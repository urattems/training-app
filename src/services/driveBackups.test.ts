import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { resendProgress } from '../domain/driveOutbox';
import { getExportReminder } from '../domain/exportReminder';
import type { WorkoutSession } from '../domain/types';
import { parseHistoryJson } from '../schemas/parse';
import { parseWeightEntryFile, parseWeightLog, toWeightEntryFile, toWeightLog } from '../schemas/weightArchive.schema';
import { TEST_TIME_ZONE } from '../test/globalSetup';
import { FIXTURE_SHA256, readFixture, resetDatabase, sha256 } from '../test/fixtures';
import { createDriveClient, type FetchLike } from './driveClient';
import {
  cancelWholeArchiveResend,
  enqueueDriveTask,
  enqueueWeeklyIfDue,
  getOutbox,
  isWeeklyBackupDue,
  processDriveOutbox,
  resendWholeArchive,
  resolveDriveRegression,
  setDriveClient,
} from './driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from './driveSettings';
import { prepareExport } from './exportService';
import { deleteWorkout } from './historyService';
import { previewRestore, restoreBackup } from './importService';
import { getLastAutoBackupAt, getLastWeeklyBackupAt, latestInstant, setLastWeeklyBackupAt } from './settingsService';
import { addWeight, deleteWeight, updateWeight } from './weightService';

const URL_ = 'https://script.google.com/macros/s/AKfycbBACKUPTESTID/exec';
const SECRET = 'secret-sauvegardes-2468';
const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');
const NOW = new Date(2026, 9, 5, 9, 30);

interface Sent {
  action: string;
  folder?: string;
  name?: string;
  content?: string;
  chars?: number;
  meta?: Record<string, unknown>;
  force?: boolean;
  at?: string;
}
let sent: Sent[] = [];
let reply: (req: Sent) => Response | Error = () => new Response('{"ok":true}');
const fetch: FetchLike = (_url, init) => {
  const req = JSON.parse(init.body as string) as Sent;
  sent.push(req);
  const out = reply(req);
  return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
};
const paths = () => sent.map((r) => `${r.action} ${r.folder ?? ''}/${r.name ?? ''}`);
const taskIds = async () => (await getOutbox()).tasks.map((t) => `${t.id}:${t.status}`);
const flush = () => new Promise((r) => setTimeout(r, 30));

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

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  reply = () => new Response('{"ok":true}');
  setDriveClient(createDriveClient({ fetch }));
});
afterEach(async () => {
  process.env.TZ = TEST_TIME_ZONE;
  await processDriveOutbox();
});

describe('Types weight_entry et weight_log (v1.0)', () => {
  const entries = (JSON.parse(example('history-weights-example.json')) as { weightEntries: { date: string; weightKg: number; recordedAt: string }[] }).weightEntries;

  it('fabriques valides au schéma ; regroupement trié, count exact', () => {
    const entry = entries[0];
    if (!entry) throw new Error();
    expect(parseWeightEntryFile(JSON.stringify(toWeightEntryFile(entry))).ok).toBe(true);
    const log = toWeightLog([...entries].reverse(), '2026-10-01T18:50:00+02:00');
    expect(log.entries.map((e) => e.date)).toEqual(entries.map((e) => e.date));
    expect(log.count).toBe(10);
    expect(parseWeightLog(JSON.stringify(log)).ok).toBe(true);
  });

  it.each<[string, (log: Record<string, unknown>) => void, RegExp]>([
    ['count faux', (l) => (l.count = 3), /annonce 3 pesée/],
    ['ordre décroissant', (l) => (l.entries = [...(l.entries as unknown[])].reverse()), /ordre croissant/],
    ['date en double', (l) => (l.entries = [(l.entries as unknown[])[0], (l.entries as unknown[])[0]]), /ordre croissant|annonce/],
    ['poids à 3 décimales', (l) => ((l.entries as Record<string, unknown>[])[0] = { ...(l.entries as Record<string, unknown>[])[0], weightKg: 80.123 }), /2 décimales/],
    ['date irréelle', (l) => ((l.entries as Record<string, unknown>[])[0] = { ...(l.entries as Record<string, unknown>[])[0], date: '2026-02-30' }), /AAAA-MM-JJ/],
    ['mauvais type', (l) => (l.type = 'weight_entry'), /weight_log/],
  ])('weight_log invalide : %s', (_name, mutate, message) => {
    const log = JSON.parse(example('weight-log-example.json')) as Record<string, unknown>;
    mutate(log);
    const parsed = parseWeightLog(JSON.stringify(log));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.join(' ')).toMatch(message);
  });

  it('weight_entry invalide : poids nul, recordedAt invalide', () => {
    const base = JSON.parse(example('weight-entry-example.json')) as Record<string, unknown>;
    expect(parseWeightEntryFile(JSON.stringify({ ...base, weightKg: 0 })).ok).toBe(false);
    expect(parseWeightEntryFile(JSON.stringify({ ...base, recordedAt: '2026-10-01 07:08' })).ok).toBe(false);
  });

  it('fixtures V1.3b : valides et reproduites à l’identique ; empreintes figées ; fixtures existantes intactes', () => {
    const entryFile = parseWeightEntryFile(example('weight-entry-example.json'));
    const logFile = parseWeightLog(example('weight-log-example.json'));
    if (!entryFile.ok || !logFile.ok) throw new Error();
    const last = entries.at(-1);
    if (!last) throw new Error();
    expect(toWeightEntryFile(last)).toEqual(entryFile.value);
    expect(toWeightLog(entries, '2026-10-01T18:50:00+02:00')).toEqual(logFile.value);
    expect(sha256(example('weight-entry-example.json'))).toBe('088592702a2dc701bf7c61b520b37daef017e2e554f79b45cb469af3645167cf');
    expect(sha256(example('weight-log-example.json'))).toBe('531d2b5dc3db59337f762b80b99aa0f712f7e5cf0cd4771ad015f94824f330db');
    for (const name of ['program-example.json', 'history-example.json'] as const) expect(sha256(readFixture(name))).toBe(FIXTURE_SHA256[name]);
  });
});

describe('Pesées (envoi activé)', () => {
  beforeEach(async () => {
    await restoreText(example('history-weights-example.json'));
    await enableDrive();
  });

  it('ajout : weight + weights_all + backup_latest ; contenus valides ; ordre (pesée, regroupement, sauvegarde)', async () => {
    await addWeight({ date: '2026-10-04', weightKg: 80.45, now: NOW });
    await flush();
    expect(await taskIds()).toEqual(['weight:2026-10-04:pending', 'weights_all:all:pending', 'backup_latest:latest:pending']);
    await processDriveOutbox('all', () => NOW);
    expect(paths()).toEqual(['put Pesees/2026-10-04.json', 'put Pesees/_pesees.json', 'put Sauvegardes/sauvegarde-derniere.json']);
    const [weight, all] = sent;
    expect(parseWeightEntryFile(weight?.content ?? '')).toMatchObject({ ok: true, value: { date: '2026-10-04', weightKg: 80.45 } });
    expect(weight?.meta).toEqual({ kind: 'weight', date: '2026-10-04', weightKg: 80.45 });
    const log = parseWeightLog(all?.content ?? '');
    expect(log.ok && log.value.count).toBe(11);
    expect(all?.meta).toEqual({ kind: 'weights_all', count: 11 });
    for (const r of sent) expect(r.chars).toBe(r.content?.length);
  });

  it('remplacement du jour et correction : mêmes tâches (dédupliquées), dernier poids envoyé', async () => {
    await addWeight({ date: '2026-10-04', weightKg: 80, now: NOW });
    await addWeight({ date: '2026-10-04', weightKg: 79.9, replace: true, now: NOW });
    await updateWeight('2026-10-04', 79.8, NOW);
    await flush();
    expect(await taskIds()).toEqual(['weight:2026-10-04:pending', 'weights_all:all:pending', 'backup_latest:latest:pending']);
    await processDriveOutbox('all', () => NOW);
    expect(parseWeightEntryFile(sent[0]?.content ?? '')).toMatchObject({ value: { weightKg: 79.8 } });
  });

  it('suppression : mark_deleted Pesees/AAAA-MM-JJ.json (not_in_index = succès), regroupement et sauvegarde', async () => {
    reply = (req) => (req.action === 'mark_deleted' ? new Response('{"ok":false,"error":"not_in_index"}') : new Response('{"ok":true}'));
    await deleteWeight('2026-09-02');
    await flush();
    await processDriveOutbox('all', () => NOW);
    expect(paths()).toEqual(['mark_deleted Pesees/2026-09-02.json', 'put Pesees/_pesees.json', 'put Sauvegardes/sauvegarde-derniere.json']);
    expect(sent[0]?.at).toMatch(/^2026-10-05T09:30:00/);
    expect((await getOutbox()).tasks).toEqual([]);
  });
});

describe('Intentions atomiques : écrites dans la transaction de la donnée', () => {
  beforeEach(async () => {
    await restoreText(example('history-weights-example.json'));
    await enableDrive();
  });

  it('aussitôt l’appel terminé (app fermée juste après) : l’intention est déjà en file, sans attente', async () => {
    await deleteWeight('2026-09-02');
    expect(await taskIds()).toEqual(['weight_deleted:2026-09-02:pending', 'weights_all:all:pending', 'backup_latest:latest:pending']);
    await deleteWorkout('w-0003');
    expect(await taskIds()).toContain('session_deleted:w-0003:pending');
    await addWeight({ date: '2026-10-04', weightKg: 80, now: NOW });
    expect(await taskIds()).toContain('weight:2026-10-04:pending');
  });

  it('envoi désactivé : l’écriture se fait normalement, aucune intention', async () => {
    await setDriveEnabled(false);
    await deleteWeight('2026-09-02');
    await updateWeight('2026-09-05', 82, NOW);
    expect((await getOutbox()).tasks).toEqual([]);
    expect(await db.weights.get('2026-09-02')).toBeUndefined();
    expect(await db.weights.get('2026-09-05')).toMatchObject({ weightKg: 82 });
  });
});

describe('Sauvegardes', () => {
  beforeEach(async () => {
    await restoreText(example('history-weights-example.json'));
    await enableDrive();
  });

  it('backup_latest = EXACTEMENT le fichier de « Exporter mes données » ; counts exacts ; force:false', async () => {
    await enqueueDriveTask('backup_latest', 'latest');
    await processDriveOutbox('all', () => NOW);
    const backup = sent[0];
    expect(backup?.content).toBe((await prepareExport(NOW)).json);
    expect(parseHistoryJson(backup?.content ?? '').ok).toBe(true);
    // V1.5.0 (adaptation signalée) : `measurements` ajouté aux compteurs.
    expect(backup?.meta).toEqual({ kind: 'backup_latest', counts: { sessions: 3, weights: 10, programs: 1, measurements: 0 }, exportedAt: '2026-10-05T09:30:00+02:00' });
    expect(backup).not.toHaveProperty('force');
    expect(await getLastAutoBackupAt()).toBe('2026-10-05T09:30:00+02:00');
  });

  it('lastAutoBackupAt n’avance QUE sur ok:true (HTML, réseau, busy : non)', async () => {
    for (const fail of [
      () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } }),
      () => new TypeError('Failed to fetch'),
      () => new Response('{"ok":false,"error":"busy","retryable":true}'),
    ]) {
      reply = fail;
      await enqueueDriveTask('backup_latest', 'latest');
      await processDriveOutbox('all', () => NOW);
      expect(await getLastAutoBackupAt()).toBeNull();
    }
    reply = () => new Response('{"ok":true}');
    await processDriveOutbox('all', () => NOW);
    expect(await getLastAutoBackupAt()).toBe('2026-10-05T09:30:00+02:00');
  });

  it('base vide : RIEN n’est envoyé, statut clair', async () => {
    await resetDatabase();
    await enableDrive();
    await enqueueDriveTask('backup_latest', 'latest');
    await enqueueDriveTask('backup_weekly', 'weekly');
    await processDriveOutbox('all', () => NOW);
    expect(sent).toEqual([]);
    expect((await getOutbox()).emptySkipAt).not.toBeUndefined();
    expect((await getOutbox()).tasks).toEqual([]);
    expect(await getLastAutoBackupAt()).toBeNull();
  });

  describe('Refus de régression (§8.2)', () => {
    const regression = () =>
      new Response(JSON.stringify({ ok: false, error: 'regression', retryable: false, current: { sessions: 121, weights: 40 }, incoming: { sessions: 3, weights: 10 } }));

    it('pas de réessai : pause, information pour l’écran de choix ; une nouvelle intention reste en pause', async () => {
      reply = regression;
      await enqueueDriveTask('backup_latest', 'latest');
      await processDriveOutbox('all', () => NOW);
      await processDriveOutbox('all', () => NOW);
      await enqueueDriveTask('backup_latest', 'latest');
      await processDriveOutbox('all', () => NOW);
      expect(sent).toHaveLength(1);
      const outbox = await getOutbox();
      expect(outbox.regression).toMatchObject({ current: { sessions: 121, weights: 40 }, incoming: { sessions: 3, weights: 10 } });
      expect(outbox.tasks).toMatchObject([{ id: 'backup_latest:latest', status: 'paused', revision: 2 }]);
      expect(await getLastAutoBackupAt()).toBeNull();
    });

    it('« Remplacer quand même » : renvoi avec force:true, confirmé, pause levée', async () => {
      reply = regression;
      await enqueueDriveTask('backup_latest', 'latest');
      await processDriveOutbox('all', () => NOW);
      reply = (req) => (req.force === true ? new Response('{"ok":true}') : regression());
      await resolveDriveRegression('replace');
      await processDriveOutbox('all', () => NOW);
      expect(sent.map((r) => r.force ?? false)).toEqual([false, true]);
      expect((await getOutbox()).regression).toBeNull();
      expect((await getOutbox()).tasks).toEqual([]);
      expect(await getLastAutoBackupAt()).not.toBeNull();
    });

    it('« Ignorer » : sauvegarde abandonnée, rien n’est envoyé ; « Restaurer » ne change rien côté file', async () => {
      reply = regression;
      await enqueueDriveTask('backup_latest', 'latest');
      await processDriveOutbox('all', () => NOW);
      await resolveDriveRegression('ignore');
      await processDriveOutbox('all', () => NOW);
      expect(sent).toHaveLength(1);
      expect(await getOutbox()).toMatchObject({ regression: null, tasks: [] });
    });

    it('supprimer une séance (Drive plus complet) déclenche aussi le garde-fou, par le vrai chemin', async () => {
      reply = (req) => (req.name === 'sauvegarde-derniere.json' ? regression() : new Response('{"ok":true}'));
      await deleteWorkout('w-0003');
      await flush();
      await processDriveOutbox('all', () => NOW);
      expect((await getOutbox()).tasks.map((t) => `${t.id}:${t.status}`)).toEqual(['backup_latest:latest:paused']);
    });
  });

  describe('Copie hebdomadaire', () => {
    it('due si jamais confirmée ou ≥ 7 jours ; nom AAAA-MM-JJ_hebdo.json ; date avancée seulement si confirmée', async () => {
      expect(isWeeklyBackupDue(null, NOW)).toBe(true);
      expect(isWeeklyBackupDue('2026-09-29T09:31:00+02:00', NOW)).toBe(false);
      expect(isWeeklyBackupDue('2026-09-28T09:30:00+02:00', NOW)).toBe(true);
      await setLastWeeklyBackupAt('2026-10-01T08:00:00+02:00');
      expect(await enqueueWeeklyIfDue(NOW)).toBe(false);
      await setLastWeeklyBackupAt('2026-09-27T08:00:00+02:00');
      reply = () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } });
      expect(await enqueueWeeklyIfDue(NOW)).toBe(true);
      await processDriveOutbox('all', () => NOW);
      expect(await getLastWeeklyBackupAt()).toBe('2026-09-27T08:00:00+02:00');
      reply = () => new Response('{"ok":true}');
      await processDriveOutbox('all', () => NOW);
      expect(paths().at(-1)).toBe('put Sauvegardes/2026-10-05_hebdo.json');
      expect(sent.at(-1)?.meta).toMatchObject({ kind: 'backup_weekly', counts: { sessions: 3, weights: 10, programs: 1 } });
      expect(await getLastWeeklyBackupAt()).toBe('2026-10-05T09:30:00+02:00');
      expect(await enqueueWeeklyIfDue(NOW)).toBe(false);
    });

    it.each([
      ['Pacific/Kiritimati', '2026-10-05_hebdo.json'],
      ['America/Los_Angeles', '2026-10-04_hebdo.json'],
    ])('fuseau %s : nom à la date LOCALE de l’envoi', async (tz, name) => {
      process.env.TZ = tz;
      const instant = new Date(Date.UTC(2026, 9, 4, 18, 0)); // 5 oct. 08:00 à UTC+14 ; 4 oct. 11:00 à Los Angeles
      await enqueueDriveTask('backup_weekly', 'weekly', instant);
      await processDriveOutbox('all', () => instant);
      expect(sent.at(-1)?.name).toBe(name);
    });
  });
});

describe('Rappel d’export : une sauvegarde CONFIRMÉE compte (le plus récent des deux)', () => {
  const workouts = [{ status: 'completed', completedAt: '2026-10-01T19:00:00+02:00' } as WorkoutSession];
  const now = new Date('2026-10-20T12:00:00+02:00');

  it('sauvegarde automatique récente : pas de rappel ; seule la plus récente des deux dates compte', () => {
    expect(getExportReminder(workouts, latestInstant(null, '2026-10-19T08:00:00+02:00'), now)).toBeNull();
    expect(getExportReminder(workouts, latestInstant('2026-09-01T08:00:00+02:00', '2026-10-19T08:00:00+02:00'), now)).toBeNull();
    expect(getExportReminder(workouts, latestInstant('2026-09-01T08:00:00+02:00', null), now)).toMatchObject({ daysSinceExport: 49 });
    expect(latestInstant(null, null)).toBeNull();
  });

  it('réponse non confirmée : lastAutoBackupAt reste nul, le rappel reste affiché', async () => {
    await restoreText(readFixture('history-example.json'));
    await enableDrive();
    reply = () => new TypeError('Failed to fetch');
    await enqueueDriveTask('backup_latest', 'latest');
    await processDriveOutbox('all', () => NOW);
    const auto = await getLastAutoBackupAt();
    expect(auto).toBeNull();
    expect(getExportReminder(workouts, latestInstant(null, auto), now)).not.toBeNull();
  });
});

describe('« Renvoyer toute l’archive »', () => {
  beforeEach(async () => {
    await restoreText(example('history-weights-example.json'));
    await enableDrive();
  });

  it('séances exportables + pesées + regroupement + sauvegarde ; progression ; sans doublon', async () => {
    expect(await resendWholeArchive(NOW)).toBe(3 + 10 + 2);
    expect(resendProgress(await getOutbox())).toEqual({ done: 0, total: 15 });
    await resendWholeArchive(NOW);
    expect((await getOutbox()).tasks).toHaveLength(15);
    await processDriveOutbox('all', () => NOW);
    expect(resendProgress(await getOutbox())).toEqual({ done: 15, total: 15 });
    expect(new Set(paths()).size).toBe(15);
    expect(paths().at(-1)).toBe('put Sauvegardes/sauvegarde-derniere.json');
  });

  it('coupure réseau au milieu : progression partielle ; reprise sans doublon', async () => {
    let calls = 0;
    reply = () => (++calls > 5 ? new TypeError('Failed to fetch') : new Response('{"ok":true}'));
    await resendWholeArchive(NOW);
    await processDriveOutbox('all', () => NOW);
    expect(resendProgress(await getOutbox())).toEqual({ done: 5, total: 15 });
    reply = () => new Response('{"ok":true}');
    await processDriveOutbox('all', () => NOW);
    expect(resendProgress(await getOutbox())).toEqual({ done: 15, total: 15 });
    const successful = sent.length - 1; // une tentative a échoué (coupure)
    expect(successful).toBe(15);
  });

  it('annulation : tâches restantes retirées ; relancer reprend sans doublon', async () => {
    let calls = 0;
    reply = () => (++calls > 4 ? new TypeError('Failed to fetch') : new Response('{"ok":true}'));
    await resendWholeArchive(NOW);
    await processDriveOutbox('all', () => NOW);
    await cancelWholeArchiveResend();
    expect((await getOutbox()).tasks).toEqual([]);
    expect(resendProgress(await getOutbox())).toBeNull();
    reply = () => new Response('{"ok":true}');
    await resendWholeArchive(NOW);
    expect((await getOutbox()).tasks).toHaveLength(15);
    await processDriveOutbox('all', () => NOW);
    expect(resendProgress(await getOutbox())).toEqual({ done: 15, total: 15 });
  });

  it('envoi désactivé : rien n’est mis en file', async () => {
    await setDriveEnabled(false);
    expect(await resendWholeArchive(NOW)).toBe(0);
    expect((await getOutbox()).tasks).toEqual([]);
  });
});

describe('Restauration et secret', () => {
  it('restauration : driveSync et dates de sauvegarde conservées ; ni secret ni URL dans aucun fichier envoyé', async () => {
    await restoreText(example('history-weights-example.json'));
    await enableDrive();
    reply = () => new Response(`<html>${SECRET} ${URL_}</html>`, { status: 404, headers: { 'content-type': 'text/html' } });
    await addWeight({ date: '2026-10-04', weightKg: 80, now: NOW });
    await deleteWeight('2026-09-02');
    await enqueueDriveTask('backup_weekly', 'weekly');
    for (let i = 0; i < 3; i++) await processDriveOutbox('all', () => NOW);
    reply = () => new Response('{"ok":true}');
    await processDriveOutbox('all', () => NOW);
    const before = { sync: await db.settings.get('driveSync'), auto: await getLastAutoBackupAt(), weekly: await getLastWeeklyBackupAt() };
    expect(before.auto).not.toBeNull();
    await restoreText(readFixture('history-example.json'));
    expect(await db.settings.get('driveSync')).toEqual(before.sync);
    expect(await getLastAutoBackupAt()).toBe(before.auto);
    expect(await getLastWeeklyBackupAt()).toBe(before.weekly);
    const everything = [JSON.stringify(await getOutbox()), ...sent.map((r) => r.content ?? ''), JSON.stringify(await db.metadata.get('preRestoreBackup'))].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('AKfycbBACKUPTESTID');
  });
});
