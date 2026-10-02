/** Règles de validation des valeurs saisies (SPEC §6) : pas de négatif, pas de plafond haut. */

const isFiniteNonNegative = (v: number): boolean => Number.isFinite(v) && v >= 0;

export const isValidReps = (v: number | null): boolean => v === null || (Number.isInteger(v) && v >= 0);
export const isValidWeightKg = (v: number | null): boolean => v === null || isFiniteNonNegative(v);
export const isValidDurationSec = (v: number | null): boolean => v === null || (Number.isInteger(v) && v >= 0);
export const isValidSpeedKmh = (v: number | null): boolean => v === null || isFiniteNonNegative(v);
export const isValidInclinePct = (v: number | null): boolean => v === null || (isFiniteNonNegative(v) && v <= 100);

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Date métier `YYYY-MM-DD` réelle (rejette 2026-02-30). */
export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
