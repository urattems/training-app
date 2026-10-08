import { z } from 'zod';
import { COACH_MEASUREMENTS_SCHEMA_VERSION, COACH_SCHEMA_VERSION, dateTimeSchema, idSchema, localDateSchema, nonNegativeIntSchema, positiveIntSchema } from './common';
import { workoutSessionSchema } from './history.schema';
import { trainingProgramSchema } from './program.schema';
import { coachMeasurementEntrySchema } from './measurement.schema';
import { coachWeightEntrySchema, weightDateSchema } from './weight.schema';

export const COACH_EXPORT_TYPE = 'training_coach_export';

/** Façon dont la sélection a été faite (information pour le coach). */
export const COACH_SELECTION_MODES = ['last_n', 'since_last_export', 'manual'] as const;

/** Fenêtre des pesées jointes (1.1) : 30 jours ou plus si les séances sont plus anciennes, 90 jours, tout. */
export const WEIGHT_WINDOW_MODES = ['auto_30d', 'days_90', 'all'] as const;

export const coachSelectionSchema = z.object({
  mode: z.enum(COACH_SELECTION_MODES),
  sessionCount: positiveIntSchema,
  totalExportableSessions: nonNegativeIntSchema,
  firstSessionDate: localDateSchema,
  lastSessionDate: localDateSchema,
});

export const weightWindowSchema = z.object({
  mode: z.enum(WEIGHT_WINDOW_MODES),
  from: weightDateSchema,
  to: weightDateSchema,
  count: nonNegativeIntSchema,
});

/** Fenêtre des mensurations jointes (1.2) : mêmes modes et même forme que celle des pesées. */
export const measurementWindowSchema = weightWindowSchema;

/**
 * Export PARTIEL pour le coach (SPEC §10.6) : une sélection de séances et les programmes
 * nécessaires pour les lire, plus (1.1) les pesées d'une fenêtre de dates.
 * Jamais une sauvegarde : refusé par la restauration et l'import. Pas de `preferences`.
 */
const coachExportV11Shape = {
  schemaVersion: z.literal(COACH_SCHEMA_VERSION),
  type: z.literal(COACH_EXPORT_TYPE),
  exportedAt: dateTimeSchema,
  locale: z.string().min(1),
  unitSystem: z.literal('metric'),
  activeProgramId: idSchema.nullable(),
  selection: coachSelectionSchema,
  programs: z.array(trainingProgramSchema),
  sessions: z.array(workoutSessionSchema).min(1),
  /** Pesées de la fenêtre, triées par date croissante ; vide si les pesées sont désactivées. */
  weightEntries: z.array(coachWeightEntrySchema),
  /** `null` = pesées désactivées pour cet envoi. */
  weightWindow: weightWindowSchema.nullable(),
};

/**
 * 1.1 : exactement le format d'avant (aucune clé de mensurations). Une clé de mensurations dans un
 * fichier 1.1 est REFUSÉE avec un message clair (elle serait sinon ignorée en silence).
 */
export const coachExportV11Schema = z
  .object({ ...coachExportV11Shape, measurementWindow: z.unknown().optional(), measurementEntries: z.unknown().optional() })
  .refine((data) => data.measurementWindow === undefined && data.measurementEntries === undefined, {
    message: 'les mensurations exigent un export pour le coach en version « 1.2 »',
    path: ['measurementEntries'],
  });

/**
 * 1.2 (V1.7.0) : uniquement quand l'utilisateur joint ses mensurations. Deux clés de plus, après
 * celles des pesées : la fenêtre puis les prises (date croissante, zones dans l'ordre du domaine,
 * `null` = zone absente, jamais 0).
 */
export const coachExportV12Schema = z.object({
  ...coachExportV11Shape,
  schemaVersion: z.literal(COACH_MEASUREMENTS_SCHEMA_VERSION),
  measurementWindow: measurementWindowSchema.nullable(),
  measurementEntries: z.array(coachMeasurementEntrySchema),
});

export const coachExportSchema = z.discriminatedUnion('schemaVersion', [coachExportV11Schema, coachExportV12Schema]);

export type CoachSelectionMode = (typeof COACH_SELECTION_MODES)[number];
export type WeightWindowMode = (typeof WEIGHT_WINDOW_MODES)[number];
export type WeightWindow = z.infer<typeof weightWindowSchema>;
export type CoachSelection = z.infer<typeof coachSelectionSchema>;
export type CoachExport = z.infer<typeof coachExportSchema>;
