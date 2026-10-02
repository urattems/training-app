/** Textes dérivés des données métier (objectifs, performances). Fonctions pures. */
import { formatKg } from '../utils/numbers';
import { getExerciseEntries, isPerformedSet } from './stats';
import type { ActualSet, ProgramSet, WorkoutSession, WorkoutStatus } from './types';
import { isRangeTarget } from './workout';

/** Objectif d'une série : « 12 × 47 kg », « 8–12 × 55 kg », « 45 reps » (sans charge). */
export function formatTargetSet(set: ProgramSet): string {
  const reps = isRangeTarget(set) ? `${set.targetRepsMin}–${set.targetRepsMax}` : String(set.targetReps);
  return set.targetWeightKg === null ? `${reps} reps` : `${reps} × ${formatKg(set.targetWeightKg)}`;
}

/** Série réalisée : « 12 × 47,5 kg », « 45 reps ». */
export function formatActualSet(set: ActualSet): string {
  const reps = set.actualReps === null ? '–' : String(set.actualReps);
  return set.actualWeightKg === null ? `${reps} reps` : `${reps} × ${formatKg(set.actualWeightKg)}`;
}

/**
 * Résumé d'une performance réelle (SPEC §7.4) :
 * charge unique → « 45 kg · 10 / 10 / 9 » ; sans charge → « 45 / 45 / 40 reps » ;
 * charges différentes → « 12 × 45 kg · 10 × 47 kg ».
 */
export function formatPerformance(sets: readonly ActualSet[]): string {
  const performed = sets.filter(isPerformedSet);
  if (performed.length === 0) return '';
  const reps = performed.map((s) => String(s.actualReps)).join(' / ');
  const weights = new Set(performed.map((s) => s.actualWeightKg));
  if (weights.size === 1) {
    const [weight] = [...weights];
    return weight === null || weight === undefined ? `${reps} reps` : `${formatKg(weight)} · ${reps}`;
  }
  return performed.map(formatActualSet).join(' · ');
}

export interface LastPerformance {
  workoutId: string;
  date: string;
  sets: ActualSet[];
}

/**
 * Dernière performance réelle d'un exercice (séances terminées ou abandonnées,
 * jamais la séance en cours), `null` si aucune.
 */
export function getLastPerformance(
  workouts: readonly WorkoutSession[],
  programExerciseId: string,
  excludeWorkoutId?: string,
): LastPerformance | null {
  const entries = getExerciseEntries(workouts, programExerciseId).filter(
    (e) => e.workoutId !== excludeWorkoutId && e.record.actualSets.some(isPerformedSet),
  );
  const last = entries.at(-1);
  return last ? { workoutId: last.workoutId, date: last.date, sets: last.record.actualSets.filter(isPerformedSet) } : null;
}

const STATUS_LABELS: Record<WorkoutStatus, string> = {
  in_progress: 'En cours',
  completed: 'Terminée',
  abandoned: 'Abandonnée',
};

export const workoutStatusLabel = (status: WorkoutStatus): string => STATUS_LABELS[status];
