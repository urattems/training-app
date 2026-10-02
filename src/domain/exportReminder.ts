import type { WorkoutSession } from './types';

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
 * (ou n'a jamais eu lieu) ET qu'au moins une séance terminée existe depuis.
 * Jamais pendant une séance en cours (ne pas distraire pendant l'entraînement).
 */
export function getExportReminder(
  workouts: readonly WorkoutSession[],
  lastExportAt: string | null,
  now: Date,
): ExportReminder | null {
  if (workouts.some((w) => w.status === 'in_progress')) return null;
  const lastExport = lastExportAt === null ? null : Date.parse(lastExportAt);
  const completedSince = workouts.filter(
    (w) => w.status === 'completed' && w.completedAt !== null && (lastExport === null || Date.parse(w.completedAt) > lastExport),
  ).length;
  if (completedSince === 0) return null;
  if (lastExport === null) return { daysSinceExport: null, completedSince };
  const days = Math.floor((now.getTime() - lastExport) / DAY_MS);
  return days > EXPORT_REMINDER_DAYS ? { daysSinceExport: days, completedSince } : null;
}
