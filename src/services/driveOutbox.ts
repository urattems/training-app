/**
 * File d'attente persistante de l'archive Drive (V1.3 spec §6-§7), dans `settings.driveOutbox`.
 * - Mises à jour en transaction : deux événements simultanés ne perdent jamais une tâche.
 * - Un seul envoi à la fois ; contenu généré au moment de l'envoi, depuis la base.
 * - Ne lève jamais d'exception vers l'appelant : un envoi ne bloque ni ne ralentit l'interface.
 */
import { db } from '../db/database';
import { sessionDriveName } from '../domain/driveNames';
import {
  completeTask,
  dropTask,
  EMPTY_OUTBOX,
  enqueueTask,
  failTask,
  ignoreTask,
  nextDueTask,
  retryTask,
  type DriveNames,
  type DriveOutboxState,
  type DriveTask,
  type DriveTaskError,
  type DriveTaskType,
} from '../domain/driveOutbox';
import { strings } from '../i18n/strings';
import { toLocalIsoString } from '../utils/dates';
import { technicalDetails } from '../utils/errors';
import { createDriveClient, type DriveClient, type DriveConfig, type DriveResult } from './driveClient';
import { buildSessionArchive } from './driveContent';
import { getDriveSync, isDriveActive } from './driveSettings';
import { readStoredData } from './exportService';
import { redact } from '../domain/driveNames';

const t = strings.drive;

// --- Lecture / écriture transactionnelles ----------------------------------------------

export async function getOutbox(): Promise<DriveOutboxState> {
  const record = await db.settings.get('driveOutbox');
  return record?.key === 'driveOutbox' ? record.value : EMPTY_OUTBOX;
}

export async function getDriveNames(): Promise<DriveNames> {
  const record = await db.settings.get('driveNames');
  return record?.key === 'driveNames' ? record.value : {};
}

/** Lecture-modification-écriture de la file dans UNE transaction (aucune tâche perdue). */
async function updateOutbox(update: (state: DriveOutboxState) => DriveOutboxState): Promise<DriveOutboxState> {
  return db.transaction('rw', db.settings, async () => {
    const next = update(await getOutbox());
    await db.settings.put({ key: 'driveOutbox', value: next });
    return next;
  });
}

// --- Évènements (pour le planificateur et l'état « envoi en cours ») ----------------------

type Listener = () => void;
const enqueueListeners = new Set<Listener>();
const sendingListeners = new Set<Listener>();
let sending = false;

/** Prévenu à chaque mise en file (le planificateur programme l'envoi 2 s plus tard). */
export function onEnqueue(listener: Listener): () => void {
  enqueueListeners.add(listener);
  return () => {
    enqueueListeners.delete(listener);
  };
}

export const isSending = (): boolean => sending;

export function subscribeSending(listener: Listener): () => void {
  sendingListeners.add(listener);
  return () => {
    sendingListeners.delete(listener);
  };
}

const setSending = (value: boolean) => {
  sending = value;
  for (const listener of sendingListeners) listener();
};

// --- Mise en file (déclencheurs, spec §7) -------------------------------------------

/**
 * Met une intention en file SEULEMENT si l'envoi est actif. Ne lève jamais : un incident
 * ici ne doit jamais empêcher de terminer, corriger ou supprimer une séance.
 */
export async function enqueueDriveTask(type: DriveTaskType, key: string, now: Date = new Date()): Promise<boolean> {
  try {
    const config = await getDriveSync();
    if (!isDriveActive(config)) return false;
    await updateOutbox((state) => enqueueTask(state, type, key, now.getTime()));
    for (const listener of enqueueListeners) listener();
    return true;
  } catch {
    return false;
  }
}

/** Séance terminée, abandonnée ou corrigée : à (r)envoyer si elle est exportable (vérifié à l'envoi). */
export const notifySessionChanged = (sessionId: string): Promise<boolean> => enqueueDriveTask('session', sessionId);

/** Séance supprimée : `mark_deleted` (abandonné à l'envoi si elle n'a jamais été envoyée). */
export const notifySessionDeleted = (sessionId: string): Promise<boolean> => enqueueDriveTask('session_deleted', sessionId);

// --- Actions de l'utilisateur ----------------------------------------------------------

export const retryDriveTask = (id: string): Promise<DriveOutboxState> => updateOutbox((s) => retryTask(s, id, Date.now()));
export const ignoreDriveTask = (id: string): Promise<DriveOutboxState> => updateOutbox((s) => ignoreTask(s, id));

// --- Envoi ------------------------------------------------------------------------------

let client: DriveClient = createDriveClient();

/** Remplace le client (tests : `fetch` simulé ; jamais l'URL réelle du script). */
export function setDriveClient(next: DriveClient): void {
  client = next;
}

export const getDriveClient = (): DriveClient => client;

/** Message français d'un résultat non confirmé ou rejeté. */
function describe(result: Exclude<DriveResult, { kind: 'confirmed' }>, config: DriveConfig): DriveTaskError {
  if (result.kind === 'rejected') {
    const known = t.serverErrors[result.error as keyof typeof t.serverErrors] as string | undefined;
    return {
      code: result.error,
      message: known ?? t.serverErrors.unknown,
      detail: redact(`requestId ${result.requestId} · ${JSON.stringify(result.body)}`, config).slice(0, 300),
    };
  }
  return {
    code: result.reason,
    message: t.unconfirmed[result.reason],
    detail: redact(`requestId ${result.requestId} · ${result.status === null ? '' : `HTTP ${String(result.status)} · `}${result.detail}`, config),
  };
}

type Outcome = 'confirmed' | 'dropped' | 'failed' | 'stopped';

/** Gel des noms à la première tentative (spec §4) : réutilisés ensuite, même après correction de date. */
async function frozenName(sessionId: string, compute: () => { folder: string; name: string }) {
  return db.transaction('rw', db.settings, async () => {
    const names = await getDriveNames();
    const existing = names[sessionId];
    if (existing) return existing;
    const name = compute();
    await db.settings.put({ key: 'driveNames', value: { ...names, [sessionId]: name } });
    return name;
  });
}

async function sendTask(task: DriveTask, config: DriveConfig, now: () => Date): Promise<Outcome> {
  const fail = async (error: DriveTaskError, retryable: boolean): Promise<Outcome> => {
    await updateOutbox((s) => failTask(s, task, error, retryable, now().getTime()));
    return retryable ? 'stopped' : 'failed';
  };
  const handle = async (result: DriveResult, acceptAlso?: string): Promise<Outcome> => {
    if (result.kind === 'confirmed' || (result.kind === 'rejected' && result.error === acceptAlso)) {
      await updateOutbox((s) => completeTask(s, task, now().getTime()));
      return 'confirmed';
    }
    const retryable = result.kind === 'unconfirmed' || result.retryable;
    return fail(describe(result, config), retryable);
  };

  if (task.type === 'session') {
    const stored = await db.transaction('r', [db.programs, db.workouts, db.settings, db.weights], readStoredData);
    const session = stored.workouts.find((w) => w.id === task.key);
    let archive;
    try {
      archive = buildSessionArchive(stored, task.key, toLocalIsoString(now()));
    } catch (error) {
      // Contenu refusé par son propre schéma : rien n'est envoyé, l'erreur est visible.
      return fail({ code: 'invalid_content', message: t.invalidContent, detail: redact(technicalDetails(error).join(' · '), config) }, false);
    }
    if (!archive || !session) {
      await updateOutbox((s) => dropTask(s, task));
      return 'dropped';
    }
    const name = await frozenName(task.key, () => sessionDriveName(stored.programs, session));
    return handle(await client.put(config, { folder: name.folder, name: name.name, content: archive.content, meta: archive.meta }));
  }

  // Suppression : seulement si la séance a déjà été (au moins tentée d'être) envoyée.
  const name = (await getDriveNames())[task.key];
  if (!name) {
    await updateOutbox((s) => dropTask(s, task));
    return 'dropped';
  }
  // `not_in_index` : le script ne connaît pas le fichier, il n'y a rien à marquer : succès.
  return handle(await client.markDeleted(config, { folder: name.folder, name: name.name, at: toLocalIsoString(now()) }), 'not_in_index');
}

let running: Promise<void> | null = null;

/**
 * Envoie les tâches dues, une à la fois, dans l'ordre. Un envoi non confirmé arrête la passe
 * (reprise programmée). Sans configuration active : ne fait RIEN (zéro requête).
 * Appels concurrents : regroupés sur la passe en cours.
 */
export function processDriveOutbox(mode: 'all' | 'timer' = 'all', now: () => Date = () => new Date()): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      const config = await getDriveSync();
      if (!isDriveActive(config)) return;
      setSending(true);
      const attempted = new Set<string>();
      for (;;) {
        const task = nextDueTask(await getOutbox(), now().getTime(), mode);
        // Une tâche n'est tentée qu'une fois par passe : une intention renouvelée pendant l'envoi
        // attend la passe suivante (2 s plus tard), jamais de boucle d'envois.
        if (!task || attempted.has(task.id)) break;
        attempted.add(task.id);
        const outcome = await sendTask(task, { url: config.url, secret: config.secret }, now);
        if (outcome === 'stopped') break;
        // Configuration modifiée ou désactivée pendant la passe : on s'arrête.
        if (!isDriveActive(await getDriveSync())) break;
      }
    } catch {
      // Jamais d'exception vers l'interface : la file reste en place pour la prochaine passe.
    } finally {
      setSending(false);
      running = null;
    }
  })();
  return running;
}
