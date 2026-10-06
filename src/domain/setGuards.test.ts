import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { workoutSessionSchema } from '../schemas/history.schema';
import { previewRestore } from '../services/importService';
import { importProgram, previewProgram } from '../services/programService';
import { getWorkout, startWorkout, updateWorkout } from '../services/workoutService';
import { resetDatabase } from '../test/fixtures';
import { parseDecimalInput, parseIntegerInput } from '../utils/numbers';
import { DomainError } from './errors';
import type { WorkoutSession } from './types';
import { MAX_SET_REPS, MAX_SET_WEIGHT_KG, setRepsError, setWeightError } from './values';
import { setActualValues } from './workout';

const CHEST = 'chest-press-machine';

describe('Garde-fous de saisie des séries (V1.3.2) : règles', () => {
  it('charge : ≥ 0, au plus 2 décimales, au plus 999,99 kg ; vide = valide', () => {
    expect(MAX_SET_WEIGHT_KG).toBe(999.99);
    expect(setWeightError(null)).toBeNull();
    expect(setWeightError(0)).toBeNull();
    expect(setWeightError(47.55)).toBeNull();
    expect(setWeightError(999.99)).toBeNull();
    expect(setWeightError(0.1 + 0.2)).toBeNull(); // représentation binaire : 0,3 accepté
    expect(setWeightError(47.555)).toBe('too_precise');
    expect(setWeightError(1000)).toBe('too_large');
    expect(setWeightError(4747)).toBe('too_large');
    expect(setWeightError(-1)).toBe('invalid');
    expect(setWeightError(Number.NaN)).toBe('invalid');
  });

  it('répétitions : entier ≥ 0, au plus 999 (gainage : secondes) ; vide = valide', () => {
    expect(MAX_SET_REPS).toBe(999);
    expect(setRepsError(null)).toBeNull();
    expect(setRepsError(0)).toBeNull();
    expect(setRepsError(120)).toBeNull(); // gainage de 2 minutes
    expect(setRepsError(999)).toBeNull();
    expect(setRepsError(1000)).toBe('too_large');
    expect(setRepsError(4747)).toBe('too_large');
    expect(setRepsError(12.5)).toBe('invalid');
    expect(setRepsError(-1)).toBe('invalid');
  });

  it('la saisie lit la virgule et le point ; le champ vide reste vide (null, jamais 0)', () => {
    expect(parseDecimalInput('47,55')).toEqual({ ok: true, value: 47.55 });
    expect(parseDecimalInput('47.55')).toEqual({ ok: true, value: 47.55 });
    expect(parseDecimalInput('')).toEqual({ ok: true, value: null });
    expect(parseIntegerInput('  ')).toEqual({ ok: true, value: null });
  });
});

describe('Garde-fous : domaine et service d’enregistrement', () => {
  beforeEach(async () => {
    await resetDatabase();
    const preview = previewProgram(readFileSync(resolve(process.cwd(), 'examples', 'program-example.json'), 'utf8'));
    if (!preview.ok) throw new Error(preview.error.message);
    const result = await importProgram(preview.value.program);
    if (!result.ok) throw new Error(result.error.message);
  });

  it('setActualValues refuse 47,555 kg, 1000 kg et 4747 reps ; accepte les limites', async () => {
    const w = await startWorkout('A');
    expect(() => setActualValues(w, CHEST, 1, { actualWeightKg: 47.555 })).toThrow(DomainError);
    expect(() => setActualValues(w, CHEST, 1, { actualWeightKg: 1000 })).toThrow(DomainError);
    expect(() => setActualValues(w, CHEST, 1, { actualReps: 4747 })).toThrow(DomainError);
    const ok = setActualValues(w, CHEST, 1, { actualReps: 999, actualWeightKg: 999.99 });
    expect(ok.exerciseRecords[0]?.actualSets[0]).toMatchObject({ actualReps: 999, actualWeightKg: 999.99 });
    // Vider un champ : null, accepté.
    expect(setActualValues(ok, CHEST, 1, { actualWeightKg: null }).exerciseRecords[0]?.actualSets[0]?.actualWeightKg).toBeNull();
  });

  it('le service refuse une valeur hors bornes écrite sans passer par le domaine ; rien n’est écrit', async () => {
    const w = await startWorkout('A');
    const withSet = (reps: number, kg: number) => (current: WorkoutSession): WorkoutSession => ({
      ...current,
      exerciseRecords: current.exerciseRecords.map((r) =>
        r.programExerciseId === CHEST ? { ...r, actualSets: [{ setNumber: 1, actualReps: reps, actualWeightKg: kg, isExtra: false }] } : r,
      ),
    });
    await expect(updateWorkout(w.id, withSet(4747, 47.5))).rejects.toThrow(DomainError);
    await expect(updateWorkout(w.id, withSet(12, 47.555))).rejects.toThrow(DomainError);
    expect((await getWorkout(w.id))?.exerciseRecords[0]?.actualSets).toEqual([]);
    await updateWorkout(w.id, withSet(12, 47.55));
    expect((await getWorkout(w.id))?.exerciseRecords[0]?.actualSets[0]).toMatchObject({ actualReps: 12, actualWeightKg: 47.55 });
  });

  it('une ancienne valeur hors bornes (restaurée) ne bloque pas l’enregistrement d’autre chose', async () => {
    const w = await startWorkout('A');
    const legacy: WorkoutSession = {
      ...w,
      exerciseRecords: w.exerciseRecords.map((r) =>
        r.programExerciseId === CHEST ? { ...r, actualSets: [{ setNumber: 1, actualReps: 4747, actualWeightKg: 47.555, isExtra: false }] } : r,
      ),
    };
    await db.workouts.put(legacy);
    const saved = await updateWorkout(w.id, (current) => setActualValues(current, CHEST, 2, { actualReps: 10 }));
    expect(saved.exerciseRecords[0]?.actualSets.map((s) => [s.actualReps, s.actualWeightKg])).toEqual([
      [4747, 47.555],
      [10, null],
    ]);
  });

  it('le schéma d’import n’est PAS durci : une vieille sauvegarde à 4747 reps / 1234,567 kg se restaure', () => {
    const backup = JSON.parse(readFileSync(resolve(process.cwd(), 'examples', 'history-example.json'), 'utf8')) as { sessions: WorkoutSession[] };
    const first = backup.sessions[0];
    if (!first) throw new Error('fixture vide');
    const odd: WorkoutSession = {
      ...first,
      exerciseRecords: first.exerciseRecords.map((r, i) =>
        i === 0 ? { ...r, actualSets: [{ setNumber: 1, actualReps: 4747, actualWeightKg: 1234.567, isExtra: false }] } : r,
      ),
    };
    expect(workoutSessionSchema.safeParse(odd).success).toBe(true);
    expect(previewRestore(JSON.stringify({ ...backup, sessions: [odd, ...backup.sessions.slice(1)] })).ok).toBe(true);
  });
});
