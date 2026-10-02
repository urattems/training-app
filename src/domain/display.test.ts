import { describe, expect, it } from 'vitest';
import { parseHistoryJson, parseProgramJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { formatPerformance, formatTargetSet, getLastPerformance } from './display';
import { createWorkout, setActualValues } from './workout';

const history = (() => {
  const r = parseHistoryJson(readFixture('history-example.json'));
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
})();

describe('Affichage des objectifs et performances', () => {
  it('objectif : exact, plage, sans charge', () => {
    expect(formatTargetSet({ setNumber: 1, targetReps: 12, targetWeightKg: 47.5 })).toBe('12 × 47,5 kg');
    expect(formatTargetSet({ setNumber: 1, targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: 55 })).toBe('8–12 × 55 kg');
    expect(formatTargetSet({ setNumber: 1, targetReps: 45, targetWeightKg: null })).toBe('45 reps');
  });

  it('performance : charge unique, sans charge, charges différentes, séries non faites ignorées', () => {
    const s = (reps: number | null, kg: number | null) => ({ setNumber: 1, actualReps: reps, actualWeightKg: kg, isExtra: false });
    expect(formatPerformance([s(10, 45), s(10, 45), s(9, 45)])).toBe('45 kg · 10 / 10 / 9');
    expect(formatPerformance([s(45, null), s(40, null)])).toBe('45 / 40 reps');
    expect(formatPerformance([s(12, 45), s(10, 47)])).toBe('12 × 45 kg · 10 × 47 kg');
    expect(formatPerformance([s(12, 47.5), s(null, null)])).toBe('47,5 kg · 12');
    expect(formatPerformance([])).toBe('');
  });

  it('dernière performance réelle : abandonnée incluse, séance en cours exclue', () => {
    expect(getLastPerformance(history.sessions, 'chest-press-machine')).toMatchObject({ workoutId: 'w-0003', date: '2026-09-22' });
    // Tirage : w-0003 n'a aucune série réalisée → w-0002.
    expect(getLastPerformance(history.sessions, 'lat-pulldown-machine')?.workoutId).toBe('w-0002');
    expect(getLastPerformance(history.sessions, 'chest-press-machine', 'w-0003')?.workoutId).toBe('w-0002');
    expect(getLastPerformance(history.sessions, 'inconnu')).toBeNull();

    const program = parseProgramJson(readFixture('program-example.json'));
    if (!program.ok) throw new Error();
    const live = setActualValues(createWorkout(program.value, 'A', { id: 'live', now: new Date(2026, 9, 1) }), 'chest-press-machine', 1, {
      actualReps: 1,
      actualWeightKg: 200,
    });
    expect(getLastPerformance([...history.sessions, live], 'chest-press-machine')?.workoutId).toBe('w-0003');
  });
});
