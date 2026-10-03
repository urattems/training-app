import { db } from '../db/database';
import { listCoachExportable } from '../domain/coachExport';
import { SCHEMA_VERSION } from '../schemas/common';
import { COACH_EXPORT_TYPE, type CoachExport, type CoachSelectionMode } from '../schemas/coachExport.schema';
import { parseCoachExportJson } from '../schemas/parse';
import { canonicalJson } from '../utils/canonicalJson';
import { toLocalDateString, toLocalIsoString } from '../utils/dates';
import { browserDownload, deliverFile, ExportIntegrityError, readStoredData, type DeliveryEnv, type DeliveryOutcome, type StoredData } from './exportService';
import { toTrainingProgram } from './programService';
import { setLastCoachExportAt } from './settingsService';

/** Choix de l'utilisateur sur l'écran de sélection. */
export interface CoachSelectionRequest {
  selectedIds: readonly string[];
  mode: CoachSelectionMode;
}

/**
 * Données → `training_coach_export` (SPEC §10.6). Seules les séances exportables choisies
 * partent (une séance en cours ou vide est ignorée même si elle était demandée), en ordre
 * chronologique croissant, avec le programme actif et ceux qu'elles référencent.
 */
export function toCoachExport(data: StoredData, request: CoachSelectionRequest, exportedAt: string): CoachExport {
  const exportable = listCoachExportable(data.workouts);
  const wanted = new Set(request.selectedIds);
  const sessions = exportable.filter((w) => wanted.has(w.id)).reverse();
  const first = sessions[0];
  const last = sessions.at(-1);
  if (!first || !last) throw new Error('Aucune séance sélectionnée.');

  const needed = new Set(sessions.map((s) => s.programId));
  if (data.activeProgramId !== null) needed.add(data.activeProgramId);
  return {
    schemaVersion: SCHEMA_VERSION,
    type: COACH_EXPORT_TYPE,
    exportedAt,
    locale: 'fr-FR',
    unitSystem: 'metric',
    activeProgramId: data.activeProgramId,
    selection: {
      mode: request.mode,
      sessionCount: sessions.length,
      totalExportableSessions: exportable.length,
      firstSessionDate: first.date,
      lastSessionDate: last.date,
    },
    programs: data.programs
      .filter((p) => needed.has(p.programId))
      .sort((a, b) => Date.parse(a.importedAt) - Date.parse(b.importedAt))
      .map(toTrainingProgram),
    sessions,
  };
}

/** Fichier : indenté, lisible par un humain. */
export const serializeCoachExport = (data: CoachExport): string => `${JSON.stringify(data, null, 2)}\n`;
/** Copie pour ChatGPT : JSON compact (moins de tokens), sans aucun texte ajouté. */
export const compactCoachExport = (data: CoachExport): string => JSON.stringify(data);

export const coachExportFileName = (now: Date): string => `training-coach-${toLocalDateString(now)}.json`;

/** Autotest avant remise : chaque texte livré est relu avec le schéma et les invariants dédiés. */
export function verifyCoachExportIntegrity(text: string, data: CoachExport): void {
  const parsed = parseCoachExportJson(text);
  if (!parsed.ok) throw new ExportIntegrityError([parsed.error.message, ...parsed.error.details]);
  if (canonicalJson(parsed.value) !== canonicalJson(data)) {
    throw new ExportIntegrityError(['Le fichier relu diffère des données exportées.']);
  }
}

export interface PreparedCoachExport {
  data: CoachExport;
  json: string;
  compactJson: string;
  file: File;
}

/**
 * Prépare l'export pour le coach AVANT le geste (lecture cohérente, sérialisation, autotest
 * des deux textes, `File`) : au toucher, `share` ou `writeText` part sans attente.
 */
export async function prepareCoachExport(request: CoachSelectionRequest, now: Date = new Date()): Promise<PreparedCoachExport> {
  const stored = await db.transaction('r', db.programs, db.workouts, db.settings, readStoredData);
  const data = toCoachExport(stored, request, toLocalIsoString(now));
  const json = serializeCoachExport(data);
  const compactJson = compactCoachExport(data);
  verifyCoachExportIntegrity(json, data);
  verifyCoachExportIntegrity(compactJson, data);
  return { data, json, compactJson, file: new File([json], coachExportFileName(now), { type: 'application/json' }) };
}

/**
 * Remet le fichier (partage, sinon téléchargement). `lastCoachExportAt` n'est écrit que si
 * l'envoi a eu lieu ; `lastExportAt` n'est JAMAIS touché (ce n'est pas une sauvegarde).
 */
export async function deliverPreparedCoachExport(prepared: PreparedCoachExport, env?: DeliveryEnv): Promise<DeliveryOutcome> {
  const outcome = await deliverFile(prepared.file, env);
  if (outcome !== 'cancelled') await setLastCoachExportAt(prepared.data.exportedAt);
  return outcome;
}

/** Repli explicite après un échec de copie : téléchargement direct du fichier. */
export async function downloadPreparedCoachExport(prepared: PreparedCoachExport, download: (file: File) => void = browserDownload): Promise<void> {
  download(prepared.file);
  await setLastCoachExportAt(prepared.data.exportedAt);
}

export type CopyOutcome = 'copied' | 'unavailable';

const defaultClipboard = (): Partial<Clipboard> | undefined => (navigator as Partial<Navigator>).clipboard;

/**
 * « Copier pour ChatGPT » : `writeText` est appelé immédiatement, dans le geste, avec le texte
 * déjà préparé. Presse-papiers absent ou refusé → `unavailable` (rien n'est écrit).
 */
export async function copyCoachExport(
  prepared: PreparedCoachExport,
  clipboard: Partial<Clipboard> | undefined = defaultClipboard(),
): Promise<CopyOutcome> {
  if (typeof clipboard?.writeText !== 'function') return 'unavailable';
  try {
    await clipboard.writeText(prepared.compactJson);
  } catch {
    return 'unavailable';
  }
  await setLastCoachExportAt(prepared.data.exportedAt);
  return 'copied';
}
