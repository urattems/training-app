// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { importProgram, previewProgram } from '../../services/programService';
import { getWorkout, startWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const CHEST = 'chest-press-machine';
const reps = (n: number) => screen.getByLabelText(`Série ${n} — répétitions`);
const kg = (n: number) => screen.getByLabelText(`Série ${n} — charge en kg`);

async function firstSet(workoutId: string) {
  const workout = await getWorkout(workoutId);
  return workout?.exerciseRecords.find((r) => r.programExerciseId === CHEST)?.actualSets.find((s) => s.setNumber === 1);
}

async function openExercise() {
  const workout = await startWorkout('A');
  window.location.hash = `#/workout/${workout.id}/exercise/${CHEST}`;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('Exercice 1 sur 3');
  return { user, workoutId: workout.id };
}

beforeEach(async () => {
  await resetDatabase();
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  const result = await importProgram(preview.value.program);
  if (!result.ok) throw new Error(result.error.message);
});
afterEach(cleanup);

describe('Saisie des séries : garde-fous (V1.3.2)', () => {
  it('47,555 kg : « Au plus 2 décimales », rien n’est enregistré ; 47,55 (virgule) est accepté', async () => {
    const { user, workoutId } = await openExercise();
    await user.type(kg(1), '47,555');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Au plus 2 décimales (ex. 47,55).');
    expect(kg(1)).toHaveValue('47,555');
    expect(kg(1)).toHaveAttribute('aria-invalid', 'true');
    expect((await firstSet(workoutId))?.actualWeightKg ?? null).not.toBe(47.555);

    await user.clear(kg(1));
    await user.type(kg(1), '47,55');
    await user.tab();
    await waitFor(async () => {
      expect((await firstSet(workoutId))?.actualWeightKg).toBe(47.55);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('charge : 999,99 accepté, 1000 refusé (« 999,99 kg au maximum »)', async () => {
    const { user, workoutId } = await openExercise();
    await user.type(kg(1), '999,99');
    await user.tab();
    await waitFor(async () => {
      expect((await firstSet(workoutId))?.actualWeightKg).toBe(999.99);
    });
    await user.clear(kg(1));
    await user.type(kg(1), '1000');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Charge trop élevée : 999,99 kg au maximum.');
    expect((await firstSet(workoutId))?.actualWeightKg).not.toBe(1000);
  });

  it('répétitions : 4747 refusé (« 999 au maximum »), 999 accepté', async () => {
    const { user, workoutId } = await openExercise();
    await user.type(reps(1), '4747');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de répétitions : 999 au maximum.');
    expect((await firstSet(workoutId))?.actualReps ?? null).not.toBe(4747);

    await user.clear(reps(1));
    await user.type(reps(1), '999');
    await user.tab();
    await waitFor(async () => {
      expect((await firstSet(workoutId))?.actualReps).toBe(999);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('champ vidé : reste vide et vaut null en base (jamais 0)', async () => {
    const { user, workoutId } = await openExercise();
    await user.type(kg(1), '47,5');
    await user.tab();
    await waitFor(async () => {
      expect((await firstSet(workoutId))?.actualWeightKg).toBe(47.5);
    });
    await user.clear(kg(1));
    await user.tab();
    await waitFor(async () => {
      expect((await firstSet(workoutId))?.actualWeightKg).toBeNull();
    });
    expect(kg(1)).toHaveValue('');
  });
});
