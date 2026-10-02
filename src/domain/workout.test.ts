import { describe, expect, it } from 'vitest';
import { parseProgramJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { DomainError } from './errors';
import type { TrainingProgram, WorkoutSession } from './types';
import {
  abandonWorkout,
  addCardioEntry,
  addExtraSet,
  applyAsPlanned,
  asPlannedValues,
  canFillAsPlanned,
  countValidatedExercises,
  createWorkout,
  findRecord,
  finishWorkout,
  removeCardioEntry,
  setActualValues,
  setComment,
  setSensation,
  setWorkoutDate,
  updateCardioEntry,
  validateExercise,
} from './workout';

const loadProgram = (): TrainingProgram => {
  const result = parseProgramJson(readFixture('program-example.json'));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const START = new Date(2026, 9, 1, 18, 0, 0);
const start = (sessionId = 'A'): WorkoutSession => createWorkout(loadProgram(), sessionId, { id: 'w-1', now: START });

describe('Démarrage et snapshot des objectifs', () => {
  it('copie les objectifs, le nom et le repos ; le réalisé démarre vide', () => {
    const workout = start();
    expect(workout.status).toBe('in_progress');
    expect(workout.date).toBe('2026-10-01');
    expect(workout.programId).toBe('prog-2026-w40');
    expect(workout.exerciseRecords.map((r) => r.programExerciseId)).toEqual([
      'chest-press-machine',
      'lat-pulldown-machine',
      'lateral-raise-dumbbell',
    ]);
    const chest = findRecord(workout, 'chest-press-machine');
    expect(chest).toMatchObject({ exerciseName: 'Chest Press', restSec: 120, status: 'pending', sensation: null, comment: null });
    expect(chest.targetSets).toHaveLength(3);
    expect(chest.actualSets).toEqual([]);
    expect(workout.executionOrder).toEqual([]);
  });

  it('le snapshot est une copie : modifier le programme ensuite ne change pas la séance', () => {
    const program = loadProgram();
    const workout = createWorkout(program, 'A', { id: 'w', now: START });
    const firstSet = program.sessions[0]?.exercises[0]?.sets[0];
    if (firstSet) firstSet.targetWeightKg = 999;
    expect(findRecord(workout, 'chest-press-machine').targetSets[0]?.targetWeightKg).toBe(47);
  });

  it('refuse une séance inconnue', () => {
    expect(() => createWorkout(loadProgram(), 'Z', { id: 'w', now: START })).toThrow(DomainError);
  });
});

describe('Objectif ≠ réalisé', () => {
  it('la saisie réelle ne modifie jamais les objectifs', () => {
    const workout = start();
    const targetsBefore = structuredClone(findRecord(workout, 'chest-press-machine').targetSets);
    const after = setActualValues(workout, 'chest-press-machine', 1, { actualReps: 8, actualWeightKg: 60 });
    expect(findRecord(after, 'chest-press-machine').targetSets).toEqual(targetsBefore);
    expect(findRecord(after, 'chest-press-machine').actualSets).toEqual([
      { setNumber: 1, actualReps: 8, actualWeightKg: 60, isExtra: false },
    ]);
    // L'entrée n'est pas modifiée (fonctions pures).
    expect(findRecord(workout, 'chest-press-machine').actualSets).toEqual([]);
  });

  it('réalisé inférieur ou supérieur à l\'objectif = donnée normale', () => {
    let w = setActualValues(start(), 'chest-press-machine', 1, { actualReps: 3, actualWeightKg: 20 });
    w = setActualValues(w, 'chest-press-machine', 2, { actualReps: 30, actualWeightKg: 200 });
    expect(findRecord(w, 'chest-press-machine').actualSets).toHaveLength(2);
  });

  it('saisie partielle : reps puis charge sur la même série', () => {
    let w = setActualValues(start(), 'chest-press-machine', 2, { actualReps: 10 });
    expect(findRecord(w, 'chest-press-machine').actualSets[0]).toEqual({ setNumber: 2, actualReps: 10, actualWeightKg: null, isExtra: false });
    w = setActualValues(w, 'chest-press-machine', 2, { actualWeightKg: 47.5 });
    expect(findRecord(w, 'chest-press-machine').actualSets[0]).toEqual({ setNumber: 2, actualReps: 10, actualWeightKg: 47.5, isExtra: false });
  });

  it('refuse les valeurs négatives ou non entières pour les reps', () => {
    const w = start();
    expect(() => setActualValues(w, 'chest-press-machine', 1, { actualReps: -1 })).toThrow(DomainError);
    expect(() => setActualValues(w, 'chest-press-machine', 1, { actualReps: 2.5 })).toThrow(DomainError);
    expect(() => setActualValues(w, 'chest-press-machine', 1, { actualWeightKg: -0.5 })).toThrow(DomainError);
    expect(() => setActualValues(w, 'chest-press-machine', 9, { actualReps: 5 })).toThrow(DomainError);
  });
});

describe('« Comme prévu »', () => {
  it('remplit reps et charge exactes', () => {
    expect(asPlannedValues({ setNumber: 1, targetReps: 12, targetWeightKg: 47 })).toEqual({ actualReps: 12, actualWeightKg: 47 });
    const w = applyAsPlanned(start(), 'chest-press-machine', 3);
    expect(findRecord(w, 'chest-press-machine').actualSets).toEqual([{ setNumber: 3, actualReps: 10, actualWeightKg: 49, isExtra: false }]);
  });

  it('plage de reps : ne remplit que la charge, jamais de reps inventées', () => {
    const w = applyAsPlanned(start(), 'lat-pulldown-machine', 1);
    expect(findRecord(w, 'lat-pulldown-machine').actualSets).toEqual([{ setNumber: 1, actualReps: null, actualWeightKg: 55, isExtra: false }]);
  });

  it('charge null : ne remplit que les reps', () => {
    const w = applyAsPlanned(start('C'), 'plank-bodyweight', 1);
    expect(findRecord(w, 'plank-bodyweight').actualSets).toEqual([{ setNumber: 1, actualReps: 45, actualWeightKg: null, isExtra: false }]);
  });

  it('plage + charge null : rien à remplir, bouton masqué', () => {
    const target = { setNumber: 1, targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: null };
    expect(asPlannedValues(target)).toEqual({});
    expect(canFillAsPlanned(target)).toBe(false);
    expect(canFillAsPlanned({ setNumber: 1, targetReps: 5, targetWeightKg: null })).toBe(true);
  });
});

describe('Séries en plus, ordre réel, validation', () => {
  it('« + Série » continue la numérotation (4, 5) sans objectif', () => {
    let w = addExtraSet(start(), 'chest-press-machine');
    w = addExtraSet(w, 'chest-press-machine');
    const record = findRecord(w, 'chest-press-machine');
    expect(record.actualSets.map((s) => [s.setNumber, s.isExtra])).toEqual([
      [4, true],
      [5, true],
    ]);
    expect(record.targetSets).toHaveLength(3);
    w = setActualValues(w, 'chest-press-machine', 5, { actualReps: 6, actualWeightKg: 40 });
    expect(findRecord(w, 'chest-press-machine').actualSets.at(-1)).toEqual({ setNumber: 5, actualReps: 6, actualWeightKg: 40, isExtra: true });
  });

  it('exercice 3 avant le 1 : l\'ordre réel est stocké, l\'ordre du programme conservé', () => {
    let w = setActualValues(start(), 'lateral-raise-dumbbell', 1, { actualReps: 15, actualWeightKg: 8 });
    w = validateExercise(w, 'lateral-raise-dumbbell');
    w = setSensation(w, 'chest-press-machine', 'good');
    w = setActualValues(w, 'lateral-raise-dumbbell', 2, { actualReps: 14 });
    expect(w.executionOrder).toEqual(['lateral-raise-dumbbell', 'chest-press-machine']);
    expect(w.exerciseRecords.map((r) => r.programExerciseId)).toEqual([
      'chest-press-machine',
      'lat-pulldown-machine',
      'lateral-raise-dumbbell',
    ]);
  });

  it('valider le dernier exercice ne termine pas la séance et ne verrouille rien', () => {
    let w = start();
    for (const r of w.exerciseRecords) w = validateExercise(w, r.programExerciseId);
    expect(w.status).toBe('in_progress');
    expect(countValidatedExercises(w)).toBe(3);
    w = setActualValues(w, 'chest-press-machine', 1, { actualReps: 12 });
    expect(findRecord(w, 'chest-press-machine').status).toBe('completed');
  });

  it('sensation et commentaire (vide → null)', () => {
    let w = setSensation(start(), 'chest-press-machine', 'very_hard');
    w = setComment(w, 'chest-press-machine', '  ');
    expect(findRecord(w, 'chest-press-machine')).toMatchObject({ sensation: 'very_hard', comment: null });
    w = setComment(w, 'chest-press-machine', 'Épaule sensible');
    expect(findRecord(w, 'chest-press-machine').comment).toBe('Épaule sensible');
  });
});

describe('Cardio', () => {
  it('ajoute et met à jour une entrée, valeurs validées', () => {
    let w = addCardioEntry(start(), 'treadmill');
    w = updateCardioEntry(w, 0, { durationSec: 1200, speedKmh: 5.5, inclinePct: 8, name: 'Tapis' });
    expect(w.cardioRecords).toEqual([{ type: 'treadmill', name: 'Tapis', durationSec: 1200, speedKmh: 5.5, inclinePct: 8, notes: null }]);
    expect(() => updateCardioEntry(w, 0, { inclinePct: 101 })).toThrow(DomainError);
    expect(() => updateCardioEntry(w, 0, { speedKmh: -1 })).toThrow(DomainError);
    expect(() => updateCardioEntry(w, 0, { durationSec: -60 })).toThrow(DomainError);
    expect(() => updateCardioEntry(w, 3, { name: 'x' })).toThrow(DomainError);
  });

  it('retire une entrée précise, sans toucher aux autres', () => {
    let w = addCardioEntry(addCardioEntry(start(), 'bike'), 'rower');
    w = removeCardioEntry(w, 0);
    expect(w.cardioRecords.map((e) => e.type)).toEqual(['rower']);
    expect(() => removeCardioEntry(w, 5)).toThrow(DomainError);
  });
});

describe('Fin, abandon, édition rétroactive', () => {
  it('terminer : completed, completedAt, durationSec, même avec des exercices non validés', () => {
    const w = finishWorkout(start(), new Date(2026, 9, 1, 19, 5, 30));
    expect(w.status).toBe('completed');
    expect(w.completedAt).toMatch(/^2026-10-01T19:05:30[+-]\d{2}:\d{2}$/);
    expect(w.durationSec).toBe(3930);
    expect(() => finishWorkout(w, new Date())).toThrow(DomainError);
  });

  it('abandon : statut abandoned, données conservées', () => {
    const w = abandonWorkout(setActualValues(start(), 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 }));
    expect(w.status).toBe('abandoned');
    expect(w.completedAt).toBeNull();
    expect(findRecord(w, 'chest-press-machine').actualSets).toHaveLength(1);
    expect(() => abandonWorkout(w)).toThrow(DomainError);
  });

  it('édition rétroactive possible après la fin, date validée', () => {
    let w = finishWorkout(start(), new Date(2026, 9, 1, 19, 0, 0));
    w = setActualValues(w, 'chest-press-machine', 1, { actualReps: 11, actualWeightKg: 47 });
    w = setWorkoutDate(w, '2026-09-30');
    expect(w.date).toBe('2026-09-30');
    expect(w.status).toBe('completed');
    expect(() => setWorkoutDate(w, '2026-02-30')).toThrow(DomainError);
  });
});
