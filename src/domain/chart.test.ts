import { describe, expect, it } from 'vitest';
import { parseHistoryJson } from '../schemas/parse';
import { readFixture } from '../test/fixtures';
import { buildChartSeries, dateToTime, niceStep, timeTicks, valueAxis } from './chart';
import { getExerciseLoadHistory, getExerciseRepHistory } from './stats';

const workouts = (() => {
  const r = parseHistoryJson(readFixture('history-example.json'));
  if (!r.ok) throw new Error(r.error.message);
  return r.value.sessions;
})();
const chest = getExerciseLoadHistory(workouts, 'chest-press-machine');

describe('Série du graphique', () => {
  it('axe X temporel réel : chaque point à sa date (écarts non égaux respectés)', () => {
    const { points } = buildChartSeries(chest, 'load', 'all', '2026-10-01');
    expect(points.map((p) => p.value)).toEqual([45, 47, 47.5]);
    expect(points.map((p) => p.t)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22'].map(dateToTime));
    expect((points[1]?.t ?? 0) - (points[0]?.t ?? 0)).toBe(7 * 86_400_000);
  });

  it('périodes : filtrage et domaine recalculé', () => {
    const month = buildChartSeries(chest, 'load', '1M', '2026-10-20');
    expect(month.points.map((p) => p.workoutId)).toEqual(['w-0003']);
    expect(month.domain).toEqual([dateToTime('2026-09-20'), dateToTime('2026-10-20')]);

    const quarter = buildChartSeries(chest, 'load', '3M', '2026-10-20');
    expect(quarter.points).toHaveLength(3);
    expect(quarter.domain[0]).toBe(dateToTime('2026-07-20'));

    const all = buildChartSeries(chest, 'load', 'all', '2026-10-20');
    expect(all.domain).toEqual([dateToTime('2026-09-08'), dateToTime('2026-09-22')]);
  });

  it('point unique et série vide : domaine non dégénéré', () => {
    const single = buildChartSeries(chest.slice(0, 1), 'load', 'all', '2026-10-20');
    expect(single.points).toHaveLength(1);
    expect(single.domain[1] - single.domain[0]).toBe(14 * 86_400_000);
    const empty = buildChartSeries([], 'load', 'all', '2026-10-20');
    expect(empty.points).toEqual([]);
    expect(empty.domain[0]).toBeLessThan(empty.domain[1]);
  });

  it('métrique reps (exercice sans charge)', () => {
    const reps = getExerciseRepHistory(workouts, 'lat-pulldown-machine');
    expect(buildChartSeries(reps, 'reps', 'all', '2026-10-20').points.map((p) => p.value)).toEqual([12, 12]);
  });

  it('graduations X et axe Y à pas rond (graduations régulières)', () => {
    expect(timeTicks([0, 300])).toEqual([0, 100, 200, 300]);
    expect(timeTicks([5, 5])).toEqual([5]);
    expect([niceStep(9), niceStep(30), niceStep(7.5), niceStep(0.6)]).toEqual([5, 10, 2.5, 0.2]);

    const { domain, ticks } = valueAxis(buildChartSeries(chest, 'load', 'all', '2026-10-20').points);
    expect(domain[0]).toBeLessThan(45);
    expect(domain[1]).toBeGreaterThan(47.5);
    expect(ticks[0]).toBe(domain[0]);
    expect(ticks.at(-1)).toBe(domain[1]);
    const gaps = ticks.slice(1).map((v, i) => v - (ticks[i] ?? 0));
    expect(new Set(gaps).size).toBe(1);
    expect(valueAxis([])).toEqual({ domain: [0, 1], ticks: [0, 1] });
  });
});
