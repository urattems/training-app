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
 * Résumé d'une performance réelle (SPEC §7.4), forme unique quel que soit le nombre de charges :
 * séries regroupées par charge consécutive, « charge · reps / reps », groupes séparés par « ; ».
 * - charge unique : « 45 kg · 10 / 10 / 9 »
 * - charges différentes : « 45 kg · 12 / 12 ; 47 kg · 10 »
 * - sans charge (poids du corps) : « 45 / 40 reps »
 * Le détail série par série (historique, carte du graphique) utilise `formatActualSet`.
 */
export function formatPerformance(sets: readonly ActualSet[]): string {
  const groups: { weight: number | null; reps: number[] }[] = [];
  for (const set of sets.filter(isPerformedSet)) {
    const last = groups.at(-1);
    if (last && last.weight === set.actualWeightKg) last.reps.push(set.actualReps ?? 0);
    else groups.push({ weight: set.actualWeightKg, reps: [set.actualReps ?? 0] });
  }
  return groups
    .map(({ weight, reps }) => {
      const list = reps.join(' / ');
      return weight === null ? `${list} reps` : `${formatKg(weight)} · ${list}`;
    })
    .join(' ; ');
}

export interface LastPerformance {
  workoutId: string;
  date: string;
  sets: ActualSet[];
}

/**
 * Dernière performance réelle d'un exercice (séances terminées ou abandonnées,
 * jamais la séance en cours), `null` si aucune. La clé est l'`exerciseId` : pour un exercice
 * remplacé, c'est la dernière performance de l'exercice remplaçant.
 */
export function getLastPerformance(
  workouts: readonly WorkoutSession[],
  exerciseId: string,
  excludeWorkoutId?: string,
): LastPerformance | null {
  const entries = getExerciseEntries(workouts, exerciseId).filter(
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
