import { z } from 'zod';

export const SCHEMA_VERSION = '1.0';

/** Identifiant stable : texte non vide. */
export const idSchema = z.string().trim().min(1);
export const nonEmptyTextSchema = z.string().trim().min(1);

/** Horodatage ISO 8601 avec offset (ou `Z`). */
export const dateTimeSchema = z.iso.datetime({ offset: true });
/** Date métier `YYYY-MM-DD`. */
export const localDateSchema = z.iso.date();

export const positiveIntSchema = z.int().min(1);
export const nonNegativeIntSchema = z.int().min(0);
export const nonNegativeNumberSchema = z.number().min(0);

export const setNumberSchema = positiveIntSchema;
export const repsSchema = nonNegativeIntSchema;
export const weightKgSchema = nonNegativeNumberSchema;
export const durationSecSchema = nonNegativeIntSchema;

/** Signale chaque valeur en double d'une liste, au chemin de l'élément concerné. */
export function reportDuplicates<T>(
  ctx: z.RefinementCtx,
  items: readonly T[],
  key: (item: T) => string | number,
  path: (index: number) => PropertyKey[],
  message: (value: string | number) => string,
): void {
  const seen = new Set<string | number>();
  items.forEach((item, index) => {
    const value = key(item);
    if (seen.has(value)) {
      ctx.addIssue({ code: 'custom', message: message(value), path: path(index), input: item });
    }
    seen.add(value);
  });
}
