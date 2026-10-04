import { describe, expect, it } from 'vitest';
import { valueAxis } from './chart';
import { getExportReminder } from './exportReminder';
import type { WeightEntry } from './types';
import {
  buildWeightSeries,
  getWeightHistory,
  parseWeightInput,
  previousWeight,
  validateWeightDate,
  WEIGHT_AXIS,
  weightDelta,
  weightSanity,
  weightStats,
  weightsLostByRestore,
  weightsRecordedSince,
} from './weight';

const entry = (date: string, weightKg: number, recordedAt = `${date}T07:00:00+02:00`): WeightEntry => ({ date, weightKg, recordedAt });

/** Historique sur plus d'un an, dans le désordre (le domaine trie). */
const HISTORY: WeightEntry[] = [
  entry('2026-10-01', 80.6),
  entry('2025-08-15', 86),
  entry('2026-09-02', 82.4),
  entry('2026-06-10', 83.1),
  entry('2026-09-22', 81.2),
  entry('2026-07-20', 84.5),
];
const TODAY = '2026-10-03';

describe('Saisie d’une pesée — 10 cas de validation', () => {
  it.each([
    ['78,4', { ok: true, value: 78.4 }],
    ['78.45', { ok: true, value: 78.45 }],
    ['  79 ', { ok: true, value: 79 }],
    ['78,456', { ok: false, error: 'too_precise' }],
    ['0', { ok: false, error: 'not_positive' }],
    ['0,00', { ok: false, error: 'not_positive' }],
    ['', { ok: false, error: 'empty' }],
    ['-3', { ok: false, error: 'invalid' }],
    ['78,4 kg', { ok: false, error: 'invalid' }],
    ['1e2', { ok: false, error: 'invalid' }],
  ])('« %s »', (input, expected) => {
    expect(parseWeightInput(input)).toEqual(expected);
  });

  it('jamais d’arrondi silencieux : 3 décimales refusées même si elles « tombent juste »', () => {
    expect(parseWeightInput('80,105')).toEqual({ ok: false, error: 'too_precise' });
    expect(parseWeightInput('80,10')).toEqual({ ok: true, value: 80.1 });
  });

  it('date : réelle, jamais dans le futur (comparée à la date locale du jour)', () => {
    expect(validateWeightDate('2026-10-03', TODAY)).toBeNull();
    expect(validateWeightDate('2024-02-29', TODAY)).toBeNull();
    expect(validateWeightDate('2026-10-04', TODAY)).toBe('future');
    expect(validateWeightDate('2026-02-30', TODAY)).toBe('invalid');
    expect(validateWeightDate('03/10/2026', TODAY)).toBe('invalid');
  });
});

describe('Avertissements doux (jamais bloquants)', () => {
  it('écart de plus de 5 kg avec la pesée précédente', () => {
    expect(weightSanity(86, { weightKg: 80.6 })).toEqual(['big_change']);
    expect(weightSanity(75.5, { weightKg: 80.6 })).toEqual(['big_change']);
    expect(weightSanity(85.6, { weightKg: 80.6 })).toEqual([]);
    expect(weightSanity(80, null)).toEqual([]);
  });

  it('valeur hors de [20, 300] kg', () => {
    expect(weightSanity(19.9, null)).toEqual(['below_range']);
    expect(weightSanity(20, null)).toEqual([]);
    expect(weightSanity(300, null)).toEqual([]);
    expect(weightSanity(300.5, { weightKg: 299 })).toEqual(['above_range']);
    expect(weightSanity(8, { weightKg: 80 })).toEqual(['big_change', 'below_range']);
  });
});

describe('Historique, périodes et statistiques', () => {
  it('périodes 1M, 3M, 6M, 1A, Tout : pesées de la période, par date croissante', () => {
    const dates = (p: Parameters<typeof getWeightHistory>[1]) => getWeightHistory(HISTORY, p, TODAY).map((e) => e.date);
    expect(dates('1M')).toEqual(['2026-09-22', '2026-10-01']);
    expect(dates('3M')).toEqual(['2026-07-20', '2026-09-02', '2026-09-22', '2026-10-01']);
    expect(dates('6M')).toEqual(['2026-06-10', '2026-07-20', '2026-09-02', '2026-09-22', '2026-10-01']);
    expect(dates('1A')).toEqual(dates('6M'));
    expect(dates('all')).toEqual(['2025-08-15', '2026-06-10', '2026-07-20', '2026-09-02', '2026-09-22', '2026-10-01']);
  });

  it('stats : dernier poids et son écart, min, max, variation sur la période', () => {
    expect(weightStats(HISTORY, '3M', TODAY)).toEqual({
      last: { date: '2026-10-01', weightKg: 80.6, delta: -0.6 },
      min: { date: '2026-10-01', weightKg: 80.6 },
      max: { date: '2026-07-20', weightKg: 84.5 },
      change: -3.9,
      count: 4,
      firstDate: '2026-07-20',
      lastDate: '2026-10-01',
    });
  });

  it('écart avec la pesée précédente de TOUT l’historique, même hors période', () => {
    // 1M ne contient que le 22/09 et le 01/10, mais l'écart du 22/09 se calcule avec le 02/09.
    expect(weightDelta(HISTORY, '2026-09-22')).toBe(-1.2);
    expect(previousWeight(HISTORY, '2026-06-10')?.date).toBe('2025-08-15');
    expect(weightDelta(HISTORY, '2025-08-15')).toBeNull();
  });

  it('un seul point : pas de variation ; aucune pesée : tout est vide', () => {
    expect(weightStats([entry('2026-10-01', 80.6)], '1M', TODAY)).toMatchObject({ change: null, count: 1, last: { delta: null } });
    expect(weightStats([], 'all', TODAY)).toEqual({ last: null, min: null, max: null, change: null, count: 0, firstDate: null, lastDate: null });
  });

  it('période sans pesée récente : dernier poids conservé, extrêmes vides', () => {
    expect(weightStats([entry('2026-01-10', 85)], '1M', TODAY)).toMatchObject({ last: { weightKg: 85 }, min: null, max: null, count: 0 });
  });
});

describe('Sauvegarde et restauration', () => {
  it('rappel d’export : une pesée enregistrée après le dernier export compte comme non sauvegardée', () => {
    const now = new Date('2026-10-20T12:00:00+02:00');
    const recent = [entry('2026-10-19', 80, '2026-10-19T07:00:00+02:00')];
    expect(weightsRecordedSince(recent, '2026-10-01T10:00:00+02:00')).toBe(1);
    expect(getExportReminder([], '2026-10-01T10:00:00+02:00', now, recent)).toEqual({ daysSinceExport: 19, completedSince: 0 });
    expect(getExportReminder([], null, now, recent)).toEqual({ daysSinceExport: null, completedSince: 0 });
    // Pesée antérieure à l'export : rien de nouveau ; une correction postérieure (recordedAt) compte.
    expect(getExportReminder([], '2026-10-01T10:00:00+02:00', now, [entry('2026-09-30', 80, '2026-09-30T07:00:00+02:00')])).toBeNull();
    expect(getExportReminder([], '2026-10-01T10:00:00+02:00', now, [entry('2026-09-30', 80, '2026-10-02T09:00:00+02:00')])).not.toBeNull();
  });

  it('avertissement : fichier sans pesée alors que l’app en contient', () => {
    expect(weightsLostByRestore(0, 12)).toBe(12);
    expect(weightsLostByRestore(0, 0)).toBeNull();
    expect(weightsLostByRestore(3, 12)).toBeNull();
  });
});

describe('Graphique du poids', () => {
  it('série : un point par pesée (identifiant = date), axe des dates réel, période', () => {
    const series = buildWeightSeries(HISTORY, '3M', TODAY);
    expect(series.points.map((p) => [p.date, p.value, p.workoutId])).toEqual([
      ['2026-07-20', 84.5, '2026-07-20'],
      ['2026-09-02', 82.4, '2026-09-02'],
      ['2026-09-22', 81.2, '2026-09-22'],
      ['2026-10-01', 80.6, '2026-10-01'],
    ]);
    expect(series.domain).toEqual([Date.UTC(2026, 6, 3, 12), Date.UTC(2026, 9, 3, 12)]);
  });

  it('ordonnée AJUSTÉE à la plage (jamais depuis zéro), contrairement à la progression', () => {
    const points = buildWeightSeries(HISTORY, '1M', TODAY).points; // 81,2 et 80,6 kg
    const weight = valueAxis(points, WEIGHT_AXIS);
    expect(weight.domain[0]).toBeGreaterThanOrEqual(79);
    expect(weight.domain[1]).toBeLessThanOrEqual(82.5);
    expect(weight.ticks.length).toBeGreaterThanOrEqual(3);
    // Réglage par défaut (progression) : marge de 5 % de la valeur, axe beaucoup plus large.
    expect(valueAxis(points).domain[1] - valueAxis(points).domain[0]).toBeGreaterThan(weight.domain[1] - weight.domain[0]);
  });
});
