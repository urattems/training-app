import { z } from 'zod';
import { isValidMeasurementCm, MEASUREMENT_ZONE_KEYS } from '../domain/measurements';
import { dateTimeSchema } from './common';
import { weightDateSchema } from './weight.schema';

/**
 * Mesure d'une zone en cm (V1.5.0) : `null` = absente (jamais 0) ; sinon nombre fini, > 0,
 * au plus 1 décimale, au plus 300 cm.
 */
export const measurementCmSchema = z
  .number()
  .refine(isValidMeasurementCm, { message: 'la mesure doit être un nombre de 0,1 à 300 cm, au plus 1 décimale' })
  .nullable();

/**
 * Prise de mensurations : une par jour, `date` = date locale de la prise (identifiant unique),
 * `recordedAt` = instant de la dernière écriture. Chaque zone est PRÉSENTE et nullable ;
 * au moins une mesure non nulle.
 */
export const measurementEntrySchema = z
  .object({
    date: weightDateSchema,
    chestCm: measurementCmSchema,
    bellyCm: measurementCmSchema,
    waistCm: measurementCmSchema,
    bicepsCm: measurementCmSchema,
    thighCm: measurementCmSchema,
    calfCm: measurementCmSchema,
    recordedAt: dateTimeSchema,
  })
  .refine((entry) => MEASUREMENT_ZONE_KEYS.some((key) => entry[key] !== null), {
    message: 'une prise de mensurations contient au moins une mesure',
  });

export type MeasurementEntry = z.infer<typeof measurementEntrySchema>;
