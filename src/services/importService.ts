import { db } from '../db/database';
import type { HistoryExport, StoredProgram } from '../domain/types';
import { strings } from '../i18n/strings';
import { importFailure, type DocumentKind, type ImportFailure } from '../schemas/errors';
import { parseHistoryJson, sourceSchemaVersion } from '../schemas/parse';
import { toLocalIsoString } from '../utils/dates';
import { err, ok, type Result } from '../utils/result';
import { readStoredData, toHistoryExport } from './exportService';
import { getLastCoachExportAt, getLastExportAt } from './settingsService';

/** Lecture d'un fichier choisi par l'utilisateur. */
export async function readFileText(file: Blob, doc: DocumentKind): Promise<Result<string, ImportFailure>> {
  try {
    return ok(await file.text());
  } catch (e) {
    return err(importFailure('unreadable_file', doc, strings.import.unreadableFile, [String(e)]));
  }
}

export interface RestorePreview {
  data: HistoryExport;
  exportedAt: string;
  /** Version écrite dans le fichier (avant migration : « 1.0 » pour une sauvegarde V1). */
  schemaVersion: string;
  programCount: number;
  sessionCount: number;
  /** Pesées du fichier (0 pour une sauvegarde 1.0). */
  weightCount: number;
}

/** Valide une sauvegarde et prépare le résumé avant confirmation (SPEC §10.3). Rien n'est écrit. */
export function previewRestore(text: string): Result<RestorePreview, ImportFailure> {
  const parsed = parseHistoryJson(text);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  return ok({
    data,
    exportedAt: data.exportedAt,
    schemaVersion: sourceSchemaVersion(text) ?? data.schemaVersion,
    programCount: data.programs.length,
    sessionCount: data.sessions.length,
    weightCount: data.weightEntries.length,
  });
}

/** Nombre de pesées actuellement dans l'app (avertissement avant restauration). */
export const countWeights = (): Promise<number> => db.weights.count();

/**
 * Remplace toutes les données par la sauvegarde, en UNE transaction (atomique) :
 * lecture de l'existant → clear → `preRestoreBackup` (écrit après le clear pour lui
 * survivre) → écriture des données restaurées. Tout échec annule l'ensemble.
 * L'export de sécurité par l'utilisateur a lieu avant, dans l'UI (DECISIONS.md).
 */
export async function restoreBackup(data: HistoryExport, now: Date = new Date()): Promise<void> {
  const stamp = toLocalIsoString(now);
  await db.transaction('rw', [db.programs, db.workouts, db.settings, db.metadata, db.weights], async () => {
    const current = toHistoryExport(await readStoredData(), stamp);
    const lastExportAt = await getLastExportAt();
    const lastCoachExportAt = await getLastCoachExportAt();

    await Promise.all([db.programs.clear(), db.workouts.clear(), db.settings.clear(), db.metadata.clear(), db.weights.clear()]);
    await db.metadata.put({ key: 'preRestoreBackup', savedAt: stamp, data: current });

    const programs: StoredProgram[] = data.programs.map((program) => ({
      ...program,
      importedAt: stamp,
      archivedAt: program.programId === data.activeProgramId ? null : stamp,
    }));
    await db.programs.bulkPut(programs);
    await db.workouts.bulkPut(data.sessions);
    await db.weights.bulkPut(data.weightEntries);
    await db.settings.bulkPut([
      { key: 'activeProgramId', value: data.activeProgramId },
      { key: 'preferences', value: data.preferences },
      { key: 'lastExportAt', value: lastExportAt },
    ]);
    // Historique d'envoi au coach propre à l'appareil : conservé tel quel.
    if (lastCoachExportAt !== null) await db.settings.put({ key: 'lastCoachExportAt', value: lastCoachExportAt });
  });
}
