// @vitest-environment jsdom
/**
 * Autosave immédiat (V1.3.2) : chaque modification part TOUT DE SUITE en base.
 * Les timers (setTimeout/setInterval) sont simulés et JAMAIS avancés : un délai de regroupement
 * (l'ancien debounce de 350 ms) ne se déclencherait jamais. Les attentes ne font que laisser
 * IndexedDB (fake-indexeddb, via setImmediate) terminer les écritures déjà lancées.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextField } from '../components/TextField';
import { db } from '../db/database';
import { sessionFileName } from '../domain/driveNames';
import type { WorkoutSession } from '../domain/types';
import { addCardioEntry, setActualValues, setComment } from '../domain/workout';
import { ActualSets } from '../features/exercise/ActualSets';
import { CardioSection } from '../features/workout/CardioSection';
import { createDriveClient, type FetchLike } from '../services/driveClient';
import { getOutbox, processDriveOutbox, setDriveClient } from '../services/driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from '../services/driveSettings';
import { importProgram, previewProgram } from '../services/programService';
import { setLastWeeklyBackupAt } from '../services/settingsService';
import { getWorkout, startWorkout } from '../services/workoutService';
import { readFixture, resetDatabase } from '../test/fixtures';
import { useWorkoutAutosave, type WorkoutAutosave } from './useWorkoutAutosave';

// Compte les écritures lancées (le module réel est utilisé tel quel).
const writes = vi.hoisted(() => ({ count: 0 }));
vi.mock('../services/workoutService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workoutService')>();
  return {
    ...actual,
    updateWorkout: (...args: Parameters<typeof actual.updateWorkout>) => {
      writes.count += 1;
      return actual.updateWorkout(...args);
    },
  };
});

const CHEST = 'chest-press-machine';
const reps = (n: number) => screen.getByLabelText(`Série ${n} — répétitions`);
const kg = (n: number) => screen.getByLabelText(`Série ${n} — charge en kg`);
const comment = () => screen.getByLabelText('Commentaire');
const type = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
};

/** Laisse les écritures DÉJÀ LANCÉES se terminer (aucune horloge avancée), jusqu'à `check`. */
async function until(check: (w: WorkoutSession) => boolean, id: string): Promise<WorkoutSession> {
  let last: WorkoutSession | undefined;
  for (let i = 0; i < 400; i++) {
    last = (await getWorkout(id)) ?? undefined;
    if (last && check(last)) return last;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`condition jamais atteinte ; dernier état : ${JSON.stringify(last?.exerciseRecords[0] ?? last?.cardioRecords)}`);
}

const chest = (w: WorkoutSession) => w.exerciseRecords.find((r) => r.programExerciseId === CHEST);
const set = (w: WorkoutSession, n: number) => chest(w)?.actualSets.find((s) => s.setNumber === n);

let autosave: WorkoutAutosave | null = null;

/** Écran de saisie : séries réelles (composant de l'app) + commentaire (même appel que l'écran exercice). */
function Harness({ workout }: { workout: WorkoutSession }) {
  const a = useWorkoutAutosave(workout.id);
  useEffect(() => {
    autosave = a;
  });
  const record = chest(workout);
  if (!record) return null;
  return (
    <>
      <ActualSets record={record} autosave={a} />
      <TextField
        label="Commentaire"
        multiline
        value={record.comment ?? ''}
        onValueChange={(text, immediate) => {
          a.save(`${CHEST}:comment`, record.comment ?? '', text.trim(), immediate, (v) => (w) => setComment(w, CHEST, v));
        }}
      />
    </>
  );
}

async function idle() {
  await act(async () => {
    await autosave?.flush();
  });
}

let workout: WorkoutSession;

beforeEach(async () => {
  await resetDatabase();
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  const result = await importProgram(preview.value.program);
  if (!result.ok) throw new Error(result.error.message);
  workout = await startWorkout('A');
  writes.count = 0;
  autosave = null;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await idle();
});

describe('Autosave immédiat : la frappe est en base sans attendre de délai', () => {
  it('répétitions : écrites dès la frappe, sans blur ni horloge avancée', async () => {
    render(<Harness workout={workout} />);
    type(reps(1), '12');
    expect(writes.count).toBe(1); // écriture lancée pendant l'événement de saisie
    await until((w) => set(w, 1)?.actualReps === 12, workout.id);
    expect(reps(1)).toHaveValue('12');
  });

  it('commentaire : chaque frappe est écrite, la dernière gagne (frappes rapides)', async () => {
    render(<Harness workout={workout} />);
    for (const text of ['B', 'Bo', 'Bon', 'Bonne', 'Bonne séance']) type(comment(), text);
    const saved = await until((w) => chest(w)?.comment === 'Bonne séance', workout.id);
    expect(chest(saved)?.comment).toBe('Bonne séance');
    await idle();
    // Les frappes en attente d'un même champ sont fusionnées (pas d'accumulation de transactions).
    expect(writes.count).toBeLessThanOrEqual(5);
    expect(chest((await getWorkout(workout.id)) ?? workout)?.comment).toBe('Bonne séance');
    expect(comment()).toHaveValue('Bonne séance');
  });

  it('ordre garanti : une frappe plus ancienne n’écrase jamais une plus récente', async () => {
    render(<Harness workout={workout} />);
    type(kg(1), '4');
    type(kg(1), '47');
    type(kg(1), '47,5');
    type(reps(1), '1');
    type(reps(1), '12');
    await until((w) => set(w, 1)?.actualWeightKg === 47.5 && set(w, 1)?.actualReps === 12, workout.id);
    await idle();
    expect(set((await getWorkout(workout.id)) ?? workout, 1)).toMatchObject({ actualReps: 12, actualWeightKg: 47.5 });
  });

  it('virgule en cours (« 52, ») : 52 est en base, le champ garde « 52, »', async () => {
    render(<Harness workout={workout} />);
    type(kg(1), '5');
    type(kg(1), '52');
    type(kg(1), '52,');
    await until((w) => set(w, 1)?.actualWeightKg === 52, workout.id);
    expect(kg(1)).toHaveValue('52,');
    type(kg(1), '52,5');
    await until((w) => set(w, 1)?.actualWeightKg === 52.5, workout.id);
    expect(kg(1)).toHaveValue('52,5');
  });

  it('démontage immédiat après la frappe : la valeur est déjà partie, puis en base', async () => {
    const view = render(<Harness workout={workout} />);
    type(kg(1), '47,5');
    expect(writes.count).toBe(1);
    view.unmount();
    await until((w) => set(w, 1)?.actualWeightKg === 47.5, workout.id);
  });

  it('pagehide juste après la frappe : la valeur est déjà partie, puis en base', async () => {
    render(<Harness workout={workout} />);
    type(comment(), 'Épaule OK');
    expect(writes.count).toBe(1);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await until((w) => chest(w)?.comment === 'Épaule OK', workout.id);
  });

  it('champ vidé : null en base (jamais 0), le champ reste vide', async () => {
    render(<Harness workout={workout} />);
    type(kg(1), '47');
    await until((w) => set(w, 1)?.actualWeightKg === 47, workout.id);
    type(kg(1), '');
    await until((w) => set(w, 1)?.actualWeightKg === null, workout.id);
    expect(kg(1)).toHaveValue('');
  });
});

describe('Garde-fous inchangés', () => {
  it('valide puis invalide sans blur (« 4,7,5 ») : la valeur intermédiaire est retirée, la série redevient absente', async () => {
    render(<Harness workout={workout} />);
    type(kg(2), '4');
    type(kg(2), '4,7');
    await until((w) => set(w, 2)?.actualWeightKg === 4.7, workout.id);
    type(kg(2), '4,7,5');
    const restored = await until((w) => set(w, 2) === undefined, workout.id);
    expect(kg(2)).toHaveValue('4,7,5');
    // L'exercice n'avait pas été commencé : il ne reste pas inscrit dans l'ordre d'exécution.
    expect(restored.executionOrder).toEqual([]);
  });

  it('valide (validée au blur) puis invalide : la valeur validée reste, l’invalide n’est jamais écrite', async () => {
    render(<Harness workout={workout} />);
    type(kg(1), '47,5');
    fireEvent.blur(kg(1));
    await until((w) => set(w, 1)?.actualWeightKg === 47.5, workout.id);
    fireEvent.focus(kg(1));
    type(kg(1), '47,55');
    await until((w) => set(w, 1)?.actualWeightKg === 47.55, workout.id);
    type(kg(1), '47,555'); // hors bornes (3 décimales)
    await until((w) => set(w, 1)?.actualWeightKg === 47.5, workout.id);
    fireEvent.blur(kg(1));
    await idle();
    expect(set((await getWorkout(workout.id)) ?? workout, 1)?.actualWeightKg).toBe(47.5);
    expect(screen.getByRole('alert')).toHaveTextContent('Au plus 2 décimales');
  });

  it('hors bornes (4747 reps) : aucun préfixe (474) ne reste en base', async () => {
    render(<Harness workout={workout} />);
    for (const text of ['4', '47', '474', '4747']) type(reps(1), text);
    await idle();
    const saved = (await getWorkout(workout.id)) ?? workout;
    expect(set(saved, 1)).toBeUndefined();
    expect(saved.executionOrder).toEqual([]);
  });

  it('un simple passage dans un champ vide n’écrit rien (pas de série vide)', async () => {
    render(<Harness workout={workout} />);
    fireEvent.focus(reps(1));
    fireEvent.blur(reps(1));
    fireEvent.focus(comment());
    fireEvent.blur(comment());
    await idle();
    expect(writes.count).toBe(0);
    expect(chest((await getWorkout(workout.id)) ?? workout)?.actualSets).toEqual([]);
  });

  it('valeur finale identique à celle en base : rien n’est écrit', async () => {
    const stored = setActualValues(workout, CHEST, 1, { actualReps: 12 });
    await db.workouts.put(stored);
    render(<Harness workout={stored} />);
    type(reps(1), '1');
    type(reps(1), '12'); // « 1 » est parti, « 12 » le corrige : écrit
    fireEvent.blur(reps(1));
    await idle();
    const count = writes.count;
    fireEvent.focus(reps(1));
    type(reps(1), '12');
    fireEvent.blur(reps(1));
    await idle();
    expect(writes.count).toBe(count);
  });
});

describe('Cardio : champs et notes écrits immédiatement', () => {
  it('notes et vitesse du cardio : en base dès la frappe', async () => {
    const withCardio = addCardioEntry(workout, 'treadmill');
    await db.workouts.put(withCardio);
    render(<CardioSection workout={withCardio} programCardio={null} />);
    type(screen.getByLabelText('Notes'), 'Fractionné');
    type(screen.getByLabelText(/^Vitesse/), '9,5');
    // La première écriture est lancée pendant la frappe ; la seconde attend son tour (file sérialisée).
    expect(writes.count).toBe(1);
    await until((w) => w.cardioRecords[0]?.notes === 'Fractionné' && w.cardioRecords[0].speedKmh === 9.5, workout.id);
  });
});

describe('Archive Drive : des écritures plus fréquentes ne créent pas plus d’envois', () => {
  it('séance terminée corrigée : 6 frappes = UNE tâche (même clé), UN envoi', async () => {
    const sent: { name?: string }[] = [];
    const fetch: FetchLike = (_url, init) => {
      sent.push(JSON.parse(init.body as string) as { name?: string });
      return Promise.resolve(new Response('{"ok":true,"version":"sync-2","rootReady":true}'));
    };
    setDriveClient(createDriveClient({ fetch }));
    const URL_ = 'https://script.google.com/macros/s/AKfycbAUTOSAVE/exec';
    await saveDriveConfig(URL_, 'secret-autosave-2468');
    await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: 'secret-autosave-2468' });
    await setDriveEnabled(true);
    await setLastWeeklyBackupAt(new Date().toISOString());
    const done: WorkoutSession = { ...setActualValues(workout, CHEST, 1, { actualReps: 10 }), status: 'completed', completedAt: workout.startedAt, durationSec: 3600 };
    await db.workouts.put(done);

    render(<Harness workout={done} />);
    for (const text of ['D', 'Du', 'Dur', 'Dure', 'Dur !', 'Dur !!']) type(comment(), text);
    await until((w) => chest(w)?.comment === 'Dur !!', workout.id);
    await idle();

    const sessionTasks = (await getOutbox()).tasks.filter((t) => t.type === 'session');
    expect(sessionTasks).toHaveLength(1);
    expect(sessionTasks[0]?.nextAttemptAt).not.toBeNull(); // envoi temporisé (2 s après la DERNIÈRE écriture)
    await processDriveOutbox('all');
    expect(sent.filter((r) => r.name === sessionFileName(done))).toHaveLength(1);
  });
});
