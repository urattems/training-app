import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeMuscuSync, type FakeMuscuSync } from '../../scripts/fake-muscu-sync.mjs';
import { db } from '../db/database';
import { resetDatabase } from '../test/fixtures';
import { createDriveClient, type FetchLike } from './driveClient';
import { getOutbox, ignoreDriveTask, processDriveOutbox, resendWholeArchive, setDriveClient } from './driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled, setDriveScriptVersion } from './driveSettings';
import { deleteAbandonedWorkout } from './historyService';
import { previewRestore, restoreBackup } from './importService';
import { setLastWeeklyBackupAt } from './settingsService';
import { addWeight, deleteWeight } from './weightService';

/**
 * V1.6.3 : une suppression de séance ou de pesée (`mark_deleted`) non confirmée par le script
 * retient `backup_latest` jusqu'au nouvel essai (même règle que les mensurations en V1.6.2).
 */
const SECRET = 'fake-secret-ordre-24680';
const LATEST = 'Sauvegardes/sauvegarde-derniere.json';
const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');

let fake: FakeMuscuSync;
let url = '';

beforeAll(async () => {
  fake = createFakeMuscuSync({ secret: SECRET, htmlRate: 0, errorRate: 0, latencyMin: 1, latencyMax: 5 });
  url = await fake.listen();
});
afterAll(async () => {
  await fake.close();
});

const latestCounts = () => fake.files.get(LATEST)?.meta.counts as { sessions: number; weights: number } | undefined;
const latestPuts = () => fake.requests.filter((r) => r.action === 'put' && `${r.folder ?? ''}/${r.name ?? ''}` === LATEST);
const marks = () => fake.requests.filter((r) => r.action === 'mark_deleted').map((r) => r.outcome);
const at = (ms: number) => () => new Date(Date.now() + ms);

/** Fixture (3 séances dont w-0003 abandonnée, 10 pesées) entièrement archivée : Drive = 3 séances, 10 pesées. */
async function archived(version: 'sync-2' | 'sync-3') {
  await resetDatabase();
  fake.files.clear();
  fake.requests.length = 0;
  fake.deletions.clear();
  fake.marks.clear();
  fake.config.regressionCounts = null;
  fake.config.htmlRate = 0;
  fake.config.version = version;
  setDriveClient(createDriveClient());
  const preview = previewRestore(example('history-weights-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
  await saveDriveConfig(url, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url, secret: SECRET });
  await setDriveEnabled(true);
  await setDriveScriptVersion(version);
  await setLastWeeklyBackupAt(new Date().toISOString());
  await resendWholeArchive();
  await processDriveOutbox('all');
  expect(latestCounts()).toMatchObject({ sessions: 3, weights: 10 });
  fake.requests.length = 0;
}

const cases = [
  { what: 'séance', remove: () => deleteAbandonedWorkout('w-0003'), field: 'sessions' as const, after: 2 },
  { what: 'pesée', remove: () => deleteWeight('2026-09-02'), field: 'weights' as const, after: 9 },
];

describe.each(['sync-3', 'sync-2'] as const)('Script %s', (version) => {
  beforeEach(async () => {
    await archived(version);
  });

  describe.each(cases)('suppression d’une $what', ({ remove, field, after }) => {
    it('mark_deleted non confirmé (page HTML) : aucune sauvegarde tant que non confirmé, même quand elle seule est due', async () => {
      await remove();
      fake.config.htmlRate = 1; // le script traite la marque, l'app reçoit une page HTML
      await processDriveOutbox('all');
      expect(marks()).toEqual(['ok']);
      expect(latestPuts()).toEqual([]);
      fake.config.htmlRate = 0;
      // 10 s plus tard : la sauvegarde est due (mise en file + 2 s), pas le nouvel essai (30 s).
      await processDriveOutbox('timer', at(10_000));
      expect(latestPuts()).toEqual([]);
      expect(latestCounts()?.[field]).toBe(field === 'sessions' ? 3 : 10);
      // Nouvel essai : la marque (rejouée), PUIS la sauvegarde.
      await processDriveOutbox('timer', at(60_000));
      expect(marks()).toEqual(['ok', 'ok']);
      expect(latestPuts()).toHaveLength(1);
      const outbox = await getOutbox();
      if (version === 'sync-3') {
        // sync-3 connaît la suppression : sauvegarde ACCEPTÉE.
        expect(latestCounts()?.[field]).toBe(after);
        expect(outbox.regression ?? null).toBeNull();
        expect(outbox.tasks).toEqual([]);
      } else {
        // sync-2 : la sauvegarde part bien APRÈS la marque ; le refus de régression d'avant s'applique.
        expect(latestPuts()[0]?.outcome).toBe('regression');
        expect(outbox.regression?.incoming[field]).toBe(after);
      }
    });

    it('mark_deleted confirmé du premier coup : marque puis sauvegarde dans la même passe', async () => {
      await remove();
      await processDriveOutbox('all');
      const order = fake.requests.filter((r) => r.action === 'mark_deleted' || `${r.folder ?? ''}/${r.name ?? ''}` === LATEST).map((r) => r.action);
      expect(order).toEqual(['mark_deleted', 'put']);
    });
  });

  it('suppression en erreur (refus non réessayable) : la sauvegarde attend jusqu’à « Ignorer »', async () => {
    await deleteWeight('2026-09-02');
    // Seule la marque est refusée (`forbidden_name`, non réessayable) ; tout le reste va au faux script.
    const refuseMarks: FetchLike = (target, init) =>
      (JSON.parse(init.body as string) as { action: string }).action === 'mark_deleted'
        ? Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'forbidden_name', retryable: false })))
        : fetch(target, init);
    setDriveClient(createDriveClient({ fetch: refuseMarks }));
    await processDriveOutbox('all');
    expect((await getOutbox()).tasks.find((t) => t.type === 'weight_deleted')?.status).toBe('error');
    expect(fake.requests.some((r) => r.name === '_pesees.json')).toBe(true); // le reste part
    expect(latestPuts()).toEqual([]); // pas la sauvegarde
    await processDriveOutbox('all', at(3_600_000 * 5));
    expect(latestPuts()).toEqual([]);
    // « Ignorer » la suppression en erreur : la sauvegarde part.
    await ignoreDriveTask('weight_deleted:2026-09-02');
    setDriveClient(createDriveClient());
    await processDriveOutbox('all');
    expect(latestPuts()).toHaveLength(1);
  });
});

describe('sync-3 : rejeu idempotent, une seule tolérance par suppression', () => {
  beforeEach(async () => {
    await archived('sync-3');
  });

  it('marque rejouée puis acceptée ; une 2ᵉ baisse non marquée est refusée', async () => {
    await deleteWeight('2026-09-02');
    fake.config.htmlRate = 1;
    await processDriveOutbox('all');
    fake.config.htmlRate = 0;
    await processDriveOutbox('timer', at(60_000));
    expect(marks()).toEqual(['ok', 'ok']);
    expect(fake.marks.size).toBe(1);
    expect(latestCounts()?.weights).toBe(9);
    // Pesée retirée SANS marque (ex. ancienne app) : la tolérance précédente est consommée.
    await db.weights.delete('2026-09-05');
    await addWeight({ date: '2026-10-02', weightKg: 80.1, now: new Date(2026, 9, 2, 7) }); // même total, sauvegarde
    await db.weights.delete('2026-09-08');
    await processDriveOutbox('timer', at(120_000));
    expect((await getOutbox()).regression?.incoming.weights).toBe(8);
  });
});
