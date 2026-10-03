import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredProgram, WorkoutSession } from '../domain/types';
import { addExtraSet, setActualValues, setComment } from '../domain/workout';
import { parseHistoryJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { DB_VERSION, TrainingDatabase } from './database';

/** Base de test dédiée (n'affecte pas l'instance de l'app). */
const NAME = 'migration-v1-v2-test';

/**
 * Le code de la V1 tel qu'il était (version 1 seule), recopié ici À LA MAIN : on simule
 * un iPhone resté sur l'ancienne version, sans dépendre des constantes actuelles.
 */
class V1Database extends Dexie {
  constructor() {
    super(NAME);
    this.version(1).stores({
      programs: '&programId',
      workouts: '&id, status, date, programId',
      settings: '&key',
      metadata: '&key',
    });
  }
}

const fixture = (() => {
  const parsed = parseHistoryJson(readFixture('history-example.json'));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
})();

/** Données réalistes : fixture + séance saisie dans l'app (série en plus, décimales, commentaire). */
function v1Data() {
  const programs: StoredProgram[] = fixture.programs.map((p) => ({ ...p, importedAt: '2026-09-01T10:00:00+02:00', archivedAt: null }));
  const base = fixture.sessions[0] as WorkoutSession;
  let typed: WorkoutSession = {
    ...base,
    id: 'w-app-1',
    status: 'in_progress',
    completedAt: null,
    durationSec: null,
    date: '2026-10-02',
    startedAt: '2026-10-02T18:05:00+02:00',
  };
  const exerciseId = typed.exerciseRecords[0]?.programExerciseId ?? '';
  typed = setActualValues(typed, exerciseId, 1, { actualReps: 11, actualWeightKg: 47.5 });
  typed = addExtraSet(typed, exerciseId);
  typed = setComment(typed, exerciseId, 'Épaule « sensible », 2ᵉ série');
  const legacyBackup = { ...fixture, schemaVersion: '1.0' } as Record<string, unknown>;
  delete legacyBackup.weightEntries;
  return {
    programs,
    workouts: [...fixture.sessions, typed],
    settings: [
      { key: 'activeProgramId', value: fixture.activeProgramId },
      { key: 'preferences', value: { unit: 'kg', theme: 'light' } },
      { key: 'lastExportAt', value: '2026-09-30T21:00:00+02:00' },
      { key: 'lastCoachExportAt', value: '2026-10-01T08:00:00+02:00' },
    ],
    metadata: [{ key: 'preRestoreBackup', savedAt: '2026-09-20T09:00:00+02:00', data: legacyBackup }],
  };
}

const byKey = <T>(rows: T[], key: (row: T) => string): T[] => [...rows].sort((a, b) => key(a).localeCompare(key(b)));

async function createV1Base() {
  const data = v1Data();
  const v1 = new V1Database();
  await v1.open();
  await v1.table('programs').bulkPut(data.programs);
  await v1.table('workouts').bulkPut(data.workouts);
  await v1.table('settings').bulkPut(data.settings);
  await v1.table('metadata').bulkPut(data.metadata);
  expect(v1.verno).toBe(1);
  v1.close();
  return data;
}

async function dump(db: TrainingDatabase) {
  return {
    programs: byKey(await db.programs.toArray(), (p) => p.programId),
    workouts: byKey(await db.workouts.toArray(), (w) => w.id),
    settings: byKey(await db.settings.toArray(), (s) => s.key),
    metadata: await db.metadata.toArray(),
    weights: await db.weights.toArray(),
  };
}

afterEach(async () => {
  await Dexie.delete(NAME);
});

describe('Migration IndexedDB v1 → v2 (première vraie migration, données réelles)', () => {
  it('une base v1 remplie, rouverte par le code v2 : toutes les données intactes, weights vide', async () => {
    const data = await createV1Base();

    const v2 = new TrainingDatabase(NAME);
    await v2.open();
    expect(DB_VERSION).toBe(2);
    expect(v2.verno).toBe(2);
    expect(v2.tables.map((t) => t.name).sort()).toEqual(['metadata', 'programs', 'settings', 'weights', 'workouts']);

    const after = await dump(v2);
    expect(after.programs).toEqual(byKey(data.programs, (p) => p.programId));
    expect(after.workouts).toEqual(byKey(data.workouts, (w) => w.id));
    expect(after.settings).toEqual(byKey(data.settings, (s) => s.key));
    expect(after.metadata).toEqual(data.metadata);
    expect(after.weights).toEqual([]);

    // Les index des stores existants sont inchangés (requêtes de l'app).
    expect(await v2.workouts.where('status').equals('in_progress').primaryKeys()).toEqual(['w-app-1']);
    expect(await v2.workouts.where('programId').equals('prog-demo-w37').count()).toBe(4);
    expect(v2.workouts.schema.indexes.map((i) => i.name).sort()).toEqual(['date', 'programId', 'status']);
    v2.close();
  });

  it('réouvertures répétées : rien ne bouge, les pesées ajoutées sont conservées', async () => {
    const data = await createV1Base();
    let reference: Awaited<ReturnType<typeof dump>> | null = null;
    for (let i = 0; i < 4; i++) {
      const v2 = new TrainingDatabase(NAME);
      await v2.open();
      const snapshot = await dump(v2);
      if (reference === null) {
        await v2.weights.put({ date: '2026-10-02', weightKg: 80.45, recordedAt: '2026-10-02T07:10:00+02:00' });
        reference = { ...snapshot, weights: [{ date: '2026-10-02', weightKg: 80.45, recordedAt: '2026-10-02T07:10:00+02:00' }] };
      } else {
        expect(snapshot).toEqual(reference);
      }
      expect(snapshot.workouts).toHaveLength(data.workouts.length);
      v2.close();
    }
  });

  it('une base neuve est créée directement en v2', async () => {
    const fresh = new TrainingDatabase(NAME);
    await fresh.open();
    expect(fresh.verno).toBe(2);
    expect(await fresh.weights.count()).toBe(0);
    fresh.close();
  });
});
