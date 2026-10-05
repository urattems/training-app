import { beforeEach, describe, expect, it } from 'vitest';
import { checkHistoryInvariants } from '../schemas/invariants';
import { coachExportSchema } from '../schemas/coachExport.schema';
import { workoutSessionSchema } from '../schemas/history.schema';
import { parseCoachExportJson, parseHistoryJson } from '../schemas/parse';
import { isReplaced, plannedName } from '../domain/replacement';
import { findRecord, replaceExercise, restorePlannedExercise, setActualValues } from '../domain/workout';
import { dumpDatabase, readFixture, resetDatabase } from '../test/fixtures';
import { buildSessionArchive } from './driveContent';
import { serializeCoachExport, toCoachExport, verifyCoachExportIntegrity, compactCoachExport } from './coachExportService';
import { prepareExport, readStoredData, toHistoryExport } from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { importProgram, previewProgram } from './programService';
import { getExerciseProgress, getRecentProgress, getTrackedExercises } from './statisticsService';
import { finishWorkout, getWorkout, startWorkout, updateWorkout } from './workoutService';

const CHEST = 'chest-press-machine';
const LAT = 'lat-pulldown-machine';

async function mustGet(id: string) {
  const workout = await getWorkout(id);
  if (!workout) throw new Error(`séance ${id} absente`);
  return workout;
}

async function seedProgram() {
  const preview = previewProgram(readFixture('program-example.json'));
  if (!preview.ok) throw new Error(preview.error.message);
  const imported = await importProgram(preview.value.program, new Date(2026, 9, 1, 9));
  if (!imported.ok) throw new Error(imported.error.message);
}

/** Séance terminée : Chest Press (ou son remplaçant) saisi une série. */
async function doWorkout(id: string, day: number, options: { replaceWith?: string; reps: number; kg: number }) {
  await startWorkout('A', { id, now: new Date(2026, 9, day, 18, 10) });
  await updateWorkout(id, (w) => {
    let next = w;
    if (options.replaceWith) next = replaceExercise(next, CHEST, options.replaceWith, 'Chest Press');
    return setActualValues(next, CHEST, 1, { actualReps: options.reps, actualWeightKg: options.kg });
  });
  return finishWorkout(id, new Date(2026, 9, day, 19, 20));
}

beforeEach(async () => {
  await resetDatabase();
  await seedProgram();
});

describe('Schémas et invariants §10.5 : exerciseId ≠ programExerciseId est accepté (aucun assouplissement nécessaire)', () => {
  it('le contrat de séance, la sauvegarde 1.1 et l’export coach acceptent un exercice remplacé', async () => {
    const done = await doWorkout('w-rep', 3, { replaceWith: 'Pec Deck (autre machine)', reps: 12, kg: 30 });
    const record = findRecord(done, CHEST);
    expect(record).toMatchObject({ exerciseId: 'sub-pec-deck-autre-machine', exerciseName: 'Pec Deck (autre machine)', programExerciseId: CHEST });
    expect(workoutSessionSchema.safeParse(done).success).toBe(true);

    const stored = await readStoredData();
    const history = toHistoryExport(stored, '2026-10-03T20:00:00+02:00');
    const parsed = parseHistoryJson(JSON.stringify(history), '2026-10-04');
    expect(parsed.ok).toBe(true);
    expect(checkHistoryInvariants(history, '2026-10-04')).toEqual([]);

    const coach = toCoachExport(stored, { mode: 'manual', selectedIds: ['w-rep'], weights: null }, '2026-10-03T20:00:00+02:00');
    expect(coachExportSchema.safeParse(coach).success).toBe(true);
    expect(parseCoachExportJson(serializeCoachExport(coach)).ok).toBe(true);
  });

  it('un fichier existant (fixture) reste valide, et un fichier édité à la main avec un remplacement aussi', () => {
    const fixture = JSON.parse(readFixture('history-example.json')) as { sessions: { exerciseRecords: { exerciseId: string; exerciseName: string }[] }[] };
    expect(parseHistoryJson(JSON.stringify(fixture), '2026-10-04').ok).toBe(true);
    const record = fixture.sessions[1]?.exerciseRecords[0];
    if (!record) throw new Error('fixture inattendue');
    record.exerciseId = 'sub-pec-deck';
    record.exerciseName = 'Pec Deck';
    expect(parseHistoryJson(JSON.stringify(fixture), '2026-10-04').ok).toBe(true);
  });
});

describe('Remplacement persisté, séries conservées, retrait', () => {
  it('écrit en base (revalidé par le contrat) ; séries, sensation et commentaire conservés ; retrait', async () => {
    await startWorkout('A', { id: 'w-1', now: new Date(2026, 9, 3, 18) });
    await updateWorkout('w-1', (w) => setActualValues(w, CHEST, 1, { actualReps: 12, actualWeightKg: 47.5 }));
    const before = findRecord(await mustGet('w-1'), CHEST);

    await updateWorkout('w-1', (w) => replaceExercise(w, CHEST, 'Dumbbell Press', 'Chest Press'));
    const replaced = findRecord(await mustGet('w-1'), CHEST);
    expect(isReplaced(replaced)).toBe(true);
    expect(replaced).toEqual({ ...before, exerciseId: 'sub-dumbbell-press', exerciseName: 'Dumbbell Press' });

    await updateWorkout('w-1', (w) => restorePlannedExercise(w, CHEST, 'Chest Press'));
    expect(findRecord(await mustGet('w-1'), CHEST)).toEqual(before);
  });

  it('un nom en double est refusé par le service : la séance n’est pas modifiée', async () => {
    await startWorkout('A', { id: 'w-2', now: new Date(2026, 9, 3, 18) });
    const snapshot = await getWorkout('w-2');
    await expect(updateWorkout('w-2', (w) => replaceExercise(w, CHEST, 'Tirage vertical', 'Chest Press'))).rejects.toThrow(
      '« Tirage vertical » est déjà un exercice de cette séance.',
    );
    expect(await getWorkout('w-2')).toEqual(snapshot);
  });

  it('le programme du coach n’est JAMAIS modifié', async () => {
    const before = (await dumpDatabase()).programs;
    await doWorkout('w-3', 3, { replaceWith: 'Pec Deck', reps: 12, kg: 30 });
    expect((await dumpDatabase()).programs).toEqual(before);
  });
});

describe('Progression : courbes séparées (service)', () => {
  it('le remplaçant a sa courbe ; celle de l’exercice d’origine est inchangée', async () => {
    await doWorkout('w-a', 1, { reps: 12, kg: 45 });
    const originalBefore = await getExerciseProgress(CHEST);

    await doWorkout('w-b', 8, { replaceWith: 'Pec Deck', reps: 12, kg: 30 });
    await doWorkout('w-c', 15, { replaceWith: 'pec deck', reps: 10, kg: 32.5 });
    await doWorkout('w-d', 22, { reps: 12, kg: 47.5 });

    const original = await getExerciseProgress(CHEST);
    expect(original.load.map((p) => [p.workoutId, p.maxLoadKg])).toEqual([['w-a', 45], ['w-d', 47.5]]);
    // Ce que l'exercice d'origine avait avant les remplacements est un préfixe de sa courbe.
    expect(original.load.slice(0, 1)).toEqual(originalBefore.load);

    const substitute = await getExerciseProgress('sub-pec-deck');
    expect(substitute.load.map((p) => [p.workoutId, p.maxLoadKg])).toEqual([['w-b', 30], ['w-c', 32.5]]);
    expect(substitute.stats).toMatchObject({ lastLoadKg: 32.5, bestLoadKg: 32.5, completedSessionCount: 2 });

    expect((await getTrackedExercises()).map((e) => e.programExerciseId)).toEqual([CHEST, 'sub-pec-deck']);
    expect((await getRecentProgress()).map((p) => p.programExerciseId)).toEqual([CHEST, 'sub-pec-deck']);
  });
});

describe('Aller-retour, export coach et fichier Drive avec un exercice remplacé', () => {
  it('export de sauvegarde puis restauration : octet pour octet, remplacement compris', async () => {
    await doWorkout('w-x', 3, { replaceWith: 'Pec Deck (autre machine)', reps: 12, kg: 30 });
    await doWorkout('w-y', 10, { reps: 12, kg: 47 });
    const before = (await dumpDatabase()).workouts;

    const exported = await prepareExport(new Date(2026, 9, 11, 12));
    await resetDatabase();
    const preview = previewRestore(exported.json);
    if (!preview.ok) throw new Error(preview.error.message);
    await restoreBackup(preview.value.data, new Date(2026, 9, 11, 13));

    const after = (await dumpDatabase()).workouts;
    expect(after).toEqual(before);
    const restored = await mustGet('w-x');
    expect(findRecord(restored, CHEST)).toMatchObject({ exerciseId: 'sub-pec-deck-autre-machine', exerciseName: 'Pec Deck (autre machine)', programExerciseId: CHEST });
    // Le prévu est toujours dans le snapshot et dans le programme restauré.
    expect(findRecord(restored, CHEST).targetSets).toHaveLength(3);
    expect(plannedName(findRecord(restored, CHEST), preview.value.data.programs[0]?.sessions[0]?.exercises[0]?.name)).toBe('Chest Press');
    // Et les courbes sont identiques après restauration.
    expect((await getExerciseProgress('sub-pec-deck-autre-machine')).load.map((p) => p.maxLoadKg)).toEqual([30]);
    expect((await getExerciseProgress(CHEST)).load.map((p) => p.maxLoadKg)).toEqual([47]);
  });

  it('export pour le coach : valide au schéma, autotest passé, remplacement lisible (prévu dans targetSets et programs[])', async () => {
    await doWorkout('w-x', 3, { replaceWith: 'Pec Deck', reps: 12, kg: 30 });
    const stored = await readStoredData();
    const data = toCoachExport(stored, { mode: 'manual', selectedIds: ['w-x'], weights: null }, '2026-10-03T21:00:00+02:00');
    const text = serializeCoachExport(data);
    expect(() => {
      verifyCoachExportIntegrity(text, data);
      verifyCoachExportIntegrity(compactCoachExport(data), data);
    }).not.toThrow();
    const parsed = parseCoachExportJson(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const record = parsed.value.sessions[0]?.exerciseRecords[0];
    expect(record).toMatchObject({ exerciseId: 'sub-pec-deck', exerciseName: 'Pec Deck', programExerciseId: CHEST });
    expect(record?.targetSets).toHaveLength(3);
    expect(parsed.value.programs[0]?.sessions[0]?.exercises[0]).toMatchObject({ id: CHEST, name: 'Chest Press' });
  });

  it('fichier de séance Drive : valide, avec le remplaçant (même programme intact)', async () => {
    await doWorkout('w-x', 3, { replaceWith: 'Pec Deck', reps: 12, kg: 30 });
    const archive = buildSessionArchive(await readStoredData(), 'w-x', '2026-10-03T21:00:00+02:00');
    if (!archive) throw new Error('séance non exportable');
    const parsed = parseCoachExportJson(archive.content);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.sessions[0]?.exerciseRecords[0]).toMatchObject({ exerciseId: 'sub-pec-deck', programExerciseId: CHEST });
    expect(parsed.value).toMatchObject({ schemaVersion: '1.1', weightEntries: [], weightWindow: null, selection: { mode: 'manual', sessionCount: 1 } });
    expect(parsed.value.sessions[0]?.exerciseRecords.map((r) => r.programExerciseId)).toContain(LAT);
  });
});
