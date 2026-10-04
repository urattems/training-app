/**
 * Données du graphique de progression (SPEC §7.8), fonctions pures.
 * Axe X en vraie échelle temporelle : chaque point est placé à sa date (timestamp),
 * jamais à intervalles égaux.
 */
import { filterByPeriod, periodStart, type LoadPoint, type Period, type RepPoint } from './stats';

export type ChartMetric = 'load' | 'reps';

export interface ChartPoint {
  /** Timestamp UTC de la date métier (midi, pour éviter les effets de fuseau). */
  t: number;
  value: number;
  /** Identifiant du point : la séance (progression) ou la date de la pesée (poids). */
  workoutId: string;
  date: string;
}

export interface ChartSeries {
  points: ChartPoint[];
  /** Domaine temporel de l'axe X [début, fin]. */
  domain: [number, number];
  ticks: number[];
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → timestamp UTC à midi. */
export function dateToTime(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 12);
}

/**
 * Série affichée pour une période : points filtrés, domaine recalculé.
 * Période bornée → domaine [début de période, aujourd'hui] ; « Tout » → [premier, dernier point]
 * (avec une marge d'une semaine autour d'un point unique).
 */
export function buildChartSeries(
  source: readonly (LoadPoint | RepPoint)[],
  metric: ChartMetric,
  period: Period,
  today: string,
): ChartSeries {
  const filtered = filterByPeriod(source, period, today);
  const points = filtered.map(
    (p): ChartPoint => ({
      t: dateToTime(p.date),
      value: metric === 'load' ? (p as LoadPoint).maxLoadKg : (p as RepPoint).maxReps,
      workoutId: p.workoutId,
      date: p.date,
    }),
  );
  return seriesForPeriod(points, period, today);
}

/**
 * Domaine temporel d'une série déjà filtrée sur la période (commun à la progression et
 * au poids) : période bornée → [début, aujourd'hui] ; « Tout » → [premier, dernier point].
 */
export function seriesForPeriod(points: ChartPoint[], period: Period, today: string): ChartSeries {
  const start = periodStart(period, today);
  let domain: [number, number];
  if (start !== null) {
    domain = [dateToTime(start), dateToTime(today)];
  } else if (points.length > 0) {
    const first = points[0]?.t ?? 0;
    const last = points[points.length - 1]?.t ?? 0;
    domain = first === last ? [first - 7 * DAY_MS, last + 7 * DAY_MS] : [first, last];
  } else {
    domain = [dateToTime(today) - 30 * DAY_MS, dateToTime(today)];
  }
  return { points, domain, ticks: timeTicks(domain) };
}

/** 4 graduations régulières sur le domaine temporel (lisibles sur 390 px). */
export function timeTicks([start, end]: [number, number], count = 4): number[] {
  if (end <= start) return [start];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(start + i * step));
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** Pas « rond » (1, 2, 2,5, 5 × 10^n) donnant environ `count` intervalles sur `span`. */
export function niceStep(span: number, count = 3): number {
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = NICE_STEPS.find((s) => s >= normalized) ?? 10;
  return step * magnitude;
}

/**
 * Axe Y : domaine aligné sur un pas rond, graduations régulières, jamais négatif.
 * Une marge entoure les valeurs pour que les points ne touchent pas les bords.
 */
/** Axe Y d'un graphique : domaine [bas, haut] et graduations. */
export interface ValueAxis {
  domain: [number, number];
  ticks: number[];
}

export function valueAxis(points: readonly ChartPoint[]): ValueAxis {
  if (points.length === 0) return { domain: [0, 1], ticks: [0, 1] };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const margin = Math.max((max - min) * 0.15, max * 0.05, 1);
  const step = niceStep(max - min + 2 * margin);
  const low = Math.max(0, Math.floor((min - margin) / step) * step);
  const high = Math.ceil((max + margin) / step) * step;
  const ticks: number[] = [];
  for (let v = low; v <= high + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { domain: [low, high], ticks };
}
