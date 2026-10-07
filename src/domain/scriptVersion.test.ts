import { describe, expect, it } from 'vitest';
import { nextDueTask, type DriveOutboxState, type DriveTask } from './driveOutbox';
import { parseSyncVersion, readableSyncVersion, supportsNoteDeletion } from './scriptVersion';

describe('Version du script (pure)', () => {
  it.each([
    ['sync-2', 2],
    ['sync-3', 3],
    ['sync-10', 10],
    [' sync-3 ', 3],
    ['SYNC-3', null],
    ['sync-3.1', null],
    ['sync-', null],
    ['v3', null],
    ['3', null],
    ['', null],
    [3, null],
    [null, null],
    [undefined, null],
  ])('parseSyncVersion(%j) → %j', (value, expected) => {
    expect(parseSyncVersion(value)).toBe(expected);
  });

  it('comparaison NUMÉRIQUE : sync-10 > sync-3 ; sync-2 et format inconnu = non supporté', () => {
    expect(supportsNoteDeletion('sync-3')).toBe(true);
    expect(supportsNoteDeletion('sync-10')).toBe(true); // pas une comparaison de texte (« sync-10 » < « sync-3 »)
    expect(supportsNoteDeletion('sync-2')).toBe(false);
    expect(supportsNoteDeletion(null)).toBe(false);
    expect(supportsNoteDeletion('sync-trois')).toBe(false);
  });

  it('version mémorisée : la chaîne si lisible, sinon inconnue (null)', () => {
    expect(readableSyncVersion('sync-3')).toBe('sync-3');
    expect(readableSyncVersion(' sync-4 ')).toBe('sync-4');
    expect(readableSyncVersion('?')).toBeNull();
    expect(readableSyncVersion(undefined)).toBeNull();
  });
});

describe('File : la sauvegarde attend la suppression de mensuration non confirmée', () => {
  const NOW = Date.parse('2026-10-06T10:00:00+02:00');
  const task = (id: string, status: DriveTask['status'] = 'pending', nextAttemptAt: string | null = '2026-10-06T07:59:00Z'): DriveTask => {
    const [type, key] = id.split(':') as [DriveTask['type'], string];
    return { id, type, key, revision: 1, createdAt: '2026-10-06T07:00:00Z', updatedAt: '2026-10-06T07:00:00Z', attempts: 0, nextAttemptAt, status, lastAttemptAt: null, lastError: null };
  };
  const state = (tasks: DriveTask[]): DriveOutboxState => ({ tasks, lastConfirmedAt: null });

  it('ordre : la suppression passe AVANT la sauvegarde', () => {
    expect(nextDueTask(state([task('backup_latest:latest'), task('measurement_deleted:2026-10-01')]), NOW, 'all')?.id).toBe('measurement_deleted:2026-10-01');
  });

  it('suppression en attente de nouvel essai : backup_latest n’est PAS due, backup_weekly oui', () => {
    const retrying = task('measurement_deleted:2026-10-01', 'pending', '2026-10-06T09:00:00Z'); // plus tard
    expect(nextDueTask(state([retrying, task('backup_latest:latest')]), NOW, 'timer')).toBeNull();
    expect(nextDueTask(state([retrying, task('backup_latest:latest'), task('backup_weekly:weekly')]), NOW, 'timer')?.id).toBe('backup_weekly:weekly');
  });

  it('suppression en erreur : la sauvegarde attend aussi (jusqu’à « Réessayer » ou « Ignorer »)', () => {
    expect(nextDueTask(state([task('measurement_deleted:2026-10-01', 'error', null), task('backup_latest:latest')]), NOW, 'all')).toBeNull();
    expect(nextDueTask(state([task('backup_latest:latest')]), NOW, 'all')?.id).toBe('backup_latest:latest');
  });
});
