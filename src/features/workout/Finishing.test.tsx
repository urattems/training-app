// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import { DomainError } from '../../domain/errors';
import { addCardioEntry, setActualValues, setComment, updateCardioEntry } from '../../domain/workout';
import { importProgram, previewProgram } from '../../services/programService';
import { abandonWorkout, deleteEmptyWorkout, getWorkout, startWorkout, updateWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const CHEST = 'chest-press-machine';

beforeEach(async () => {
  await resetDatabase();
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error();
  await importProgram(preview.value.program);
});
afterEach(cleanup);

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

describe('Nettoyage des textes à l\'enregistrement (service)', () => {
  it('commentaire, cardio nom/notes trimés ; vides → null (nom : chaîne vide)', async () => {
    const w = await startWorkout('A');
    await updateWorkout(w.id, (x) => setComment(x, CHEST, '  Épaule  '));
    await updateWorkout(w.id, (x) => updateCardioEntry(addCardioEntry(x, 'rower'), 0, { name: ' Rameur ', notes: '   ' }));
    const saved = await getWorkout(w.id);
    expect(saved?.exerciseRecords[0]?.comment).toBe('Épaule');
    expect(saved?.cardioRecords[0]).toMatchObject({ name: 'Rameur', notes: null });
  });

  it('écran exercice : un commentaire tapé avec des espaces est enregistré trimé', async () => {
    const w = await startWorkout('A');
    const user = renderAt(`#/workout/${w.id}/exercise/${CHEST}`);
    await user.type(await screen.findByLabelText('Commentaire'), '   Dernière série dure   ');
    await user.tab();
    await waitFor(async () => {
      expect((await getWorkout(w.id))?.exerciseRecords[0]?.comment).toBe('Dernière série dure');
    });
  });
});

describe('Avertissement non bloquant à « Valider l\'exercice »', () => {
  it('charge sans répétitions : « Compléter » reste sur l\'exercice et place le curseur ; rien n\'est inventé', async () => {
    const w = await startWorkout('A');
    await updateWorkout(w.id, (x) => setActualValues(x, CHEST, 1, { actualWeightKg: 47 }));
    const user = renderAt(`#/workout/${w.id}/exercise/${CHEST}`);
    await screen.findByText('Exercice 1 sur 3');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));

    const dialog = await screen.findByRole('dialog', { name: '1 série sans répétitions. Valider quand même ?' });
    expect(within(dialog).getByText('Rien n’est inventé : les valeurs manquantes restent vides.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Compléter' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Série 1 — répétitions')).toHaveFocus();
    expect(screen.getByText('Exercice 1 sur 3')).toBeInTheDocument();
    const saved = await getWorkout(w.id);
    expect(saved?.exerciseRecords[0]).toMatchObject({ status: 'pending' });
    expect(saved?.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 1, actualReps: null, actualWeightKg: 47, isExtra: false }]);
  });

  it('« Valider quand même » valide sans rien inventer et passe à l\'exercice suivant', async () => {
    const w = await startWorkout('A');
    await updateWorkout(w.id, (x) => setActualValues(setActualValues(x, CHEST, 1, { actualWeightKg: 47 }), CHEST, 2, { actualReps: 12 }));
    const user = renderAt(`#/workout/${w.id}/exercise/${CHEST}`);
    await screen.findByText('Exercice 1 sur 3');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    const dialog = await screen.findByRole('dialog', { name: '1 série sans répétitions et 1 série sans charge. Valider quand même ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Valider quand même' }));
    expect(await screen.findByText('Exercice 2 sur 3')).toBeInTheDocument();
    const saved = await getWorkout(w.id);
    expect(saved?.exerciseRecords[0]?.status).toBe('completed');
    expect(saved?.exerciseRecords[0]?.actualSets).toEqual([
      { setNumber: 1, actualReps: null, actualWeightKg: 47, isExtra: false },
      { setNumber: 2, actualReps: 12, actualWeightKg: null, isExtra: false },
    ]);
  });

  it('séries vides ou complètes, et poids du corps avec reps seules : aucun avertissement', async () => {
    const w = await startWorkout('C');
    await updateWorkout(w.id, (x) => setActualValues(x, 'plank-bodyweight', 1, { actualReps: 45 }));
    const user = renderAt(`#/workout/${w.id}/exercise/plank-bodyweight`);
    await screen.findByText('Exercice 3 sur 3');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    expect(await screen.findByRole('button', { name: 'Terminer la séance' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Abandon d\'une séance vide', () => {
  it('séance vide : « Supprimer cette séance » avec confirmation explicite, puis suppression', async () => {
    const w = await startWorkout('A');
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Séance A en cours' });
    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    const first = await screen.findByRole('dialog', { name: 'Abandonner la séance ?' });
    await user.click(within(first).getByRole('button', { name: 'Supprimer cette séance' }));
    const confirm = await screen.findByRole('dialog', { name: 'Supprimer cette séance vide ?' });
    expect(await getWorkout(w.id)).not.toBeNull();
    await user.click(within(confirm).getByRole('button', { name: 'Supprimer définitivement' }));
    await screen.findByRole('button', { name: 'Commencer la séance' });
    expect(await db.workouts.count()).toBe(0);
  });

  it('séance vide : « Abandonner la séance » reste possible et la conserve', async () => {
    const w = await startWorkout('A');
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Séance A en cours' });
    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abandonner la séance' }));
    await screen.findByRole('button', { name: 'Commencer la séance' });
    expect((await getWorkout(w.id))?.status).toBe('abandoned');
  });

  it('séance avec données : pas de suppression proposée, abandon conservé comme avant', async () => {
    const w = await startWorkout('A');
    await updateWorkout(w.id, (x) => setActualValues(x, CHEST, 1, { actualReps: 10 }));
    const user = renderAt('#/');
    await screen.findByRole('heading', { name: 'Séance A en cours' });
    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Abandonner la séance ?' });
    expect(within(dialog).queryByRole('button', { name: 'Supprimer cette séance' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Abandonner la séance' }));
    await screen.findByRole('button', { name: 'Commencer la séance' });
    expect((await getWorkout(w.id))?.exerciseRecords[0]?.actualSets).toHaveLength(1);
  });

  it('service : jamais de suppression d\'une séance contenant des saisies ou déjà terminée', async () => {
    const w = await startWorkout('A');
    await updateWorkout(w.id, (x) => setComment(x, CHEST, 'note'));
    await expect(deleteEmptyWorkout(w.id)).rejects.toBeInstanceOf(DomainError);
    await abandonWorkout(w.id);
    await expect(deleteEmptyWorkout(w.id)).rejects.toBeInstanceOf(DomainError);
    expect(await getWorkout(w.id)).not.toBeNull();
  });
});
