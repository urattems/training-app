/**
 * Pesées (V1.2) : règles pures, testées. L'app enregistre et calcule ; elle ne fixe aucun
 * objectif et ne donne aucun conseil. kg uniquement.
 */
import { hasAtMostTwoDecimals } from '../schemas/weight.schema';
import { parseDecimalInput } from '../utils/numbers';
import { filterByPeriod, type Period } from './stats';
import type { WeightEntry } from './types';
import { isValidLocalDate } from './values';

/** Écart avec la pesée précédente au-delà duquel on demande « C'est bien ça ? ». */
export const WEIGHT_CHANGE_WARNING_KG = 5;
/** Plage plausible : en dehors, simple demande de confirmation (jamais un refus). */
export const WEIGHT_PLAUSIBLE_MIN_KG = 20;
export const WEIGHT_PLAUSIBLE_MAX_KG = 300;

/** Arrondi d'affichage des écarts (évite 0.30000000000000004), jamais appliqué à une saisie. */
export const roundKg = (value: number): number => Math.round(value * 100) / 100;

// --- Saisie -------------------------------------------------------------------

export type WeightInputError = 'empty' | 'invalid' | 'not_positive' | 'too_precise';
export type WeightInputResult = { ok: true; value: number } | { ok: false; error: WeightInputError };

/**
 * Lit une saisie de poids : virgule ou point (`parseDecimalInput`), > 0, au plus 2 décimales.
 * Au-delà de 2 décimales : refus (jamais d'arrondi silencieux).
 */
export function parseWeightInput(text: string): WeightInputResult {
  const parsed = parseDecimalInput(text);
  if (!parsed.ok) return { ok: false, error: 'invalid' };
  if (parsed.value === null) return { ok: false, error: 'empty' };
  return validateWeightKg(parsed.value);
}

/** Valide un poids déjà numérique (service, import). */
export function validateWeightKg(value: number): WeightInputResult {
  if (!Number.isFinite(value)) return { ok: false, error: 'invalid' };
  if (value <= 0) return { ok: false, error: 'not_positive' };
  if (!hasAtMostTwoDecimals(value)) return { ok: false, error: 'too_precise' };
  return { ok: true, value };
}

export type WeightDateError = 'invalid' | 'future';

/** Date d'une pesée : réelle (`YYYY-MM-DD`) et jamais après aujourd'hui (date locale de l'appareil). */
export function validateWeightDate(date: string, today: string): WeightDateError | null {
  if (!isValidLocalDate(date)) return 'invalid';
  return date > today ? 'future' : null;
}

// --- Avertissements doux ------------------------------------------------------

export type WeightWarning = 'big_change' | 'below_range' | 'above_range';

/**
 * Avertissements NON bloquants : écart de plus de 5 kg avec la pesée précédente,
 * ou valeur hors de [20, 300] kg. L'interface demande « C'est bien ça ? », rien de plus.
 */
export function weightSanity(value: number, previous: Pick<WeightEntry, 'weightKg'> | null): WeightWarning[] {
  const warnings: WeightWarning[] = [];
  if (previous !== null && Math.abs(value - previous.weightKg) > WEIGHT_CHANGE_WARNING_KG) warnings.push('big_change');
  if (value < WEIGHT_PLAUSIBLE_MIN_KG) warnings.push('below_range');
  if (value > WEIGHT_PLAUSIBLE_MAX_KG) warnings.push('above_range');
  return warnings;
}

// --- Historique ----------------------------------------------------------------

/** Pesées triées par date croissante (copie). */
export const sortWeights = <T extends { date: string }>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Pesée précédant `date` dans TOUT l'historique (pas seulement la période affichée). */
export function previousWeight(entries: readonly WeightEntry[], date: string): WeightEntry | null {
  return sortWeights(entries).filter((e) => e.date < date).at(-1) ?? null;
}

/** Écart d'une pesée avec la précédente de tout l'historique, `null` pour la toute première. */
export function weightDelta(entries: readonly WeightEntry[], date: string): number | null {
  const current = entries.find((e) => e.date === date);
  const previous = previousWeight(entries, date);
  return current && previous ? roundKg(current.weightKg - previous.weightKg) : null;
}

/** Pesées d'une période (1M, 3M, 6M, 1A, Tout), par date croissante. */
export function getWeightHistory(entries: readonly WeightEntry[], period: Period, today: string): WeightEntry[] {
  return filterByPeriod(sortWeights(entries), period, today);
}

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface WeightStats {
  /** Dernière pesée (tout l'historique) et son écart avec la précédente. */
  last: (WeightPoint & { delta: number | null }) | null;
  /** Sur la période : extrêmes et variation (dernière − première), `null` sans données. */
  min: WeightPoint | null;
  max: WeightPoint | null;
  /** `null` s'il y a moins de 2 pesées dans la période. */
  change: number | null;
  /** Nombre de pesées de la période et bornes réelles (première et dernière pesée). */
  count: number;
  firstDate: string | null;
  lastDate: string | null;
}

const point = (e: WeightEntry): WeightPoint => ({ date: e.date, weightKg: e.weightKg });

export function weightStats(entries: readonly WeightEntry[], period: Period, today: string): WeightStats {
  const all = sortWeights(entries);
  const latest = all.at(-1) ?? null;
  const inPeriod = filterByPeriod(all, period, today);
  const first = inPeriod[0] ?? null;
  const last = inPeriod.at(-1) ?? null;
  // À égalité, la pesée la plus récente.
  const min = inPeriod.reduce<WeightEntry | null>((m, e) => (m === null || e.weightKg <= m.weightKg ? e : m), null);
  const max = inPeriod.reduce<WeightEntry | null>((m, e) => (m === null || e.weightKg >= m.weightKg ? e : m), null);
  return {
    last: latest ? { ...point(latest), delta: weightDelta(all, latest.date) } : null,
    min: min ? point(min) : null,
    max: max ? point(max) : null,
    change: first && last && inPeriod.length >= 2 ? roundKg(last.weightKg - first.weightKg) : null,
    count: inPeriod.length,
    firstDate: first?.date ?? null,
    lastDate: last?.date ?? null,
  };
}

/**
 * Restauration d'un fichier SANS pesée alors que l'app en contient : nombre de pesées qui
 * seront remplacées (avertissement visible), `null` sinon.
 */
export function weightsLostByRestore(fileWeightCount: number, currentWeightCount: number): number | null {
  return fileWeightCount === 0 && currentWeightCount > 0 ? currentWeightCount : null;
}

/** Pesées enregistrées après le dernier export : données non sauvegardées (rappel d'export). */
export function weightsRecordedSince(entries: readonly Pick<WeightEntry, 'recordedAt'>[], lastExportAt: string | null): number {
  if (lastExportAt === null) return entries.length;
  const since = Date.parse(lastExportAt);
  return entries.filter((e) => Date.parse(e.recordedAt) > since).length;
}
