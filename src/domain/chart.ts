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

// --- Axe à amplitude minimale (poids, mensurations) ------------------------------------

/** L'amplitude visible vaut au moins 1,25 × celle des données : ≥ 10 % de marge de chaque côté. */
const SPAN_FACTOR = 1.25;
/** Marge minimale entre les données et chaque bord, en part de l'amplitude affichée. */
const MIN_EDGE_MARGIN = 0.1;
/** Pas de graduation « propres », dans l'unité des valeurs (kg, cm). */
const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100] as const;
const MIN_TICKS = 4;
const MAX_TICKS = 6;

const ticksInside = (low: number, high: number, step: number): number[] => {
  const ticks: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(v);
  return ticks;
};

/**
 * Axe Y à amplitude minimale, NON ancré à zéro (règle V1.2c du poids, généralisée en V1.6.0 pour
 * les mensurations), fonction pure :
 * - amplitude visible = max(minSpan, amplitude des données × 1,25) ;
 * - centrée sur le milieu des données, bornes arrondies à l'unité entière vers l'EXTÉRIEUR
 *   (la marge ≥ 10 % n'est jamais réduite) ;
 * - marge ≥ 10 % de l'amplitude affichée de chaque côté (vérifiée APRÈS l'arrondi) ;
 * - graduations : multiples d'un pas propre (1, 2, 5, 10…), 4 à 6 lignes.
 * Si la marge ou les graduations ne conviennent pas, l'axe est élargi d'une unité de chaque côté
 * (il reste centré) jusqu'à ce que tout convienne.
 * Jamais sous 0 : dans ce seul cas extrême, la fenêtre est décalée vers le haut, à amplitude
 * égale, au lieu d'être centrée.
 */
export function paddedValueAxis(values: readonly number[], minSpan: number): ValueAxis {
  if (values.length === 0) return paddedValueAxis([minSpan / 2], minSpan);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const middle = (min + max) / 2;
  const span = Math.max(minSpan, (max - min) * SPAN_FACTOR);
  let low = Math.floor(middle - span / 2);
  let high = Math.ceil(middle + span / 2);
  const notBelowZero = () => {
    if (low < 0) {
      high -= low;
      low = 0;
    }
  };
  notBelowZero();
  for (;;) {
    const margin = MIN_EDGE_MARGIN * (high - low);
    if (min - low >= margin && high - max >= margin) {
      for (const step of TICK_STEPS) {
        const ticks = ticksInside(low, high, step);
        if (ticks.length >= MIN_TICKS && ticks.length <= MAX_TICKS) return { domain: [low, high], ticks };
      }
    }
    low -= 1;
    high += 1;
    notBelowZero();
  }
}
