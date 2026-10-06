import { measurementsRecordedSince } from './measurements';
import type { MeasurementEntry, WeightEntry, WorkoutSession } from './types';
import { weightsRecordedSince } from './weight';

/** Délai au-delà duquel un rappel d'export est proposé (SPEC §7.10). */
export const EXPORT_REMINDER_DAYS = 14;

const DAY_MS = 86_400_000;

export interface ExportReminder {
  /** Jours depuis le dernier export, `null` si jamais exporté. */
  daysSinceExport: number | null;
  /** Séances terminées depuis le dernier export (absentes de tout fichier exporté). */
  completedSince: number;
}

/**
 * Rappel d'export (SPEC §7.10) : affiché si le dernier export date de plus de 14 jours
 * (ou n'a jamais eu lieu) ET qu'il existe une donnée non sauvegardée depuis : une séance
 * terminée, ou (V1.2) une pesée dont `recordedAt` est postérieur au dernier export.
 * Jamais pendant une séance en cours (ne pas distraire pendant l'entraînement).
 * Un export pour le coach ne modifie pas `lastExportAt` : il n'éteint pas ce rappel.
 */
export function getExportReminder(
  workouts: readonly WorkoutSession[],
  lastExportAt: string | null,
  now: Date,
  weights: readonly Pick<WeightEntry, 'recordedAt'>[] = [],
  measurements: readonly Pick<MeasurementEntry, 'recordedAt'>[] = [],
): ExportReminder | null {
  if (workouts.some((w) => w.status === 'in_progress')) return null;
  const lastExport = lastExportAt === null ? null : Date.parse(lastExportAt);
  const completedSince = workouts.filter(
    (w) => w.status === 'completed' && w.completedAt !== null && (lastExport === null || Date.parse(w.completedAt) > lastExport),
  ).length;
  // Pesées (V1.2) et mensurations (V1.5.0) enregistrées depuis le dernier export : données non sauvegardées.
  if (completedSince === 0 && weightsRecordedSince(weights, lastExportAt) === 0 && measurementsRecordedSince(measurements, lastExportAt) === 0) return null;
  if (lastExport === null) return { daysSinceExport: null, completedSince };
  const days = Math.floor((now.getTime() - lastExport) / DAY_MS);
  return days > EXPORT_REMINDER_DAYS ? { daysSinceExport: days, completedSince } : null;
}
