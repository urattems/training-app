/**
 * File d'attente de l'archive Drive (V1.3 spec §6), règles pures.
 * Une tâche est une INTENTION, dédupliquée par (type, clé) : la plus récente remplace l'ancienne.
 * Le contenu n'est jamais figé dans la file : il est généré au moment de l'envoi.
 */
import type { DriveFileName } from './driveNames';

/**
 * Types de tâches (spec §6). Clés : id de séance, date de pesée ou de mensuration, ou `all` /
 * `latest` / `weekly`. `measurement_deleted` (V1.6.2) : suppression d'une prise de mensurations,
 * notée par `note_deletion` (script sync-3) ; aucun fichier par prise.
 */
export type DriveTaskType =
  | 'session'
  | 'session_deleted'
  | 'weight'
  | 'weight_deleted'
  | 'measurement_deleted'
  | 'weights_all'
  | 'backup_latest'
  | 'backup_weekly';

/**
 * Ordre d'envoi (spec §6) : séances, suppressions de séances, pesées (et leurs suppressions),
 * regroupement des pesées, puis les sauvegardes EN DERNIER (elles reflètent tout le reste).
 */
export const TASK_ORDER: readonly DriveTaskType[] = [
  'session',
  'session_deleted',
  'weight',
  'weight_deleted',
  // Toujours AVANT la sauvegarde : le script doit connaître la suppression avant la baisse du compteur.
  'measurement_deleted',
  'weights_all',
  'backup_latest',
  'backup_weekly',
];

/** Suppressions à faire connaître au script AVANT la sauvegarde (`mark_deleted`, `note_deletion`). */
export const DELETION_TYPES: ReadonlySet<DriveTaskType> = new Set(['session_deleted', 'weight_deleted', 'measurement_deleted']);

/** Clés uniques des tâches sans objet propre : une seule de chaque en file (fusion). */
export const SINGLETON_KEYS = { weights_all: 'all', backup_latest: 'latest', backup_weekly: 'weekly' } as const;

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
  /** `paused` : `backup_latest` refusée pour régression, en attente du choix de l'utilisateur (§8.2). */
  status: 'pending' | 'error' | 'paused';
  lastAttemptAt: string | null;
  lastError: DriveTaskError | null;
  /** `backup_latest` : renvoi avec `force: true` après « Remplacer quand même ». */
  force?: boolean;
}

/** Contenu de Drive vs contenu de l'app lors d'un refus de régression (réponse du script). */
export interface RegressionCounts {
  sessions: number;
  weights: number;
  /** V1.5.0 : seulement si le script le renvoie (absent avec le script sync-2). */
  measurements?: number;
}

export interface RegressionInfo {
  current: RegressionCounts;
  incoming: RegressionCounts;
  at: string;
}

/** Progression de « Renvoyer toute l'archive » : tâches mises en file (id + révision). */
export interface ResendState {
  startedAt: string;
  entries: { id: string; revision: number }[];
}

export interface DriveOutboxState {
  tasks: DriveTask[];
  /** Dernier envoi confirmé par le script (`ok: true`). */
  lastConfirmedAt: string | null;
  /** Refus de régression en attente de choix (Restaurer / Remplacer quand même / Ignorer). */
  regression?: RegressionInfo | null;
  /** Dernière sauvegarde NON envoyée car la base était vide (§8.1). */
  emptySkipAt?: string | null;
  /** « Renvoyer toute l'archive » en cours ou terminé. */
  resend?: ResendState | null;
}

export const EMPTY_OUTBOX: DriveOutboxState = { tasks: [], lastConfirmedAt: null };

export const taskId = (type: DriveTaskType, key: string): string => `${type}:${key}`;

const iso = (time: number): string => new Date(time).toISOString();

/** Met une intention en file (ou remplace la précédente de même type et clé). */
export function enqueueTask(state: DriveOutboxState, type: DriveTaskType, key: string, now: number): DriveOutboxState {
  const id = taskId(type, key);
  const existing = state.tasks.find((t) => t.id === id);
  // Sauvegarde en pause (régression) : la nouvelle intention la remplace mais reste en pause
  // jusqu'au choix de l'utilisateur (« L'app ne réessaie pas »).
  const paused = existing?.status === 'paused';
  const task: DriveTask = {
    id,
    type,
    key,
    revision: (existing?.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? iso(now),
    updatedAt: iso(now),
    attempts: 0,
    nextAttemptAt: paused ? null : iso(now + ENQUEUE_DELAY_MS),
    status: paused ? 'paused' : 'pending',
    lastAttemptAt: existing?.lastAttemptAt ?? null,
    lastError: paused ? (existing.lastError ?? null) : null,
  };
  return { ...state, tasks: [...state.tasks.filter((t) => t.id !== id), task] };
}

/** Plusieurs intentions d'un coup (un événement en déclenche souvent 2 ou 3). */
export function enqueueTasks(state: DriveOutboxState, items: readonly { type: DriveTaskType; key: string }[], now: number): DriveOutboxState {
  return items.reduce((s, item) => enqueueTask(s, item.type, item.key, now), state);
}

/**
 * Prochaine tâche à envoyer, dans l'ordre (séances, suppressions ; puis ancienneté).
 * `all` (ouverture, premier plan, réseau retrouvé, « Envoyer maintenant ») : toute tâche en attente.
 * `timer` : seulement les tâches dont l'heure de reprise est passée.
 */
export function nextDueTask(state: DriveOutboxState, now: number, mode: 'all' | 'timer'): DriveTask | null {
  // Tant qu'une suppression n'est pas confirmée par le script (en attente ou en erreur), `backup_latest`
  // attend : envoyée avant, elle compterait une donnée en moins que le script ne sait pas encore
  // supprimée et serait refusée à tort comme une régression. V1.6.2 : mensurations ; V1.6.3 :
  // séances et pesées (`mark_deleted`), même règle.
  const deletionPending = state.tasks.some((t) => DELETION_TYPES.has(t.type));
  const due = state.tasks.filter(
    (t) =>
      t.status === 'pending' &&
      !(deletionPending && t.type === 'backup_latest') &&
      (mode === 'all' || (t.nextAttemptAt !== null && Date.parse(t.nextAttemptAt) <= now)),
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
  // Le reste de l'état (régression, base vide, renvoi en cours) est conservé.
  return { ...state, tasks, lastConfirmedAt: iso(now) };
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
  /** Sauvegardes en pause (refus de régression). */
  paused: number;
  lastConfirmedAt: string | null;
  /** En attente ou en erreur depuis plus d'une heure (puce de l'accueil). */
  stalled: number;
}

export function outboxSummary(state: DriveOutboxState, now: number): OutboxSummary {
  return {
    pending: state.tasks.filter((t) => t.status === 'pending').length,
    errors: state.tasks.filter((t) => t.status === 'error').length,
    paused: state.tasks.filter((t) => t.status === 'paused').length,
    lastConfirmedAt: state.lastConfirmedAt,
    stalled: state.tasks.filter((t) => t.status !== 'paused' && now - Date.parse(t.createdAt) > STALLED_AFTER_MS).length,
  };
}

/** Noms gelés par séance (`settings.driveNames`). */
export type DriveNames = Record<string, DriveFileName>;

// --- Garde-fous des sauvegardes (spec §8) ------------------------------------------------

/** Refus de régression : `backup_latest` en pause, PAS de réessai, information pour l'écran de choix. */
export function pauseForRegression(state: DriveOutboxState, task: DriveTask, info: RegressionInfo, error: DriveTaskError, now: number): DriveOutboxState {
  if (!sameIntention(state, task)) return state;
  const paused: DriveTask = { ...task, status: 'paused', nextAttemptAt: null, attempts: task.attempts + 1, lastAttemptAt: iso(now), lastError: error, force: false };
  return { ...state, regression: info, tasks: state.tasks.map((t) => (t.id === task.id ? paused : t)) };
}

/**
 * Choix après un refus de régression :
 * - `replace` (« Remplacer quand même », après confirmation) : renvoi immédiat avec `force: true` ;
 * - `ignore` : la sauvegarde en attente est abandonnée (une prochaine modification la relancera).
 * « Restaurer depuis mon Drive » n'est qu'une explication : la pause reste en place.
 */
export function resolveRegression(state: DriveOutboxState, choice: 'replace' | 'ignore', now: number): DriveOutboxState {
  const id = taskId('backup_latest', SINGLETON_KEYS.backup_latest);
  const tasks =
    choice === 'ignore'
      ? state.tasks.filter((t) => t.id !== id)
      : state.tasks.map((t) => (t.id === id ? { ...t, status: 'pending' as const, force: true, attempts: 0, nextAttemptAt: iso(now) } : t));
  return { ...state, regression: null, tasks };
}

/** Base vide : aucune sauvegarde envoyée (tâche retirée, statut visible). */
export function skipEmptyBackup(state: DriveOutboxState, task: DriveTask, now: number): DriveOutboxState {
  return { ...dropTask(state, task), emptySkipAt: iso(now) };
}

// --- « Renvoyer toute l'archive » (spec §10) ---------------------------------------------

/** Met en file tout ce qui est donné (sans doublon : intentions dédupliquées) et mémorise la progression. */
export function startResend(state: DriveOutboxState, items: readonly { type: DriveTaskType; key: string }[], now: number): DriveOutboxState {
  const next = enqueueTasks(state, items, now);
  const ids = [...new Set(items.map((i) => taskId(i.type, i.key)))];
  const entries = ids.map((id) => ({ id, revision: next.tasks.find((t) => t.id === id)?.revision ?? 0 }));
  return { ...next, resend: { startedAt: iso(now), entries } };
}

/** Progression : une tâche est « faite » quand l'intention mémorisée n'est plus en file. */
export function resendProgress(state: DriveOutboxState): { done: number; total: number } | null {
  if (!state.resend) return null;
  const { entries } = state.resend;
  const remaining = entries.filter((e) => state.tasks.some((t) => t.id === e.id && t.revision === e.revision)).length;
  return { done: entries.length - remaining, total: entries.length };
}

/**
 * Annulation : retire les tâches encore en attente du renvoi (celles renouvelées depuis par un vrai
 * événement sont gardées). Relancer plus tard reprend sans doublon (déduplication).
 */
export function cancelResend(state: DriveOutboxState): DriveOutboxState {
  if (!state.resend) return state;
  const { entries } = state.resend;
  const tasks = state.tasks.filter((t) => !entries.some((e) => e.id === t.id && e.revision === t.revision && t.status !== 'paused'));
  return { ...state, tasks, resend: null };
}
