import { db } from '../db/database';
import type { HistoryExport, StoredProgram, UserPreferences, WorkoutSession } from '../domain/types';
import { SCHEMA_VERSION } from '../schemas/common';
import { toLocalDateString, toLocalIsoString } from '../utils/dates';
import { toTrainingProgram } from './programService';
import { getActiveProgramId, getPreferences, setLastExportAt } from './settingsService';

export interface StoredData {
  programs: StoredProgram[];
  workouts: WorkoutSession[];
  activeProgramId: string | null;
  preferences: UserPreferences;
}

/** Lit toutes les données (à appeler dans une transaction pour un instantané cohérent). */
export async function readStoredData(): Promise<StoredData> {
  const [programs, workouts, activeProgramId, preferences] = await Promise.all([
    db.programs.toArray(),
    db.workouts.toArray(),
    getActiveProgramId(),
    getPreferences(),
  ]);
  return { programs, workouts, activeProgramId, preferences };
}

/**
 * Modèle domaine → format unique `training_history_export` (export coach + sauvegarde, SPEC §10.2).
 * Programmes archivés inclus ; champs internes retirés ; ordre chronologique.
 */
export function toHistoryExport(data: StoredData, exportedAt: string): HistoryExport {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'training_history_export',
    exportedAt,
    locale: 'fr-FR',
    unitSystem: 'metric',
    activeProgramId: data.activeProgramId,
    preferences: { ...data.preferences },
    programs: [...data.programs]
      .sort((a, b) => Date.parse(a.importedAt) - Date.parse(b.importedAt))
      .map(toTrainingProgram),
    sessions: [...data.workouts].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
  };
}

export async function buildHistoryExport(now: Date = new Date()): Promise<HistoryExport> {
  const data = await db.transaction('r', db.programs, db.workouts, db.settings, readStoredData);
  return toHistoryExport(data, toLocalIsoString(now));
}

export const serializeExport = (data: HistoryExport): string => `${JSON.stringify(data, null, 2)}\n`;

export const exportFileName = (now: Date): string => `training-backup-${toLocalDateString(now)}.json`;

export type DeliveryOutcome = 'shared' | 'downloaded' | 'cancelled';

/** API navigateur nécessaires, injectables pour les tests. */
export interface DeliveryEnv {
  navigator: Partial<Pick<Navigator, 'canShare' | 'share'>>;
  download: (file: File) => void;
}

function browserDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Laisse au navigateur le temps de démarrer le téléchargement avant de libérer l'URL.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

const defaultEnv = (): DeliveryEnv => ({ navigator, download: browserDownload });

/**
 * Web Share de fichiers disponible ? Absent hors contexte sécurisé (HTTP sur IP locale)
 * et sur certains navigateurs ; `canShare` peut aussi lever une exception : repli silencieux.
 */
function canShareFile(nav: DeliveryEnv['navigator'], file: File): boolean {
  if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false;
  try {
    return nav.canShare.call(nav, { files: [file] });
  } catch {
    return false;
  }
}

/**
 * Remet le fichier à l'utilisateur : Web Share en priorité (feuille de partage iOS),
 * téléchargement en secours (SPEC §10.2). Doit être appelé depuis un geste utilisateur.
 */
export async function deliverFile(file: File, env: DeliveryEnv = defaultEnv()): Promise<DeliveryOutcome> {
  if (canShareFile(env.navigator, file)) {
    const share = env.navigator.share as NonNullable<Navigator['share']>;
    try {
      await share.call(env.navigator, { files: [file], title: file.name });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Partage refusé (ex. geste utilisateur expiré) : on bascule sur le téléchargement.
    }
  }
  env.download(file);
  return 'downloaded';
}

/** « Exporter mes données » : construit, remet le fichier et mémorise la date d'export. */
export async function exportData(now: Date = new Date(), env?: DeliveryEnv): Promise<DeliveryOutcome> {
  const data = await buildHistoryExport(now);
  const file = new File([serializeExport(data)], exportFileName(now), { type: 'application/json' });
  const outcome = await deliverFile(file, env);
  if (outcome !== 'cancelled') await setLastExportAt(data.exportedAt);
  return outcome;
}
