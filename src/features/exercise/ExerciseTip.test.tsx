// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { importProgram, previewProgram } from '../../services/programService';
import { startWorkout } from '../../services/workoutService';
import { fixtureObject, readFixture, resetDatabase } from '../../test/fixtures';
import { ExerciseTip } from './ExerciseTip';

async function seedProgram(text: string) {
  const preview = previewProgram(text);
  if (!preview.ok) throw new Error(preview.error.message);
  const result = await importProgram(preview.value.program);
  if (!result.ok) throw new Error(result.error.message);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  render(<App />);
}

/** jsdom ne calcule pas la mise en page : on simule un texte qui dépasse 3 lignes. */
function simulateOverflow(overflows: boolean) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(overflows ? 120 : 60);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
}

beforeEach(resetDatabase);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Encart « Conseil » de l’écran exercice (notes du programme)', () => {
  it('affiché quand l’exercice a des notes, entre « Dernière fois » et OBJECTIF', async () => {
    await seedProgram(readFixture('program-example.json'));
    const workout = await startWorkout('A');
    renderAt(`#/workout/${workout.id}/exercise/lat-pulldown-machine`);

    const tip = await screen.findByRole('complementary', { name: 'Conseil' });
    expect(within(tip).getByText('Tirer vers le haut de la poitrine, contrôler la remontée.')).toBeInTheDocument();
    // Texte court : pas de « Voir plus ».
    expect(within(tip).queryByRole('button')).not.toBeInTheDocument();
    // Placé avant OBJECTIF et RÉALISÉ dans l'ordre du document, après « Dernière fois ».
    const lastTime = screen.getByRole('region', { name: 'Dernière fois' });
    const firstField = screen.getByLabelText('Série 1 — répétitions');
    expect(lastTime.compareDocumentPosition(tip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tip.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('absent quand notes vaut null', async () => {
    await seedProgram(readFixture('program-example.json'));
    const workout = await startWorkout('A');
    renderAt(`#/workout/${workout.id}/exercise/chest-press-machine`);
    expect(await screen.findByText('Exercice 1 sur 3')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Conseil' })).not.toBeInTheDocument();
  });

  it('absent quand notes ne contient que des espaces', () => {
    render(<ExerciseTip notes="   " />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('texte long : replié sur 3 lignes avec « Voir plus », dépliable et repliable', async () => {
    simulateOverflow(true);
    const user = userEvent.setup();
    const program = fixtureObject('program-example.json') as { sessions: { exercises: { notes: string | null }[] }[] };
    const longTip = 'Garder les omoplates serrées et la poitrine sortie. '.repeat(5).trim();
    const first = program.sessions[0]?.exercises[0];
    if (first) first.notes = longTip;
    await seedProgram(JSON.stringify(program));
    const workout = await startWorkout('A');
    renderAt(`#/workout/${workout.id}/exercise/chest-press-machine`);

    const tip = await screen.findByRole('complementary', { name: 'Conseil' });
    const text = within(tip).getByText(longTip);
    expect(text.className).toMatch(/clamped/);
    const more = within(tip).getByRole('button', { name: 'Voir plus' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    await user.click(more);
    expect(text.className).not.toMatch(/clamped/);
    const less = within(tip).getByRole('button', { name: 'Voir moins' });
    expect(less).toHaveAttribute('aria-expanded', 'true');

    await user.click(less);
    expect(text.className).toMatch(/clamped/);
  });

  it('texte qui tient en 3 lignes : pas de bouton', () => {
    simulateOverflow(false);
    render(<ExerciseTip notes="Dos droit." />);
    expect(screen.getByRole('complementary', { name: 'Conseil' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
