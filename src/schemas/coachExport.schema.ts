import { z } from 'zod';
import { SCHEMA_VERSION, dateTimeSchema, idSchema, localDateSchema, nonNegativeIntSchema, positiveIntSchema } from './common';
import { workoutSessionSchema } from './history.schema';
import { trainingProgramSchema } from './program.schema';

export const COACH_EXPORT_TYPE = 'training_coach_export';

/** Façon dont la sélection a été faite (information pour le coach). */
export const COACH_SELECTION_MODES = ['last_n', 'since_last_export', 'manual'] as const;

export const coachSelectionSchema = z.object({
  mode: z.enum(COACH_SELECTION_MODES),
  sessionCount: positiveIntSchema,
  totalExportableSessions: nonNegativeIntSchema,
  firstSessionDate: localDateSchema,
  lastSessionDate: localDateSchema,
});

/**
 * Export PARTIEL pour le coach (SPEC §10.6) : une sélection de séances et les programmes
 * nécessaires pour les lire. Jamais une sauvegarde : refusé par la restauration et l'import.
 * Pas de `preferences`.
 */
export const coachExportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal(COACH_EXPORT_TYPE),
  exportedAt: dateTimeSchema,
  locale: z.string().min(1),
  unitSystem: z.literal('metric'),
  activeProgramId: idSchema.nullable(),
  selection: coachSelectionSchema,
  programs: z.array(trainingProgramSchema),
  sessions: z.array(workoutSessionSchema).min(1),
});

export type CoachSelectionMode = (typeof COACH_SELECTION_MODES)[number];
export type CoachSelection = z.infer<typeof coachSelectionSchema>;
export type CoachExport = z.infer<typeof coachExportSchema>;
