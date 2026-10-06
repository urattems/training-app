/**
 * Règles de validation des valeurs (SPEC §6) : pas de négatif, pas de plafond haut pour les
 * données IMPORTÉES (les anciennes sauvegardes restent toujours restaurables).
 * Les SAISIES de séries ont en plus des garde-fous (V1.3.2) : voir `setRepsError` / `setWeightError`.
 */

/** Au plus 2 décimales (tolérance de représentation binaire, jamais d'arrondi silencieux). */
export const hasAtMostTwoDecimals = (value: number): boolean => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

const isFiniteNonNegative = (v: number): boolean => Number.isFinite(v) && v >= 0;

export const isValidReps = (v: number | null): boolean => v === null || (Number.isInteger(v) && v >= 0);
export const isValidWeightKg = (v: number | null): boolean => v === null || isFiniteNonNegative(v);
export const isValidDurationSec = (v: number | null): boolean => v === null || (Number.isInteger(v) && v >= 0);
export const isValidSpeedKmh = (v: number | null): boolean => v === null || isFiniteNonNegative(v);
export const isValidInclinePct = (v: number | null): boolean => v === null || (isFiniteNonNegative(v) && v <= 100);

/** Plafond d'une charge saisie (kg). */
export const MAX_SET_WEIGHT_KG = 999.99;
/** Plafond de répétitions saisies (le gainage compte des secondes : 999 s ≈ 16 min). */
export const MAX_SET_REPS = 999;

export type SetValueError = 'invalid' | 'too_precise' | 'too_large';

/** Garde-fou de saisie d'une charge : ≥ 0, au plus 2 décimales, au plus 999,99 kg. `null` = vide, valide. */
export function setWeightError(v: number | null): SetValueError | null {
  if (v === null) return null;
  if (!isFiniteNonNegative(v)) return 'invalid';
  if (!hasAtMostTwoDecimals(v)) return 'too_precise';
  return v > MAX_SET_WEIGHT_KG ? 'too_large' : null;
}

/** Garde-fou de saisie de répétitions : entier ≥ 0, au plus 999. `null` = vide, valide. */
export function setRepsError(v: number | null): SetValueError | null {
  if (v === null) return null;
  if (!Number.isInteger(v) || v < 0) return 'invalid';
  return v > MAX_SET_REPS ? 'too_large' : null;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date métier `YYYY-MM-DD` réelle (rejette 2026-02-30). */
export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
