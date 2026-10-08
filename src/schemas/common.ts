import { z } from 'zod';

/** Version du format programme (`training_program`) : inchangée depuis la V1. */
export const SCHEMA_VERSION = '1.0';
/** Version courante de la sauvegarde (`training_history_export`) : 1.1 = pesées (V1.2). */
export const HISTORY_SCHEMA_VERSION = '1.2';
/** Version courante de l'export pour le coach (`training_coach_export`) : 1.1 = pesées (V1.2). */
export const COACH_SCHEMA_VERSION = '1.1';
/**
 * Export pour le coach AVEC mensurations (V1.7.0) : produit SEULEMENT quand l'utilisateur coche
 * « Joindre mes mensurations ». Sans cette option, l'export reste en 1.1, identique octet pour octet.
 */
export const COACH_MEASUREMENTS_SCHEMA_VERSION = '1.2';

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
