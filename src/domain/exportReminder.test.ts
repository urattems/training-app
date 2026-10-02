import { describe, expect, it } from 'vitest';
import { parseHistoryJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { getExportReminder } from './exportReminder';
import type { WorkoutSession } from './types';

const workouts = (() => {
  const r = parseHistoryJson(readFixture('history-example.json'));
  if (!r.ok) throw new Error(r.error.message);
  return r.value.sessions;
})();
// Fixture : w-0001 terminée le 8 sept. 19:08, w-0002 terminée le 15 sept. 19:15, w-0003 abandonnée.

const NOW = new Date('2026-10-20T12:00:00+02:00');

/** Séance terminée à une date donnée (copie de w-0002). */
const completedAt = (iso: string): WorkoutSession => ({ ...(workouts[1] as WorkoutSession), id: `w-${iso}`, completedAt: iso });

describe('Rappel d\'export (date figée : 20 octobre 2026)', () => {
  it('jamais exporté + séances terminées → rappel', () => {
    expect(getExportReminder(workouts, null, NOW)).toEqual({ daysSinceExport: null, completedSince: 2 });
  });

  it('jamais exporté et aucune séance terminée (abandonnée seulement) → pas de rappel', () => {
    expect(getExportReminder(workouts.filter((w) => w.status === 'abandoned'), null, NOW)).toBeNull();
    expect(getExportReminder([], null, NOW)).toBeNull();
  });

  it('export de plus de 14 jours + séance terminée depuis → rappel', () => {
    expect(getExportReminder(workouts, '2026-09-10T08:00:00+02:00', NOW)).toEqual({ daysSinceExport: 40, completedSince: 1 });
  });

  it('export de plus de 14 jours mais aucune séance terminée depuis → pas de rappel', () => {
    expect(getExportReminder(workouts, '2026-09-20T08:00:00+02:00', NOW)).toBeNull();
  });

  it('seuil : 14 jours → pas de rappel ; 15 jours → rappel', () => {
    const recent = [...workouts, completedAt('2026-10-10T19:00:00+02:00')];
    expect(getExportReminder(recent, '2026-10-06T12:00:00+02:00', NOW)).toBeNull();
    expect(getExportReminder(recent, '2026-10-05T11:00:00+02:00', NOW)).toEqual({ daysSinceExport: 15, completedSince: 1 });
  });

  it('jamais pendant une séance en cours', () => {
    const inProgress: WorkoutSession = { ...(workouts[0] as WorkoutSession), id: 'live', status: 'in_progress', completedAt: null, durationSec: null };
    expect(getExportReminder([...workouts, inProgress], null, NOW)).toBeNull();
  });
});
