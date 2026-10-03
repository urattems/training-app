import { describe, expect, it } from 'vitest';
import { parseProgramJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import type { TrainingProgram, WorkoutSession } from './types';
import {
  addCardioEntry,
  addExtraSet,
  createWorkout,
  findIncompleteSets,
  findRecord,
  isWorkoutEmpty,
  normalizeText,
  sanitizeWorkoutTexts,
  setActualValues,
  setComment,
  setSensation,
  updateCardioEntry,
} from './workout';

const program = ((): TrainingProgram => {
  const r = parseProgramJson(readFixture('program-example.json'));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
})();
const start = (session = 'A'): WorkoutSession => createWorkout(program, session, { id: 'w', now: new Date(2026, 9, 1, 18) });

describe('Nettoyage des textes saisis', () => {
  it('normalizeText : trim, vide → null', () => {
    expect(normalizeText('  Épaule sensible  ')).toBe('Épaule sensible');
    expect(normalizeText('   ')).toBeNull();
    expect(normalizeText('')).toBeNull();
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText('a\n\nb')).toBe('a\n\nb');
  });

  it('commentaire d\'exercice trimé à l\'enregistrement', () => {
    const w = setComment(start(), 'chest-press-machine', '  Bonne séance \n');
    expect(findRecord(w, 'chest-press-machine').comment).toBe('Bonne séance');
  });

  it('cardio : nom trimé (reste une chaîne : non nullable dans le contrat), notes trimées, vides → null', () => {
    let w = addCardioEntry(start(), 'treadmill');
    w = updateCardioEntry(w, 0, { name: '  Tapis incliné  ', notes: '  ' });
    expect(w.cardioRecords[0]).toMatchObject({ name: 'Tapis incliné', notes: null });
    w = updateCardioEntry(w, 0, { name: '   ', notes: ' Marche ' });
    expect(w.cardioRecords[0]).toMatchObject({ name: '', notes: 'Marche' });
  });

  it('sanitizeWorkoutTexts : notes de séance, commentaires, cardio', () => {
    const base = addCardioEntry(start(), 'bike');
    const dirty: WorkoutSession = {
      ...base,
      notes: '  ',
      exerciseRecords: base.exerciseRecords.map((r, i) => ({ ...r, comment: i === 0 ? '  ok  ' : '   ' })),
      cardioRecords: base.cardioRecords.map((c) => ({ ...c, name: ' Vélo ', notes: ' rapide ' })),
    };
    const clean = sanitizeWorkoutTexts(dirty);
    expect(clean.notes).toBeNull();
    expect(clean.exerciseRecords.map((r) => r.comment)).toEqual(['ok', null, null]);
    expect(clean.cardioRecords[0]).toMatchObject({ name: 'Vélo', notes: 'rapide' });
  });
});

describe('Séries prescrites partiellement remplies', () => {
  it('charge sans reps, reps sans charge (charge prévue) ; série vide et série extra ignorées', () => {
    let w = setActualValues(start(), 'chest-press-machine', 1, { actualWeightKg: 47 });
    w = setActualValues(w, 'chest-press-machine', 2, { actualReps: 12 });
    w = setActualValues(w, 'chest-press-machine', 3, { actualReps: null, actualWeightKg: null });
    w = addExtraSet(w, 'chest-press-machine');
    w = setActualValues(w, 'chest-press-machine', 4, { actualWeightKg: 40 });
    expect(findIncompleteSets(findRecord(w, 'chest-press-machine'))).toEqual({ missingReps: [1], missingWeight: [2] });
  });

  it('poids du corps (charge prévue null) : des reps seules sont complètes', () => {
    const w = setActualValues(start('C'), 'plank-bodyweight', 1, { actualReps: 45 });
    expect(findIncompleteSets(findRecord(w, 'plank-bodyweight'))).toEqual({ missingReps: [], missingWeight: [] });
  });

  it('séries complètes ou non commencées : rien à signaler', () => {
    const w = setActualValues(start(), 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 });
    expect(findIncompleteSets(findRecord(w, 'chest-press-machine'))).toEqual({ missingReps: [], missingWeight: [] });
    expect(findIncompleteSets(findRecord(start(), 'chest-press-machine'))).toEqual({ missingReps: [], missingWeight: [] });
  });
});

describe('Séance vide', () => {
  it('vide tant que rien n\'est saisi ; toute saisie la rend non vide', () => {
    const w = start();
    expect(isWorkoutEmpty(w)).toBe(true);
    expect(isWorkoutEmpty(setActualValues(w, 'chest-press-machine', 1, { actualReps: null, actualWeightKg: null }))).toBe(true);
    expect(isWorkoutEmpty(setActualValues(w, 'chest-press-machine', 1, { actualReps: 10 }))).toBe(false);
    expect(isWorkoutEmpty(addCardioEntry(w, 'bike'))).toBe(false);
    expect(isWorkoutEmpty(setSensation(w, 'chest-press-machine', 'good'))).toBe(false);
    expect(isWorkoutEmpty(setComment(w, 'chest-press-machine', 'x'))).toBe(false);
  });
});
