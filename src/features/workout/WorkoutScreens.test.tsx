// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { setActualValues, validateExercise } from '../../domain/workout';
import { importProgram, previewProgram } from '../../services/programService';
import { finishWorkout, getInProgressWorkout, getWorkout, startWorkout, updateWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

async function seedProgram() {
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  const result = await importProgram(preview.value.program);
  if (!result.ok) throw new Error(result.error.message);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  const view = render(<App />);
  return { user, view };
}

beforeEach(async () => {
  await resetDatabase();
  await seedProgram();
});
afterEach(cleanup);

describe('Accueil', () => {
  it('prochaine séance puis démarrage : snapshot des objectifs et écran séance', async () => {
    const { user } = renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Séance A' })).toBeInTheDocument();
    expect(screen.getByText('3 exercices · ~70 min')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Commencer la séance' }));
    expect(await screen.findByRole('heading', { name: 'Séance A', level: 1 })).toBeInTheDocument();

    const workout = await getInProgressWorkout();
    expect(workout).not.toBeNull();
    expect(window.location.hash).toBe(`#/workout/${workout?.id ?? ''}`);
    expect(workout?.exerciseRecords[0]?.targetSets.map((s) => s.targetWeightKg)).toEqual([47, 47, 49]);
    expect(workout?.exerciseRecords.every((r) => r.actualSets.length === 0)).toBe(true);

    expect(screen.getByText('0 / 3')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByText('À faire')).toHaveLength(3);
    // Accès libre à n'importe quel exercice (écran exercice au J3b).
    expect(within(list).getByRole('link', { name: /Élévations latérales/ })).toHaveAttribute(
      'href',
      `#/workout/${workout?.id ?? ''}/exercise/lateral-raise-dumbbell`,
    );
    // La section Cardio lit l'objectif dans le programme (lecture asynchrone).
    expect(await screen.findByText('Aucun cardio saisi.')).toBeInTheDocument();
  });

  it('rotation après une séance terminée et carte « Dernière séance »', async () => {
    const workout = await startWorkout('A', { now: new Date(2026, 9, 1, 18, 0) });
    await updateWorkout(workout.id, (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 }));
    await finishWorkout(workout.id, new Date(2026, 9, 1, 19, 8));

    renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Séance B' })).toBeInTheDocument();
    const last = screen.getByRole('region', { name: 'Séance A' });
    expect(within(last).getByText('Terminée')).toBeInTheDocument();
    expect(within(last).getByText('jeudi 1 octobre · 1 h 08')).toBeInTheDocument();
  });

  it('séance en cours : carte prioritaire, Reprendre, et aucune autre séance démarrable', async () => {
    const workout = await startWorkout('B');
    const { user } = renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Séance B en cours' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commencer la séance' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Reprendre' }));
    expect(window.location.hash).toBe(`#/workout/${workout.id}`);
    expect(await screen.findByRole('heading', { name: 'Séance B', level: 1 })).toBeInTheDocument();
  });

  it('Abandonner depuis l\'accueil : confirmation, statut abandoned, données conservées', async () => {
    const workout = await startWorkout('A');
    await updateWorkout(workout.id, (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 10, actualWeightKg: 45 }));
    const { user } = renderAt('#/');
    await screen.findByRole('heading', { name: 'Séance A en cours' });

    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Abandonner la séance ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Continuer la séance' }));
    expect((await getWorkout(workout.id))?.status).toBe('in_progress');

    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abandonner la séance' }));
    // L'abandon ne fait pas avancer la rotation : prochaine séance = A ; la dernière séance (A) est « Abandonnée ».
    expect(await screen.findByRole('button', { name: 'Commencer la séance' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Séance A' })).toHaveLength(2);
    });
    expect(screen.getByText('Abandonnée')).toBeInTheDocument();
    const saved = await getWorkout(workout.id);
    expect(saved?.status).toBe('abandoned');
    expect(saved?.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 1, actualReps: 10, actualWeightKg: 45, isExtra: false }]);
  });

  it('reprise après fermeture/réouverture de la base', async () => {
    await startWorkout('C');
    db.close();
    await db.open();
    renderAt('#/');
    expect(await screen.findByRole('heading', { name: 'Séance C en cours' })).toBeInTheDocument();
  });
});

describe('Programme', () => {
  it('lancer une autre séance pendant une séance en cours est bloqué : Reprendre / Abandonner', async () => {
    const workout = await startWorkout('A');
    const { user } = renderAt('#/program');
    const sessionB = await screen.findByRole('region', { name: 'Séance B' });
    await user.click(within(sessionB).getByRole('button', { name: 'Commencer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Une séance est déjà en cours' });
    expect(within(dialog).getByText(/Séance A est en cours/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reprendre' }));
    expect(window.location.hash).toBe(`#/workout/${workout.id}`);
    expect(await db.workouts.count()).toBe(1);
  });

  it('détail d\'une séance : objectif, repos, dernière performance, notes', async () => {
    const done = await startWorkout('A', { now: new Date(2026, 8, 24, 18) });
    await updateWorkout(done.id, (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 }));
    await updateWorkout(done.id, (w) => setActualValues(w, 'chest-press-machine', 2, { actualReps: 11, actualWeightKg: 47 }));
    await finishWorkout(done.id, new Date(2026, 8, 24, 19));

    const { user } = renderAt('#/program');
    await user.click(await screen.findByRole('link', { name: /Tirage vertical/ }));
    expect(window.location.hash).toBe('#/program/A?exercise=lat-pulldown-machine');

    const lat = await screen.findByRole('region', { name: 'Tirage vertical' });
    expect(within(lat).getAllByText('8–12 × 55 kg')).toHaveLength(3);
    expect(within(lat).getByText('Repos recommandé : 120 s')).toBeInTheDocument();
    expect(within(lat).getByText('Aucune séance précédente.')).toBeInTheDocument();
    expect(within(lat).getByText('Tirer vers le haut de la poitrine, contrôler la remontée.')).toBeInTheDocument();

    const chest = screen.getByRole('region', { name: 'Chest Press' });
    expect(within(chest).getByText(/47 kg · 12 \/ 11/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commencer cette séance' })).toBeInTheDocument();
  });
});

describe('Écran séance', () => {
  it('Terminer avec des exercices non validés : confirmation, puis completed', async () => {
    const workout = await startWorkout('A');
    await updateWorkout(workout.id, (w) => validateExercise(w, 'chest-press-machine'));
    const { user } = renderAt(`#/workout/${workout.id}`);

    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Validé')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Terminer la séance' }));
    const dialog = await screen.findByRole('dialog', { name: '2 exercices non validés' });
    await user.click(within(dialog).getByRole('button', { name: 'Continuer la séance' }));
    expect((await getWorkout(workout.id))?.status).toBe('in_progress');

    await user.click(screen.getByRole('button', { name: 'Terminer la séance' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Terminer quand même' }));
    expect(await screen.findByRole('heading', { name: 'Séance B' })).toBeInTheDocument();
    const saved = await getWorkout(workout.id);
    expect(saved?.status).toBe('completed');
    expect(saved?.completedAt).not.toBeNull();
    expect(saved?.exerciseRecords.map((r) => r.status)).toEqual(['completed', 'pending', 'pending']);
  });

  it('Terminer quand tout est validé : pas de confirmation', async () => {
    const workout = await startWorkout('A');
    for (const id of ['chest-press-machine', 'lat-pulldown-machine', 'lateral-raise-dumbbell']) {
      await updateWorkout(workout.id, (w) => validateExercise(w, id));
    }
    const { user } = renderAt(`#/workout/${workout.id}`);
    await user.click(await screen.findByRole('button', { name: 'Terminer la séance' }));
    expect(await screen.findByRole('heading', { name: 'Séance B' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await getWorkout(workout.id))?.status).toBe('completed');
  });

  it('séance terminée ouverte par son URL : plus modifiable ici', async () => {
    const workout = await startWorkout('A');
    await finishWorkout(workout.id);
    renderAt(`#/workout/${workout.id}`);
    expect(await screen.findByRole('heading', { name: 'Séance terminée' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminer la séance' })).not.toBeInTheDocument();
  });
});
