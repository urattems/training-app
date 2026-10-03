import { describe, expect, it } from 'vitest';
import { parseHistoryJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { isCoachExportable, listCoachExportable, selectLatest, selectSinceLastExport, summarizeSelection } from './coachExport';
import type { WorkoutSession } from './types';

const history = parseHistoryJson(readFixture('history-example.json'));
if (!history.ok) throw new Error(history.error.message);
/** w-0001 (8 sept., terminée), w-0002 (15 sept., terminée), w-0003 (22 sept., abandonnée avec données). */
const sessions = history.value.sessions;
const byId = (id: string): WorkoutSession => {
  const found = sessions.find((s) => s.id === id);
  if (!found) throw new Error(id);
  return found;
};

/** Séance vide (aucune saisie), dérivée de w-0001. */
const emptyOf = (w: WorkoutSession, id: string, status: WorkoutSession['status']): WorkoutSession => ({
  ...w,
  id,
  status,
  completedAt: status === 'completed' ? w.completedAt : null,
  notes: null,
  cardioRecords: [],
  exerciseRecords: w.exerciseRecords.map((r) => ({
    ...r,
    sensation: null,
    comment: null,
    actualSets: r.actualSets.map((s) => ({ ...s, actualReps: null, actualWeightKg: null })),
  })),
});

const inProgress: WorkoutSession = { ...byId('w-0003'), id: 'w-live', status: 'in_progress', startedAt: '2026-10-02T18:00:00+02:00', date: '2026-10-02' };

describe('Séances exportables pour le coach', () => {
  it('terminées et abandonnées avec données ; jamais en cours ni vides', () => {
    expect(isCoachExportable(byId('w-0001'))).toBe(true);
    expect(isCoachExportable(byId('w-0003'))).toBe(true);
    expect(isCoachExportable(inProgress)).toBe(false);
    expect(isCoachExportable(emptyOf(byId('w-0001'), 'w-empty-a', 'abandoned'))).toBe(false);
    expect(isCoachExportable(emptyOf(byId('w-0001'), 'w-empty-c', 'completed'))).toBe(false);
  });

  it('liste de la plus récente à la plus ancienne', () => {
    const list = listCoachExportable([byId('w-0001'), inProgress, byId('w-0003'), byId('w-0002'), emptyOf(byId('w-0002'), 'w-e', 'abandoned')]);
    expect(list.map((w) => w.id)).toEqual(['w-0003', 'w-0002', 'w-0001']);
  });
});

describe('Raccourcis de sélection', () => {
  const exportable = listCoachExportable(sessions);

  it('Dernière séance, 3 dernières, 6 dernières, N dernières (borné)', () => {
    expect(selectLatest(exportable, 1)).toEqual(['w-0003']);
    expect(selectLatest(exportable, 2)).toEqual(['w-0003', 'w-0002']);
    expect(selectLatest(exportable, 3)).toEqual(['w-0003', 'w-0002', 'w-0001']);
    expect(selectLatest(exportable, 6)).toEqual(['w-0003', 'w-0002', 'w-0001']);
    expect(selectLatest(exportable, 0)).toEqual([]);
  });

  it('depuis le dernier envoi : sans envoi précédent, toutes', () => {
    expect(selectSinceLastExport(exportable, null)).toEqual(['w-0003', 'w-0002', 'w-0001']);
  });

  it('depuis le dernier envoi (date figée) : séances finies après cet instant', () => {
    // Envoi le 15 sept. à 19:00 : w-0002 s'est terminée à 19:15 → incluse ; w-0001 non.
    expect(selectSinceLastExport(exportable, '2026-09-15T19:00:00+02:00')).toEqual(['w-0003', 'w-0002']);
    // Envoi le 16 sept. : seule l'abandonnée du 22 (sans fin au contrat → son début).
    expect(selectSinceLastExport(exportable, '2026-09-16T12:00:00+02:00')).toEqual(['w-0003']);
    // Envoi après tout : rien de nouveau.
    expect(selectSinceLastExport(exportable, '2026-10-01T18:50:00+02:00')).toEqual([]);
  });

  it('résumé : nombre et dates extrêmes de la sélection', () => {
    expect(summarizeSelection(exportable, new Set(['w-0001', 'w-0003']))).toEqual({ count: 2, firstDate: '2026-09-08', lastDate: '2026-09-22' });
    expect(summarizeSelection(exportable, new Set())).toEqual({ count: 0, firstDate: null, lastDate: null });
  });
});
