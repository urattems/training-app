// @vitest-environment jsdom
/**
 * App servie en HTTP sur IP locale (tests sur iPhone) : contexte non sécurisé.
 * `crypto.randomUUID`, `navigator.share`/`canShare` y sont absents ; l'app doit fonctionner.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { deliverFile, exportFileName } from '../../services/exportService';
import { importProgram, previewProgram } from '../../services/programService';
import { getInProgressWorkout, startWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

/** Web Crypto tel qu'exposé hors contexte sécurisé : getRandomValues seulement. */
const stubInsecureCrypto = () => {
  vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
};

beforeEach(async () => {
  await resetDatabase();
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  await importProgram(preview.value.program);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Contexte non sécurisé (HTTP sur IP locale)', () => {
  it('service : une séance démarre sans crypto.randomUUID', async () => {
    stubInsecureCrypto();
    const workout = await startWorkout('A');
    expect(workout.id).toMatch(UUID_V4);
    expect((await getInProgressWorkout())?.id).toBe(workout.id);
  });

  it('UI : « Commencer la séance » ouvre l\'écran séance sans crypto.randomUUID', async () => {
    stubInsecureCrypto();
    window.location.hash = '#/';
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Commencer la séance' }));
    expect(await screen.findByRole('button', { name: 'Terminer la séance' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const workout = await getInProgressWorkout();
    expect(workout?.id).toMatch(UUID_V4);
    expect(window.location.hash).toBe(`#/workout/${workout?.id ?? ''}`);
  });

  it('export : Web Share absent → téléchargement', async () => {
    const download = vi.fn();
    const file = new File(['{}'], exportFileName(new Date(2026, 9, 1)), { type: 'application/json' });
    expect(await deliverFile(file, { navigator: { canShare: undefined, share: undefined }, download })).toBe('downloaded');
    expect(download).toHaveBeenCalledWith(file);
  });

  it('export : canShare qui lève une exception → téléchargement, sans erreur', async () => {
    const download = vi.fn();
    const share = vi.fn();
    const file = new File(['{}'], 'x.json', { type: 'application/json' });
    const canShare = () => {
      throw new TypeError('canShare indisponible');
    };
    expect(await deliverFile(file, { navigator: { canShare, share }, download })).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
  });
});

describe('Feuille d\'erreur : détails techniques', () => {
  it('« Afficher les détails » donne le nom et le message de l\'erreur', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(db.workouts, 'add').mockRejectedValueOnce(new TypeError('crypto.randomUUID is not a function'));
    window.location.hash = '#/';
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Commencer la séance' }));

    const dialog = await screen.findByRole('dialog', { name: 'Impossible de démarrer la séance' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('erreur inattendue');
    expect(within(dialog).queryByText(/TypeError/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Afficher les détails' }));
    expect(within(dialog).getByText('TypeError: crypto.randomUUID is not a function')).toBeInTheDocument();
    expect(await getInProgressWorkout()).toBeNull();
  });
});
