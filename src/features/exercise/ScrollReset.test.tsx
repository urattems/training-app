// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { App } from '../../app/App';
import { importProgram, previewProgram } from '../../services/programService';
import { getWorkout, startWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const CHEST = 'chest-press-machine';
const LAT = 'lat-pulldown-machine';
const RAISE = 'lateral-raise-dumbbell';

const exerciseHash = (workoutId: string, exerciseId: string) => `#/workout/${workoutId}/exercise/${exerciseId}`;
const reps = (n: number) => screen.getByLabelText(`Série ${n} — répétitions`);
const kg = (n: number) => screen.getByLabelText(`Série ${n} — charge en kg`);

let scrollTo: MockInstance<typeof window.scrollTo>;
let workoutId = '';

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

/** Appels `scrollTo` depuis le dernier `scrollTo.mockClear()`. */
const resets = () => scrollTo.mock.calls.length;

beforeEach(async () => {
  await resetDatabase();
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  await importProgram(preview.value.program);
  workoutId = (await startWorkout('A')).id;
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  scrollTo.mockRestore();
});

describe('Retour en haut au changement d’exercice (fix-ux)', () => {
  it('ouverture d’un exercice : défilement à zéro, instantané, focus sur le titre sans défiler', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    const title = screen.getByRole('heading', { level: 1, name: 'Chest Press' });
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it('Valider puis suivant : remise en haut, clavier fermé (le champ actif est quitté)', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(reps(1), '12');
    await user.type(kg(1), '47');
    expect(kg(1)).toHaveFocus();
    scrollTo.mockClear();

    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    await screen.findByText('Exercice 2 sur 3');

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(resets()).toBe(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Tirage vertical' })).toHaveFocus();
    expect(document.activeElement?.tagName).toBe('H1');
    // La saisie validée n'est pas perdue : le flush se termine avant le changement d'exercice.
    const saved = (await getWorkout(workoutId))?.exerciseRecords[0];
    expect(saved).toMatchObject({ status: 'completed', actualSets: [{ setNumber: 1, actualReps: 12, actualWeightKg: 47 }] });
  });

  it('flèches ← et → : remise en haut à chaque changement', async () => {
    const user = renderAt(exerciseHash(workoutId, LAT));
    await screen.findByText('Exercice 2 sur 3');
    scrollTo.mockClear();

    await user.click(screen.getByRole('link', { name: 'Exercice suivant' }));
    await screen.findByText('Exercice 3 sur 3');
    expect(resets()).toBe(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Élévations latérales' })).toHaveFocus();

    await user.click(screen.getByRole('link', { name: 'Exercice précédent' }));
    await screen.findByText('Exercice 2 sur 3');
    expect(resets()).toBe(2);
    expect(screen.getByRole('heading', { level: 1, name: 'Tirage vertical' })).toHaveFocus();
  });

  it('ouverture depuis l’écran séance, puis retour à la Liste : remise en haut', async () => {
    const user = renderAt(`#/workout/${workoutId}`);
    await user.click(await screen.findByRole('link', { name: /Chest Press/ }));
    await screen.findByText('Exercice 1 sur 3');
    expect(resets()).toBeGreaterThanOrEqual(1);

    scrollTo.mockClear();
    await user.click(screen.getByRole('link', { name: 'Liste des exercices de la séance' }));
    await screen.findByRole('button', { name: 'Terminer la séance' });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('valider le dernier exercice : la Liste s’ouvre en haut', async () => {
    const user = renderAt(exerciseHash(workoutId, RAISE));
    await screen.findByText('Exercice 3 sur 3');
    await user.type(reps(1), '15');
    await user.type(kg(1), '8');
    scrollTo.mockClear();
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    await screen.findByRole('button', { name: 'Terminer la séance' });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('changement d’identifiant dans l’URL : remise en haut', async () => {
    renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    scrollTo.mockClear();

    act(() => {
      window.location.hash = exerciseHash(workoutId, RAISE);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByText('Exercice 3 sur 3');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(screen.getByRole('heading', { level: 1, name: 'Élévations latérales' })).toHaveFocus();
  });

  it('JAMAIS pendant la saisie : frappe, enregistrement automatique, série en plus, sensation, commentaire, « Comme prévu »', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    scrollTo.mockClear();

    await user.type(reps(1), '12');
    await user.type(kg(1), '47,5');
    // Enregistrement automatique : le délai de 350 ms est écoulé, la saisie est en base.
    await waitFor(async () => {
      expect((await getWorkout(workoutId))?.exerciseRecords[0]?.actualSets[0]).toMatchObject({ actualReps: 12, actualWeightKg: 47.5 });
    });
    expect(kg(1)).toHaveFocus(); // le champ garde le focus : le clavier reste ouvert pendant la saisie

    await user.click(screen.getByRole('button', { name: 'Série 2 : remplir comme prévu' }));
    await waitFor(() => {
      expect(reps(2)).toHaveValue('12');
    });
    await user.click(screen.getByRole('button', { name: '+ Série' }));
    await screen.findByLabelText('Série 4 — répétitions');
    await user.click(screen.getByRole('button', { name: 'Difficile' }));
    await user.type(screen.getByLabelText('Commentaire'), 'Bonne séance');
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(async () => {
      const record = (await getWorkout(workoutId))?.exerciseRecords[0];
      expect(record).toMatchObject({ sensation: 'hard', comment: 'Bonne séance' });
    });

    expect(resets()).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Commentaire')).toHaveFocus();
  });
});
