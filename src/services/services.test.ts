import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { DomainError } from '../domain/errors';
import { setActualValues, setSensation, validateExercise } from '../domain/workout';
import { parseHistoryJson } from '../schemas/parse';
import { dumpDatabase, fixtureObject, readFixture, resetDatabase } from '../test/fixtures';
import { buildHistoryExport, deliverFile, exportData, exportFileName, serializeExport } from './exportService';
import { deleteWorkout, listWorkouts } from './historyService';
import { previewRestore, readFileText, restoreBackup } from './importService';
import { getActiveProgram, importProgram, listPrograms, previewProgram } from './programService';
import { getActiveProgramId, getLastExportAt } from './settingsService';
import { getExerciseProgress } from './statisticsService';
import {
  abandonWorkout,
  finishWorkout,
  getInProgressWorkout,
  getNextSessionForActiveProgram,
  getWorkout,
  startWorkout,
  updateWorkout,
} from './workoutService';

const NOW = new Date(2026, 9, 1, 18, 0, 0);

async function importFixtureProgram(text = readFixture('program-example.json')) {
  const preview = previewProgram(text);
  if (!preview.ok) throw new Error(preview.error.message);
  const imported = await importProgram(preview.value.program, NOW);
  if (!imported.ok) throw new Error(imported.error.message);
  return imported.value;
}

/** Programme v2 : même exercice `chest-press-machine`, nouveaux objectifs, nouvel id. */
const nextWeekProgramText = (): string => {
  const program = fixtureObject('program-example.json') as { programId: string; sessions: { exercises: { sets: { targetWeightKg: number | null }[] }[] }[] };
  program.programId = 'prog-2026-w41';
  for (const set of program.sessions[0]?.exercises[0]?.sets ?? []) set.targetWeightKg = 60;
  return JSON.stringify(program);
};

const historyFixture = () => {
  const parsed = parseHistoryJson(readFixture('history-example.json'));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

beforeEach(resetDatabase);

describe('Import de programme', () => {
  it('prévisualise puis importe examples/program-example.json : il devient actif', async () => {
    const preview = previewProgram(readFixture('program-example.json'));
    expect(preview.ok && { name: preview.value.name, week: preview.value.weekLabel, s: preview.value.sessionCount, e: preview.value.exerciseCount }).toEqual({
      name: 'Programme semaine 40',
      week: 'Semaine 40',
      s: 3,
      e: 9,
    });
    await importFixtureProgram();
    expect(await getActiveProgramId()).toBe('prog-2026-w40');
    expect((await getActiveProgram())?.archivedAt).toBeNull();
  });

  it('un nouvel import devient actif, l\'ancien est archivé et conservé', async () => {
    await importFixtureProgram();
    await importFixtureProgram(nextWeekProgramText());
    expect(await getActiveProgramId()).toBe('prog-2026-w41');
    const programs = await listPrograms();
    expect(programs).toHaveLength(2);
    expect(programs.find((p) => p.programId === 'prog-2026-w40')?.archivedAt).not.toBeNull();
  });

  it('refuse un programId déjà présent, sans rien modifier', async () => {
    await importFixtureProgram();
    const before = await dumpDatabase();
    const preview = previewProgram(readFixture('program-example.json'));
    if (!preview.ok) throw new Error();
    const result = await importProgram(preview.value.program, new Date(2026, 9, 2));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('duplicate_program');
      expect(result.error.message).toBe(
        'Import impossible : un programme avec l\'identifiant « prog-2026-w40 » existe déjà. Demande au coach un nouvel identifiant.',
      );
    }
    expect(await dumpDatabase()).toEqual(before);
  });

  it('un JSON invalide est refusé : rien n\'est écrit', async () => {
    expect(previewProgram('{ pas du json').ok).toBe(false);
    expect(previewProgram(JSON.stringify({ ...fixtureObject('program-example.json'), sessions: [] })).ok).toBe(false);
    expect(await dumpDatabase()).toEqual({ programs: [], workouts: [], settings: [], metadata: [] });
  });

  it('lit un fichier, ou signale un fichier illisible', async () => {
    expect(await readFileText(new Blob(['{"a":1}']), 'program')).toEqual({ ok: true, value: '{"a":1}' });
    const broken = { text: () => Promise.reject(new Error('io')) } as unknown as Blob;
    const result = await readFileText(broken, 'program');
    expect(!result.ok && result.error.kind).toBe('unreadable_file');
  });
});

describe('Séance : démarrage, unicité in_progress, reprise, abandon', () => {
  it('une seule séance in_progress à la fois', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await expect(startWorkout('B', { now: NOW, id: 'w-2' })).rejects.toThrow(DomainError);
    await expect(startWorkout('A', { now: NOW, id: 'w-3' })).rejects.toThrow(
      'Une séance est déjà en cours : reprends-la ou abandonne-la avant d’en commencer une autre.',
    );
    expect(await db.workouts.where('status').equals('in_progress').count()).toBe(1);
    expect(await db.workouts.count()).toBe(1);

    await abandonWorkout('w-1');
    await startWorkout('B', { now: NOW, id: 'w-4' });
    expect((await getInProgressWorkout())?.id).toBe('w-4');
  });

  it('une séance terminée ou abandonnée ne peut pas repasser in_progress', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await finishWorkout('w-1', new Date(2026, 9, 1, 19));
    await expect(updateWorkout('w-1', (w) => ({ ...w, status: 'in_progress', completedAt: null }))).rejects.toThrow(DomainError);
  });

  it('refuse de démarrer sans programme actif', async () => {
    await expect(startWorkout('A')).rejects.toThrow('Aucun programme actif');
  });

  it('scénarios 2 et 3 : saisie persistée, fermer/rouvrir, reprendre', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 }));
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 2, { actualReps: 11, actualWeightKg: 47 }));
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 3, { actualReps: 9, actualWeightKg: 49 }));
    const saved = await updateWorkout('w-1', (w) => validateExercise(setSensation(w, 'chest-press-machine', 'hard'), 'chest-press-machine'));

    // « Refresh » : fermeture et réouverture de la base.
    db.close();
    await db.open();
    const resumed = await getInProgressWorkout();
    expect(resumed).toEqual(saved);
    expect(resumed?.exerciseRecords[0]?.actualSets).toHaveLength(3);
  });

  it('abandon : données conservées et visibles dans l\'historique', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 }));
    await abandonWorkout('w-1');
    const [workout] = await listWorkouts();
    expect(workout?.status).toBe('abandoned');
    expect(workout?.exerciseRecords[0]?.actualSets).toEqual([{ setNumber: 1, actualReps: 12, actualWeightKg: 47, isExtra: false }]);
  });

  it('rotation via le service et suppression explicite d\'une séance', async () => {
    await importFixtureProgram();
    expect((await getNextSessionForActiveProgram())?.id).toBe('A');
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await finishWorkout('w-1', new Date(2026, 9, 1, 19));
    expect((await getNextSessionForActiveProgram())?.id).toBe('B');
    await deleteWorkout('w-1');
    expect(await getWorkout('w-1')).toBeNull();
  });
});

describe('Snapshot conservé après un nouvel import', () => {
  it('les objectifs d\'une séance passée ne suivent pas le nouveau programme', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await finishWorkout('w-1', new Date(2026, 9, 1, 19));
    const before = await getWorkout('w-1');

    await importFixtureProgram(nextWeekProgramText());
    expect((await getActiveProgram())?.sessions[0]?.exercises[0]?.sets[0]?.targetWeightKg).toBe(60);

    const after = await getWorkout('w-1');
    expect(after).toEqual(before);
    expect(after?.exerciseRecords[0]?.targetSets.map((s) => s.targetWeightKg)).toEqual([47, 47, 49]);
    expect(after?.programId).toBe('prog-2026-w40');
  });
});

describe('Scénario 4 : exercice 3 avant le 1', () => {
  it('ordre réel stocké, statistiques correctes', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await updateWorkout('w-1', (w) => setActualValues(w, 'lateral-raise-dumbbell', 1, { actualReps: 15, actualWeightKg: 8 }));
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47 }));
    await finishWorkout('w-1', new Date(2026, 9, 1, 19));
    expect((await getWorkout('w-1'))?.executionOrder).toEqual(['lateral-raise-dumbbell', 'chest-press-machine']);
    const progress = await getExerciseProgress('lateral-raise-dumbbell');
    expect(progress.load.map((p) => p.maxLoadKg)).toEqual([8]);
    expect(progress.stats.completedSessionCount).toBe(1);
  });
});

describe('Export → restauration (aller-retour sans perte)', () => {
  it('restaure history-example.json puis l\'exporte à l\'identique', async () => {
    const fixture = historyFixture();
    await restoreBackup(fixture, NOW);
    const exported = await buildHistoryExport(new Date(2026, 9, 2, 8));
    expect({ ...exported, exportedAt: fixture.exportedAt }).toEqual(fixture);
    // Le JSON sérialisé est relu et validé tel quel.
    const reparsed = parseHistoryJson(serializeExport(exported));
    expect(reparsed.ok && { ...reparsed.value, exportedAt: fixture.exportedAt }).toEqual(fixture);
  });

  it('aller-retour depuis des données saisies dans l\'app', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 12, actualWeightKg: 47.5 }));
    await finishWorkout('w-1', new Date(2026, 9, 1, 19));
    await importFixtureProgram(nextWeekProgramText());
    await startWorkout('A', { now: new Date(2026, 9, 8, 18), id: 'w-2' });

    const exported = await buildHistoryExport(NOW);
    const preview = previewRestore(serializeExport(exported));
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value).toMatchObject({ programCount: 2, sessionCount: 2, schemaVersion: '1.1' });

    await resetDatabase();
    await restoreBackup(preview.value.data, new Date(2026, 9, 9));
    expect(await buildHistoryExport(NOW)).toEqual(exported);
    expect(await getActiveProgramId()).toBe('prog-2026-w41');
    expect((await getInProgressWorkout())?.id).toBe('w-2');
  });

  it('conserve une copie interne des données remplacées (preRestoreBackup)', async () => {
    await importFixtureProgram();
    const previous = await buildHistoryExport(NOW);
    await restoreBackup(historyFixture(), NOW);
    const backup = await db.metadata.get('preRestoreBackup');
    expect(backup?.data).toEqual(previous);
    expect(await getActiveProgramId()).toBe('prog-demo-w37');
  });

  it('restauration atomique : un échec en cours de transaction ne modifie rien', async () => {
    await importFixtureProgram();
    await startWorkout('A', { now: NOW, id: 'w-1' });
    await updateWorkout('w-1', (w) => setActualValues(w, 'chest-press-machine', 1, { actualReps: 10, actualWeightKg: 47 }));
    const before = await dumpDatabase();

    // Échec simulé APRÈS le clear et l'écriture de preRestoreBackup.
    const spy = vi.spyOn(db.workouts, 'bulkPut').mockRejectedValueOnce(new Error('échec disque simulé'));
    await expect(restoreBackup(historyFixture(), NOW)).rejects.toThrow('échec disque simulé');
    spy.mockRestore();

    expect(await dumpDatabase()).toEqual(before);
    expect(await db.metadata.get('preRestoreBackup')).toBeUndefined();
  });

  it('une sauvegarde invalide est refusée avant toute écriture', async () => {
    await importFixtureProgram();
    const before = await dumpDatabase();
    const broken = { ...fixtureObject('history-example.json'), activeProgramId: 'absent' };
    const preview = previewRestore(JSON.stringify(broken));
    expect(!preview.ok && preview.error.kind).toBe('invariant');
    expect(await dumpDatabase()).toEqual(before);
  });
});

describe('Remise du fichier d\'export', () => {
  const file = () => new File(['{}'], exportFileName(NOW), { type: 'application/json' });

  it('nom de fichier training-backup-YYYY-MM-DD.json', () => {
    expect(exportFileName(NOW)).toBe('training-backup-2026-10-01.json');
  });

  it('Web Share en priorité', async () => {
    const share = vi.fn(() => Promise.resolve());
    const download = vi.fn();
    expect(await deliverFile(file(), { navigator: { canShare: () => true, share }, download })).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });

  it('téléchargement si Web Share absent, refusé ou en échec ; annulation respectée', async () => {
    const download = vi.fn();
    expect(await deliverFile(file(), { navigator: {}, download })).toBe('downloaded');
    expect(await deliverFile(file(), { navigator: { canShare: () => false, share: vi.fn() }, download })).toBe('downloaded');
    const failing = { canShare: () => true, share: () => Promise.reject(new DOMException('geste expiré', 'NotAllowedError')) };
    expect(await deliverFile(file(), { navigator: failing, download })).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(3);
    const cancelled = { canShare: () => true, share: () => Promise.reject(new DOMException('annulé', 'AbortError')) };
    expect(await deliverFile(file(), { navigator: cancelled, download })).toBe('cancelled');
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('mémorise la date du dernier export, sauf annulation', async () => {
    await importFixtureProgram();
    const cancelled = { canShare: () => true, share: () => Promise.reject(new DOMException('annulé', 'AbortError')) };
    await exportData(NOW, { navigator: cancelled, download: vi.fn() });
    expect(await getLastExportAt()).toBeNull();
    await exportData(NOW, { navigator: {}, download: vi.fn() });
    expect(await getLastExportAt()).toMatch(/^2026-10-01T18:00:00/);
  });
});
