/**
 * Mensurations (V1.5.0) : règles pures. Une prise = les circonférences de 6 zones (cm) à une date ;
 * chaque mesure peut manquer (`null`, jamais 0). Le Total (somme des 6) n'existe que pour une prise
 * COMPLÈTE ; ce n'est jamais un « score ». Toutes les dates sont des dates métier `YYYY-MM-DD`.
 */
import { strings } from '../i18n/strings';
import type { MeasurementEntry } from '../schemas/measurement.schema';
import { seriesForPeriod, dateToTime, type ChartSeries } from './chart';
import { filterByPeriod, type Period } from './stats';

const t = strings.measurements;

/** Les 6 zones, DANS CET ORDRE (constante unique) : clé du contrat, libellé, consigne de mesure. */
export const MEASUREMENT_ZONES = [
  { key: 'chestCm', label: t.zones.chest.label, instruction: t.zones.chest.instruction },
  { key: 'bellyCm', label: t.zones.belly.label, instruction: t.zones.belly.instruction },
  { key: 'waistCm', label: t.zones.waist.label, instruction: t.zones.waist.instruction },
  { key: 'bicepsCm', label: t.zones.biceps.label, instruction: t.zones.biceps.instruction },
  { key: 'thighCm', label: t.zones.thigh.label, instruction: t.zones.thigh.instruction },
  { key: 'calfCm', label: t.zones.calf.label, instruction: t.zones.calf.instruction },
] as const;

export type MeasurementZoneKey = (typeof MEASUREMENT_ZONES)[number]['key'];
export const MEASUREMENT_ZONE_KEYS: readonly MeasurementZoneKey[] = MEASUREMENT_ZONES.map((z) => z.key);

/** Les 6 mesures d'une prise (`null` = absente). */
export type MeasurementValues = Record<MeasurementZoneKey, number | null>;

/** Plafond d'une mesure (cm). */
export const MAX_MEASUREMENT_CM = 300;

// --- Règles de valeur ---------------------------------------------------------------

export type MeasurementValueError = 'invalid' | 'not_positive' | 'too_precise' | 'too_large';

/** Au plus 1 décimale (tolérance de représentation binaire, jamais d'arrondi silencieux). */
export const hasAtMostOneDecimal = (value: number): boolean => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;

/** Valeur d'une mesure : finie, > 0, au plus 1 décimale, au plus 300 cm. `null` = valide (absente). */
export function measurementValueError(value: number): MeasurementValueError | null {
  if (!Number.isFinite(value)) return 'invalid';
  if (value <= 0) return 'not_positive';
  if (!hasAtMostOneDecimal(value)) return 'too_precise';
  return value > MAX_MEASUREMENT_CM ? 'too_large' : null;
}

export const isValidMeasurementCm = (value: number): boolean => measurementValueError(value) === null;

/** Au moins une mesure présente. */
export const hasAnyMeasurement = (values: MeasurementValues): boolean => MEASUREMENT_ZONE_KEYS.some((key) => values[key] !== null);

/** Les 6 mesures d'une prise (sans date ni instant d'écriture). */
export const valuesOf = (entry: MeasurementValues): MeasurementValues =>
  Object.fromEntries(MEASUREMENT_ZONE_KEYS.map((key) => [key, entry[key]])) as MeasurementValues;

// --- Prises -------------------------------------------------------------------------

/** Par date croissante (la date est unique). */
export const sortMeasurements = <T extends { date: string }>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Prise complète : les 6 mesures présentes. */
export const isComplete = (entry: MeasurementValues): boolean => MEASUREMENT_ZONE_KEYS.every((key) => entry[key] !== null);

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** « Total des mensurations » : somme des 6, arrondie à 1 décimale ; `null` si la prise est incomplète. */
export function measurementTotal(entry: MeasurementValues): number | null {
  if (!isComplete(entry)) return null;
  return round1(MEASUREMENT_ZONE_KEYS.reduce((sum, key) => sum + (entry[key] ?? 0), 0));
}

/** Dernière prise complète (par date), `null` s'il n'y en a pas. */
export function latestComplete(entries: readonly MeasurementEntry[]): MeasurementEntry | null {
  return sortMeasurements(entries).filter(isComplete).at(-1) ?? null;
}

/** Série suivie : une zone, ou le Total (prises complètes seulement). */
export type MeasurementSeriesKey = MeasurementZoneKey | 'total';

export interface MeasurementPoint {
  date: string;
  value: number;
}

/** Valeurs datées d'une série, par date croissante (seules les valeurs présentes). */
export function measurementPoints(entries: readonly MeasurementEntry[], key: MeasurementSeriesKey): MeasurementPoint[] {
  const points: MeasurementPoint[] = [];
  for (const entry of sortMeasurements(entries)) {
    const value = key === 'total' ? measurementTotal(entry) : entry[key];
    if (value !== null) points.push({ date: entry.date, value });
  }
  return points;
}

/**
 * Départ d'une série = sa plus ancienne valeur PAR DATE (jamais l'ordre de saisie), sur TOUTES les
 * prises (indépendant de la période affichée). Zone : plus ancienne valeur de cette zone ;
 * Total : plus ancienne prise complète.
 */
export const departure = (entries: readonly MeasurementEntry[], key: MeasurementSeriesKey): MeasurementPoint | null =>
  measurementPoints(entries, key)[0] ?? null;

/** Valeur la plus récente d'une série (par date). */
export const latestValue = (entries: readonly MeasurementEntry[], key: MeasurementSeriesKey): MeasurementPoint | null =>
  measurementPoints(entries, key).at(-1) ?? null;

/**
 * Variation Départ → dernière valeur, arrondie à 1 décimale ; `null` s'il n'y a pas deux valeurs à
 * des dates différentes (une seule valeur n'a pas de variation).
 */
export function variation(entries: readonly MeasurementEntry[], key: MeasurementSeriesKey): number | null {
  const first = departure(entries, key);
  const last = latestValue(entries, key);
  if (!first || !last || first.date === last.date) return null;
  return round1(last.value - first.value);
}

/** Série de graphique d'une zone ou du Total sur une période (points reliés, dates métier). */
export function buildMeasurementSeries(entries: readonly MeasurementEntry[], key: MeasurementSeriesKey, period: Period, today: string): ChartSeries {
  const points = filterByPeriod(measurementPoints(entries, key), period, today).map((p) => ({ t: dateToTime(p.date), value: p.value, workoutId: p.date, date: p.date }));
  return seriesForPeriod(points, period, today);
}

export interface MeasurementStats {
  min: MeasurementPoint | null;
  max: MeasurementPoint | null;
  count: number;
}

/** Min, max (à égalité, le plus récent) et nombre de valeurs d'une série sur la période. */
export function measurementStats(entries: readonly MeasurementEntry[], key: MeasurementSeriesKey, period: Period, today: string): MeasurementStats {
  const points = filterByPeriod(measurementPoints(entries, key), period, today);
  let min: MeasurementPoint | null = null;
  let max: MeasurementPoint | null = null;
  for (const p of points) {
    if (min === null || p.value <= min.value) min = p;
    if (max === null || p.value >= max.value) max = p;
  }
  return { min, max, count: points.length };
}

// --- Avertissement doux (« C'est bien ça ? ») -------------------------------------------

/** Écart (cm) au-delà duquel une valeur saisie déclenche « C'est bien ça ? » (jamais bloquant). */
export const MEASUREMENT_SANITY_CM = 10;

/** Valeur d'une zone la plus proche DANS LE PASSÉ (par date, strictement avant `date`), sinon `null`. */
export function previousZoneValue(entries: readonly MeasurementEntry[], zone: MeasurementZoneKey, date: string): MeasurementPoint | null {
  return measurementPoints(entries, zone).filter((p) => p.date < date).at(-1) ?? null;
}

export interface MeasurementWarning {
  zone: MeasurementZoneKey;
  value: number;
  previous: MeasurementPoint;
}

/** Zones saisies qui diffèrent de plus de 10 cm de leur valeur la plus proche dans le passé. */
export function measurementWarnings(entries: readonly MeasurementEntry[], date: string, values: MeasurementValues): MeasurementWarning[] {
  const warnings: MeasurementWarning[] = [];
  for (const zone of MEASUREMENT_ZONE_KEYS) {
    const value = values[zone];
    const previous = value === null ? null : previousZoneValue(entries, zone, date);
    if (value !== null && previous && Math.abs(value - previous.value) > MEASUREMENT_SANITY_CM) warnings.push({ zone, value, previous });
  }
  return warnings;
}

// --- Sauvegarde ---------------------------------------------------------------------

/** Une restauration sans mensurations remplacerait celles de l'app : nombre perdu, sinon `null`. */
export function measurementsLostByRestore(fileCount: number, currentCount: number): number | null {
  return fileCount === 0 && currentCount > 0 ? currentCount : null;
}

/** Prises enregistrées après le dernier export : données non sauvegardées (rappel d'export). */
export function measurementsRecordedSince(entries: readonly Pick<MeasurementEntry, 'recordedAt'>[], lastExportAt: string | null): number {
  if (lastExportAt === null) return entries.length;
  const since = Date.parse(lastExportAt);
  return entries.filter((e) => Date.parse(e.recordedAt) > since).length;
}
