// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { db } from '../../db/database';
import type { WorkoutSession } from '../../domain/types';
import { importProgram, previewProgram } from '../../services/programService';
import { getExerciseProgress } from '../../services/statisticsService';
import { getInProgressWorkout, getWorkout, startWorkout } from '../../services/workoutService';
import { fixtureObject, readFixture, resetDatabase } from '../../test/fixtures';

const CHEST = 'chest-press-machine';
const LAT = 'lat-pulldown-machine';
const RAISE = 'lateral-raise-dumbbell';

async function seedProgram(text = readFixture('program-example.json')) {
  const preview = previewProgram(text);
  if (!preview.ok) throw new Error(preview.error.message);
  const result = await importProgram(preview.value.program);
  if (!result.ok) throw new Error(result.error.message);
}

function renderAt(hash: string) {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  return user;
}

/** Ferme l'app (démontage), ferme et rouvre la base, puis relance l'app. */
async function closeAndReopen(hash: string) {
  cleanup();
  db.close();
  await db.open();
  return renderAt(hash);
}

const exerciseHash = (workoutId: string, exerciseId: string) => `#/workout/${workoutId}/exercise/${exerciseId}`;
const reps = (n: number) => screen.getByLabelText(`Série ${n} — répétitions`);
const kg = (n: number) => screen.getByLabelText(`Série ${n} — charge en kg`);

async function savedRecord(workoutId: string, exerciseId: string) {
  const workout = await getWorkout(workoutId);
  return workout?.exerciseRecords.find((r) => r.programExerciseId === exerciseId);
}

/** Attend qu'une condition sur la séance en base soit vraie. */
async function expectSaved(workoutId: string, check: (w: WorkoutSession) => void) {
  await waitFor(async () => {
    const workout = await getWorkout(workoutId);
    if (!workout) throw new Error('séance absente');
    check(workout);
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedProgram();
});
afterEach(cleanup);

describe('Scénario 2 — séance A : 3 séries, sensation, commentaire, validation, fermer/rouvrir', () => {
  it('les données sont identiques après réouverture', async () => {
    const user = renderAt('#/');
    await user.click(await screen.findByRole('button', { name: 'Commencer la séance' }));
    await user.click(await screen.findByRole('link', { name: /Chest Press/ }));

    expect(await screen.findByText('Exercice 1 sur 3')).toBeInTheDocument();
    // Barre basse masquée, bouton Liste présent.
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Liste des exercices de la séance' })).toBeInTheDocument();
    // Réalisé vide au départ, objectif en placeholder.
    expect(reps(1)).toHaveValue('');
    expect(reps(1)).toHaveAttribute('placeholder', '12');
    expect(kg(1)).toHaveValue('');
    expect(kg(1)).toHaveAttribute('placeholder', '47');
    expect(reps(1)).toHaveAttribute('inputmode', 'numeric');
    expect(kg(1)).toHaveAttribute('inputmode', 'decimal');

    await user.type(reps(1), '12');
    await user.type(kg(1), '47,5');
    await user.type(reps(2), '12');
    await user.type(kg(2), '47.5');
    await user.type(reps(3), '10');
    await user.type(kg(3), '49');
    await user.click(screen.getByRole('button', { name: 'Bien' }));
    await user.type(screen.getByLabelText('Commentaire'), 'Bonne séance');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));

    // Passage direct à l'exercice suivant.
    expect(await screen.findByText('Exercice 2 sur 3')).toBeInTheDocument();
    const workout = await getInProgressWorkout();
    if (!workout) throw new Error('séance absente');

    await closeAndReopen(exerciseHash(workout.id, CHEST));
    expect(await screen.findByText('Exercice 1 sur 3')).toBeInTheDocument();
    expect([1, 2, 3].map((n) => [reps(n).getAttribute('value'), kg(n).getAttribute('value')])).toEqual([
      ['12', '47,5'],
      ['12', '47,5'],
      ['10', '49'],
    ]);
    expect(screen.getByRole('button', { name: 'Bien' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Commentaire')).toHaveValue('Bonne séance');
    expect(screen.getByText('Validé')).toBeInTheDocument();

    const record = await savedRecord(workout.id, CHEST);
    expect(record).toMatchObject({ status: 'completed', sensation: 'good', comment: 'Bonne séance' });
    expect(record?.actualSets).toEqual([
      { setNumber: 1, actualReps: 12, actualWeightKg: 47.5, isExtra: false },
      { setNumber: 2, actualReps: 12, actualWeightKg: 47.5, isExtra: false },
      { setNumber: 3, actualReps: 10, actualWeightKg: 49, isExtra: false },
    ]);
    // Objectifs intacts.
    expect(record?.targetSets.map((s) => s.targetWeightKg)).toEqual([47, 47, 49]);
  });
});

describe('Scénario 3 — quitter en cours de séance, rouvrir, reprendre', () => {
  it('une saisie non encore écrite est enregistrée à la fermeture (pagehide), puis reprise', async () => {
    const workout = await startWorkout('A');
    const user = renderAt(exerciseHash(workout.id, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(reps(1), '12');
    await user.type(kg(1), '47,5');
    // Fermeture de l'app sur iOS : `pagehide`, sans blur ni attente du délai d'enregistrement.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    // Écrit tout de suite (bien avant le délai de 350 ms).
    await waitFor(
      async () => {
        expect((await savedRecord(workout.id, CHEST))?.actualSets[0]).toMatchObject({ actualReps: 12, actualWeightKg: 47.5 });
      },
      { timeout: 150 },
    );

    const reopened = await closeAndReopen('#/');
    await reopened.click(await screen.findByRole('link', { name: 'Reprendre' }));
    expect(await screen.findByText('1 / 3 séries saisies')).toBeInTheDocument();
    await reopened.click(screen.getByRole('link', { name: /Chest Press/ }));
    await screen.findByText('Exercice 1 sur 3');
    expect(reps(1)).toHaveValue('12');
    expect(kg(1)).toHaveValue('47,5');
  });

  it('passage en arrière-plan (visibilitychange) : écriture immédiate, sans attendre le délai', async () => {
    const workout = await startWorkout('A');
    const user = renderAt(exerciseHash(workout.id, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(kg(1), '50');

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(
      async () => {
        expect((await savedRecord(workout.id, CHEST))?.actualSets[0]?.actualWeightKg).toBe(50);
      },
      { timeout: 150 },
    );
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});

describe('Scénario 4 — exercice 3 avant le 1', () => {
  it('ordre réel stocké, statistiques correctes', async () => {
    const workout = await startWorkout('A');
    const user = renderAt(`#/workout/${workout.id}`);
    await user.click(await screen.findByRole('link', { name: /Élévations latérales/ }));
    expect(await screen.findByText('Exercice 3 sur 3')).toBeInTheDocument();
    await user.type(reps(1), '15');
    await user.type(kg(1), '8');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));

    // Dernier exercice validé : retour à l'écran séance.
    await user.click(await screen.findByRole('link', { name: /Chest Press/ }));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(reps(1), '12');
    await user.type(kg(1), '47');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    await screen.findByText('Exercice 2 sur 3');
    await user.click(screen.getByRole('link', { name: 'Liste des exercices de la séance' }));

    await user.click(await screen.findByRole('button', { name: 'Terminer la séance' }));
    await user.click(within(await screen.findByRole('dialog', { name: '1 exercice non validé' })).getByRole('button', { name: 'Terminer quand même' }));
    await screen.findByRole('button', { name: 'Commencer la séance' });

    const saved = await getWorkout(workout.id);
    expect(saved?.status).toBe('completed');
    expect(saved?.executionOrder).toEqual([RAISE, CHEST]);
    expect(saved?.exerciseRecords.map((r) => r.programExerciseId)).toEqual([CHEST, LAT, RAISE]);
    const chest = await getExerciseProgress(CHEST);
    expect(chest.load.map((p) => p.maxLoadKg)).toEqual([47]);
    expect(chest.stats.completedSessionCount).toBe(1);
    expect((await getExerciseProgress(RAISE)).load.map((p) => p.maxLoadKg)).toEqual([8]);
  });
});

describe('Saisie : brouillon, décimales, effacement', () => {
  let workoutId = '';
  beforeEach(async () => {
    workoutId = (await startWorkout('A')).id;
  });

  it('« 47, » et « 47. » ne sont jamais perdus ni écrasés pendant la saisie', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(kg(1), '47,');
    await new Promise((r) => setTimeout(r, 500));
    // Le brouillon « 47, » reste intact à l'écran ; seule la dernière valeur valide (47) est persistée.
    expect(kg(1)).toHaveValue('47,');
    expect((await savedRecord(workoutId, CHEST))?.actualSets[0]?.actualWeightKg).toBe(47);
    await user.type(kg(1), '5');
    expect(kg(1)).toHaveValue('47,5');
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets[0]?.actualWeightKg).toBe(47.5);
    });

    await user.type(kg(2), '52.');
    expect(kg(2)).toHaveValue('52.');
    await user.type(kg(2), '25');
    await user.tab();
    expect(kg(2)).toHaveValue('52,25');
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets[1]?.actualWeightKg).toBe(52.25);
    });
  });

  it('« 47, » abandonné au blur devient 47 ; une valeur invalide est signalée et jamais écrite', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(kg(1), '47,');
    await user.tab();
    expect(kg(1)).toHaveValue('47');
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets[0]?.actualWeightKg).toBe(47);
    });

    await user.type(kg(2), '4,7,5');
    await user.tab();
    expect(kg(2)).toHaveValue('4,7,5');
    expect(kg(2)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Valeur invalide');
    await new Promise((r) => setTimeout(r, 500));
    // Ni la saisie invalide ni la valeur intermédiaire « 4,7 » ne sont écrites ; la saisie reste affichée.
    expect((await savedRecord(workoutId, CHEST))?.actualSets.find((s) => s.setNumber === 2)).toBeUndefined();
    expect(kg(2)).toHaveValue('4,7,5');
  });

  it('effacer un champ remet la valeur à null sans casser la série', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(reps(1), '12');
    await user.type(kg(1), '47');
    await user.tab();
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 1, actualReps: 12, actualWeightKg: 47, isExtra: false }]);
    });
    await user.clear(reps(1));
    await user.tab();
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 1, actualReps: null, actualWeightKg: 47, isExtra: false }]);
    });
  });

  it('un simple passage dans un champ vide n\'écrit rien', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.click(reps(1));
    await user.tab();
    await new Promise((r) => setTimeout(r, 500));
    const saved = await getWorkout(workoutId);
    expect(saved?.exerciseRecords[0]?.actualSets).toEqual([]);
    expect(saved?.executionOrder).toEqual([]);
  });
});

describe('Comme prévu, + Série, sensation, navigation', () => {
  let workoutId = '';
  beforeEach(async () => {
    workoutId = (await startWorkout('A')).id;
  });

  it('cibles exactes : remplit reps et charge', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.click(screen.getByRole('button', { name: 'Série 3 : remplir comme prévu' }));
    await waitFor(() => {
      expect(reps(3)).toHaveValue('10');
    });
    expect(kg(3)).toHaveValue('49');
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 3, actualReps: 10, actualWeightKg: 49, isExtra: false }]);
    });
  });

  it('plage de reps : remplit seulement la charge, les reps restent vides et prennent le focus', async () => {
    const user = renderAt(exerciseHash(workoutId, LAT));
    await screen.findByText('Exercice 2 sur 3');
    expect(reps(1)).toHaveAttribute('placeholder', '8–12');
    await user.click(screen.getByRole('button', { name: 'Série 1 : remplir comme prévu' }));
    await waitFor(() => {
      expect(kg(1)).toHaveValue('55');
    });
    expect(reps(1)).toHaveValue('');
    expect(reps(1)).toHaveFocus();
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[1]?.actualSets).toEqual([{ setNumber: 1, actualReps: null, actualWeightKg: 55, isExtra: false }]);
    });
  });

  it('« + Série » : série extra numérotée 4, sans objectif ni « Comme prévu »', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.click(screen.getByRole('button', { name: '+ Série' }));
    expect(await screen.findByLabelText('Série 4 — répétitions')).toHaveAttribute('placeholder', '');
    expect(screen.queryByRole('button', { name: 'Série 4 : remplir comme prévu' })).not.toBeInTheDocument();
    expect(screen.getByText('en plus')).toBeInTheDocument();
    await user.type(reps(4), '8');
    await user.type(kg(4), '40');
    await user.tab();
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 4, actualReps: 8, actualWeightKg: 40, isExtra: true }]);
    });
    // « + Série » reste en bas de liste, après la série 4.
    const add = screen.getByRole('button', { name: '+ Série' });
    expect(reps(4).compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Écran séance : la série en plus est comptée à part des séries prescrites.
    await user.click(screen.getByRole('link', { name: 'Liste des exercices de la séance' }));
    expect(await screen.findByText('0 / 3 séries saisies · +1 en plus')).toBeInTheDocument();
  });

  it('sensation : un seul choix, retoucher le choix actif le désélectionne', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    const options = within(screen.getByRole('group', { name: 'Sensation' })).getAllByRole('button');
    expect(options.map((b) => b.textContent)).toEqual(['Très facile', 'Facile', 'Bien', 'Difficile', 'Très difficile']);
    await user.click(screen.getByRole('button', { name: 'Difficile' }));
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.sensation).toBe('hard');
    });
    await user.click(screen.getByRole('button', { name: 'Très difficile' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Très difficile' })).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByRole('button', { name: 'Difficile' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Très difficile' }));
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.sensation).toBeNull();
    });
  });

  it('navigation hors ordre par le header (← →) et bouton Liste', async () => {
    const user = renderAt(exerciseHash(workoutId, LAT));
    await screen.findByText('Exercice 2 sur 3');
    await user.click(screen.getByRole('link', { name: 'Exercice précédent' }));
    expect(await screen.findByText('Exercice 1 sur 3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Exercice précédent' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Exercice suivant' }));
    await user.click(await screen.findByRole('link', { name: 'Exercice suivant' }));
    expect(await screen.findByText('Exercice 3 sur 3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Exercice suivant' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Liste des exercices de la séance' }));
    expect(await screen.findByRole('button', { name: 'Terminer la séance' })).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/workout/${workoutId}`);
  });

  it('un exercice validé reste modifiable', async () => {
    const user = renderAt(exerciseHash(workoutId, CHEST));
    await screen.findByText('Exercice 1 sur 3');
    await user.type(reps(1), '12');
    await user.type(kg(1), '47');
    await user.click(screen.getByRole('button', { name: 'Valider l’exercice' }));
    await screen.findByText('Exercice 2 sur 3');

    await user.click(screen.getByRole('link', { name: 'Liste des exercices de la séance' }));
    const row = await screen.findByRole('link', { name: /Chest Press/ });
    expect(within(row).getByText('Validé')).toBeInTheDocument();
    await user.click(row);
    await screen.findByText('Exercice 1 sur 3');
    await user.clear(reps(1));
    await user.type(reps(1), '11');
    await user.tab();
    await expectSaved(workoutId, (w) => {
      expect(w.exerciseRecords[0]?.status).toBe('completed');
      expect(w.exerciseRecords[0]?.actualSets[0]?.actualReps).toBe(11);
    });
  });
});

describe('Comme prévu masqué quand rien n\'est remplissable', () => {
  it('plage de reps + charge null : pas de bouton', async () => {
    const program = fixtureObject('program-example.json') as { programId: string; sessions: { exercises: { sets: Record<string, unknown>[] }[] }[] };
    program.programId = 'prog-pdc';
    for (const set of program.sessions[0]?.exercises[1]?.sets ?? []) set.targetWeightKg = null;
    await resetDatabase();
    await seedProgram(JSON.stringify(program));
    const workout = await startWorkout('A');
    renderAt(exerciseHash(workout.id, LAT));
    await screen.findByText('Exercice 2 sur 3');
    expect(screen.queryByRole('button', { name: /remplir comme prévu/ })).not.toBeInTheDocument();
    expect(kg(1)).toHaveAttribute('placeholder', '');
  });
});

describe('Cardio réel', () => {
  it('type, nom, durée en minutes (stockée en secondes), vitesse, inclinaison bornée, notes ; persistance ; suppression confirmée', async () => {
    const workout = await startWorkout('A');
    let user = renderAt(`#/workout/${workout.id}`);
    await user.click(await screen.findByRole('button', { name: 'Ajouter du cardio' }));
    await user.click(screen.getByRole('button', { name: 'Tapis' }));
    const entry = await screen.findByRole('group', { name: 'Cardio 1' });

    await user.type(within(entry).getByLabelText('Nom'), 'Tapis incliné');
    await user.type(within(entry).getByLabelText('Durée (min)'), '20');
    await user.type(within(entry).getByLabelText('Vitesse (km/h)'), '5,5');
    await user.type(within(entry).getByLabelText('Inclinaison (%)'), '101');
    await user.tab();
    expect(within(entry).getByRole('alert')).toHaveTextContent('Inclinaison entre 0 et 100 %.');
    await user.clear(within(entry).getByLabelText('Inclinaison (%)'));
    await user.type(within(entry).getByLabelText('Inclinaison (%)'), '8');
    await user.type(within(entry).getByLabelText('Notes'), 'Marche rapide');
    await user.tab();

    await expectSaved(workout.id, (w) => {
      expect(w.cardioRecords).toEqual([
        { type: 'treadmill', name: 'Tapis incliné', durationSec: 1200, speedKmh: 5.5, inclinePct: 8, notes: 'Marche rapide' },
      ]);
    });

    user = await closeAndReopen(`#/workout/${workout.id}`);
    const reopened = await screen.findByRole('group', { name: 'Cardio 1' });
    expect(within(reopened).getByLabelText('Durée (min)')).toHaveValue('20');
    expect(within(reopened).getByLabelText('Vitesse (km/h)')).toHaveValue('5,5');
    expect(within(reopened).getByRole('button', { name: 'Tapis' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(reopened).getByRole('button', { name: 'Vélo' }));
    await expectSaved(workout.id, (w) => {
      expect(w.cardioRecords[0]?.type).toBe('bike');
    });

    await user.click(within(reopened).getByRole('button', { name: /Supprimer cette entrée/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Supprimer cette entrée cardio ?' })).getByRole('button', { name: 'Supprimer' }));
    await expectSaved(workout.id, (w) => {
      expect(w.cardioRecords).toEqual([]);
    });
  });
});
