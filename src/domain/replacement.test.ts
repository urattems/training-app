import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DomainError } from './errors';
import { getLastPerformance } from './display';
import {
  MAX_EXERCISE_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  isReplaced,
  nameKey,
  plannedName,
  replacementExerciseId,
  resolveExerciseName,
  slugify,
} from './replacement';
import {
  chartMetricFor,
  getExerciseEntries,
  getExerciseLoadHistory,
  getExerciseStats,
  getRecentProgressions,
  listTrackedExercises,
} from './stats';
import type { TrainingProgram, WorkoutSession } from './types';
import { createWorkout, findIncompleteSets, findRecord, replaceExercise, restorePlannedExercise, setActualValues } from './workout';

const CHEST = 'chest-press-machine';
const LAT = 'lat-pulldown-machine';
const RAISE = 'lateral-raise-dumbbell';

const program = JSON.parse(readFileSync(resolve(process.cwd(), 'examples', 'program-example.json'), 'utf8')) as TrainingProgram;

const workoutAt = (id: string, day: number): WorkoutSession => {
  const w = createWorkout(program, 'A', { id, now: new Date(2026, 8, day, 18, 0) });
  return { ...w, status: 'completed', completedAt: w.startedAt, durationSec: 3600 };
};
const withSet = (w: WorkoutSession, exerciseId: string, reps: number, kg: number): WorkoutSession =>
  setActualValues(w, exerciseId, 1, { actualReps: reps, actualWeightKg: kg });

describe('slug : « sub- » + nom normalisé', () => {
  it.each([
    ['Chest Press', 'chest-press'],
    ['chest press', 'chest-press'], // casse
    ['CHEST   PRESS', 'chest-press'], // espaces multiples
    ['Développé couché incliné', 'developpe-couche-incline'], // accents
    ['Écarté à la poulie (câble)', 'ecarte-a-la-poulie-cable'], // accents + caractères spéciaux
    ['Cœur / Œil : ß', 'coeur-oeil-ss'], // ligatures
    ['Leg-Press 45°', 'leg-press-45'],
    ['  ---Rowing---  ', 'rowing'], // tirets aux extrémités retirés
    ['Pec Deck (autre machine)', 'pec-deck-autre-machine'],
    ['Tractions 8/10', 'tractions-8-10'],
  ])('« %s » → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('40 caractères au maximum, sans tiret final ; l’identifiant ajoute « sub- »', () => {
    const long = 'Développé couché avec haltères sur banc incliné à trente degrés';
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug).toBe('developpe-couche-avec-halteres-sur-banc');
    expect(slug.endsWith('-')).toBe(false);
    // Coupe pile sur un tiret : le tiret final est retiré.
    expect(slugify(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
    expect(replacementExerciseId(long)).toBe(`sub-${slug}`);
    expect(replacementExerciseId('x'.repeat(100))).toBe(`sub-${'x'.repeat(40)}`);
  });

  it('le même nom donne toujours le même identifiant (quels que soient casse, accents, espaces)', () => {
    const ids = ['Leg Press', 'leg press', ' LEG-PRESS ', 'Lég Press'].map(replacementExerciseId);
    expect(new Set(ids)).toEqual(new Set(['sub-leg-press']));
    expect(replacementExerciseId('Leg Press 2')).not.toBe(replacementExerciseId('Leg Press'));
  });

  it('nameKey : clé de comparaison sans troncature', () => {
    expect(nameKey('Lég-Press')).toBe('leg-press');
    expect(nameKey('???')).toBe('');
  });
});

describe('resolveExerciseName', () => {
  const context = { programExerciseId: CHEST, plannedName: 'Chest Press', others: [{ exerciseId: LAT, exerciseName: 'Tirage vertical' }] };
  const failure = (raw: string) => {
    const r = resolveExerciseName(raw, context);
    return r.ok ? null : r.message;
  };

  it('accepte un nom valide : exerciseId « sub- », pas de retour à l’exercice prévu', () => {
    expect(resolveExerciseName('  Pec Deck  ', context)).toEqual({ ok: true, exerciseId: 'sub-pec-deck', exerciseName: 'Pec Deck', restoresPlanned: false });
  });

  it('1 à 60 caractères après trim', () => {
    expect(failure('')).toMatch(/Indique le nom/);
    expect(failure('    ')).toMatch(/Indique le nom/);
    expect(resolveExerciseName('a'.repeat(MAX_EXERCISE_NAME_LENGTH), context).ok).toBe(true);
    expect(resolveExerciseName(` ${'a'.repeat(MAX_EXERCISE_NAME_LENGTH)} `, context).ok).toBe(true); // le trim précède le décompte
    expect(failure('a'.repeat(MAX_EXERCISE_NAME_LENGTH + 1))).toMatch(/60 caractères au maximum/);
  });

  it('refuse les caractères de contrôle et un nom sans lettre ni chiffre', () => {
    expect(failure('Pec\nDeck')).toMatch(/caractère de contrôle/);
    expect(failure('Pec\tDeck')).toMatch(/caractère de contrôle/);
    expect(failure('Pec\u0000Deck')).toMatch(/caractère de contrôle/);
    expect(failure('???')).toMatch(/au moins une lettre ou un chiffre/);
    expect(failure('🏋️')).toMatch(/au moins une lettre ou un chiffre/);
  });

  it('le nom d’origine (casse, accents, ponctuation ignorés) retire le remplacement', () => {
    for (const raw of ['Chest Press', 'chest press', ' CHEST-PRESS ', 'Chést Press']) {
      expect(resolveExerciseName(raw, context)).toEqual({ ok: true, exerciseId: CHEST, exerciseName: 'Chest Press', restoresPlanned: true });
    }
  });

  it('refuse un nom déjà pris par un autre exercice de la séance (même nom, ou même identifiant)', () => {
    expect(failure('Tirage vertical')).toBe('« Tirage vertical » est déjà un exercice de cette séance. Choisis un autre nom.');
    expect(failure('tirage VERTICAL')).toMatch(/déjà un exercice de cette séance/);
    const sub = resolveExerciseName('Pec Deck', { ...context, others: [{ exerciseId: 'sub-pec-deck', exerciseName: 'Pec-Deck (bis)' }] });
    expect(sub.ok).toBe(false); // même identifiant, noms différents : refusé
  });
});

describe('replaceExercise / retrait', () => {
  const base = () => withSet(createWorkout(program, 'A', { id: 'w-1', now: new Date(2026, 8, 1, 18) }), CHEST, 12, 47.5);

  it('remplace : seuls exerciseId et exerciseName changent ; le prévu et le programme restent intacts', () => {
    const before = base();
    const after = replaceExercise(before, CHEST, 'Dumbbell Press', 'Chest Press');
    const record = findRecord(after, CHEST);
    expect(record).toMatchObject({ exerciseId: 'sub-dumbbell-press', exerciseName: 'Dumbbell Press', programExerciseId: CHEST });
    const original = findRecord(before, CHEST);
    expect(record.targetSets).toEqual(original.targetSets);
    expect(record.restSec).toBe(original.restSec);
    expect(record.status).toBe(original.status);
    expect(isReplaced(record)).toBe(true);
    // Les autres exercices et le programme ne bougent pas ; l'entrée n'est pas mutée.
    expect(after.exerciseRecords.slice(1)).toEqual(before.exerciseRecords.slice(1));
    expect(findRecord(before, CHEST).exerciseId).toBe(CHEST);
    expect(program.sessions[0]?.exercises[0]).toMatchObject({ id: CHEST, name: 'Chest Press' });
    // L'ordre réel reste en programExerciseId.
    expect(after.executionOrder).toEqual([CHEST]);
  });

  it('les séries déjà saisies sont conservées au remplacement ET au retrait', () => {
    const before = base();
    const sets = findRecord(before, CHEST).actualSets;
    expect(sets).toHaveLength(1);
    const replaced = replaceExercise(before, CHEST, 'Dumbbell Press', 'Chest Press');
    expect(findRecord(replaced, CHEST).actualSets).toEqual(sets);
    const restored = restorePlannedExercise(replaced, CHEST, 'Chest Press');
    expect(findRecord(restored, CHEST).actualSets).toEqual(sets);
    expect(restored).toEqual(before);
    // Le nombre de lignes reste celui du programme : trois séries prescrites, une seule saisie.
    expect(findRecord(replaced, CHEST).targetSets).toHaveLength(3);
  });

  it('retrait : exerciseId = programExerciseId et nom d’origine du programme', () => {
    const replaced = replaceExercise(base(), CHEST, 'Dumbbell Press', 'Chest Press');
    const restored = restorePlannedExercise(replaced, CHEST, 'Chest Press');
    expect(findRecord(restored, CHEST)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });
    expect(isReplaced(findRecord(restored, CHEST))).toBe(false);
  });

  it('saisir le nom d’origine retire aussi le remplacement ; sans remplacement, rien ne change', () => {
    const replaced = replaceExercise(base(), CHEST, 'Dumbbell Press', 'Chest Press');
    const typed = replaceExercise(replaced, CHEST, '  chest press ', 'Chest Press');
    expect(findRecord(typed, CHEST)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });
    const untouched = base();
    expect(replaceExercise(untouched, CHEST, 'Chest Press', 'Chest Press')).toBe(untouched);
    expect(restorePlannedExercise(untouched, CHEST, 'Chest Press')).toBe(untouched);
  });

  it('même nom : même exerciseId ; corriger la casse du nom met seulement le nom à jour', () => {
    const a = replaceExercise(base(), CHEST, 'Leg Press', 'Chest Press');
    // Une autre séance, un autre exercice du programme, le même nom saisi autrement : même identifiant.
    const b = replaceExercise(createWorkout(program, 'A', { id: 'w-2', now: new Date(2026, 8, 3) }), LAT, 'LEG press', 'Tirage vertical');
    expect(findRecord(a, CHEST).exerciseId).toBe('sub-leg-press');
    expect(findRecord(b, LAT).exerciseId).toBe('sub-leg-press');
    const same = replaceExercise(a, CHEST, 'Leg Press', 'Chest Press');
    expect(same).toBe(a);
    const renamed = replaceExercise(a, CHEST, 'LEG PRESS', 'Chest Press');
    expect(findRecord(renamed, CHEST)).toMatchObject({ exerciseId: 'sub-leg-press', exerciseName: 'LEG PRESS' });
  });

  it('doublon dans la même séance refusé (DomainError) : rien n’est modifié', () => {
    const w = base();
    expect(() => replaceExercise(w, CHEST, 'Tirage vertical', 'Chest Press')).toThrow(DomainError);
    expect(() => replaceExercise(w, CHEST, 'Tirage vertical', 'Chest Press')).toThrow('« Tirage vertical » est déjà un exercice de cette séance.');
    // Deux exercices ne peuvent pas porter le même remplaçant.
    const first = replaceExercise(w, CHEST, 'Leg Press', 'Chest Press');
    expect(() => replaceExercise(first, LAT, 'leg press', 'Tirage vertical')).toThrow(DomainError);
    // Rétablir l'exercice prévu alors qu'un autre porte son nom : refusé.
    const swapped = replaceExercise(replaceExercise(w, CHEST, 'Pec Deck', 'Chest Press'), LAT, 'Chest Press', 'Tirage vertical');
    expect(() => restorePlannedExercise(swapped, CHEST, 'Chest Press')).toThrow(DomainError);
  });

  it('nom invalide refusé avec un message clair', () => {
    expect(() => replaceExercise(base(), CHEST, '   ', 'Chest Press')).toThrow('Indique le nom');
    expect(() => replaceExercise(base(), CHEST, 'x'.repeat(61), 'Chest Press')).toThrow('60 caractères au maximum');
    expect(() => replaceExercise(base(), 'inconnu', 'Pec Deck', 'Chest Press')).toThrow(DomainError);
  });

  it('plannedName : snapshot tant que non remplacé, sinon le nom du programme ; null si inconnu', () => {
    const w = base();
    expect(plannedName(findRecord(w, CHEST), undefined)).toBe('Chest Press');
    const replaced = findRecord(replaceExercise(w, CHEST, 'Pec Deck', 'Chest Press'), CHEST);
    expect(plannedName(replaced, 'Chest Press')).toBe('Chest Press');
    expect(plannedName(replaced, undefined)).toBeNull();
  });

  it('avertissement de validation : le prévu ne s’applique plus à un exercice remplacé (charge), mais une charge sans reps reste signalée', () => {
    const w = setActualValues(createWorkout(program, 'A', { id: 'w-3', now: new Date(2026, 8, 1) }), CHEST, 1, { actualReps: 12 });
    expect(findIncompleteSets(findRecord(w, CHEST))).toEqual({ missingReps: [], missingWeight: [1] });
    const replaced = replaceExercise(w, CHEST, 'Pec Deck', 'Chest Press');
    expect(findIncompleteSets(findRecord(replaced, CHEST))).toEqual({ missingReps: [], missingWeight: [] });
    const weightOnly = replaceExercise(setActualValues(w, CHEST, 2, { actualWeightKg: 30 }), CHEST, 'Pec Deck', 'Chest Press');
    expect(findIncompleteSets(findRecord(weightOnly, CHEST))).toEqual({ missingReps: [2], missingWeight: [] });
  });
});

describe('clé de progression = exerciseId : courbes séparées', () => {
  // w1, w4 : exercice d'origine ; w2, w3 : remplacé par « Pec Deck ».
  const w1 = withSet(workoutAt('w-1', 1), CHEST, 12, 45);
  const w2 = withSet(replaceExercise(workoutAt('w-2', 8), CHEST, 'Pec Deck', 'Chest Press'), CHEST, 12, 30);
  const w3 = withSet(replaceExercise(workoutAt('w-3', 15), CHEST, 'pec deck', 'Chest Press'), CHEST, 10, 32.5);
  const w4 = withSet(workoutAt('w-4', 22), CHEST, 12, 47.5);
  const all = [w1, w2, w3, w4];

  it('un remplacement n’altère jamais la courbe de l’exercice d’origine', () => {
    const originalOnly = getExerciseLoadHistory([w1, w4], CHEST);
    expect(getExerciseLoadHistory(all, CHEST)).toEqual(originalOnly);
    expect(originalOnly.map((p) => p.maxLoadKg)).toEqual([45, 47.5]);
    expect(getExerciseStats(all, CHEST)).toEqual(getExerciseStats([w1, w4], CHEST));
    expect(getExerciseStats(all, CHEST).lastLoadKg).toBe(47.5);
    expect(getExerciseStats(all, CHEST).completedSessionCount).toBe(2);
  });

  it('le remplaçant a sa propre courbe, sous le même identifiant d’une séance à l’autre', () => {
    const points = getExerciseLoadHistory(all, 'sub-pec-deck');
    expect(points.map((p) => [p.workoutId, p.maxLoadKg, p.exerciseName])).toEqual([
      ['w-2', 30, 'Pec Deck'],
      ['w-3', 32.5, 'pec deck'],
    ]);
    expect(getExerciseStats(all, 'sub-pec-deck')).toMatchObject({ lastLoadKg: 32.5, bestLoadKg: 32.5, completedSessionCount: 2 });
    expect(chartMetricFor(all, 'sub-pec-deck')).toBe('load');
    expect(getExerciseEntries(all, 'sub-pec-deck').map((e) => e.workoutId)).toEqual(['w-2', 'w-3']);
  });

  it('« Dernière fois » : celle de l’exercice remplaçant ; l’origine ne voit pas le remplaçant', () => {
    expect(getLastPerformance(all, 'sub-pec-deck', 'w-3')?.sets).toEqual([{ setNumber: 1, actualReps: 12, actualWeightKg: 30, isExtra: false }]);
    expect(getLastPerformance(all, 'sub-pec-deck', 'w-2')?.date).toBe('2026-09-15');
    expect(getLastPerformance([w1, w4], 'sub-pec-deck')).toBeNull();
    expect(getLastPerformance(all, CHEST, 'w-4')?.date).toBe('2026-09-01'); // w2 et w3 (remplacés) n'y comptent pas
  });

  it('sélecteur d’exercices et progression récente : le remplaçant est un exercice à part, sous son nom', () => {
    expect(listTrackedExercises(all).map((e) => [e.programExerciseId, e.exerciseName])).toEqual([
      [CHEST, 'Chest Press'],
      ['sub-pec-deck', 'pec deck'], // nom de la séance la plus récente
    ]);
    const progressions = getRecentProgressions(all);
    expect(progressions.map((p) => [p.programExerciseId, p.deltaKg])).toEqual([
      [CHEST, 2.5],
      ['sub-pec-deck', 2.5],
    ]);
  });

  it('séances en cours exclues, et un exercice jamais remplacé garde sa courbe (clé = programExerciseId)', () => {
    const inProgress = { ...withSet(replaceExercise(createWorkout(program, 'A', { id: 'w-5', now: new Date(2026, 8, 29) }), CHEST, 'Pec Deck', 'Chest Press'), CHEST, 12, 99) };
    expect(getExerciseLoadHistory([...all, inProgress], 'sub-pec-deck').map((p) => p.workoutId)).toEqual(['w-2', 'w-3']);
    expect(getExerciseLoadHistory([w1], LAT)).toEqual([]);
    expect(getExerciseLoadHistory([withSet(workoutAt('w-6', 2), RAISE, 15, 8)], RAISE).map((p) => p.maxLoadKg)).toEqual([8]);
  });
});
