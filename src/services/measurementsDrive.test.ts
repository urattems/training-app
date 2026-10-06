import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeMuscuSync, type FakeMuscuSync } from '../../scripts/fake-muscu-sync.mjs';
import type { MeasurementValues } from '../domain/measurements';
import { resetDatabase } from '../test/fixtures';
import { createDriveClient } from './driveClient';
import { buildBackupFile } from './driveContent';
import { getOutbox, processDriveOutbox, setDriveClient } from './driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from './driveSettings';
import { addMeasurement, deleteMeasurement, updateMeasurement } from './measurementService';
import { getLastAutoBackupAt, setLastWeeklyBackupAt } from './settingsService';

const SECRET = 'fake-secret-mesures-2468';
const LATEST = 'Sauvegardes/sauvegarde-derniere.json';
const NOW = new Date(2026, 9, 6, 10, 0);
const NONE: MeasurementValues = { chestCm: null, bellyCm: null, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null };
const FULL: MeasurementValues = { chestCm: 104.5, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.1, thighCm: 58.2, calfCm: 38.4 };

let fake: FakeMuscuSync;
let url = '';

beforeAll(async () => {
  // Script FACTICE au protocole sync-2 (celui de l'utilisateur aujourd'hui), servi en HTTP réel.
  fake = createFakeMuscuSync({ secret: SECRET, htmlRate: 0, errorRate: 0, latencyMin: 1, latencyMax: 5 });
  url = await fake.listen();
});
afterAll(async () => {
  await fake.close();
});

beforeEach(async () => {
  await resetDatabase();
  fake.files.clear();
  fake.requests.length = 0;
  fake.config.regressionCounts = null;
  setDriveClient(createDriveClient());
  await saveDriveConfig(url, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url, secret: SECRET });
  await setDriveEnabled(true);
  await setLastWeeklyBackupAt(new Date().toISOString());
});

const taskIds = async () => (await getOutbox()).tasks.map((t) => t.id);
const latestCounts = () => fake.files.get(LATEST)?.meta.counts as Record<string, number> | undefined;

describe('Mensurations et archive Drive (jalon 3, compatible sync-2)', () => {
  it('ajout, modification, suppression : backup_latest SEUL en file (aucun fichier par prise)', async () => {
    await addMeasurement('2026-10-01', FULL, NOW);
    expect(await taskIds()).toEqual(['backup_latest:latest']);
    await processDriveOutbox('all');
    expect(await taskIds()).toEqual([]);

    await updateMeasurement('2026-10-01', { ...FULL, calfCm: null }, NOW);
    expect(await taskIds()).toEqual(['backup_latest:latest']);
    await processDriveOutbox('all');

    await deleteMeasurement('2026-10-01');
    expect(await taskIds()).toEqual(['backup_latest:latest']);
    await processDriveOutbox('all');
    expect(await taskIds()).toEqual([]);
  });

  it('base avec des mensurations SEULES : non vide, sauvegarde envoyée ; compteurs envoyés', async () => {
    await addMeasurement('2026-10-01', { ...NONE, bellyCm: 92 }, NOW);
    const file = await buildBackupFile('backup_latest', NOW);
    expect(file.empty).toBe(false);
    expect(file.meta.counts).toEqual({ sessions: 0, weights: 0, programs: 0, measurements: 1 });
    await processDriveOutbox('all');
    expect(latestCounts()).toEqual({ sessions: 0, weights: 0, programs: 0, measurements: 1 });
    expect(await getLastAutoBackupAt()).not.toBeNull();
  });

  it('script sync-2 : seules des actions connues (put), aucun fichier de mensuration, aucun envoi en plus', async () => {
    await addMeasurement('2026-09-20', FULL, NOW);
    await addMeasurement('2026-10-01', { ...NONE, chestCm: 103.5 }, NOW);
    await processDriveOutbox('all');
    expect(fake.requests.map((r) => `${r.action} ${r.outcome}`)).toEqual(['put ok']);
    expect([...fake.files.keys()]).toEqual([LATEST]);
    expect(fake.requests.some((r) => !['ping', 'put', 'mark_deleted', 'reindex'].includes(r.action))).toBe(false);
  });

  it('suppression d’une prise avec sync-2 : sauvegarde ACCEPTÉE (le script ne compare que séances et pesées)', async () => {
    await addMeasurement('2026-09-20', FULL, NOW);
    await addMeasurement('2026-10-01', FULL, NOW);
    await processDriveOutbox('all');
    expect(latestCounts()?.measurements).toBe(2);
    await deleteMeasurement('2026-09-20');
    await processDriveOutbox('all');
    expect(fake.requests.map((r) => r.outcome)).toEqual(['ok', 'ok']);
    expect(latestCounts()?.measurements).toBe(1);
    expect((await getOutbox()).regression ?? null).toBeNull();
  });

  it('refus de régression sync-2 (sans mensurations) : lecture tolérante, compteur absent ignoré', async () => {
    fake.config.regressionCounts = { sessions: 5, weights: 20 };
    await addMeasurement('2026-10-01', FULL, NOW);
    await processDriveOutbox('all');
    const { regression } = await getOutbox();
    expect(regression?.current).toEqual({ sessions: 5, weights: 20 });
    expect(regression?.incoming).toEqual({ sessions: 0, weights: 0 });
    expect(regression && 'measurements' in regression.current).toBe(false);
  });
});
