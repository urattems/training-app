import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeMuscuSync, type FakeMuscuSync } from '../../scripts/fake-muscu-sync.mjs';
import { db, DEVICE_SETTING_KEYS } from '../db/database';
import type { MeasurementValues } from '../domain/measurements';
import { resetDatabase } from '../test/fixtures';
import { createDriveClient } from './driveClient';
import { buildBackupFile } from './driveContent';
import { getOutbox, processDriveOutbox, setDriveClient } from './driveOutbox';
import { getDriveScriptVersion, markDriveTested, saveDriveConfig, setDriveEnabled, setDriveScriptVersion } from './driveSettings';
import { prepareExport } from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { addMeasurement, deleteMeasurement, updateMeasurement } from './measurementService';
import { setLastWeeklyBackupAt } from './settingsService';

const SECRET = 'fake-secret-sync3-97531';
const LATEST = 'Sauvegardes/sauvegarde-derniere.json';
const NOW = new Date(2026, 9, 6, 10, 0);
const FULL: MeasurementValues = { chestCm: 104.5, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.1, thighCm: 58.2, calfCm: 38.4 };

let fake: FakeMuscuSync;
let url = '';

beforeAll(async () => {
  fake = createFakeMuscuSync({ secret: SECRET, htmlRate: 0, errorRate: 0, latencyMin: 1, latencyMax: 5, version: 'sync-3' });
  url = await fake.listen();
});
afterAll(async () => {
  await fake.close();
});

beforeEach(async () => {
  await resetDatabase();
  fake.files.clear();
  fake.requests.length = 0;
  fake.deletions.clear();
  fake.config.regressionCounts = null;
  fake.config.htmlRate = 0;
  fake.config.version = 'sync-3';
  setDriveClient(createDriveClient());
  await saveDriveConfig(url, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url, secret: SECRET });
  await setDriveEnabled(true);
  await setLastWeeklyBackupAt(new Date().toISOString());
});

const actions = () => fake.requests.map((r) => `${r.action}${r.key ? ` ${r.key}` : ''} ${r.outcome}`);
const latestMeasurements = () => (fake.files.get(LATEST)?.meta.counts as Record<string, number> | undefined)?.measurements;

/** Prises du 1er au n-ième septembre, sauvegarde acceptée (Drive : n mensurations). */
async function seed(n: number) {
  for (let d = 1; d <= n; d++) await addMeasurement(`2026-09-0${String(d)}`, FULL, NOW);
  await processDriveOutbox('all');
  expect(latestMeasurements()).toBe(n);
  fake.requests.length = 0;
}

describe('sync-3 : suppression de mensurations notée avant la sauvegarde', () => {
  beforeEach(async () => {
    await setDriveScriptVersion('sync-3');
  });

  it('1 suppression : note_deletion PUIS sauvegarde, acceptée (baisse tolérée)', async () => {
    await seed(2);
    await deleteMeasurement('2026-09-01');
    expect((await getOutbox()).tasks.map((t) => t.id)).toEqual(['measurement_deleted:2026-09-01', 'backup_latest:latest']);
    await processDriveOutbox('all');
    expect(actions()).toEqual(['note_deletion 2026-09-01 ok', 'put ok']);
    expect(latestMeasurements()).toBe(1);
    expect((await getOutbox()).regression ?? null).toBeNull();
    expect((await getOutbox()).tasks).toEqual([]);
  });

  it('tolérée UNE fois, pas deux : une baisse suivante non notée est refusée', async () => {
    await seed(3);
    await deleteMeasurement('2026-09-01');
    await processDriveOutbox('all');
    expect(latestMeasurements()).toBe(2);
    // Suppression suivante sans note (ex. ancienne app) : la tolérance précédente est consommée.
    await db.measurements.delete('2026-09-02');
    await updateMeasurement('2026-09-03', { ...FULL, calfCm: 38 }, NOW); // déclenche une sauvegarde
    await processDriveOutbox('all');
    expect((await getOutbox()).regression?.current.measurements).toBe(2);
    expect((await getOutbox()).regression?.incoming.measurements).toBe(1);
  });

  it('2 suppressions rapides : 2 note_deletion distincts, UNE seule sauvegarde, acceptée', async () => {
    await seed(3);
    await deleteMeasurement('2026-09-01');
    await deleteMeasurement('2026-09-02');
    await processDriveOutbox('all');
    expect(actions()).toEqual(['note_deletion 2026-09-01 ok', 'note_deletion 2026-09-02 ok', 'put ok']);
    expect(latestMeasurements()).toBe(1);
    expect((await getOutbox()).regression ?? null).toBeNull();
  });

  it('suppression rejouée (réponse perdue puis nouvel essai) : comptée une fois, pas de double tolérance', async () => {
    await seed(3);
    await deleteMeasurement('2026-09-01');
    fake.config.htmlRate = 1; // le script TRAITE la note, mais l'app reçoit une page HTML : non confirmé
    await processDriveOutbox('all');
    expect(actions()).toEqual(['note_deletion 2026-09-01 ok']);
    // Non confirmée : la sauvegarde n'est PAS partie, la suppression attend un nouvel essai.
    expect((await getOutbox()).tasks.map((t) => [t.id, t.status, t.attempts])).toEqual([
      ['measurement_deleted:2026-09-01', 'pending', 1],
      ['backup_latest:latest', 'pending', 0],
    ]);
    expect(latestMeasurements()).toBe(3);
    fake.config.htmlRate = 0;
    await processDriveOutbox('all'); // nouvel essai : même note rejouée, puis la sauvegarde
    expect(actions()).toEqual(['note_deletion 2026-09-01 ok', 'note_deletion 2026-09-01 ok', 'put ok']);
    expect(fake.deletions.size).toBe(1);
    expect(latestMeasurements()).toBe(2);
    // Une 2ᵉ baisse non notée est refusée : le rejeu n'a pas donné deux tolérances.
    await db.measurements.delete('2026-09-02');
    await updateMeasurement('2026-09-03', { ...FULL, calfCm: 38 }, NOW);
    await processDriveOutbox('all');
    expect((await getOutbox()).regression?.incoming.measurements).toBe(1);
  });

  it('note_deletion non confirmée : la sauvegarde ne part pas, même quand elle seule est due (pas de fausse régression)', async () => {
    await seed(2);
    await deleteMeasurement('2026-09-01');
    fake.config.htmlRate = 1;
    await processDriveOutbox('all'); // note non confirmée : nouvel essai dans 30 s
    fake.config.htmlRate = 0;
    fake.requests.length = 0;
    // 10 s plus tard : la sauvegarde (mise en file + 2 s) est due, pas encore le nouvel essai de la note.
    await processDriveOutbox('timer', () => new Date(Date.now() + 10_000));
    expect(actions()).toEqual([]);
    expect(latestMeasurements()).toBe(2);
    expect((await getOutbox()).regression ?? null).toBeNull();
    // Le nouvel essai venu (1 min plus tard) : la note, PUIS la sauvegarde, acceptée.
    await processDriveOutbox('timer', () => new Date(Date.now() + 60_000));
    expect(actions()).toEqual(['note_deletion 2026-09-01 ok', 'put ok']);
    expect(latestMeasurements()).toBe(1);
  });

  it('modification d’une prise = enregistrement normal : aucune suppression notée', async () => {
    await seed(1);
    await updateMeasurement('2026-09-01', { ...FULL, calfCm: null }, NOW);
    expect((await getOutbox()).tasks.map((t) => t.id)).toEqual(['backup_latest:latest']);
    await processDriveOutbox('all');
    expect(actions()).toEqual(['put ok']);
  });

  it('suppression d’une date sans prise : rien n’est noté', async () => {
    await seed(1);
    await deleteMeasurement('2026-08-15');
    expect((await getOutbox()).tasks).toEqual([]);
  });
});

describe('sync-2 et version inconnue', () => {
  it('sync-2 (version connue) : aucune note_deletion envoyée, aucune erreur', async () => {
    fake.config.version = 'sync-2';
    await setDriveScriptVersion('sync-2');
    await seed(2);
    await deleteMeasurement('2026-09-01');
    await processDriveOutbox('all');
    expect(actions()).toEqual(['put ok']); // sync-2 ne compte pas les mensurations : acceptée
    expect(fake.requests.some((r) => r.action === 'note_deletion')).toBe(false);
    const outbox = await getOutbox();
    expect(outbox.tasks).toEqual([]);
    expect(outbox.regression ?? null).toBeNull();
  });

  it('version inconnue + script sync-2 : ping discret, rien d’autre, version mémorisée', async () => {
    fake.config.version = 'sync-2';
    await seed(2);
    await deleteMeasurement('2026-09-01');
    await processDriveOutbox('all');
    expect(actions()).toEqual(['ping ok', 'put ok']);
    expect(await getDriveScriptVersion()).toBe('sync-2');
  });

  it('version inconnue puis ping réussi (sync-3) : bascule, la suppression est notée', async () => {
    await seed(2);
    expect(await getDriveScriptVersion()).toBeNull();
    await deleteMeasurement('2026-09-01');
    await processDriveOutbox('all');
    expect(actions()).toEqual(['ping ok', 'note_deletion 2026-09-01 ok', 'put ok']);
    expect(await getDriveScriptVersion()).toBe('sync-3');
    expect(latestMeasurements()).toBe(1);
  });

  it('version inconnue et ping en échec : rien d’envoyé pour la suppression, aucune erreur', async () => {
    await seed(2);
    await deleteMeasurement('2026-09-01');
    fake.config.htmlRate = 1; // le ping n'est pas confirmé
    await processDriveOutbox('all');
    expect(fake.requests.some((r) => r.action === 'note_deletion')).toBe(false);
    expect((await getOutbox()).tasks.some((t) => t.type === 'measurement_deleted')).toBe(false);
    expect(await getDriveScriptVersion()).toBeNull();
    fake.config.htmlRate = 0;
  });
});

describe('Version du script : réglage de l’appareil, jamais exporté ni restauré', () => {
  it('clé dans DEVICE_SETTING_KEYS ; absente des exports, de la sauvegarde Drive ; conservée par une restauration', async () => {
    expect(DEVICE_SETTING_KEYS).toContain('driveScriptVersion');
    await setDriveScriptVersion('sync-3');
    await addMeasurement('2026-09-01', FULL, NOW);
    const exported = await prepareExport(NOW);
    const backup = await buildBackupFile('backup_latest', NOW);
    for (const text of [exported.json, backup.content, JSON.stringify(backup.meta)]) {
      expect(text).not.toContain('driveScriptVersion');
      expect(text).not.toContain('sync-3');
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(url);
    }
    // Restauration d'une sauvegarde : la version (comme l'URL et le secret) reste celle de l'appareil.
    const preview = previewRestore(exported.json);
    if (!preview.ok) throw new Error(preview.error.message);
    await restoreBackup(preview.value.data, NOW);
    expect(await getDriveScriptVersion()).toBe('sync-3');
    const copy = JSON.stringify((await db.metadata.get('preRestoreBackup'))?.data);
    expect(copy).not.toContain('sync-3');
    expect(copy).not.toContain(SECRET);
  });

  it('URL ou secret changés : la version redevient inconnue (autre script)', async () => {
    await setDriveScriptVersion('sync-3');
    await saveDriveConfig(url, `${SECRET}-autre`);
    expect(await getDriveScriptVersion()).toBeNull();
  });
});
