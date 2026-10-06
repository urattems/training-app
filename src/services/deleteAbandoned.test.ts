import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { listCoachExportable } from '../domain/coachExport';
import { DomainError } from '../domain/errors';
import { countEnteredSets } from '../domain/workout';
import { dumpDatabase, resetDatabase } from '../test/fixtures';
import { createDriveClient, type FetchLike } from './driveClient';
import { getOutbox, processDriveOutbox, resolveDriveRegression, setDriveClient } from './driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from './driveSettings';
import { prepareExport, readStoredData } from './exportService';
import { deleteAbandonedWorkout, listWorkouts } from './historyService';
import { previewRestore, restoreBackup } from './importService';
import { setLastWeeklyBackupAt } from './settingsService';
import { getExerciseProgress } from './statisticsService';
import { addWeight } from './weightService';
import { startWorkout } from './workoutService';

const CHEST = 'chest-press-machine';
const ABANDONED = 'w-0003';
const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

beforeEach(async () => {
  await resetDatabase();
  await restoreText(example('history-weights-example.json'));
});

describe('deleteAbandonedWorkout : exception stricte, limitée aux séances abandonnées', () => {
  it('supprime exactement la séance abandonnée ; les autres séances et le reste sont intacts', async () => {
    const before = await readStoredData();
    await deleteAbandonedWorkout(ABANDONED);
    const after = await readStoredData();
    expect(after.workouts.map((w) => w.id).sort()).toEqual(['w-0001', 'w-0002']);
    expect(after.workouts).toEqual(before.workouts.filter((w) => w.id !== ABANDONED));
    // Pas de cascade : programmes, pesées, réglages inchangés.
    expect(after.programs).toEqual(before.programs);
    expect(after.weights).toEqual(before.weights);
    expect(after.activeProgramId).toBe(before.activeProgramId);
  });

  it('refuse une séance terminée : DomainError, rien n’est modifié (transaction)', async () => {
    const before = await dumpDatabase();
    await expect(deleteAbandonedWorkout('w-0001')).rejects.toThrow(new DomainError('Seule une séance abandonnée peut être supprimée ainsi. Elle est conservée.'));
    expect(await dumpDatabase()).toEqual(before);
  });

  it('refuse une séance en cours, et une séance inconnue', async () => {
    const inProgress = await startWorkout('A');
    const before = await dumpDatabase();
    await expect(deleteAbandonedWorkout(inProgress.id)).rejects.toThrow(DomainError);
    await expect(deleteAbandonedWorkout('w-inconnue')).rejects.toThrow('Séance introuvable.');
    expect(await dumpDatabase()).toEqual(before);
  });

  it('séries saisies pour la confirmation : les séries avec au moins une valeur', async () => {
    const abandoned = (await listWorkouts()).find((w) => w.id === ABANDONED);
    expect(abandoned && countEnteredSets(abandoned)).toBe(2);
  });
});

describe('Données dérivées recalculées après suppression', () => {
  it('progression et statistiques : la séance supprimée n’y figure plus', async () => {
    const before = await getExerciseProgress(CHEST);
    expect(before.load.some((p) => p.workoutId === ABANDONED)).toBe(true);
    await deleteAbandonedWorkout(ABANDONED);
    const after = await getExerciseProgress(CHEST);
    expect(after.load.map((p) => p.workoutId)).toEqual(before.load.map((p) => p.workoutId).filter((id) => id !== ABANDONED));
    expect(after.stats.lastDate).toBe('2026-09-15');
  });

  it('historique, export coach et sauvegarde : sans la séance ; aller-retour export → restauration cohérent', async () => {
    await deleteAbandonedWorkout(ABANDONED);
    expect((await listWorkouts()).map((w) => w.id)).not.toContain(ABANDONED);
    expect(listCoachExportable(await db.workouts.toArray()).map((w) => w.id)).not.toContain(ABANDONED);
    const exported = await prepareExport(new Date(2026, 9, 6, 10, 0));
    expect(exported.data.sessions.map((s) => s.id)).toEqual(['w-0001', 'w-0002']);
    const stored = await readStoredData();
    await resetDatabase();
    await restoreText(exported.json);
    const restored = await readStoredData();
    expect(restored.workouts).toEqual(stored.workouts);
    expect(restored.weights).toEqual(stored.weights);
  });
});

describe('Archive Drive après suppression (analyse V1.3.3)', () => {
  /** Script simulé : même règle que le vrai (refus d'une sauvegarde avec MOINS de séances ou de pesées). */
  interface Req {
    action: string;
    name?: string;
    force?: boolean;
    meta?: { counts?: { sessions: number; weights: number } };
  }
  let sent: Req[];
  let driveCounts: { sessions: number; weights: number } | null;
  const fetch: FetchLike = (_url, init) => {
    const req = JSON.parse(init.body as string) as Req;
    sent.push(req);
    const incoming = req.meta?.counts;
    if (req.action === 'put' && req.name === 'sauvegarde-derniere.json' && incoming) {
      if (driveCounts && req.force !== true && (incoming.sessions < driveCounts.sessions || incoming.weights < driveCounts.weights)) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'regression', current: driveCounts, incoming })));
      }
      driveCounts = { sessions: incoming.sessions, weights: incoming.weights };
    }
    return Promise.resolve(new Response('{"ok":true,"version":"sync-2","rootReady":true}'));
  };

  beforeEach(async () => {
    sent = [];
    driveCounts = null;
    setDriveClient(createDriveClient({ fetch }));
    const url = 'https://script.google.com/macros/s/AKfycbDELETEID/exec';
    await saveDriveConfig(url, 'secret-suppression-1357');
    await markDriveTested('2026-10-04T10:00:00+02:00', { url, secret: 'secret-suppression-1357' });
    await setDriveEnabled(true);
    await setLastWeeklyBackupAt(new Date().toISOString());
    // État de départ : le Drive a la sauvegarde complète (3 séances).
    driveCounts = { sessions: 3, weights: (await readStoredData()).weights.length };
  });

  it('suppression : mark_deleted envoyé (aucun effacement), sauvegarde refusée → EN PAUSE, rien d’écrasé', async () => {
    await deleteAbandonedWorkout(ABANDONED);
    expect((await getOutbox()).tasks.map((t) => t.id).sort()).toEqual(['backup_latest:latest', `session_deleted:${ABANDONED}`]);
    await processDriveOutbox('all');
    expect(sent.map((r) => r.action)).not.toContain('delete');
    const outbox = await getOutbox();
    expect(outbox.regression).toMatchObject({ current: { sessions: 3 }, incoming: { sessions: 2 } });
    expect(outbox.tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['backup_latest:latest:paused']);
    expect(driveCounts?.sessions).toBe(3);
  });

  it('la file n’est PAS bloquée : les autres envois (pesée, séance) partent ; seule la sauvegarde attend', async () => {
    await deleteAbandonedWorkout(ABANDONED);
    await processDriveOutbox('all');
    sent = [];
    await addWeight({ date: '2026-10-05', weightKg: 80.2 });
    await processDriveOutbox('all');
    expect(sent.map((r) => r.name)).toEqual(expect.arrayContaining(['2026-10-05.json', '_pesees.json']));
    expect(sent.some((r) => r.name === 'sauvegarde-derniere.json')).toBe(false);
    expect((await getOutbox()).tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['backup_latest:latest:paused']);
  });

  it('« Remplacer quand même » (choix existant de l’utilisateur) débloque : force:true, sauvegarde à 2 séances', async () => {
    await deleteAbandonedWorkout(ABANDONED);
    await processDriveOutbox('all');
    await resolveDriveRegression('replace');
    await processDriveOutbox('all');
    expect(sent.filter((r) => r.name === 'sauvegarde-derniere.json').map((r) => r.force ?? false)).toEqual([false, true]);
    expect(driveCounts?.sessions).toBe(2);
    expect((await getOutbox()).tasks).toEqual([]);
  });
});
