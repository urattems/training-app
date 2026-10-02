import { z } from 'zod';
import {
  SCHEMA_VERSION,
  dateTimeSchema,
  durationSecSchema,
  idSchema,
  localDateSchema,
  nonNegativeNumberSchema,
  repsSchema,
  reportDuplicates,
  setNumberSchema,
  weightKgSchema,
} from './common';
import { programSetListSchema, trainingProgramSchema } from './program.schema';

export const SENSATIONS = ['very_easy', 'easy', 'good', 'hard', 'very_hard'] as const;
export const WORKOUT_STATUSES = ['in_progress', 'completed', 'abandoned'] as const;
export const EXERCISE_STATUSES = ['pending', 'completed'] as const;
export const CARDIO_TYPES = ['treadmill', 'bike', 'elliptical', 'rower', 'other'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;

export const sensationSchema = z.enum(SENSATIONS);
export const workoutStatusSchema = z.enum(WORKOUT_STATUSES);
export const exerciseStatusSchema = z.enum(EXERCISE_STATUSES);
export const cardioTypeSchema = z.enum(CARDIO_TYPES);

export const actualSetSchema = z.object({
  setNumber: setNumberSchema,
  actualReps: repsSchema.nullable(),
  actualWeightKg: weightKgSchema.nullable(),
  isExtra: z.boolean().default(false),
});

export const workoutExerciseSchema = z
  .object({
    exerciseId: idSchema,
    exerciseName: z.string().min(1),
    programExerciseId: idSchema,
    status: exerciseStatusSchema,
    restSec: durationSecSchema.nullable(),
    targetSets: programSetListSchema,
    actualSets: z.array(actualSetSchema),
    sensation: sensationSchema.nullable(),
    comment: z.string().nullable(),
  })
  .superRefine((record, ctx) => {
    reportDuplicates(
      ctx,
      record.actualSets,
      (s) => s.setNumber,
      (i) => ['actualSets', i, 'setNumber'],
      (n) => `la série réalisée n°${n} apparaît plusieurs fois`,
    );
  });

export const cardioEntrySchema = z.object({
  type: cardioTypeSchema,
  name: z.string(),
  durationSec: durationSecSchema.nullable(),
  speedKmh: nonNegativeNumberSchema.nullable(),
  inclinePct: z.number().min(0).max(100).nullable(),
  notes: z.string().nullable(),
});

export const workoutSessionSchema = z
  .object({
    id: idSchema,
    programId: idSchema,
    programSessionId: idSchema,
    sessionName: z.string().min(1),
    date: localDateSchema,
    startedAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullable(),
    durationSec: durationSecSchema.nullable(),
    status: workoutStatusSchema,
    executionOrder: z.array(idSchema),
    exerciseRecords: z.array(workoutExerciseSchema),
    cardioRecords: z.array(cardioEntrySchema),
    notes: z.string().nullable(),
  })
  .superRefine((workout, ctx) => {
    reportDuplicates(
      ctx,
      workout.exerciseRecords,
      (r) => r.programExerciseId,
      (i) => ['exerciseRecords', i, 'programExerciseId'],
      (id) => `l'exercice « ${id} » apparaît plusieurs fois`,
    );
    reportDuplicates(
      ctx,
      workout.executionOrder,
      (id) => id,
      (i) => ['executionOrder', i],
      (id) => `l'exercice « ${id} » apparaît plusieurs fois dans l'ordre d'exécution`,
    );
    const known = new Set(workout.exerciseRecords.map((r) => r.programExerciseId));
    workout.executionOrder.forEach((id, i) => {
      if (!known.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['executionOrder', i],
          message: `l'ordre d'exécution cite un exercice absent de la séance (« ${id} »)`,
        });
      }
    });
  });

export const userPreferencesSchema = z.object({
  unit: z.literal('kg'),
  theme: z.enum(THEMES),
});

export const DEFAULT_PREFERENCES: z.infer<typeof userPreferencesSchema> = { unit: 'kg', theme: 'light' };

export const historyExportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  type: z.literal('training_history_export'),
  exportedAt: dateTimeSchema,
  locale: z.string().min(1),
  unitSystem: z.literal('metric'),
  activeProgramId: idSchema.nullable(),
  preferences: userPreferencesSchema.default(() => ({ ...DEFAULT_PREFERENCES })),
  programs: z.array(trainingProgramSchema),
  sessions: z.array(workoutSessionSchema),
});

export type Sensation = z.infer<typeof sensationSchema>;
export type WorkoutStatus = z.infer<typeof workoutStatusSchema>;
export type ExerciseStatus = z.infer<typeof exerciseStatusSchema>;
export type CardioType = z.infer<typeof cardioTypeSchema>;
export type ActualSet = z.infer<typeof actualSetSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type CardioEntry = z.infer<typeof cardioEntrySchema>;
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type HistoryExport = z.infer<typeof historyExportSchema>;
