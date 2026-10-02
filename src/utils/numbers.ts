/** Résultat de la lecture d'un champ numérique saisi. `null` = champ vide. */
export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

const DECIMAL_PATTERN = /^\d+(?:[.,]\d+)?$/;
const INTEGER_PATTERN = /^\d+$/;

/**
 * Lit une saisie décimale positive : `47,5` et `47.5` sont acceptés (SPEC §6).
 * Vide → `null`. Négatif ou texte → refus.
 */
export function parseDecimalInput(input: string): ParsedNumber {
  const trimmed = input.trim().replace(/\s/g, '');
  if (trimmed === '') return { ok: true, value: null };
  if (!DECIMAL_PATTERN.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed.replace(',', '.')) };
}

/** Lit une saisie entière positive (reps). Vide → `null`. */
export function parseIntegerInput(input: string): ParsedNumber {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!INTEGER_PATTERN.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed) };
}

const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Affichage français d'un nombre (`47,5`). */
export function formatDecimal(value: number): string {
  return decimalFormatter.format(value);
}

/** Affichage d'une charge (`47,5 kg`). */
export function formatKg(value: number): string {
  return `${formatDecimal(value)} kg`;
}
