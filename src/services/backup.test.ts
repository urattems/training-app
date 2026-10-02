import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import type { WorkoutSession } from '../domain/types';
import { addCardioEntry, addExtraSet, setActualValues, setComment, setSensation, updateCardioEntry, validateExercise } from '../domain/workout';
import { parseHistoryJson } from '../schemas/parse';
import { dumpDatabase, fixtureObject, readFixture, resetDatabase } from '../test/fixtures';
import {
  deliverPreparedExport,
  ExportIntegrityError,
  exportData,
  prepareExport,
  verifyExportIntegrity,
  type DeliveryEnv,
} from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { importProgram, previewProgram } from './programService';
import { getLastExportAt } from './settingsService';
import { requestPersistentStorage } from './storageService';
import { abandonWorkout, finishWorkout, startWorkout, updateWorkout } from './workoutService';

const download = (): DeliveryEnv => ({ navigator: {}, download: vi.fn() });

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

/** Export → vidage complet de la base → restauration du fichier → nouvel export. */
async function roundTrip() {
  const first = await prepareExport(new Date(2026, 9, 20, 12));
  await resetDatabase();
  await restoreText(first.json);
  const second = await prepareExport(new Date(2026, 9, 20, 12));
  return { first, second };
}

beforeEach(resetDatabase);

describe('Aller-retour export → vidage → restauration', () => {
  it('history-example.json : égalité profonde', async () => {
    await restoreText(readFixture('history-example.json'));
    const { first, second } = await roundTrip();
    expect(second.data).toEqual(first.data);
    expect(second.json).toBe(first.json);
    const fixture = parseHistoryJson(readFixture('history-example.json'));
    expect(fixture.ok && { ...second.data, exportedAt: fixture.value.exportedAt }).toEqual(fixture.ok && fixture.value);
  });

  it('données saisies dans l\'app (archivé, extra, cardio, abandon, en cours) : égalité profonde', async () => {
    const first = previewProgram(readFixture('program-example.json'));
    if (!first.ok) throw new Error();
    await importProgram(first.value.program, new Date(2026, 9, 1));
    const done = await startWorkout('A', { now: new Date(2026, 9, 2, 18), id: 'w-a' });
    const edits: ((w: WorkoutSession) => WorkoutSession)[] = [
      (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47.5 }),
      (w) => addExtraSet(w, 'chest-press-machine'),
      (w) => setActualValues(w, 'chest-press-machine', 4, { actualReps: 8, actualWeightKg: 40 }),
      (w) => setSensation(w, 'chest-press-machine', 'hard'),
      (w) => setComment(w, 'chest-press-machine', 'Épaule « sensible », 2ᵉ série'),
      (w) => validateExercise(w, 'chest-press-machine'),
      (w) => updateCardioEntry(addCardioEntry(w, 'treadmill'), 0, { durationSec: 1200, speedKmh: 5.5, inclinePct: 8, name: 'Tapis' }),
    ];
    for (const edit of edits) await updateWorkout(done.id, edit);
    await finishWorkout(done.id, new Date(2026, 9, 2, 19));
    const abandoned = await startWorkout('B', { now: new Date(2026, 9, 4, 18), id: 'w-b' });
    await abandonWorkout(abandoned.id);

    const next = fixtureObject('program-example.json');
    next.programId = 'prog-w41';
    const second = previewProgram(JSON.stringify(next));
    if (!second.ok) throw new Error();
    await importProgram(second.value.program, new Date(2026, 9, 8));
    await startWorkout('C', { now: new Date(2026, 9, 9, 18), id: 'w-c' });

    const before = await dumpDatabase();
    const { first: exported, second: reexported } = await roundTrip();
    expect(exported.programCount).toBe(2);
    expect(exported.sessionCount).toBe(3);
    expect(reexported.data).toEqual(exported.data);
    const after = await dumpDatabase();
    expect(after.workouts).toEqual(before.workouts);
    expect(after.settings.find((s) => s.key === 'activeProgramId')?.value).toBe('prog-w41');
  });
});

describe('Autotest d\'intégrité de l\'export', () => {
  it('un export valide passe la relecture', async () => {
    await restoreText(readFixture('history-example.json'));
    const prepared = await prepareExport();
    expect(() => {
      verifyExportIntegrity(prepared.json, prepared.data);
    }).not.toThrow();
    expect(prepared.file.name).toMatch(/^training-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await prepared.file.text()).toBe(prepared.json);
  });

  it('une donnée corrompue en base bloque l\'export (jamais de fichier non restaurable) et lastExportAt reste vide', async () => {
    await restoreText(readFixture('history-example.json'));
    const corrupted = (await db.workouts.get('w-0001')) as WorkoutSession;
    const record = corrupted.exerciseRecords[0];
    if (!record?.actualSets[0]) throw new Error();
    record.actualSets[0].actualReps = -3;
    await db.workouts.put(corrupted);

    await expect(prepareExport()).rejects.toBeInstanceOf(ExportIntegrityError);
    await expect(exportData(new Date(), download())).rejects.toThrow('vérification d’intégrité');
    expect(await getLastExportAt()).toBeNull();
  });

  it('JSON relu différent des données → refus', () => {
    const fixture = parseHistoryJson(readFixture('history-example.json'));
    if (!fixture.ok) throw new Error();
    expect(() => {
      verifyExportIntegrity(readFixture('history-example.json'), { ...fixture.value, activeProgramId: null });
    }).toThrow(ExportIntegrityError);
  });
});

describe('lastExportAt : écrit seulement si l\'export a réellement eu lieu', () => {
  beforeEach(async () => {
    await restoreText(readFixture('history-example.json'));
  });

  it('téléchargement réussi → date de l\'instantané exporté', async () => {
    const prepared = await prepareExport(new Date(2026, 9, 20, 12));
    expect(await deliverPreparedExport(prepared, download())).toBe('downloaded');
    expect(await getLastExportAt()).toBe(prepared.data.exportedAt);
  });

  it('téléchargement en échec → erreur propagée, rien d\'écrit', async () => {
    const prepared = await prepareExport();
    const failing: DeliveryEnv = {
      navigator: {},
      download: () => {
        throw new TypeError('URL.createObjectURL is not a function');
      },
    };
    await expect(deliverPreparedExport(prepared, failing)).rejects.toThrow(TypeError);
    expect(await getLastExportAt()).toBeNull();
  });

  it('partage annulé → rien d\'écrit ; share absent ou canShare qui plante → téléchargement', async () => {
    const prepared = await prepareExport();
    const abort = () => Promise.reject(new DOMException('annulé', 'AbortError'));
    expect(await deliverPreparedExport(prepared, { navigator: { canShare: () => true, share: abort }, download: vi.fn() })).toBe('cancelled');
    expect(await getLastExportAt()).toBeNull();

    const throwing = () => {
      throw new TypeError('canShare');
    };
    expect(await deliverPreparedExport(prepared, { navigator: { canShare: throwing, share: vi.fn() }, download: vi.fn() })).toBe('downloaded');
    expect(await deliverPreparedExport(prepared, { navigator: { share: undefined, canShare: undefined }, download: vi.fn() })).toBe('downloaded');
    expect(await getLastExportAt()).toBe(prepared.data.exportedAt);
  });

  it('share appelé immédiatement, sans attente préalable (geste iOS)', async () => {
    const prepared = await prepareExport();
    const share = vi.fn(() => Promise.resolve());
    const pending = deliverPreparedExport(prepared, { navigator: { canShare: () => true, share }, download: vi.fn() });
    // Appel synchrone : share est déjà invoqué avant toute attente.
    expect(share).toHaveBeenCalledOnce();
    expect(await pending).toBe('shared');
  });
});

describe('Restauration : refus en bloc des fichiers invalides, rien n\'est écrit', () => {
  const variant = (mutate: (h: Record<string, unknown>) => void) => {
    const h = fixtureObject('history-example.json');
    mutate(h);
    return JSON.stringify(h);
  };
  const sessions = (h: Record<string, unknown>) => h.sessions as Record<string, unknown>[];

  const cases: [string, string, RegExp][] = [
    [
      'plusieurs séances in_progress',
      variant((h) => {
        for (const s of sessions(h).slice(0, 2)) Object.assign(s, { status: 'in_progress', completedAt: null });
      }),
      /plusieurs séances sont en cours/,
    ],
    ['activeProgramId inconnu', variant((h) => (h.activeProgramId = 'fantome')), /programme actif « fantome »/],
    ['id de séance en double', variant((h) => ((sessions(h)[1] as Record<string, unknown>).id = 'w-0001')), /séance « w-0001 » est utilisé plusieurs fois/],
    ['id de programme en double', variant((h) => (h.programs as unknown[]).push((h.programs as unknown[])[0])), /programme « prog-demo-w37 » est utilisé plusieurs fois/],
    ['mauvais schemaVersion', variant((h) => (h.schemaVersion = '9.0')), /version de schéma « 9.0 », non prise en charge/],
    ['JSON illisible', '{ "schemaVersion": "1.0", "sessions": [', /n'est pas un JSON valide/],
    ['programme à la place d\'une sauvegarde', readFixture('program-example.json'), /ce fichier n'est pas une sauvegarde/],
  ];

  it.each(cases)('%s', async (_, text, message) => {
    await restoreText(readFixture('history-example.json'));
    const before = await dumpDatabase();
    const preview = previewRestore(text);
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.error.message).toMatch(/^Restauration impossible : /);
      expect(preview.error.message).toMatch(message);
    }
    expect(await dumpDatabase()).toEqual(before);
  });
});

describe('Restauration atomique', () => {
  it('échec sur la dernière écriture (réglages) : rien ne change, pas de copie interne', async () => {
    await restoreText(readFixture('history-example.json'));
    await db.metadata.clear();
    const before = await dumpDatabase();
    const backup = fixtureObject('history-example.json');
    backup.activeProgramId = null;
    const preview = previewRestore(JSON.stringify(backup));
    if (!preview.ok) throw new Error();

    const spy = vi.spyOn(db.settings, 'bulkPut').mockRejectedValueOnce(new Error('échec simulé'));
    await expect(restoreBackup(preview.value.data)).rejects.toThrow('échec simulé');
    spy.mockRestore();
    expect(await dumpDatabase()).toEqual(before);
  });

  it('succès : copie interne preRestoreBackup des données remplacées', async () => {
    await restoreText(readFixture('history-example.json'));
    const replaced = await prepareExport();
    const other = fixtureObject('history-example.json');
    other.sessions = [];
    await restoreText(JSON.stringify(other));
    const backup = await db.metadata.get('preRestoreBackup');
    expect(backup?.data.sessions).toEqual(replaced.data.sessions);
    expect(await db.workouts.count()).toBe(0);
  });
});

describe('Stockage persistant (détection de fonctionnalité, silencieux)', () => {
  it('API absente (contexte non sécurisé) → indisponible', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unavailable');
    expect(await requestPersistentStorage({})).toBe('unavailable');
  });

  it('déjà persistant → oui, sans nouvelle demande', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    expect(await requestPersistentStorage({ persisted: () => Promise.resolve(true), persist })).toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('accordé, refusé, ou en erreur (jamais propagée)', async () => {
    expect(await requestPersistentStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) })).toBe('granted');
    expect(await requestPersistentStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) })).toBe('denied');
    expect(await requestPersistentStorage({ persist: () => Promise.reject(new Error('refus')) })).toBe('unavailable');
  });
});
