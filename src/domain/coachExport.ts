/**
 * Export pour le coach (SPEC §10.6) : quelles séances peuvent partir, et raccourcis de sélection.
 * Règles pures, sans accès à la base.
 */
import type { WorkoutSession } from './types';
import { isWorkoutEmpty } from './workout';

/** Terminée ou abandonnée, avec au moins une donnée saisie. Jamais en cours, jamais vide. */
export const isCoachExportable = (workout: WorkoutSession): boolean => workout.status !== 'in_progress' && !isWorkoutEmpty(workout);

/** Séances exportables, de la plus récente à la plus ancienne. */
export function listCoachExportable(workouts: readonly WorkoutSession[]): WorkoutSession[] {
  return workouts.filter(isCoachExportable).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** « Dernière séance », « 3 dernières », « N dernières » : les N plus récentes (N borné). */
export function selectLatest(exportable: readonly WorkoutSession[], n: number): string[] {
  return exportable.slice(0, Math.max(0, Math.floor(n))).map((w) => w.id);
}

/**
 * Fin d'une séance : `completedAt`, sinon (séance abandonnée, sans date de fin au contrat)
 * son début.
 */
export const sessionEndInstant = (workout: WorkoutSession): string => workout.completedAt ?? workout.startedAt;

/**
 * « Depuis mon dernier envoi au coach » : séances terminées (ou commencées, si abandonnées)
 * APRÈS l'instant figé du dernier envoi. Sans envoi précédent : toutes.
 */
export function selectSinceLastExport(exportable: readonly WorkoutSession[], lastCoachExportAt: string | null): string[] {
  if (lastCoachExportAt === null) return exportable.map((w) => w.id);
  const since = Date.parse(lastCoachExportAt);
  return exportable.filter((w) => Date.parse(sessionEndInstant(w)) > since).map((w) => w.id);
}

export interface SelectionSummary {
  count: number;
  /** Dates `YYYY-MM-DD` de la plus ancienne et de la plus récente séance choisies. */
  firstDate: string | null;
  lastDate: string | null;
}

/** Résumé en direct (« 3 séances · 28 sept. au 2 oct. »). */
export function summarizeSelection(exportable: readonly WorkoutSession[], selected: ReadonlySet<string>): SelectionSummary {
  const chosen = exportable.filter((w) => selected.has(w.id));
  // `exportable` est trié du plus récent au plus ancien.
  return { count: chosen.length, firstDate: chosen.at(-1)?.date ?? null, lastDate: chosen[0]?.date ?? null };
}
