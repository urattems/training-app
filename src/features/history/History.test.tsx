// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { parseHistoryJson } from '../../schemas/parse';
import { restoreBackup } from '../../services/importService';
import { getExerciseProgress, getRecentProgress } from '../../services/statisticsService';
import { getWorkout, startWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const CHEST = 'chest-press-machine';

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

const historyRows = () => within(screen.getByRole('list')).getAllByRole('link');

beforeEach(resetDatabase);
afterEach(cleanup);

describe('Historique — liste', () => {
  it('état vide', async () => {
    renderAt('#/history');
    expect(await screen.findByRole('heading', { name: 'Aucune séance enregistrée' })).toBeInTheDocument();
  });

  it('ordre chronologique inverse : date, séance, statut, durée', async () => {
    await restoreFixture();
    renderAt('#/history');
    await screen.findByRole('heading', { name: 'Historique', level: 1 });
    await waitFor(() => {
      expect(historyRows()).toHaveLength(3);
    });
    const [w3, w2, w1] = historyRows();
    expect(w3).toHaveTextContent(/Séance A.*22 septembre.*Abandonnée/);
    expect(w2).toHaveTextContent(/15 septembre · 1 h 05.*Terminée/);
    expect(w1).toHaveTextContent(/8 septembre · 1 h 08.*Terminée/);
    expect(w2).toHaveAttribute('href', '#/history/w-0002');
  });

  it('accessible depuis Programme et Progression (sans 4e onglet), et depuis la dernière séance de l\'accueil', async () => {
    await restoreFixture();
    const user = renderAt('#/program');
    await user.click(await screen.findByRole('link', { name: 'Historique des séances' }));
    expect(window.location.hash).toBe('#/history');
    await user.click(screen.getByRole('link', { name: 'Progression' }));
    await user.click(await screen.findByRole('link', { name: 'Historique des séances' }));
    expect(window.location.hash).toBe('#/history');
    expect(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getAllByRole('link')).toHaveLength(3);

    await user.click(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: 'Accueil' }));
    await user.click(await screen.findByRole('link', { name: /Dernière séance/ }));
    expect(window.location.hash).toBe('#/history/w-0003');
    expect(await screen.findByText('Douleur à l\'épaule, arrêt de la séance.', { exact: false })).toBeInTheDocument();
  });

  it('une séance en cours apparaît « En cours » et mène à l\'écran séance', async () => {
    await restoreFixture();
    const workout = await startWorkout('A');
    renderAt('#/history');
    await waitFor(() => {
      expect(historyRows()).toHaveLength(4);
    });
    expect(historyRows()[0]).toHaveTextContent('En cours');
    expect(historyRows()[0]).toHaveAttribute('href', `#/workout/${workout.id}`);
  });
});

describe('Accueil — progression récente', () => {
  it('variations factuelles de charge (« Chest Press +0,5 kg »)', async () => {
    await restoreFixture();
    renderAt('#/');
    const card = await screen.findByRole('region', { name: 'Progression récente' });
    expect(within(card).getByText('Chest Press')).toBeInTheDocument();
    expect(within(card).getByText('+0,5 kg')).toBeInTheDocument();
  });
});

describe('Historique — détail', () => {
  beforeEach(restoreFixture);

  it('OBJECTIF puis RÉALISÉ séparés, série extra, sensation, commentaire, cardio, ordre d\'exécution', async () => {
    renderAt('#/history/w-0002');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });

    expect(screen.getByText('Ordre d’exécution').nextElementSibling).toHaveTextContent(/Tirage vertical.*Chest Press/);

    const lat = screen.getByRole('region', { name: 'Tirage vertical' });
    const objective = within(lat).getByRole('region', { name: 'Objectif' });
    const actual = within(lat).getByRole('region', { name: 'Réalisé' });
    expect(within(objective).getAllByText('8–12 × 50 kg')).toHaveLength(3);
    expect(within(actual).getByText('8 × 45 kg')).toBeInTheDocument();
    expect(within(actual).getByText('en plus')).toBeInTheDocument();
    expect(within(lat).getByText('Facile')).toBeInTheDocument();
    expect(within(lat).getByText('« Série bonus en dégressif. »')).toBeInTheDocument();
    // Lecture seule par défaut : aucun champ.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByText('Aucun cardio.')).toBeInTheDocument();
  });

  it('cardio et série non faite affichés', async () => {
    renderAt('#/history/w-0001');
    expect(await screen.findByText('Tapis incliné')).toBeInTheDocument();
    expect(screen.getByText('Tapis · 20 min · 4,5 km/h · 8 %')).toBeInTheDocument();
    cleanup();
    renderAt('#/history/w-0003');
    const chest = await screen.findByRole('region', { name: 'Chest Press' });
    expect(within(chest).getByText('non faite')).toBeInTheDocument();
  });

  it('édition rétroactive : séries réalisées, objectifs intacts, stats recalculées', async () => {
    const user = renderAt('#/history/w-0002');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Modifier' }));

    const chest = screen.getByRole('region', { name: 'Chest Press' });
    // L'objectif reste en lecture seule.
    expect(within(within(chest).getByRole('region', { name: 'Objectif' })).queryAllByRole('textbox')).toHaveLength(0);
    const kg3 = within(chest).getByLabelText('Série 3 — charge en kg');
    expect(kg3).toHaveValue('47');
    await user.clear(kg3);
    await user.type(kg3, '50');
    await user.tab();

    await waitFor(async () => {
      const saved = await getWorkout('w-0002');
      expect(saved?.exerciseRecords[0]?.actualSets[2]?.actualWeightKg).toBe(50);
    });
    expect(await screen.findByText(/^Enregistré à/)).toBeInTheDocument();
    const saved = await getWorkout('w-0002');
    expect(saved?.exerciseRecords[0]?.targetSets.map((s) => s.targetWeightKg)).toEqual([45, 45, 47]);
    expect(saved?.status).toBe('completed');

    const progress = await getExerciseProgress(CHEST);
    expect(progress.load.map((p) => p.maxLoadKg)).toEqual([45, 50, 47.5]);
    expect(progress.stats.bestLoadKg).toBe(50);

    await user.click(screen.getByRole('button', { name: 'Terminer les modifications' }));
    expect(within(screen.getByRole('region', { name: 'Chest Press' })).getByText('10 × 50 kg')).toBeInTheDocument();
  });

  it('édition : « 47, » n\'est jamais perdu, sensation et commentaire modifiables', async () => {
    const user = renderAt('#/history/w-0001');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    const chest = screen.getByRole('region', { name: 'Chest Press' });

    const kg1 = within(chest).getByLabelText('Série 1 — charge en kg');
    await user.clear(kg1);
    await user.type(kg1, '47,');
    expect(kg1).toHaveValue('47,');
    await user.type(kg1, '5');
    await user.tab();
    expect(kg1).toHaveValue('47,5');

    await user.click(within(chest).getByRole('button', { name: 'Très difficile' }));
    const comment = within(chest).getByLabelText('Commentaire');
    await user.clear(comment);
    await user.type(comment, 'Corrigé après coup');
    await user.tab();

    await waitFor(async () => {
      const record = (await getWorkout('w-0001'))?.exerciseRecords[0];
      expect(record?.actualSets[0]?.actualWeightKg).toBe(47.5);
      expect(record?.sensation).toBe('very_hard');
      expect(record?.comment).toBe('Corrigé après coup');
    });
  });

  it('édition de la date : l\'historique se réordonne', async () => {
    const user = renderAt('#/history/w-0001');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-30' } });
    await waitFor(async () => {
      expect((await getWorkout('w-0001'))?.date).toBe('2026-09-30');
    });
    await user.click(screen.getByRole('link', { name: 'Historique' }));
    await waitFor(() => {
      expect(historyRows()[0]).toHaveAttribute('href', '#/history/w-0001');
    });
  });

  it('édition de la date : startedAt et completedAt suivent (même jour, heures conservées)', async () => {
    const user = renderAt('#/history/w-0002');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-17' } });
    await waitFor(async () => {
      const saved = await getWorkout('w-0002');
      expect(saved?.date).toBe('2026-09-17');
      expect(saved?.startedAt.slice(0, 19)).toBe('2026-09-17T18:10:00');
      expect(saved?.completedAt?.slice(0, 19)).toBe('2026-09-17T19:15:00');
      expect(saved?.durationSec).toBe(3900);
    });
  });

  it('suppression : confirmation explicite, puis stats recalculées', async () => {
    const user = renderAt('#/history/w-0003');
    await screen.findByRole('heading', { name: 'Séance A', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Supprimer la séance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette séance ?' });
    expect(dialog).toHaveTextContent('sera définitivement supprimée');
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(await getWorkout('w-0003')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Supprimer la séance' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer définitivement' }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#/history');
    });
    await waitFor(() => {
      expect(historyRows()).toHaveLength(2);
    });
    expect(await getWorkout('w-0003')).toBeNull();

    const progress = await getExerciseProgress(CHEST);
    expect(progress.load.map((p) => p.maxLoadKg)).toEqual([45, 47]);
    expect(await getRecentProgress()).toEqual([
      { programExerciseId: CHEST, exerciseName: 'Chest Press', deltaKg: 2, date: '2026-09-15' },
    ]);
  });

  it('séance en cours : pas d\'édition ici, « Reprendre la séance »', async () => {
    const workout = await startWorkout('A');
    renderAt(`#/history/${workout.id}`);
    expect(await screen.findByRole('link', { name: 'Reprendre la séance' })).toHaveAttribute('href', `#/workout/${workout.id}`);
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
  });
});
