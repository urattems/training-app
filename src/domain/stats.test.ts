import { describe, expect, it } from 'vitest';
import { parseHistoryJson, parseProgramJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import {
  chartMetricFor,
  countCompletedWorkouts,
  exerciseVolume,
  filterByPeriod,
  formatLoadDelta,
  getExerciseLoadHistory,
  getExerciseRepHistory,
  getExerciseStats,
  getExerciseVolumeHistory,
  getRecentProgressions,
  getRepRecordsByLoad,
  lastLoadDelta,
  listTrackedExercises,
  maxLoadKg,
  periodStart,
  setVolume,
  workoutVolume,
} from './stats';
import type { WorkoutSession } from './types';
import { createWorkout, finishWorkout, setActualValues } from './workout';

const history = (() => {
  const result = parseHistoryJson(readFixture('history-example.json'));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
})();
const workouts = history.sessions;

const program = (() => {
  const result = parseProgramJson(readFixture('program-example.json'));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
})();

const CHEST = 'chest-press-machine';
const LAT = 'lat-pulldown-machine';

/** Séance en cours avec des valeurs réelles très élevées : ne doit jamais apparaître. */
const inProgressHeavy = (): WorkoutSession =>
  setActualValues(createWorkout(program, 'A', { id: 'live', now: new Date(2026, 9, 1, 18) }), CHEST, 1, {
    actualReps: 10,
    actualWeightKg: 200,
  });

describe('Volume', () => {
  it('série = reps × kg ; séries sans reps ou sans charge ignorées', () => {
    expect(setVolume({ setNumber: 1, actualReps: 12, actualWeightKg: 45, isExtra: false })).toBe(540);
    expect(setVolume({ setNumber: 1, actualReps: null, actualWeightKg: 45, isExtra: false })).toBe(0);
    expect(setVolume({ setNumber: 1, actualReps: 45, actualWeightKg: null, isExtra: false })).toBe(0);
  });

  it('exercice = somme des séries (série extra incluse), séance = somme des exercices', () => {
    const w1 = workouts[0];
    const w2 = workouts[1];
    if (!w1 || !w2) throw new Error('fixture');
    expect(exerciseVolume(w1.exerciseRecords[0] ?? never())).toBe(12 * 45 + 11 * 45 + 9 * 45);
    // Tirage w-0002 : 3 séries + 1 série extra (8 × 45).
    expect(exerciseVolume(w2.exerciseRecords[1] ?? never())).toBe(12 * 50 + 11 * 50 + 10 * 50 + 8 * 45);
    expect(workoutVolume(w1)).toBe(1440 + (12 + 10 + 9) * 50);
  });
});

describe('Séries de graphiques — valeurs réelles uniquement', () => {
  it('getExerciseLoadHistory : 1 point = charge max réelle par séance, abandonnées incluses', () => {
    const points = getExerciseLoadHistory(workouts, CHEST);
    expect(points.map((p) => [p.workoutId, p.maxLoadKg])).toEqual([
      ['w-0001', 45],
      ['w-0002', 47],
      ['w-0003', 47.5],
    ]);
    // Série non faite (null) exclue du détail.
    expect(points[2]?.sets).toHaveLength(2);
  });

  it('jamais d\'objectif dans les stats : objectifs élevés sans réalisé = aucun point', () => {
    const live = createWorkout(program, 'A', { id: 'x', now: new Date(2026, 9, 2, 18) });
    const finished = finishWorkout(live, new Date(2026, 9, 2, 19));
    expect(getExerciseLoadHistory([finished], CHEST)).toEqual([]);
    const realLow = finishWorkout(setActualValues(live, CHEST, 1, { actualReps: 5, actualWeightKg: 20 }), new Date(2026, 9, 2, 19));
    expect(getExerciseLoadHistory([realLow], CHEST).map((p) => p.maxLoadKg)).toEqual([20]);
  });

  it('une charge sans reps (série non réalisée) ne compte pas comme charge max', () => {
    const record = { ...(workouts[0]?.exerciseRecords[0] ?? never()) };
    record.actualSets = [
      { setNumber: 1, actualReps: 10, actualWeightKg: 40, isExtra: false },
      { setNumber: 2, actualReps: null, actualWeightKg: 90, isExtra: false },
    ];
    expect(maxLoadKg(record)).toBe(40);
  });

  it('les séances in_progress sont exclues partout', () => {
    const all = [...workouts, inProgressHeavy()];
    expect(getExerciseLoadHistory(all, CHEST).map((p) => p.maxLoadKg)).toEqual([45, 47, 47.5]);
    expect(getExerciseStats(all, CHEST).bestLoadKg).toBe(47.5);
    expect(getExerciseVolumeHistory(all, CHEST)).toHaveLength(3);
  });

  it('getExerciseVolumeHistory et getExerciseRepHistory', () => {
    expect(getExerciseVolumeHistory(workouts, CHEST).map((p) => p.volumeKg)).toEqual([1440, 12 * 45 * 2 + 10 * 47, 12 * 47.5 * 2]);
    // Tirage absent du réel dans w-0003 (actualSets vide) : 2 points.
    expect(getExerciseRepHistory(workouts, LAT).map((p) => p.maxReps)).toEqual([12, 12]);
  });

  it('exercice au poids du corps : pas de charge, graphique des reps max', () => {
    const plank = finishWorkout(
      setActualValues(createWorkout(program, 'C', { id: 'p', now: new Date(2026, 9, 3, 18) }), 'plank-bodyweight', 1, { actualReps: 50 }),
      new Date(2026, 9, 3, 19),
    );
    expect(getExerciseLoadHistory([plank], 'plank-bodyweight')).toEqual([]);
    expect(getExerciseRepHistory([plank], 'plank-bodyweight').map((p) => p.maxReps)).toEqual([50]);
    expect(chartMetricFor([plank], 'plank-bodyweight')).toBe('reps');
    expect(chartMetricFor(workouts, CHEST)).toBe('load');
  });
});

describe('« Nombre de séances » (completed seulement) vs charges/volume (abandonnées incluses)', () => {
  it('l\'abandonnée w-0003 compte pour charge, volume et records, pas pour le nombre de séances', () => {
    const stats = getExerciseStats(workouts, CHEST);
    expect(stats.completedSessionCount).toBe(2);
    expect(getExerciseLoadHistory(workouts, CHEST)).toHaveLength(3);
    expect(getExerciseVolumeHistory(workouts, CHEST)).toHaveLength(3);
    expect(stats.bestLoadKg).toBe(47.5);
    expect(stats.bestLoadDate).toBe('2026-09-22');
    expect(stats.lastLoadKg).toBe(47.5);
    expect(stats.maxSessionVolumeKg).toBe(12 * 45 * 2 + 10 * 47);
    expect(stats.lastSessionVolumeKg).toBe(1140);
    expect(countCompletedWorkouts(workouts)).toBe(2);
    expect(workouts).toHaveLength(3);
  });

  it('ne compte pas une séance completed où l\'exercice n\'a aucune série réalisée', () => {
    const empty = finishWorkout(createWorkout(program, 'A', { id: 'e', now: new Date(2026, 9, 4, 18) }), new Date(2026, 9, 4, 19));
    expect(getExerciseStats([...workouts, empty], CHEST).completedSessionCount).toBe(2);
    expect(countCompletedWorkouts([...workouts, empty])).toBe(3);
  });
});

describe('Records', () => {
  it('meilleure série à charge donnée et meilleure série globale', () => {
    expect(getRepRecordsByLoad(workouts, CHEST).map((r) => [r.weightKg, r.reps])).toEqual([
      [47.5, 12],
      [47, 10],
      [45, 12],
    ]);
    expect(getExerciseStats(workouts, CHEST).bestSet).toMatchObject({ weightKg: 47.5, reps: 12, workoutId: 'w-0003' });
    expect(getRepRecordsByLoad(workouts, LAT).map((r) => [r.weightKg, r.reps])).toEqual([
      [50, 12],
      [45, 8],
    ]);
  });
});

describe('Périodes', () => {
  it('calcule le début de période, fin de mois bornée', () => {
    expect(periodStart('1M', '2026-10-01')).toBe('2026-09-01');
    expect(periodStart('3M', '2026-10-15')).toBe('2026-07-15');
    expect(periodStart('1A', '2026-10-01')).toBe('2025-10-01');
    expect(periodStart('1M', '2026-03-31')).toBe('2026-02-28');
    expect(periodStart('all', '2026-10-01')).toBeNull();
  });

  it('filtre les points', () => {
    const points = getExerciseLoadHistory(workouts, CHEST);
    // 1 mois avant le 10/10 = 10/09 : w-0002 (15/09) et w-0003 (22/09) inclus, w-0001 (08/09) exclu.
    expect(filterByPeriod(points, '1M', '2026-10-10').map((p) => p.workoutId)).toEqual(['w-0002', 'w-0003']);
    expect(filterByPeriod(points, '1M', '2026-10-20').map((p) => p.workoutId)).toEqual(['w-0003']);
    expect(filterByPeriod(points, 'all', '2026-10-10')).toHaveLength(3);
  });
});

describe('Progression factuelle', () => {
  it('écart vs séance précédente, texte sans conseil', () => {
    expect(lastLoadDelta(getExerciseLoadHistory(workouts, CHEST))).toBe(0.5);
    expect(formatLoadDelta(2.5)).toBe('+2,5 kg vs séance précédente');
    expect(formatLoadDelta(-2.5)).toBe('−2,5 kg vs séance précédente');
    expect(formatLoadDelta(0)).toBe('charge identique vs séance précédente');
  });

  it('exercices suivis et progressions récentes', () => {
    expect(listTrackedExercises(workouts).map((e) => e.programExerciseId)).toEqual([CHEST, LAT]);
    expect(getRecentProgressions(workouts)).toEqual([
      { programExerciseId: CHEST, exerciseName: 'Chest Press', deltaKg: 0.5, date: '2026-09-22' },
    ]);
  });
});

function never(): never {
  throw new Error('donnée de fixture manquante');
}
