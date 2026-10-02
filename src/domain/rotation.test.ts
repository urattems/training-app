import { describe, expect, it } from 'vitest';
import { parseProgramJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { getNextSession } from './rotation';
import type { WorkoutSession } from './types';
import { abandonWorkout, createWorkout, finishWorkout } from './workout';

const program = (() => {
  const result = parseProgramJson(readFixture('program-example.json'));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
})();

const done = (sessionId: string, day: number): WorkoutSession =>
  finishWorkout(createWorkout(program, sessionId, { id: `w-${sessionId}-${day}`, now: new Date(2026, 9, day, 18) }), new Date(2026, 9, day, 19));

describe('Prochaine séance (rotation)', () => {
  it('premier lancement : la séance d\'order le plus bas', () => {
    expect(getNextSession(program, []).id).toBe('A');
  });

  it('suit la dernière séance terminée, avec retour à la première', () => {
    expect(getNextSession(program, [done('A', 1)]).id).toBe('B');
    expect(getNextSession(program, [done('A', 1), done('B', 2)]).id).toBe('C');
    expect(getNextSession(program, [done('B', 2), done('C', 3), done('A', 1)]).id).toBe('A');
  });

  it('une séance abandonnée ou en cours ne fait pas avancer la rotation', () => {
    const abandoned = abandonWorkout(createWorkout(program, 'B', { id: 'x', now: new Date(2026, 9, 5) }));
    const inProgress = createWorkout(program, 'C', { id: 'y', now: new Date(2026, 9, 6) });
    expect(getNextSession(program, [done('A', 1), abandoned, inProgress]).id).toBe('B');
  });

  it('ignore les séances d\'un autre programme', () => {
    const other = { ...done('B', 4), programId: 'autre' };
    expect(getNextSession(program, [done('A', 1), other]).id).toBe('B');
  });
});
