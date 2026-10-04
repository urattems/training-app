import { describe, expect, it } from 'vitest';
import { getExportReminder } from './exportReminder';
import type { WeightEntry } from './types';
import {
  buildWeightSeries,
  getWeightHistory,
  parseWeightInput,
  previousWeight,
  validateWeightDate,
  MIN_WEIGHT_SPAN_KG,
  weightAxis,
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

});

/** Toutes les règles d'échelle du poids (V1.2c), vérifiées sur un axe donné. */
function expectWeightAxisRules(values: number[]) {
  const { domain, ticks } = weightAxis(values);
  const [low, high] = domain;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = high - low;
  // Amplitude visible ≥ max(10 kg, 1,25 × amplitude des données).
  expect(span).toBeGreaterThanOrEqual(Math.max(MIN_WEIGHT_SPAN_KG, (max - min) * 1.25));
  // Bornes au kg entier.
  expect(Number.isInteger(low) && Number.isInteger(high)).toBe(true);
  // Jamais sous 0 kg ; sinon centrée sur le milieu des données (à l'arrondi au kg près).
  expect(low).toBeGreaterThanOrEqual(0);
  if (low > 0) expect(Math.abs((low + high) / 2 - (min + max) / 2)).toBeLessThanOrEqual(1);
  // Jamais de point collé au bord : marge ≥ 10 % de l'amplitude de chaque côté.
  expect(min - low).toBeGreaterThanOrEqual(0.1 * span);
  expect(high - max).toBeGreaterThanOrEqual(0.1 * span);
  // Graduations propres : 4 à 6 lignes, pas constant de 1, 2, 5, 10… kg, à l'intérieur du domaine.
  expect(ticks.length).toBeGreaterThanOrEqual(4);
  expect(ticks.length).toBeLessThanOrEqual(6);
  const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
  expect([1, 2, 5, 10, 20, 50, 100]).toContain(step);
  ticks.forEach((t, i) => {
    expect(Math.abs(t % step)).toBe(0);
    if (i > 0) expect(t - (ticks[i - 1] ?? 0)).toBe(step);
  });
  expect(ticks[0]).toBeGreaterThanOrEqual(low);
  expect(ticks.at(-1)).toBeLessThanOrEqual(high);
  return { domain, ticks };
}

describe('Échelle du graphique de poids (V1.2c)', () => {
  it('une pesée seule : 10 kg centrés sur elle', () => {
    expect(expectWeightAxisRules([80.6])).toEqual({ domain: [75, 86], ticks: [76, 78, 80, 82, 84, 86] });
  });

  it('toutes les pesées identiques : 10 kg centrés', () => {
    expect(expectWeightAxisRules([80, 80, 80])).toEqual({ domain: [75, 85], ticks: [76, 78, 80, 82, 84] });
  });

  it('amplitude de 3 kg : le plancher de 10 kg s’applique (une variation n’envahit pas la hauteur)', () => {
    expect(expectWeightAxisRules([79, 80.4, 82])).toEqual({ domain: [75, 86], ticks: [76, 78, 80, 82, 84, 86] });
  });

  it('amplitude de 8 kg : 10 kg, marge de 1 kg de chaque côté', () => {
    expect(expectWeightAxisRules([76, 79.5, 84])).toEqual({ domain: [75, 85], ticks: [76, 78, 80, 82, 84] });
  });

  it('amplitude de 20 kg : 1,25 × 20 = 25 kg (arrondi à 26), pas de 5 kg', () => {
    expect(expectWeightAxisRules([70, 81, 90])).toEqual({ domain: [67, 93], ticks: [70, 75, 80, 85, 90] });
  });

  it('plusieurs périodes de la même histoire : règles respectées, la période change l’axe', () => {
    const axisFor = (period: Parameters<typeof buildWeightSeries>[1]) =>
      expectWeightAxisRules(buildWeightSeries(HISTORY, period, TODAY).points.map((p) => p.value));
    expect(axisFor('1M')).toEqual({ domain: [75, 86], ticks: [76, 78, 80, 82, 84, 86] }); // 81,2 et 80,6
    expect(axisFor('3M')).toEqual({ domain: [77, 88], ticks: [78, 80, 82, 84, 86, 88] }); // 80,6 → 84,5
    expect(axisFor('all')).toEqual({ domain: [78, 89], ticks: [78, 80, 82, 84, 86, 88] }); // 80,6 → 86
  });

  it('balayage : les règles tiennent pour des amplitudes de 0 à 120 kg et tous les centres', () => {
    for (let spread = 0; spread <= 120; spread += 0.7) {
      for (const base of [18.3, 45, 79.95, 151.2]) expectWeightAxisRules([base, base + spread / 3, base + spread]);
    }
  });

  it('jamais sous 0 kg : cas extrême (18 → 126 kg dans la période), fenêtre décalée vers le haut', () => {
    const { domain } = expectWeightAxisRules([18.3, 126.1]);
    expect(domain[0]).toBe(0);
  });

  it('constante nommée : amplitude minimale de 10 kg', () => {
    expect(MIN_WEIGHT_SPAN_KG).toBe(10);
  });
});
