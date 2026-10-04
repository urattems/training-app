/**
 * File d'attente de l'archive Drive (V1.3 spec §6), règles pures.
 * Une tâche est une INTENTION, dédupliquée par (type, clé) : la plus récente remplace l'ancienne.
 * Le contenu n'est jamais figé dans la file : il est généré au moment de l'envoi.
 */
import type { DriveFileName } from './driveNames';

/** Types de tâches de la V1.3a (les pesées et sauvegardes arrivent en V1.3b). */
export type DriveTaskType = 'session' | 'session_deleted';

/** Ordre d'envoi : séances, puis suppressions (spec §6). */
export const TASK_ORDER: readonly DriveTaskType[] = ['session', 'session_deleted'];

/** Reprise après un envoi non confirmé : 30 s, 2 min, 10 min, 1 h, puis à chaque ouverture. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000] as const;
/** Délai entre une mise en file et le premier envoi (regroupe les corrections rapprochées). */
export const ENQUEUE_DELAY_MS = 2_000;
/** Au-delà, un envoi en attente ou en erreur est signalé sur l'accueil. */
export const STALLED_AFTER_MS = 3_600_000;

export interface DriveTaskError {
  /** Code du script (`unauthorized`…) ou de l'app (`network`, `invalid_content`…). */
  code: string;
  /** Message en français. */
  message: string;
  /** Détail technique, déjà expurgé (jamais le secret ni l'URL complète). */
  detail: string;
}

export interface DriveTask {
  /** `type:clé`, ex. `session:w-0001`. */
  id: string;
  type: DriveTaskType;
  key: string;
  /** Incrémentée à chaque nouvelle intention : un envoi terminé n'efface jamais une intention plus récente. */
  revision: number;
  /** Première mise en file (encore en attente) : sert à « en attente depuis plus d'une heure ». */
  createdAt: string;
  updatedAt: string;
  attempts: number;
  /** Prochaine tentative automatique ; `null` = à la prochaine ouverture de l'app. */
  nextAttemptAt: string | null;
  status: 'pending' | 'error';
  lastAttemptAt: string | null;
  lastError: DriveTaskError | null;
}

export interface DriveOutboxState {
  tasks: DriveTask[];
  /** Dernier envoi confirmé par le script (`ok: true`). */
  lastConfirmedAt: string | null;
}

export const EMPTY_OUTBOX: DriveOutboxState = { tasks: [], lastConfirmedAt: null };

export const taskId = (type: DriveTaskType, key: string): string => `${type}:${key}`;

const iso = (time: number): string => new Date(time).toISOString();

/** Met une intention en file (ou remplace la précédente de même type et clé). */
export function enqueueTask(state: DriveOutboxState, type: DriveTaskType, key: string, now: number): DriveOutboxState {
  const id = taskId(type, key);
  const existing = state.tasks.find((t) => t.id === id);
  const task: DriveTask = {
    id,
    type,
    key,
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? iso(now),
    updatedAt: iso(now),
    attempts: 0,
    nextAttemptAt: iso(now + ENQUEUE_DELAY_MS),
    status: 'pending',
    lastAttemptAt: existing?.lastAttemptAt ?? null,
    lastError: null,
  };
  return { ...state, tasks: [...state.tasks.filter((t) => t.id !== id), task] };
}

/**
 * Prochaine tâche à envoyer, dans l'ordre (séances, suppressions ; puis ancienneté).
 * `all` (ouverture, premier plan, réseau retrouvé, « Envoyer maintenant ») : toute tâche en attente.
 * `timer` : seulement les tâches dont l'heure de reprise est passée.
 */
export function nextDueTask(state: DriveOutboxState, now: number, mode: 'all' | 'timer'): DriveTask | null {
  const due = state.tasks.filter(
    (t) => t.status === 'pending' && (mode === 'all' || (t.nextAttemptAt !== null && Date.parse(t.nextAttemptAt) <= now)),
  );
  due.sort((a, b) => TASK_ORDER.indexOf(a.type) - TASK_ORDER.indexOf(b.type) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return due[0] ?? null;
}

/** Heure de la prochaine reprise automatique (pour programmer le minuteur), `null` s'il n'y en a pas. */
export function nextWakeUp(state: DriveOutboxState): number | null {
  const times = state.tasks.filter((t) => t.status === 'pending' && t.nextAttemptAt !== null).map((t) => Date.parse(t.nextAttemptAt ?? ''));
  return times.length > 0 ? Math.min(...times) : null;
}

const sameIntention = (state: DriveOutboxState, task: DriveTask): boolean =>
  state.tasks.some((t) => t.id === task.id && t.revision === task.revision);

/** Envoi confirmé : la tâche disparaît, sauf si une intention plus récente l'a remplacée entre-temps. */
export function completeTask(state: DriveOutboxState, task: DriveTask, now: number): DriveOutboxState {
  const tasks = sameIntention(state, task) ? state.tasks.filter((t) => t.id !== task.id) : state.tasks;
  return { tasks, lastConfirmedAt: iso(now) };
}

/** Tâche devenue sans objet (séance disparue, jamais envoyée…) : retirée sans erreur. */
export function dropTask(state: DriveOutboxState, task: DriveTask): DriveOutboxState {
  return sameIntention(state, task) ? { ...state, tasks: state.tasks.filter((t) => t.id !== task.id) } : state;
}

/**
 * Échec. Réessayable : reprise programmée (30 s, 2 min, 10 min, 1 h, puis à l'ouverture).
 * Non réessayable : la tâche passe « en erreur » (visible, à réessayer ou ignorer).
 */
export function failTask(state: DriveOutboxState, task: DriveTask, error: DriveTaskError, retryable: boolean, now: number): DriveOutboxState {
  if (!sameIntention(state, task)) return state;
  const attempts = task.attempts + 1;
  const delay = RETRY_DELAYS_MS[attempts - 1];
  const updated: DriveTask = {
    ...task,
    attempts,
    lastAttemptAt: iso(now),
    lastError: error,
    status: retryable ? 'pending' : 'error',
    nextAttemptAt: retryable && delay !== undefined ? iso(now + delay) : null,
  };
  return { ...state, tasks: state.tasks.map((t) => (t.id === task.id ? updated : t)) };
}

/** « Réessayer » une tâche en erreur : remise en attente, immédiatement. */
export function retryTask(state: DriveOutboxState, id: string, now: number): DriveOutboxState {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === id ? { ...t, status: 'pending', attempts: 0, nextAttemptAt: iso(now), lastError: t.lastError } : t)),
  };
}

/** « Ignorer » une tâche en erreur : retirée de la file. */
export function ignoreTask(state: DriveOutboxState, id: string): DriveOutboxState {
  return { ...state, tasks: state.tasks.filter((t) => t.id !== id) };
}

export interface OutboxSummary {
  pending: number;
  errors: number;
  lastConfirmedAt: string | null;
  /** En attente ou en erreur depuis plus d'une heure (puce de l'accueil). */
  stalled: number;
}

export function outboxSummary(state: DriveOutboxState, now: number): OutboxSummary {
  return {
    pending: state.tasks.filter((t) => t.status === 'pending').length,
    errors: state.tasks.filter((t) => t.status === 'error').length,
    lastConfirmedAt: state.lastConfirmedAt,
    stalled: state.tasks.filter((t) => now - Date.parse(t.createdAt) > STALLED_AFTER_MS).length,
  };
}

/** Noms gelés par séance (`settings.driveNames`). */
export type DriveNames = Record<string, DriveFileName>;
