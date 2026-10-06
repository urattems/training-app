import { z } from 'zod';
import { hasAtMostTwoDecimals, isValidLocalDate } from '../domain/values';
import { dateTimeSchema } from './common';

// Déplacé dans `domain/values` (V1.3.2, partagé avec les garde-fous de saisie des séries).
export { hasAtMostTwoDecimals };

/** Poids corporel en kg : nombre fini, strictement positif, au plus 2 décimales. */
export const bodyWeightKgSchema = z
  .number()
  .refine(Number.isFinite, { message: 'le poids doit être un nombre fini' })
  .refine((v) => v > 0, { message: 'le poids doit être supérieur à 0' })
  .refine(hasAtMostTwoDecimals, { message: 'le poids accepte au plus 2 décimales' });

/** Date métier `YYYY-MM-DD` réelle (rejette 2026-02-30). La date future est un invariant (dépend d'aujourd'hui). */
export const weightDateSchema = z.string().refine(isValidLocalDate, { message: 'date attendue au format AAAA-MM-JJ (date réelle)' });

/**
 * Pesée (V1.2) : une par jour, `date` = date locale mesurée (identifiant unique),
 * `recordedAt` = instant de la dernière écriture (saisie ou correction).
 */
export const weightEntrySchema = z.object({
  date: weightDateSchema,
  weightKg: bodyWeightKgSchema,
  recordedAt: dateTimeSchema,
});

/** Pesée dans l'export pour le coach : compacte (date et poids seulement). */
export const coachWeightEntrySchema = z.object({
  date: weightDateSchema,
  weightKg: bodyWeightKgSchema,
});

export type WeightEntry = z.infer<typeof weightEntrySchema>;
export type CoachWeightEntry = z.infer<typeof coachWeightEntrySchema>;
