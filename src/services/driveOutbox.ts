/**
 * File d'attente persistante de l'archive Drive (V1.3 spec §6-§7), dans `settings.driveOutbox`.
 * - Mises à jour en transaction : deux événements simultanés ne perdent jamais une tâche.
 * - Un seul envoi à la fois ; contenu généré au moment de l'envoi, depuis la base.
 * - Ne lève jamais d'exception vers l'appelant : un envoi ne bloque ni ne ralentit l'interface.
 */
import { db } from '../db/database';
import { sessionDriveName } from '../domain/driveNames';
import { isCoachExportable } from '../domain/coachExport';
import {
  cancelResend,
  completeTask,
  dropTask,
  EMPTY_OUTBOX,
  enqueueTasks,
  failTask,
  ignoreTask,
  nextDueTask,
  pauseForRegression,
  resolveRegression,
  retryTask,
  SINGLETON_KEYS,
  skipEmptyBackup,
  startResend,
  type DriveNames,
  type DriveOutboxState,
  type DriveTask,
  type DriveTaskError,
  type DriveTaskType,
  type RegressionCounts,
} from '../domain/driveOutbox';
import { strings } from '../i18n/strings';
import { toLocalIsoString } from '../utils/dates';
import { technicalDetails } from '../utils/errors';
import { createDriveClient, type DriveClient, type DriveConfig, type DriveResult } from './driveClient';
import { buildBackupFile, buildSessionArchive, buildWeightFile, buildWeightsAllFile, DRIVE_PATHS, type DriveFile } from './driveContent';
import { getDriveSync, isDriveActive } from './driveSettings';
import { readStoredData, storedDataTables } from './exportService';
import { getLastWeeklyBackupAt, setLastAutoBackupAt, setLastWeeklyBackupAt } from './settingsService';
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
  return enqueueDriveTasks([{ type, key }], now);
}

/** Plusieurs intentions en UNE transaction (un événement en déclenche souvent plusieurs). */
export async function enqueueDriveTasks(items: readonly { type: DriveTaskType; key: string }[], now: Date = new Date()): Promise<boolean> {
  try {
    const config = await getDriveSync();
    if (!isDriveActive(config)) return false;
    await updateOutbox((state) => enqueueTasks(state, items, now.getTime()));
    for (const listener of enqueueListeners) listener();
    return true;
  } catch {
    return false;
  }
}

/**
 * Intention ATOMIQUE : à appeler DANS la transaction qui écrit la donnée (séance, pesée), dont la
 * portée inclut `db.settings`. Si l'app est fermée juste après, la donnée ET l'intention sont
 * écrites, ou ni l'une ni l'autre. Ne lève jamais (un incident Drive n'annule pas l'écriture) ;
 * réveiller ensuite le planificateur avec `notifyDriveQueued()`, après la transaction.
 */
export async function queueDriveTasks(items: readonly { type: DriveTaskType; key: string }[], now: Date = new Date()): Promise<boolean> {
  try {
    if (!isDriveActive(await getDriveSync())) return false;
    await updateOutbox((state) => enqueueTasks(state, items, now.getTime()));
    return true;
  } catch {
    return false;
  }
}

/** Réveille le planificateur (envoi 2 s plus tard) après une mise en file transactionnelle. */
export function notifyDriveQueued(): void {
  for (const listener of enqueueListeners) listener();
}

const BACKUP_LATEST = { type: 'backup_latest', key: SINGLETON_KEYS.backup_latest } as const;
const WEIGHTS_ALL = { type: 'weights_all', key: SINGLETON_KEYS.weights_all } as const;

/** Séance terminée, abandonnée ou corrigée : à (r)envoyer si elle est exportable (vérifié à l'envoi). */
export const notifySessionChanged = (sessionId: string): Promise<boolean> => enqueueDriveTask('session', sessionId);

/** Séance supprimée : `mark_deleted` (abandonné à l'envoi si elle n'a jamais été envoyée). */
export const notifySessionDeleted = (sessionId: string): Promise<boolean> => enqueueDriveTask('session_deleted', sessionId);

// Déclencheurs complets du tableau §7 (appelés par les services, jamais attendus par l'interface).

/** Intentions du tableau §7, à mettre en file dans la transaction de l'écriture (`queueDriveTasks`). */
export const DRIVE_TRIGGERS = {
  /** Séance terminée, abandonnée avec données ou corrigée. */
  sessionSaved: (sessionId: string) => [{ type: 'session' as const, key: sessionId }, BACKUP_LATEST],
  /** Séance supprimée (`session_deleted` abandonnée à l'envoi si jamais envoyée). */
  sessionDeleted: (sessionId: string) => [{ type: 'session_deleted' as const, key: sessionId }, BACKUP_LATEST],
  /** Pesée ajoutée, modifiée ou remplacée. */
  weightSaved: (date: string) => [{ type: 'weight' as const, key: date }, WEIGHTS_ALL, BACKUP_LATEST],
  /** Pesée supprimée. */
  weightDeleted: (date: string) => [{ type: 'weight_deleted' as const, key: date }, WEIGHTS_ALL, BACKUP_LATEST],
  /**
   * Mensuration ajoutée, modifiée ou supprimée (V1.5.0) : la sauvegarde SEULE, aucun fichier par
   * prise et aucune nouvelle action (protocole sync-2 inchangé).
   */
  measurementChanged: () => [BACKUP_LATEST],
};

/** Copie hebdomadaire due : jamais confirmée, ou dernière confirmation vieille de 7 jours ou plus. */
export function isWeeklyBackupDue(lastWeeklyBackupAt: string | null, now: Date): boolean {
  return lastWeeklyBackupAt === null || now.getTime() - Date.parse(lastWeeklyBackupAt) >= 7 * 86_400_000;
}

/** À l'ouverture de l'app : met `backup_weekly` en file si elle est due (§7). */
export async function enqueueWeeklyIfDue(now: Date = new Date()): Promise<boolean> {
  try {
    if (!isWeeklyBackupDue(await getLastWeeklyBackupAt(), now)) return false;
    return await enqueueDriveTasks([{ type: 'backup_weekly', key: SINGLETON_KEYS.backup_weekly }], now);
  } catch {
    return false;
  }
}

// --- Actions de l'utilisateur ----------------------------------------------------------

export const retryDriveTask = (id: string): Promise<DriveOutboxState> => updateOutbox((s) => retryTask(s, id, Date.now()));
export const ignoreDriveTask = (id: string): Promise<DriveOutboxState> => updateOutbox((s) => ignoreTask(s, id));

/** Refus de régression : « Remplacer quand même » (après confirmation) ou « Ignorer ». */
export async function resolveDriveRegression(choice: 'replace' | 'ignore'): Promise<void> {
  await updateOutbox((s) => resolveRegression(s, choice, Date.now()));
  for (const listener of enqueueListeners) listener();
}

/**
 * « Renvoyer toute l'archive » : toutes les séances exportables, chaque pesée, `weights_all` et
 * `backup_latest`, en une transaction, sans doublon. Renvoie le nombre de fichiers prévus.
 */
export async function resendWholeArchive(now: Date = new Date()): Promise<number> {
  const config = await getDriveSync();
  if (!isDriveActive(config)) return 0;
  const stored = await db.transaction('r', storedDataTables(), readStoredData);
  const items = [
    ...stored.workouts.filter(isCoachExportable).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map((w) => ({ type: 'session' as const, key: w.id })),
    ...stored.weights.map((w) => ({ type: 'weight' as const, key: w.date })),
    WEIGHTS_ALL,
    BACKUP_LATEST,
  ];
  await updateOutbox((s) => startResend(s, items, now.getTime()));
  for (const listener of enqueueListeners) listener();
  return items.length;
}

/** Annule le renvoi en cours (les tâches restantes du renvoi sont retirées ; relançable sans doublon). */
export const cancelWholeArchiveResend = (): Promise<DriveOutboxState> => updateOutbox(cancelResend);

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
  const invalid = (error: unknown): Promise<Outcome> =>
    // Contenu refusé par son propre schéma : rien n'est envoyé, l'erreur est visible.
    fail({ code: 'invalid_content', message: t.invalidContent, detail: redact(technicalDetails(error).join(' · '), config) }, false);
  const drop = async (): Promise<Outcome> => {
    await updateOutbox((s) => dropTask(s, task));
    return 'dropped';
  };
  const put = async (file: DriveFile, force = false) =>
    client.put(config, { folder: file.folder, name: file.name, content: file.content, meta: file.meta, ...(force && { force: true }) });
  const readStored = () => db.transaction('r', storedDataTables(), readStoredData);

  if (task.type === 'weight' || task.type === 'weights_all') {
    let file: DriveFile | null;
    try {
      const stored = await readStored();
      file = task.type === 'weight' ? buildWeightFile(stored, task.key) : buildWeightsAllFile(stored, toLocalIsoString(now()));
    } catch (error) {
      return invalid(error);
    }
    // Pesée supprimée entre-temps : `weight_deleted` s'en charge.
    if (!file) return drop();
    return handle(await put(file));
  }

  if (task.type === 'weight_deleted') {
    // Le fichier n'est jamais supprimé de Drive : la suppression est notée (`not_in_index` = succès).
    return handle(
      await client.markDeleted(config, { folder: DRIVE_PATHS.weightsFolder, name: DRIVE_PATHS.weightName(task.key), at: toLocalIsoString(now()) }),
      'not_in_index',
    );
  }

  if (task.type === 'backup_latest' || task.type === 'backup_weekly') {
    const kind = task.type;
    let file;
    try {
      file = await buildBackupFile(kind, now());
    } catch (error) {
      return invalid(error);
    }
    // Garde-fou §8.1 : jamais de sauvegarde d'une base vide.
    if (file.empty) {
      await updateOutbox((s) => skipEmptyBackup(s, task, now().getTime()));
      return 'dropped';
    }
    const result = await put(file, kind === 'backup_latest' && task.force === true);
    if (result.kind === 'rejected' && result.error === 'regression' && kind === 'backup_latest') {
      // Garde-fou §8.2 : pas de réessai ; pause et écran de choix.
      // Lecture tolérante : un compteur absent (ex. mensurations avec le script sync-2) est ignoré.
      const counts = (value: unknown): RegressionCounts => {
        const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
        const measurements = Number(v.measurements);
        return {
          sessions: Number(v.sessions ?? 0),
          weights: Number(v.weights ?? 0),
          ...(v.measurements !== undefined && v.measurements !== null && Number.isFinite(measurements) && { measurements }),
        };
      };
      await updateOutbox((s) =>
        pauseForRegression(s, task, { current: counts(result.body.current), incoming: counts(result.body.incoming), at: toLocalIsoString(now()) }, describe(result, config), now().getTime()),
      );
      return 'failed';
    }
    const outcome = await handle(result);
    // Les dates n'avancent QUE sur une réponse confirmée (`ok: true`), avec l'instant du contenu.
    if (outcome === 'confirmed') {
      if (kind === 'backup_latest') await setLastAutoBackupAt(file.exportedAt);
      else await setLastWeeklyBackupAt(file.exportedAt);
    }
    return outcome;
  }

  if (task.type === 'session') {
    const stored = await db.transaction('r', storedDataTables(), readStoredData);
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
