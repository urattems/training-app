// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { parseHistoryJson } from '../../schemas/parse';
import { restoreBackup } from '../../services/importService';
import { getWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

async function restoreFixture() {
  const parsed = parseHistoryJson(readFixture('history-example.json'));
  if (!parsed.ok) throw new Error(parsed.error.message);
  await restoreBackup(parsed.value);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

beforeEach(async () => {
  await resetDatabase();
  await restoreFixture();
});
afterEach(cleanup);

describe('Détail d’une séance abandonnée : « Supprimer cette séance » (alternative sans geste)', () => {
  it('confirmation : nom, date, séries saisies, caractère définitif ; Annuler ne change rien', async () => {
    const user = renderAt('#/history/w-0003');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Supprimer cette séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance abandonnée ?' });
    expect(dialog).toHaveTextContent('« Séance A » du mardi 22 septembre : 2 séries saisies.');
    expect(dialog).toHaveTextContent('La suppression est définitive');
    expect(within(dialog).getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await getWorkout('w-0003')).not.toBeNull();
    expect(await getWorkout('w-0001')).not.toBeNull();
  });

  it('confirmer supprime exactement cette séance, retour à la liste mise à jour', async () => {
    const user = renderAt('#/history/w-0003');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Supprimer cette séance' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/history');
    });
    await waitFor(() => {
      expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(2);
    });
    expect(await getWorkout('w-0003')).toBeNull();
    expect(await getWorkout('w-0001')).not.toBeNull();
    expect(await getWorkout('w-0002')).not.toBeNull();
  });

  it('séance TERMINÉE : bouton et confirmation inchangés (règle des autres statuts non modifiée)', async () => {
    const user = renderAt('#/history/w-0002');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    expect(screen.queryByRole('button', { name: 'Supprimer cette séance' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Supprimer la séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance ?' });
    expect(dialog).toHaveTextContent('sera définitivement supprimée');
    expect(within(dialog).getByRole('button', { name: 'Supprimer définitivement' })).toBeInTheDocument();
  });
});
