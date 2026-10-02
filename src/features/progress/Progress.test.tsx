// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { buildChartSeries } from '../../domain/chart';
import { getExerciseLoadHistory } from '../../domain/stats';
import type { WorkoutSession } from '../../domain/types';
import { setActualValues, validateExercise } from '../../domain/workout';
import { parseHistoryJson } from '../../schemas/parse';
import { deleteWorkout } from '../../services/historyService';
import { restoreBackup } from '../../services/importService';
import { importProgram, previewProgram } from '../../services/programService';
import { finishWorkout, startWorkout, updateWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';
import { loadDemoData } from '../settings/DevTools';

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

/** Boutons-points du graphique (un par séance affichée). */
const points = () => screen.queryAllByRole('button', { name: /^\w+ \d+ \w+.* : / });
const period = (label: string) => screen.getByRole('button', { name: label });

// Le premier import du module différé compile Recharts (plusieurs secondes sous jsdom) :
// on le préchauffe une fois, pour que les attentes des tests mesurent l'app, pas la compilation.
beforeAll(async () => {
  await import('./ProgressPage');
}, 30_000);

beforeEach(async () => {
  // Seul Date est simulé : « aujourd'hui » = 20 octobre 2026 pour des périodes déterministes.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));
  await resetDatabase();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Progression — états vides', () => {
  it('aucune séance : message explicatif, pas de graphique vide', async () => {
    renderAt('#/progress');
    expect(await screen.findByRole('heading', { name: 'Pas encore de progression' })).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('période sans séance : message, pas de graphique vide', async () => {
    await restoreFixture();
    vi.setSystemTime(new Date(2027, 5, 1, 12));
    const user = renderAt('#/progress');
    await user.click(await screen.findByRole('button', { name: '1 mois' }));
    expect(await screen.findByText('Aucune séance réalisée sur cette période.')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });
});

describe('Progression — graphique, périodes, carte de détail', () => {
  beforeEach(restoreFixture);

  it('exercice le plus récent par défaut, 3 points sur 3 mois (abandonnée incluse)', async () => {
    renderAt('#/progress');
    expect(await screen.findByRole('figure', { name: /Charge max par séance \(kg\) — 3 séances/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Exercice')).toHaveValue(CHEST);
    expect(period('3 mois')).toHaveAttribute('aria-pressed', 'true');
    expect(points().map((p) => p.getAttribute('aria-label'))).toEqual([
      'mardi 8 septembre : 45 kg',
      'mardi 15 septembre : 47 kg',
      'mardi 22 septembre : 47,5 kg',
    ]);
  });

  it('périodes 1M · 3M · 6M · 1A · Tout : recalcul des points, période dans l\'URL', async () => {
    const user = renderAt('#/progress');
    await screen.findByRole('figure');
    await user.click(period('1 mois'));
    // Un seul point : le graphique s'affiche quand même.
    await waitFor(() => {
      expect(points()).toHaveLength(1);
    });
    expect(window.location.hash).toContain('periode=1M');
    for (const label of ['6 mois', '1 an', 'Tout l’historique']) {
      await user.click(period(label));
      await waitFor(() => {
        expect(points()).toHaveLength(3);
      });
    }
    expect(period('Tout l’historique')).toHaveAttribute('aria-pressed', 'true');
  });

  it('toucher un point affiche une carte lisible (date, exercice, charge max, reps par série)', async () => {
    const user = renderAt('#/progress');
    await screen.findByRole('figure');
    expect(screen.getByText('Touche un point pour voir le détail de la séance.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'mardi 22 septembre : 47,5 kg' }));
    const card = await screen.findByRole('region', { name: 'mardi 22 septembre' });
    expect(within(card).getByText('Chest Press')).toBeInTheDocument();
    expect(within(card).getByText('Charge max')).toBeInTheDocument();
    expect(within(card).getByText('47,5 kg')).toBeInTheDocument();
    expect(within(card).getAllByText('12 × 47,5 kg')).toHaveLength(2);
    expect(within(card).getByRole('link', { name: 'Voir la séance' })).toHaveAttribute('href', '#/history/w-0003');
    expect(screen.getByRole('button', { name: 'mardi 22 septembre : 47,5 kg' })).toHaveAttribute('aria-pressed', 'true');

    // Autre point, puis fermeture.
    await user.click(screen.getByRole('button', { name: 'mardi 8 septembre : 45 kg' }));
    expect(await screen.findByRole('region', { name: 'mardi 8 septembre' })).toHaveTextContent('9 × 45 kg');
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('region', { name: 'mardi 8 septembre' })).not.toBeInTheDocument();
  });

  it('stats hiérarchisées : dernière charge, record, volume, séances terminées seulement', async () => {
    renderAt('#/progress');
    const stats = await screen.findByRole('region', { name: 'Dernière charge' });
    expect(within(stats).getAllByText('47,5 kg').length).toBeGreaterThan(0);
    expect(within(stats).getByText('+0,5 kg vs séance précédente')).toBeInTheDocument();
    expect(within(stats).getByText('Record').nextElementSibling).toHaveTextContent('47,5 kg');
    expect(within(stats).getByText('Volume dernière séance').nextElementSibling).toHaveTextContent(/1\s140 kg/);
    // 3 séances avec Chest Press, dont 1 abandonnée : 2 séances terminées.
    expect(within(stats).getByText('Séances').nextElementSibling).toHaveTextContent('2');
    expect(within(stats).getByText(/12 × 47,5 kg/)).toBeInTheDocument();

    const recent = screen.getByRole('region', { name: 'Historique récent' });
    expect(within(recent).getAllByRole('link')).toHaveLength(3);
    expect(within(recent).getByText('Abandonnée')).toBeInTheDocument();
  });

  it('changer d\'exercice met à jour l\'URL et le graphique', async () => {
    const user = renderAt('#/progress?periode=all');
    await screen.findByRole('figure');
    await user.selectOptions(screen.getByLabelText('Exercice'), 'lat-pulldown-machine');
    await waitFor(() => {
      expect(window.location.hash).toBe('#/progress/lat-pulldown-machine?periode=all');
    });
    await waitFor(() => {
      expect(points()).toHaveLength(2);
    });
  });

  it('édition puis suppression d\'une séance : graphique et stats recalculés', async () => {
    renderAt('#/progress?periode=all');
    await screen.findByRole('figure');
    await updateWorkout('w-0003', (w) => setActualValues(w, CHEST, 1, { actualWeightKg: 60 }));
    expect(await screen.findByRole('button', { name: 'mardi 22 septembre : 60 kg' })).toBeInTheDocument();
    const stats = screen.getByRole('region', { name: 'Dernière charge' });
    expect(within(stats).getByText('Record').nextElementSibling).toHaveTextContent('60 kg');

    await deleteWorkout('w-0003');
    await waitFor(() => {
      expect(points()).toHaveLength(2);
    });
    expect(within(screen.getByRole('region', { name: 'Dernière charge' })).getByText('Record').nextElementSibling).toHaveTextContent('47 kg');
  });
});

describe('Progression — exercice sans charge', () => {
  it('graphique des répétitions max, libellé adapté', async () => {
    const preview = previewProgram(readFixture('program-example.json'));
    if (!preview.ok) throw new Error(preview.error.message);
    await importProgram(preview.value.program);
    for (const [day, reps] of [
      [5, 40],
      [12, 50],
    ] as const) {
      vi.setSystemTime(new Date(2026, 9, day, 18));
      const workout = await startWorkout('C');
      await updateWorkout(workout.id, (w) => validateExercise(setActualValues(w, 'plank-bodyweight', 1, { actualReps: reps }), 'plank-bodyweight'));
      vi.setSystemTime(new Date(2026, 9, day, 19));
      await finishWorkout(workout.id);
    }
    vi.setSystemTime(new Date(2026, 9, 20, 12));

    renderAt('#/progress/plank-bodyweight');
    expect(await screen.findByRole('figure', { name: /Répétitions max par séance — 2 séances/ })).toBeInTheDocument();
    expect(screen.getByText('Aucune charge enregistrée pour cet exercice : le graphique suit les répétitions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'lundi 12 octobre : 50 reps' })).toBeInTheDocument();
    const stats = screen.getByRole('region', { name: 'Dernières répétitions max' });
    expect(within(stats).getByText('Record de répétitions').nextElementSibling).toHaveTextContent('50 reps');
    expect(within(stats).queryByText('Volume dernière séance')).not.toBeInTheDocument();
  });
});

describe('Progression — performance', () => {
  /** 3 ans de séances : 3 par semaine, 3 exercices chacune. */
  function generateYears(years: number): WorkoutSession[] {
    const workouts: WorkoutSession[] = [];
    const start = new Date(Date.UTC(2023, 9, 1));
    for (let i = 0; i < years * 52 * 3; i++) {
      const day = new Date(start.getTime() + Math.floor(i * (7 / 3)) * 86_400_000);
      const date = day.toISOString().slice(0, 10);
      const load = 40 + Math.round((i / 10) * 2.5) / 2;
      workouts.push({
        id: `gen-${String(i)}`,
        programId: 'prog-demo-w37',
        programSessionId: 'A',
        sessionName: 'Séance A',
        date,
        startedAt: `${date}T18:00:00+02:00`,
        completedAt: `${date}T19:00:00+02:00`,
        durationSec: 3600,
        status: 'completed',
        executionOrder: [CHEST],
        exerciseRecords: [CHEST, 'lat-pulldown-machine', 'lateral-raise-dumbbell'].map((id) => ({
          exerciseId: id,
          exerciseName: id,
          programExerciseId: id,
          status: 'completed' as const,
          restSec: 120,
          targetSets: [{ setNumber: 1, targetReps: 10, targetWeightKg: load }],
          actualSets: [1, 2, 3].map((n) => ({ setNumber: n, actualReps: 10, actualWeightKg: load, isExtra: false })),
          sensation: null,
          comment: null,
        })),
        cardioRecords: [],
        notes: null,
      });
    }
    return workouts;
  }

  it('calcul des séries rapide sur 3 ans de données', () => {
    const workouts = generateYears(3);
    expect(workouts.length).toBeGreaterThan(450);
    const t0 = performance.now();
    const series = buildChartSeries(getExerciseLoadHistory(workouts, CHEST), 'load', 'all', '2026-10-20');
    const elapsed = performance.now() - t0;
    expect(series.points).toHaveLength(workouts.length);
    expect(elapsed).toBeLessThan(250);
  });

  it('l\'onglet s\'affiche avec plusieurs années de données', async () => {
    await restoreFixture();
    await db.workouts.bulkPut(generateYears(3));
    const user = renderAt('#/progress');
    await screen.findByRole('figure', undefined, { timeout: 5000 });
    await user.click(period('Tout l’historique'));
    await waitFor(() => {
      expect(points().length).toBeGreaterThan(450);
    });
  });
});

describe('Chargeur de démo (mode dev)', () => {
  it('charge examples/history-example.json via la restauration', async () => {
    expect(await loadDemoData()).toBe(3);
    expect(await db.workouts.count()).toBe(3);
  });

  it('visible dans les Paramètres en mode dev, avec confirmation', async () => {
    expect(import.meta.env.DEV).toBe(true);
    const user = renderAt('#/settings');
    await user.click(await screen.findByRole('button', { name: 'Charger les données de démo' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remplacer par la démo' }));
    expect(await screen.findByText('Données de démo chargées : 3 séances.')).toBeInTheDocument();
  });
});
