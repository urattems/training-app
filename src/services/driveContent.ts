/**
 * Contenu d'un fichier de séance de l'archive Drive (V1.3 spec §5) : un `training_coach_export`
 * 1.1 contenant CETTE seule séance et son programme, validé par son schéma AVANT tout envoi.
 */
import { isCoachExportable } from '../domain/coachExport';
import type { WorkoutSession } from '../domain/types';
import type { CoachExport } from '../schemas/coachExport.schema';
import { serializeCoachExport, toCoachExport, verifyCoachExportIntegrity } from './coachExportService';
import { parseWeightEntryFile, parseWeightLog, serializeArchive, toWeightEntryFile, toWeightLog, verifyArchiveText } from '../schemas/weightArchive.schema';
import { toLocalDateString } from '../utils/dates';
import type { Result } from '../utils/result';
import { prepareExport, type StoredData } from './exportService';

export interface SessionArchive {
  data: CoachExport;
  content: string;
  meta: {
    kind: 'session';
    sessionId: string;
    date: string;
    sessionName: string;
    status: WorkoutSession['status'];
    programId: string;
    weekLabel: string;
  };
}

/**
 * `null` si la séance n'est plus exportable (en cours, vide, disparue) : la tâche est alors
 * abandonnée sans erreur. Lève `ExportIntegrityError` si le contenu ne passe pas son schéma.
 */
export function buildSessionArchive(stored: StoredData, sessionId: string, exportedAt: string): SessionArchive | null {
  const session = stored.workouts.find((w) => w.id === sessionId);
  if (!session || !isCoachExportable(session)) return null;
  const program = stored.programs.find((p) => p.programId === session.programId);
  // Seulement le programme de la séance ; le programme actif n'est cité que s'il s'agit de lui.
  const scoped: StoredData = {
    ...stored,
    programs: program ? [program] : [],
    activeProgramId: stored.activeProgramId === session.programId ? session.programId : null,
  };
  const data = toCoachExport(scoped, { mode: 'manual', selectedIds: [sessionId], weights: null }, exportedAt);
  const content = serializeCoachExport(data);
  verifyCoachExportIntegrity(content, data);
  return {
    data,
    content,
    meta: {
      kind: 'session',
      sessionId,
      date: session.date,
      sessionName: session.sessionName,
      status: session.status,
      programId: session.programId,
      weekLabel: program?.week.label ?? '',
    },
  };
}

// --- Pesées et sauvegardes (V1.3b, spec §3-§5) -------------------------------------------

/** Arbre Drive (spec §3) : dossiers et noms fixes. */
export const DRIVE_PATHS = {
  weightsFolder: 'Pesees',
  weightsAll: '_pesees.json',
  backupsFolder: 'Sauvegardes',
  backupLatest: 'sauvegarde-derniere.json',
  weeklyName: (localDate: string) => `${localDate}_hebdo.json`,
  weightName: (date: string) => `${date}.json`,
} as const;

/** Fichier prêt à envoyer : emplacement, contenu validé, `meta`. */
export interface DriveFile {
  folder: string;
  name: string;
  content: string;
  meta: Record<string, unknown>;
}

/** Contenu refusé par son propre schéma : jamais envoyé. */
export class ArchiveContentError extends Error {
  constructor(readonly details: string[]) {
    super(`Contenu non conforme : ${details.join(' ; ')}`);
    this.name = 'ArchiveContentError';
  }
}

function checked<T>(value: T, parse: (text: string) => Result<T, string[]>): string {
  const content = serializeArchive(value);
  const problems = verifyArchiveText(content, value, parse);
  if (problems.length > 0) throw new ArchiveContentError(problems);
  return content;
}

/** `Pesees/AAAA-MM-JJ.json` (`weight_entry`) ; `null` si la pesée n'existe plus. */
export function buildWeightFile(stored: StoredData, date: string): DriveFile | null {
  const entry = stored.weights.find((w) => w.date === date);
  if (!entry) return null;
  return {
    folder: DRIVE_PATHS.weightsFolder,
    name: DRIVE_PATHS.weightName(date),
    content: checked(toWeightEntryFile(entry), parseWeightEntryFile),
    meta: { kind: 'weight', date: entry.date, weightKg: entry.weightKg },
  };
}

/** `Pesees/_pesees.json` (`weight_log`, croissant par date). */
export function buildWeightsAllFile(stored: StoredData, exportedAt: string): DriveFile {
  const log = toWeightLog(stored.weights, exportedAt);
  return {
    folder: DRIVE_PATHS.weightsFolder,
    name: DRIVE_PATHS.weightsAll,
    content: checked(log, parseWeightLog),
    meta: { kind: 'weights_all', count: log.count },
  };
}

export interface BackupFile extends DriveFile {
  exportedAt: string;
  /** Aucune séance, aucune pesée, aucun programme : jamais envoyée (spec §8.1). */
  empty: boolean;
}

/**
 * Sauvegarde : EXACTEMENT le `training_history_export` 1.1 de « Exporter mes données »
 * (même fabrique `prepareExport`, même contrôle d'intégrité avant remise).
 */
export async function buildBackupFile(kind: 'backup_latest' | 'backup_weekly', now: Date): Promise<BackupFile> {
  const prepared = await prepareExport(now);
  const counts = { sessions: prepared.sessionCount, weights: prepared.weightCount, programs: prepared.programCount };
  return {
    folder: DRIVE_PATHS.backupsFolder,
    name: kind === 'backup_latest' ? DRIVE_PATHS.backupLatest : DRIVE_PATHS.weeklyName(toLocalDateString(now)),
    content: prepared.json,
    meta: { kind, counts, exportedAt: prepared.data.exportedAt },
    exportedAt: prepared.data.exportedAt,
    empty: counts.sessions === 0 && counts.weights === 0 && counts.programs === 0,
  };
}
