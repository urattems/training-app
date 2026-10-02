// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app/App';
import { importProgram, previewProgram } from '../services/programService';
import { finishWorkout, startWorkout } from '../services/workoutService';
import { readFixture, resetDatabase } from '../test/fixtures';
import { pwaStub } from '../test/pwaRegisterStub';
import { shouldShowUpdateBanner } from './updatePolicy';

describe('Règle de la bannière de mise à jour', () => {
  it.each([
    [{ needRefresh: true, workoutInProgress: false, dismissed: false }, true],
    [{ needRefresh: false, workoutInProgress: false, dismissed: false }, false],
    [{ needRefresh: true, workoutInProgress: true, dismissed: false }, false],
    [{ needRefresh: true, workoutInProgress: undefined, dismissed: false }, false],
    [{ needRefresh: true, workoutInProgress: false, dismissed: true }, false],
  ])('%o → %s', (state, expected) => {
    expect(shouldShowUpdateBanner(state)).toBe(expected);
  });
});

describe('Bannière « Nouvelle version disponible »', () => {
  beforeEach(async () => {
    pwaStub.reset();
    await resetDatabase();
    const preview = previewProgram(readFixture('program-example.json'));
    if (!preview.ok) throw new Error();
    await importProgram(preview.value.program);
  });
  afterEach(cleanup);

  const renderHome = () => {
    window.location.hash = '#/';
    const user = userEvent.setup();
    render(<App />);
    return user;
  };

  it('affichée quand une version attend, mise à jour seulement au toucher de l\'utilisateur', async () => {
    const user = renderHome();
    await screen.findByRole('button', { name: 'Commencer la séance' });
    expect(screen.queryByText('Nouvelle version disponible.')).not.toBeInTheDocument();
    act(() => {
      pwaStub.setNeedRefresh(true);
    });
    const banner = await screen.findByText('Nouvelle version disponible.');
    // Jamais de mise à jour automatique.
    expect(pwaStub.updateCalls).toBe(0);
    await user.click(within(banner.parentElement as HTMLElement).getByRole('button', { name: 'Mettre à jour' }));
    expect(pwaStub.updateCalls).toBe(1);
  });

  it('« Plus tard » la masque', async () => {
    const user = renderHome();
    act(() => {
      pwaStub.setNeedRefresh(true);
    });
    await user.click(await screen.findByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByText('Nouvelle version disponible.')).not.toBeInTheDocument();
    expect(pwaStub.updateCalls).toBe(0);
  });

  it('JAMAIS pendant une séance en cours : elle attend la fin de la séance', async () => {
    const workout = await startWorkout('A');
    renderHome();
    await screen.findByRole('heading', { name: 'Séance A en cours' });
    act(() => {
      pwaStub.setNeedRefresh(true);
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText('Nouvelle version disponible.')).not.toBeInTheDocument();

    await finishWorkout(workout.id);
    await waitFor(() => {
      expect(screen.getByText('Nouvelle version disponible.')).toBeInTheDocument();
    });
    expect(pwaStub.updateCalls).toBe(0);
  });
});
