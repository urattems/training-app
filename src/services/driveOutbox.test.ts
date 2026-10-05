import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { RETRY_DELAYS_MS } from '../domain/driveOutbox';
import type { WorkoutSession } from '../domain/types';
import { setActualValues, setWorkoutDate } from '../domain/workout';
import { parseCoachExportJson } from '../schemas/parse';
import { dumpDatabase, readFixture, resetDatabase } from '../test/fixtures';
import { createDriveClient, type FetchLike } from './driveClient';
import { getDriveNames, getOutbox, notifySessionChanged, processDriveOutbox, setDriveClient } from './driveOutbox';
import { getDriveSync, markDriveTested, saveDriveConfig, setDriveEnabled } from './driveSettings';
import { buildHistoryExport, prepareExport } from './exportService';
import { deleteWorkout } from './historyService';
import { previewRestore, restoreBackup } from './importService';
import { abandonWorkout, finishWorkout, startWorkout, updateWorkout } from './workoutService';

const URL_ = 'https://script.google.com/macros/s/AKfycbOUTBOXTESTID/exec';
const SECRET = 'secret-outbox-9876';

interface Sent {
  action: string;
  folder?: string;
  name?: string;
  content?: string;
  chars?: number;
  meta?: Record<string, unknown>;
  at?: string;
}

/** Script simulé : enregistre les requêtes ; `reply` décide de la réponse (par défaut ok). */
let sent: Sent[] = [];
let reply: (req: Sent) => Response | Error | Promise<Response> = () => new Response('{"ok":true}');
let inFlight = 0;
let maxInFlight = 0;

const fetch: FetchLike = async (_url, init) => {
  const req = JSON.parse(init.body as string) as Sent;
  sent.push(req);
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((r) => setTimeout(r, 2));
  inFlight--;
  const out = await reply(req);
  if (out instanceof Error) throw out;
  return out;
};

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

async function enableDrive() {
  await saveDriveConfig(URL_, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
  await setDriveEnabled(true);
}

/** Séance démarrée, une série saisie (donc exportable une fois terminée). */
async function seededWorkout(id = 'w-new-1'): Promise<WorkoutSession> {
  const workout = await startWorkout('A', { now: new Date(2026, 9, 4, 18, 10), id });
  const exerciseId = workout.exerciseRecords[0]?.programExerciseId ?? '';
  return updateWorkout(workout.id, (w) => setActualValues(w, exerciseId, 1, { actualReps: 10, actualWeightKg: 50 }));
}

const flush = () => new Promise((r) => setTimeout(r, 30));
const tasks = async () => (await getOutbox()).tasks.map((t) => `${t.id}#${String(t.revision)}:${t.status}`);

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  reply = () => new Response('{"ok":true}');
  inFlight = 0;
  maxInFlight = 0;
  setDriveClient(createDriveClient({ fetch }));
  await restoreText(readFixture('history-example.json'));
});
afterEach(async () => {
  await processDriveOutbox();
});

describe('Envoi désactivé (par défaut) : zéro requête', () => {
  it('terminer, corriger, supprimer, puis traiter la file : aucune requête, aucune tâche', async () => {
    const workout = await seededWorkout();
    await finishWorkout(workout.id);
    await deleteWorkout('w-0001');
    await flush();
    await processDriveOutbox();
    expect(sent).toEqual([]);
    expect((await getOutbox()).tasks).toEqual([]);
  });

  it('configuré mais non activé : toujours zéro requête', async () => {
    await saveDriveConfig(URL_, SECRET);
    await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
    await finishWorkout((await seededWorkout()).id);
    await flush();
    await processDriveOutbox();
    expect(sent).toEqual([]);
  });
});

describe('Configuration', () => {
  it('activer exige un test réussi ; changer d’URL ou de secret désactive', async () => {
    await saveDriveConfig(URL_, SECRET);
    await expect(setDriveEnabled(true)).rejects.toThrow('Fais d’abord un test réussi');
    await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
    await setDriveEnabled(true);
    expect((await getDriveSync()).enabled).toBe(true);
    await saveDriveConfig(URL_, 'autre-secret-5555');
    expect(await getDriveSync()).toMatchObject({ enabled: false, testedAt: null });
  });

  it('validation : URL https (ou http local), secret d’au moins 8 caractères', async () => {
    await expect(saveDriveConfig('ftp://x', SECRET)).rejects.toThrow('Adresse invalide');
    await expect(saveDriveConfig('http://example.com/exec', SECRET)).rejects.toThrow('Adresse invalide');
    await expect(saveDriveConfig(URL_, 'court')).rejects.toThrow('au moins 8');
    await expect(saveDriveConfig('http://127.0.0.1:4190/macros/s/X/exec', SECRET)).resolves.toBeDefined();
  });
});

describe('Séances (envoi activé)', () => {
  beforeEach(enableDrive);

  it('séance terminée : un put, contenu = training_coach_export 1.1 d’UNE séance, valide au schéma', async () => {
    const workout = await seededWorkout();
    await finishWorkout(workout.id, new Date(2026, 9, 4, 19, 20));
    await flush();
    expect(await tasks()).toEqual([`session:${workout.id}#1:pending`, 'backup_latest:latest#1:pending']);
    await processDriveOutbox('all');
    // V1.3b : la séance, puis la sauvegarde (en dernier).
    expect(sent.map((r) => r.name)).toEqual(['2026-10-04_1810_Seance-A_wnew1.json', 'sauvegarde-derniere.json']);
    const put = sent[0];
    expect(put).toMatchObject({ action: 'put', folder: 'Semaine 37', name: '2026-10-04_1810_Seance-A_wnew1.json' });
    expect(put?.chars).toBe(put?.content?.length);
    const parsed = parseCoachExportJson(put?.content ?? '');
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.sessions.map((s) => s.id)).toEqual([workout.id]);
    expect(parsed.value.programs.map((p) => p.programId)).toEqual(['prog-demo-w37']);
    expect(parsed.value).toMatchObject({ schemaVersion: '1.1', weightEntries: [], weightWindow: null, selection: { mode: 'manual', sessionCount: 1 } });
    expect(put?.meta).toEqual({ kind: 'session', sessionId: workout.id, date: '2026-10-04', sessionName: 'Séance A', status: 'completed', programId: 'prog-demo-w37', weekLabel: 'Semaine 37' });
    const outbox = await getOutbox();
    expect(outbox.tasks).toEqual([]);
    expect(outbox.lastConfirmedAt).not.toBeNull();
  });

  it('séance en cours ou abandonnée vide : jamais envoyée (tâche abandonnée sans erreur)', async () => {
    const empty = await startWorkout('A', { now: new Date(2026, 9, 4, 18), id: 'w-empty' });
    await abandonWorkout(empty.id);
    await notifySessionChanged('w-0001');
    await db.workouts.update('w-0001', { status: 'in_progress', completedAt: null });
    await flush();
    await processDriveOutbox('all');
    expect(sent).toEqual([]);
    expect((await getOutbox()).tasks).toEqual([]);
  });

  it('abandonnée AVEC données : envoyée', async () => {
    const workout = await seededWorkout();
    await abandonWorkout(workout.id);
    await flush();
    await processDriveOutbox('all');
    expect(sent.map((s) => [s.action, s.folder])).toEqual([
      ['put', 'Semaine 37'],
      ['put', 'Sauvegardes'],
    ]);
    expect(sent[0]?.meta).toMatchObject({ status: 'abandoned' });
  });

  it('correction dans l’historique (date changée) : même fichier, nom gelé au premier envoi', async () => {
    const workout = await seededWorkout();
    await finishWorkout(workout.id);
    await processDriveOutbox('all');
    await updateWorkout(workout.id, (w) => setWorkoutDate(w, '2026-10-02'));
    await flush();
    await processDriveOutbox('all');
    // V1.3b : chaque enregistrement est suivi de la sauvegarde.
    expect(sent.map((s) => s.name)).toEqual([
      '2026-10-04_1810_Seance-A_wnew1.json',
      'sauvegarde-derniere.json',
      '2026-10-04_1810_Seance-A_wnew1.json',
      'sauvegarde-derniere.json',
    ]);
    expect(parseCoachExportJson(sent[2]?.content ?? '').ok && JSON.parse(sent[2]?.content ?? '{}')).toMatchObject({ sessions: [{ date: '2026-10-02' }] });
    expect((await getDriveNames())[workout.id]).toEqual({ folder: 'Semaine 37', name: '2026-10-04_1810_Seance-A_wnew1.json' });
  });

  it('fix-v1.3a : un nom déjà gelé (ancienne règle de suffixe) ne change jamais', async () => {
    const frozen = { folder: 'Semaine 37 (prog)', name: '2026-09-08_1800_Seance-A_w0001.json' };
    await db.settings.put({ key: 'driveNames', value: { 'w-0001': frozen } });
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    expect(sent.map((r) => ({ folder: r.folder, name: r.name }))).toEqual([frozen]);
    expect((await getDriveNames())['w-0001']).toEqual(frozen);
  });

  it('suppression : mark_deleted avec le nom gelé ; not_in_index = succès ; jamais envoyée = abandonnée', async () => {
    await notifySessionChanged('w-0002');
    await processDriveOutbox('all');
    reply = (req) => (req.action === 'mark_deleted' ? new Response('{"ok":false,"error":"not_in_index","retryable":false}') : new Response('{"ok":true}'));
    await deleteWorkout('w-0002');
    await deleteWorkout('w-0001'); // jamais envoyée
    await flush();
    await processDriveOutbox('all');
    expect(sent.map((s) => [s.action, s.name])).toEqual([
      ['put', '2026-09-15_1810_Seance-A_w0002.json'],
      ['mark_deleted', '2026-09-15_1810_Seance-A_w0002.json'],
      ['put', 'sauvegarde-derniere.json'], // V1.3b : la suppression met aussi la sauvegarde en file
    ]);
    expect(sent[1]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await getOutbox()).tasks).toEqual([]);
  });

  it('ordre : séances avant suppressions ; un seul envoi à la fois', async () => {
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    sent = [];
    await deleteWorkout('w-0001');
    await notifySessionChanged('w-0002');
    await notifySessionChanged('w-0003');
    await flush();
    await Promise.all([processDriveOutbox('all'), processDriveOutbox('all'), processDriveOutbox('all')]);
    expect(sent.map((s) => s.action)).toEqual(['put', 'put', 'mark_deleted', 'put']);
    expect(sent.at(-1)?.name).toBe('sauvegarde-derniere.json'); // V1.3b : sauvegarde en dernier
    expect(maxInFlight).toBe(1);
  });

  it('page HTML puis reprise : 30 s, 2 min, 10 min, 1 h, puis à l’ouverture ; succès ensuite', async () => {
    reply = () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    await notifySessionChanged('w-0001');
    const t0 = Date.now();
    const delays: (number | null)[] = [];
    let now = t0;
    for (let i = 0; i < 5; i++) {
      await processDriveOutbox('all', () => new Date(now));
      const task = (await getOutbox()).tasks[0];
      delays.push(task?.nextAttemptAt === null || task === undefined ? null : Date.parse(task.nextAttemptAt) - now);
      expect(task?.lastError).toMatchObject({ code: 'html' });
      now += 1000;
    }
    expect(delays).toEqual([...RETRY_DELAYS_MS, null]);
    reply = () => new Response('{"ok":true}');
    await processDriveOutbox('all');
    expect((await getOutbox()).tasks).toEqual([]);
    expect(sent).toHaveLength(6);
  });

  it('réseau coupé puis rétabli : la tâche reste, puis part', async () => {
    reply = () => new TypeError('Failed to fetch');
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    expect((await getOutbox()).tasks[0]).toMatchObject({ status: 'pending', lastError: { code: 'network' } });
    reply = () => new Response('{"ok":true}');
    await processDriveOutbox('all');
    expect((await getOutbox()).tasks).toEqual([]);
  });

  it('erreur non réessayable (secret refusé) : tâche « en erreur », plus d’envoi automatique', async () => {
    reply = () => new Response('{"ok":false,"error":"unauthorized"}');
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    await processDriveOutbox('all');
    expect(sent).toHaveLength(1);
    expect((await getOutbox()).tasks[0]).toMatchObject({ status: 'error', lastError: { code: 'unauthorized', message: 'Secret refusé par le script : vérifie le secret.' } });
  });

  it('contenu invalide au schéma : RIEN n’est envoyé, erreur visible', async () => {
    await db.programs.delete('prog-demo-w37');
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    expect(sent).toEqual([]);
    expect((await getOutbox()).tasks[0]).toMatchObject({ status: 'error', lastError: { code: 'invalid_content' } });
  });

  it('file persistante : survit à la fermeture et réouverture de la base (redémarrage)', async () => {
    reply = () => new TypeError('Failed to fetch');
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    db.close();
    await db.open();
    expect(await tasks()).toEqual(['session:w-0001#1:pending']);
    reply = () => new Response('{"ok":true}');
    await processDriveOutbox('all');
    expect((await getOutbox()).tasks).toEqual([]);
  });

  it('mises en file simultanées : aucune tâche perdue (transactions)', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `x-${String(i)}`);
    await Promise.all(ids.map((id) => notifySessionChanged(id)));
    expect((await getOutbox()).tasks.map((t) => t.key).sort()).toEqual([...ids].sort());
  });

  it('correction pendant l’envoi : la nouvelle intention n’est pas perdue', async () => {
    // La correction est enregistrée PENDANT la requête, avant que la confirmation ne revienne.
    let corrected = false;
    reply = async () => {
      if (!corrected) {
        corrected = true;
        await notifySessionChanged('w-0001');
      }
      return new Response('{"ok":true}');
    };
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    await flush();
    expect(await tasks()).toEqual(['session:w-0001#2:pending']);
  });
});

describe('Configuration propre à l’appareil : jamais exportée ni restaurée', () => {
  beforeEach(enableDrive);

  it('restauration : driveSync, file et noms gelés conservés ; preRestoreBackup et exports sans eux', async () => {
    await notifySessionChanged('w-0001');
    await processDriveOutbox('all');
    reply = () => new TypeError('Failed to fetch');
    await notifySessionChanged('w-0002');
    await processDriveOutbox('all');
    const before = { sync: await getDriveSync(), names: await getDriveNames(), outbox: await getOutbox() };
    await restoreText(readFixture('history-example.json'));
    expect(await getDriveSync()).toEqual(before.sync);
    expect(await getDriveNames()).toEqual(before.names);
    expect(await getOutbox()).toEqual(before.outbox);
    const dump = JSON.stringify(await dumpDatabase());
    const backup = JSON.stringify((await db.metadata.get('preRestoreBackup'))?.data);
    const exported = (await prepareExport()).json + JSON.stringify(await buildHistoryExport());
    for (const text of [backup, exported]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('AKfycbOUTBOXTESTID');
      expect(text).not.toContain('driveSync');
    }
    expect(dump).toContain('driveSync');
  });
});
