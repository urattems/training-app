/**
 * Export pour le coach (SPEC §10.6) : quelles séances peuvent partir, et raccourcis de sélection.
 * Règles pures, sans accès à la base.
 */
import type { WeightWindowMode } from '../schemas/coachExport.schema';
import { addDaysToLocalDate } from '../utils/dates';
import type { WeightEntry, WorkoutSession } from './types';
import { sortWeights } from './weight';
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

// --- Pesées jointes (1.1) -----------------------------------------------------------

/** Fenêtre par défaut : 30 jours (ou plus, si les séances choisies sont plus anciennes). */
export const DEFAULT_WEIGHT_WINDOW: WeightWindowMode = 'auto_30d';

/**
 * Bornes `[from, to]` (incluses) des pesées jointes ; `to` = aujourd'hui.
 * - `auto_30d` : la plus ancienne entre la première séance choisie et aujourd'hui − 30 jours ;
 * - `days_90` : aujourd'hui − 90 jours ;
 * - `all` : depuis la toute première pesée (aujourd'hui s'il n'y en a aucune).
 */
export function weightWindowBounds(
  mode: WeightWindowMode,
  oldestSessionDate: string,
  today: string,
  weights: readonly Pick<WeightEntry, 'date'>[],
): { from: string; to: string } {
  if (mode === 'days_90') return { from: addDaysToLocalDate(today, -90), to: today };
  if (mode === 'all') return { from: sortWeights(weights)[0]?.date ?? today, to: today };
  const thirtyDays = addDaysToLocalDate(today, -30);
  return { from: oldestSessionDate < thirtyDays ? oldestSessionDate : thirtyDays, to: today };
}

/** Pesées compactes (date, poids) de la fenêtre, par date croissante. */
export function weightsInWindow(weights: readonly WeightEntry[], from: string, to: string): { date: string; weightKg: number }[] {
  return sortWeights(weights)
    .filter((w) => w.date >= from && w.date <= to)
    .map((w) => ({ date: w.date, weightKg: w.weightKg }));
}
