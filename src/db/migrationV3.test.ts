import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeasurementEntry, WeightEntry } from '../domain/types';
import { DB_VERSION, TrainingDatabase } from './database';

/** Base de test dédiée (n'affecte pas l'instance de l'app). */
const NAME = 'migration-v2-v3-test';

/**
 * Le code de la V1.2 → V1.4.x tel qu'il était (versions 1 et 2), recopié ici À LA MAIN : un iPhone
 * resté sur l'ancienne version, ou une ancienne version servie après un retour en arrière.
 */
class V2Database extends Dexie {
  constructor() {
    super(NAME);
    this.version(1).stores({ programs: '&programId', workouts: '&id, status, date, programId', settings: '&key', metadata: '&key' });
    this.version(2).stores({ weights: '&date' });
  }
}

const PROGRAM = { programId: 'p-1', importedAt: '2026-09-01T10:00:00+02:00', archivedAt: null, name: 'Programme' };
const WORKOUT = { id: 'w-1', status: 'completed', date: '2026-10-01', programId: 'p-1', sessionName: 'Séance A' };
const SETTINGS = [
  { key: 'activeProgramId', value: 'p-1' },
  { key: 'lastExportAt', value: '2026-09-30T21:00:00+02:00' },
  { key: 'driveSync', value: { url: 'https://script.google.com/macros/s/X/exec', secret: 'secret-1234', enabled: true, testedAt: null } },
];
const META = { key: 'preRestoreBackup', savedAt: '2026-09-20T09:00:00+02:00', data: { schemaVersion: '1.1' } };
const WEIGHTS: WeightEntry[] = [
  { date: '2026-09-30', weightKg: 80.4, recordedAt: '2026-09-30T07:00:00+02:00' },
  { date: '2026-10-01', weightKg: 80.15, recordedAt: '2026-10-01T07:05:00+02:00' },
];
const MEASUREMENT: MeasurementEntry = {
  date: '2026-10-01',
  chestCm: 104.5,
  bellyCm: 92,
  waistCm: null,
  bicepsCm: 36.1,
  thighCm: null,
  calfCm: 38.4,
  recordedAt: '2026-10-01T08:00:00+02:00',
};

async function createV2Base() {
  const v2 = new V2Database();
  await v2.open();
  await v2.table('programs').put(PROGRAM);
  await v2.table('workouts').put(WORKOUT);
  await v2.table('settings').bulkPut(SETTINGS);
  await v2.table('metadata').put(META);
  await v2.table('weights').bulkPut(WEIGHTS);
  expect(v2.verno).toBe(2);
  v2.close();
}

/** Lecture brute par nom de store (commune à l'ancien et au nouveau code). */
async function dump(db: { table: (name: string) => { toArray: () => PromiseLike<unknown[]> } }): Promise<Record<string, unknown[]>> {
  const all = async (name: string): Promise<unknown[]> => db.table(name).toArray();
  return {
    programs: await all('programs'),
    workouts: await all('workouts'),
    settings: ((await all('settings')) as { key: string }[]).sort((a, b) => a.key.localeCompare(b.key)),
    metadata: await all('metadata'),
    weights: await all('weights'),
  };
}

const sortedSettings = [...SETTINGS].sort((a, b) => a.key.localeCompare(b.key));

afterEach(async () => {
  await Dexie.delete(NAME);
});

describe('Migration IndexedDB v2 → v3 (mensurations)', () => {
  it('une base v2 remplie, rouverte par le code v3 : toutes les données intactes, measurements vide', async () => {
    await createV2Base();
    const v3 = new TrainingDatabase(NAME);
    await v3.open();
    expect(DB_VERSION).toBe(3);
    expect(v3.verno).toBe(3);
    expect(v3.tables.map((t) => t.name).sort()).toEqual(['measurements', 'metadata', 'programs', 'settings', 'weights', 'workouts']);
    expect(await dump(v3)).toEqual({ programs: [PROGRAM], workouts: [WORKOUT], settings: sortedSettings, metadata: [META], weights: WEIGHTS });
    expect(await v3.measurements.count()).toBe(0);
    // Index des stores existants inchangés.
    expect(v3.workouts.schema.indexes.map((i) => i.name).sort()).toEqual(['date', 'programId', 'status']);
    expect(v3.measurements.schema.primKey.name).toBe('date');
    v3.close();
  });

  it('réouvertures répétées : rien ne bouge, les mensurations ajoutées sont conservées', async () => {
    await createV2Base();
    for (let i = 0; i < 4; i++) {
      const v3 = new TrainingDatabase(NAME);
      await v3.open();
      if (i === 0) await v3.measurements.add(MEASUREMENT);
      expect(await dump(v3)).toEqual({ programs: [PROGRAM], workouts: [WORKOUT], settings: sortedSettings, metadata: [META], weights: WEIGHTS });
      expect(await v3.measurements.toArray()).toEqual([MEASUREMENT]);
      v3.close();
    }
  });

  it('une base neuve est créée directement en v3', async () => {
    const fresh = new TrainingDatabase(NAME);
    await fresh.open();
    expect(fresh.verno).toBe(3);
    expect(await fresh.measurements.count()).toBe(0);
    fresh.close();
  });

  it('une seule prise par date : la clé primaire refuse un doublon', async () => {
    const v3 = new TrainingDatabase(NAME);
    await v3.open();
    await v3.measurements.add(MEASUREMENT);
    await expect(v3.measurements.add({ ...MEASUREMENT, chestCm: 99 })).rejects.toThrow();
    expect(await v3.measurements.toArray()).toEqual([MEASUREMENT]);
    v3.close();
  });

  it('retour en arrière : l’ANCIEN code (v2) ouvre une base v3 sans la vider ni perdre les mensurations', async () => {
    await createV2Base();
    const v3 = new TrainingDatabase(NAME);
    await v3.open();
    await v3.measurements.add(MEASUREMENT);
    v3.close();

    // Ancienne version servie de nouveau (cache, retour en arrière) : Dexie ouvre la base à sa
    // version installée (3) au lieu d'échouer, et l'ancien code ignore le store inconnu.
    const old = new V2Database();
    await old.open();
    expect(await dump(old)).toEqual({ programs: [PROGRAM], workouts: [WORKOUT], settings: sortedSettings, metadata: [META], weights: WEIGHTS });
    await old.table('weights').put({ date: '2026-10-02', weightKg: 80, recordedAt: '2026-10-02T07:00:00+02:00' });
    old.close();

    // Nouvelle version rouverte : mensurations intactes, pesée de l'ancien code conservée.
    const again = new TrainingDatabase(NAME);
    await again.open();
    expect(again.verno).toBe(3);
    expect(await again.measurements.toArray()).toEqual([MEASUREMENT]);
    expect(await again.weights.count()).toBe(3);
    again.close();
  });
});
