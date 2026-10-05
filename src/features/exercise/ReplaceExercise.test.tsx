// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { replaceExercise, setActualValues } from '../../domain/workout';
import { createDriveClient, type FetchLike } from '../../services/driveClient';
import { getDriveNames, getOutbox, processDriveOutbox, setDriveClient } from '../../services/driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from '../../services/driveSettings';
import { importProgram, previewProgram } from '../../services/programService';
import { setLastWeeklyBackupAt } from '../../services/settingsService';
import { finishWorkout, getWorkout, startWorkout, updateWorkout } from '../../services/workoutService';
import { readFixture, resetDatabase } from '../../test/fixtures';

const CHEST = 'chest-press-machine';
const LAT = 'lat-pulldown-machine';

const exerciseHash = (workoutId: string, exerciseId: string) => `#/workout/${workoutId}/exercise/${exerciseId}`;
const reps = (n: number) => screen.getByLabelText(`Série ${n} — répétitions`);
const kg = (n: number) => screen.getByLabelText(`Série ${n} — charge en kg`);
const PENCIL = { name: 'Remplacer cet exercice' };

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

async function mustGet(id: string) {
  const workout = await getWorkout(id);
  if (!workout) throw new Error(`séance ${id} absente`);
  return workout;
}
const savedChest = async (id: string) => (await mustGet(id)).exerciseRecords.find((r) => r.programExerciseId === CHEST);

/** Ouvre la feuille depuis le crayon de `scope` (l'écran entier par défaut). */
async function openSheet(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement = document.body) {
  await user.click(within(scope).getByRole('button', PENCIL));
  return screen.findByRole('dialog', { name: 'Remplacer l’exercice' });
}

/** Remplace l'exercice par `name` depuis la feuille et attend sa fermeture. */
async function replaceWith(user: ReturnType<typeof userEvent.setup>, name: string, scope: HTMLElement = document.body) {
  const dialog = await openSheet(user, scope);
  const input = within(dialog).getByLabelText('Exercice réalisé');
  await user.clear(input);
  await user.type(input, name);
  await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

async function seedProgram() {
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  const imported = await importProgram(preview.value.program, new Date(2026, 9, 1, 9));
  if (!imported.ok) throw new Error(imported.error.message);
}

let workoutId = '';
beforeEach(async () => {
  await resetDatabase();
  await seedProgram();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await processDriveOutbox();
});

describe('Écran exercice : crayon et feuille « Remplacer l’exercice »', () => {
  beforeEach(async () => {
    workoutId = (await startWorkout('A')).id;
  });

  it('crayon à droite du titre, avec son nom accessible ; feuille accessible avec le rappel « Prévu », le champ prérempli et la phrase', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    const title = await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const pencil = screen.getByRole('button', PENCIL);
    expect(title.compareDocumentPosition(pencil) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // à droite du titre
    expect(title.parentElement).toContainElement(pencil); // sur la même ligne
    expect(screen.queryByText('Remplacé')).not.toBeInTheDocument();

    const dialog = await openSheet(user);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText('Prévu : Chest Press')).toBeInTheDocument();
    const input = within(dialog).getByLabelText('Exercice réalisé');
    expect(input).toHaveValue('Chest Press'); // prérempli avec le nom actuel
    expect(within(dialog).getByText('Cela ne change que cette séance. Le programme du coach n’est pas modifié.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    // Pas encore remplacé : pas de « Revenir à l'exercice prévu ».
    expect(within(dialog).queryByRole('button', { name: 'Revenir à l’exercice prévu' })).not.toBeInTheDocument();
    // Tout est nommé (boutons, champs).
    for (const el of dialog.querySelectorAll<HTMLElement>('button, input')) expect(computeAccessibleName(el).trim(), el.outerHTML.slice(0, 80)).not.toBe('');
  });

  it('champ texte : clavier complet (pas numérique), sans correction, 17 px (token), cible du crayon ≥ 44 px', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const input = within(await openSheet(user)).getByLabelText('Exercice réalisé');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toHaveAttribute('inputmode');
    expect(input).toHaveAttribute('enterkeyhint', 'done');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    // 17 px : jamais de zoom au focus sur iOS (≥ 16 px). Lu dans les feuilles de style (jsdom ne les applique pas).
    const css = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
    expect(css('components/Field.module.css')).toMatch(/\.input\s*\{[^}]*font-size:\s*var\(--font-size-input\)/);
    expect(css('styles/tokens.css')).toMatch(/--font-size-input:\s*1\.0625rem/); // 17 px
    // Crayon : 44 px au moins dans les deux sens.
    expect(css('features/exercise/ReplaceExercise.module.css')).toMatch(/\.pencil\s*\{[^}]*width:\s*var\(--tap-min\)[^}]*height:\s*var\(--tap-min\)/);
    expect(css('styles/tokens.css')).toMatch(/--tap-min:\s*2\.75rem/); // 44 px
  });

  it('le nom actuel est sélectionné au focus : on peut y ajouter « (autre machine) » sans tout retaper', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const input: HTMLInputElement = within(await openSheet(user)).getByLabelText('Exercice réalisé');
    input.blur();
    input.focus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Chest Press'.length]);
    // Ajouter à la fin : End puis la suite.
    await user.keyboard('{End} (autre machine)');
    expect(input).toHaveValue('Chest Press (autre machine)');
  });

  it('remplacer : nom, badge « Remplacé », « Prévu : » dans OBJECTIF ; sauvegarde immédiate ; le prévu reste intact', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    await replaceWith(user, 'Dumbbell Press');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dumbbell Press' })).toBeInTheDocument();
    expect(screen.getByText('Remplacé')).toBeInTheDocument();
    const objective = screen.getByRole('region', { name: 'Objectif' });
    expect(within(objective).getByText('Prévu : Chest Press')).toBeInTheDocument();
    expect(within(objective).getAllByText(/× 4[79] kg/)).toHaveLength(3); // objectifs intacts (47 / 47 / 49 kg)
    expect(screen.getByText('Repos recommandé : 120 s', { exact: false })).toBeInTheDocument();

    const record = await savedChest(workoutId);
    expect(record).toMatchObject({ exerciseId: 'sub-dumbbell-press', exerciseName: 'Dumbbell Press', programExerciseId: CHEST, restSec: 120 });
    expect(record?.targetSets.map((s) => s.targetWeightKg)).toEqual([47, 47, 49]);
    // La catégorie et l'équipement décrivent l'exercice prévu : pas affichés sous le nom d'un remplaçant.
    expect(screen.queryByText(/Machine/)).not.toBeInTheDocument();
    // Retour du focus au crayon à la fermeture de la feuille.
    expect(screen.getByRole('button', PENCIL)).toHaveFocus();
  });

  it('remplacé : « Comme prévu » masqué et placeholders absents ; de retour après retrait', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    expect(screen.getAllByRole('button', { name: /remplir comme prévu/ })).toHaveLength(3);
    expect(reps(1)).toHaveAttribute('placeholder', '12');
    expect(kg(1)).toHaveAttribute('placeholder', '47');

    await replaceWith(user, 'Dumbbell Press');
    await screen.findByRole('heading', { level: 1, name: 'Dumbbell Press' });
    expect(screen.queryAllByRole('button', { name: /remplir comme prévu/ })).toHaveLength(0);
    for (const n of [1, 2, 3]) {
      expect(reps(n)).toHaveAttribute('placeholder', '');
      expect(kg(n)).toHaveAttribute('placeholder', '');
    }
    // Le bloc OBJECTIF reste visible, à titre d'information.
    expect(within(screen.getByRole('region', { name: 'Objectif' })).getAllByRole('listitem')).toHaveLength(3);
    // « + Série » reste disponible, et trois lignes (le nombre du programme).
    expect(screen.getByRole('button', { name: '+ Série' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Série 4 — répétitions')).not.toBeInTheDocument();

    // Retrait : tout revient.
    const dialog = await openSheet(user);
    await user.click(within(dialog).getByRole('button', { name: 'Revenir à l’exercice prévu' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Chest Press' })).toBeInTheDocument();
    expect(screen.queryByText('Remplacé')).not.toBeInTheDocument();
    expect(screen.queryByText(/Prévu : /)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /remplir comme prévu/ })).toHaveLength(3);
    expect(reps(1)).toHaveAttribute('placeholder', '12');
    expect(kg(3)).toHaveAttribute('placeholder', '49');
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });
  });

  it('les séries déjà saisies sont CONSERVÉES au remplacement et au retrait', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    await user.type(reps(1), '12');
    await user.type(kg(1), '47,5');
    await user.type(reps(2), '10');
    await user.click(screen.getByRole('button', { name: '+ Série' }));
    await screen.findByLabelText('Série 4 — répétitions');
    await user.type(reps(4), '8');
    await user.type(kg(4), '40');

    // La saisie en cours (non encore écrite) part avant le remplacement : rien n'est perdu.
    await replaceWith(user, 'Dumbbell Press');
    await screen.findByRole('heading', { level: 1, name: 'Dumbbell Press' });
    expect([reps(1), kg(1), reps(2), reps(4), kg(4)].map((el) => el.getAttribute('value'))).toEqual(['12', '47,5', '10', '8', '40']);
    const expected = [
      { setNumber: 1, actualReps: 12, actualWeightKg: 47.5, isExtra: false },
      { setNumber: 2, actualReps: 10, actualWeightKg: null, isExtra: false },
      { setNumber: 4, actualReps: 8, actualWeightKg: 40, isExtra: true },
    ];
    expect((await savedChest(workoutId))?.actualSets).toEqual(expected);
    expect(screen.getByText('en plus')).toBeInTheDocument(); // la série en plus reste marquée

    await user.click(within(await openSheet(user)).getByRole('button', { name: 'Revenir à l’exercice prévu' }));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    expect((await savedChest(workoutId))?.actualSets).toEqual(expected);
    expect(reps(1)).toHaveValue('12');
  });

  it('saisir le nom d’origine (casse libre) retire le remplacement ; un nom identique ne change rien', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const writes = vi.spyOn(Storage.prototype, 'setItem'); // aucune écriture parasite attendue ailleurs
    await replaceWith(user, 'chest press'); // pas remplacé : nom identique, rien ne change
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });
    expect(screen.queryByText('Remplacé')).not.toBeInTheDocument();
    expect(writes).not.toHaveBeenCalled();

    await replaceWith(user, 'Dumbbell Press');
    await screen.findByText('Remplacé');
    await replaceWith(user, '  CHEST PRESS ');
    expect(await screen.findByRole('heading', { level: 1, name: 'Chest Press' })).toBeInTheDocument();
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });
    expect(screen.queryByText('Remplacé')).not.toBeInTheDocument();
  });

  it('doublon dans la même séance : refusé avec un message clair, la feuille reste ouverte, rien n’est écrit', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const dialog = await openSheet(user);
    const input = within(dialog).getByLabelText('Exercice réalisé');
    await user.clear(input);
    await user.type(input, 'tirage VERTICAL');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('« tirage VERTICAL » est déjà un exercice de cette séance. Choisis un autre nom.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });

    // Corriger efface l'erreur.
    await user.type(input, ' bis');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('validation du champ : vide, trop long (> 60), sans lettre ; Entrée enregistre ; Annuler et Échap ne changent rien', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const dialog = await openSheet(user);
    const input = within(dialog).getByLabelText('Exercice réalisé');
    const save = within(dialog).getByRole('button', { name: 'Enregistrer' });

    await user.clear(input);
    await user.click(save);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Indique le nom de l’exercice réalisé.');
    await user.type(input, 'x'.repeat(61));
    await user.click(save);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('60 caractères au maximum');
    await user.clear(input);
    await user.type(input, '???');
    await user.click(save);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('au moins une lettre ou un chiffre');
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: CHEST });

    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const again = await openSheet(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(again).not.toBeInTheDocument();
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press' });

    const third = await openSheet(user);
    const field = within(third).getByLabelText('Exercice réalisé');
    await user.clear(field);
    await user.type(field, 'Pec Deck{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await savedChest(workoutId)).toMatchObject({ exerciseId: 'sub-pec-deck', exerciseName: 'Pec Deck' });
  });

  it('écran séance : badge « Remplacé » sur la ligne, sous le nom choisi', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    await replaceWith(user, 'Dumbbell Press');
    await screen.findByRole('heading', { level: 1, name: 'Dumbbell Press' });
    await user.click(screen.getByRole('link', { name: 'Liste des exercices de la séance' }));
    const row = await screen.findByRole('link', { name: /Dumbbell Press/ });
    expect(within(row).getByText('Remplacé')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Chest Press/ })).not.toBeInTheDocument();
    expect(within(await screen.findByRole('link', { name: /Tirage vertical/ })).queryByText('Remplacé')).not.toBeInTheDocument();
  });

  it('valider un exercice remplacé : pas d’avertissement « sans charge » issu de la charge prévue de l’exercice d’origine', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    await replaceWith(user, 'Pompes');
    await screen.findByRole('heading', { level: 1, name: 'Pompes' });
    await user.type(reps(1), '15'); // poids du corps : reps seules
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    expect(await screen.findByText('Exercice 2 sur 3')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await savedChest(workoutId))?.status).toBe('completed');
  });
});

describe('« Dernière fois » d’un exercice remplacé', () => {
  it('= dernière performance de l’exercice remplaçant ; sinon « Aucune séance précédente. » ; l’origine ne la voit pas', async () => {
    // Séance précédente : Chest Press remplacé par « Dumbbell Press », 10 × 30 kg.
    await startWorkout('A', { id: 'w-prev', now: new Date(2026, 9, 2, 18) });
    await updateWorkout('w-prev', (w) => setActualValues(replaceExercise(w, CHEST, 'Dumbbell Press', 'Chest Press'), CHEST, 1, { actualReps: 10, actualWeightKg: 30 }));
    await finishWorkout('w-prev', new Date(2026, 9, 2, 19));

    workoutId = (await startWorkout('A', { id: 'w-now', now: new Date(2026, 9, 5, 18) })).id;
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByRole('heading', { level: 1, name: 'Chest Press' });
    const lastTime = () => screen.getByRole('region', { name: 'Dernière fois' });
    // Exercice d'origine : la séance précédente l'a remplacé, donc aucune performance de « Chest Press ».
    expect(lastTime()).toHaveTextContent('Aucune séance précédente.');

    await replaceWith(user, 'dumbbell press'); // même nom, saisi autrement : même exerciseId
    await screen.findByRole('heading', { level: 1, name: 'dumbbell press' });
    expect(lastTime()).toHaveTextContent('30 kg · 10');
    expect(lastTime()).not.toHaveTextContent('Aucune séance précédente.');

    await replaceWith(user, 'Pec Deck');
    await screen.findByRole('heading', { level: 1, name: 'Pec Deck' });
    expect(lastTime()).toHaveTextContent('Aucune séance précédente.');
  });
});

describe('Historique : badge, « Prévu » et crayon en mode « Modifier »', () => {
  /** Séance terminée dont Chest Press a été réalisé sur une autre machine. */
  async function finishedReplaced() {
    await startWorkout('A', { id: 'w-fin', now: new Date(2026, 9, 3, 18, 10) });
    await updateWorkout('w-fin', (w) => setActualValues(replaceExercise(w, CHEST, 'Pec Deck', 'Chest Press'), CHEST, 1, { actualReps: 12, actualWeightKg: 30 }));
    await finishWorkout('w-fin', new Date(2026, 9, 3, 19, 20));
  }

  it('lecture : badge « Remplacé », « Prévu : » dans OBJECTIF, nom réel dans RÉALISÉ et dans l’ordre d’exécution ; pas de crayon', async () => {
    await finishedReplaced();
    renderAt('#/history/w-fin');
    const region = await screen.findByRole('region', { name: 'Pec Deck' });
    expect(within(region).getByText('Remplacé')).toBeInTheDocument();
    // Le nom prévu vient du programme d'origine : lu après son chargement.
    expect(await within(within(region).getByRole('region', { name: 'Objectif' })).findByText('Prévu : Chest Press')).toBeInTheDocument();
    expect(within(within(region).getByRole('region', { name: 'Réalisé' })).getByText('12 × 30 kg')).toBeInTheDocument();
    expect(screen.getByText('Ordre d’exécution').nextElementSibling).toHaveTextContent('Pec Deck');
    expect(screen.queryAllByRole('button', PENCIL)).toHaveLength(0);
    // L'exercice non remplacé n'a ni badge ni « Prévu ».
    const lat = screen.getByRole('region', { name: 'Tirage vertical' });
    expect(within(lat).queryByText('Remplacé')).not.toBeInTheDocument();
    expect(within(lat).queryByText(/Prévu : /)).not.toBeInTheDocument();
  });

  it('mode « Modifier » : un crayon par exercice ; mêmes règles ; « Comme prévu » absent pour l’exercice remplacé ; séries conservées', async () => {
    await finishedReplaced();
    const user = renderAt('#/history/w-fin');
    await screen.findByRole('region', { name: 'Pec Deck' });
    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(screen.getAllByRole('button', PENCIL)).toHaveLength(3);

    const pec = screen.getByRole('region', { name: 'Pec Deck' });
    expect(within(pec).queryAllByRole('button', { name: /remplir comme prévu/ })).toHaveLength(0);
    const lat = screen.getByRole('region', { name: 'Tirage vertical' });
    expect(within(lat).getAllByRole('button', { name: /remplir comme prévu/ }).length).toBeGreaterThan(0);

    // Retrait depuis l'historique.
    const dialog = await openSheet(user, pec);
    expect(within(dialog).getByLabelText('Exercice réalisé')).toHaveValue('Pec Deck');
    expect(within(dialog).getByText('Prévu : Chest Press')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revenir à l’exercice prévu' }));
    const chest = await screen.findByRole('region', { name: 'Chest Press' });
    expect(within(chest).queryByText('Remplacé')).not.toBeInTheDocument();
    expect(await savedChest('w-fin')).toMatchObject({ exerciseId: CHEST, exerciseName: 'Chest Press', actualSets: [{ setNumber: 1, actualReps: 12, actualWeightKg: 30 }] });
    expect((await mustGet('w-fin')).status).toBe('completed');

    // Doublon refusé ici aussi.
    const second = await openSheet(user, chest);
    const input = within(second).getByLabelText('Exercice réalisé');
    await user.clear(input);
    await user.type(input, 'Tirage vertical');
    await user.click(within(second).getByRole('button', { name: 'Enregistrer' }));
    expect(within(second).getByRole('alert')).toHaveTextContent('déjà un exercice de cette séance');
  });

  it('une séance terminée remplacée depuis l’historique : même statut, mêmes dates, objectifs intacts', async () => {
    await startWorkout('A', { id: 'w-fin2', now: new Date(2026, 9, 3, 18, 10) });
    await updateWorkout('w-fin2', (w) => setActualValues(w, CHEST, 1, { actualReps: 12, actualWeightKg: 47 }));
    await finishWorkout('w-fin2', new Date(2026, 9, 3, 19, 20));
    const before = await mustGet('w-fin2');
    const user = renderAt('#/history/w-fin2');
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    await replaceWith(user, 'Dumbbell Press', await screen.findByRole('region', { name: 'Chest Press' }));
    await waitFor(async () => {
      expect((await savedChest('w-fin2'))?.exerciseId).toBe('sub-dumbbell-press');
    });
    const after = await mustGet('w-fin2');
    expect({ ...after, exerciseRecords: [] }).toEqual({ ...before, exerciseRecords: [] });
    expect(after.exerciseRecords[0]?.targetSets).toEqual(before.exerciseRecords[0]?.targetSets);
    expect(after.exerciseRecords[0]?.actualSets).toEqual(before.exerciseRecords[0]?.actualSets);
  });
});

describe('Archive Drive : le remplacement depuis l’historique met à jour le MÊME fichier', () => {
  const URL_ = 'https://script.google.com/macros/s/AKfycbREPLACETESTID/exec';
  const SECRET = 'secret-replace-9876';
  interface Sent {
    action: string;
    folder?: string;
    name?: string;
    content?: string;
  }
  let sent: Sent[] = [];
  const fetch: FetchLike = (_url, init) => {
    sent.push(JSON.parse(init.body as string) as Sent);
    return Promise.resolve(new Response('{"ok":true}'));
  };

  beforeEach(async () => {
    sent = [];
    setDriveClient(createDriveClient({ fetch }));
    await saveDriveConfig(URL_, SECRET);
    await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
    await setDriveEnabled(true);
    await setLastWeeklyBackupAt(new Date().toISOString());
  });

  it('séance terminée et envoyée, puis exercice remplacé dans « Modifier » : même dossier, même nom gelé, contenu à jour', async () => {
    await startWorkout('A', { id: 'w-drv', now: new Date(2026, 9, 4, 18, 10) });
    await updateWorkout('w-drv', (w) => setActualValues(w, CHEST, 1, { actualReps: 12, actualWeightKg: 47 }));
    await finishWorkout('w-drv', new Date(2026, 9, 4, 19, 20));
    await processDriveOutbox('all');
    const sessionPuts = () => sent.filter((r) => r.action === 'put' && r.folder === 'Semaine 40');
    expect(sessionPuts()).toHaveLength(1);
    const first = sessionPuts()[0];
    expect(first?.content).not.toContain('sub-dumbbell-press');
    const frozen = (await getDriveNames())['w-drv'];
    expect(frozen).toBeDefined();

    const user = renderAt('#/history/w-drv');
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    await replaceWith(user, 'Dumbbell Press', await screen.findByRole('region', { name: 'Chest Press' }));
    await waitFor(async () => {
      expect((await getOutbox()).tasks.length + sessionPuts().length).toBeGreaterThan(1);
    });
    await processDriveOutbox('all');

    await waitFor(() => {
      expect(sessionPuts().length).toBeGreaterThanOrEqual(2);
    });
    const last = sessionPuts().at(-1);
    expect(last).toMatchObject({ folder: frozen?.folder, name: frozen?.name }); // même fichier, même nom gelé
    expect(new Set(sessionPuts().map((r) => `${r.folder ?? ''}/${r.name ?? ''}`)).size).toBe(1);
    const content = JSON.parse(last?.content ?? '{}') as { sessions: { exerciseRecords: { exerciseId: string; exerciseName: string; programExerciseId: string }[] }[] };
    expect(content.sessions[0]?.exerciseRecords.find((r) => r.programExerciseId === CHEST)).toMatchObject({ exerciseId: 'sub-dumbbell-press', exerciseName: 'Dumbbell Press' });
    expect((await getDriveNames())['w-drv']).toEqual(frozen);
    // Aucune erreur : tout est confirmé, la file est vide.
    expect((await getOutbox()).tasks).toEqual([]);
    // Et l'exercice LAT n'est pas touché.
    expect(content.sessions[0]?.exerciseRecords.find((r) => r.programExerciseId === LAT)).toMatchObject({ exerciseId: LAT });
  });
});
