import { z } from 'zod';
import {
  SCHEMA_VERSION,
  dateTimeSchema,
  idSchema,
  localDateSchema,
  nonEmptyTextSchema,
  nonNegativeIntSchema,
  nonNegativeNumberSchema,
  positiveIntSchema,
  repsSchema,
  reportDuplicates,
  setNumberSchema,
  weightKgSchema,
} from './common';

// --- Série prescrite -------------------------------------------------------
// Deux formes exclusives : reps exactes OU plage min/max (SPEC §11.1).
// Les deux schémas ci-dessous définissent les types de sortie ; l'entrée est
// lue par `programSetSchema`, qui vérifie l'exclusivité puis normalise.

export const exactTargetSetSchema = z.object({
  setNumber: setNumberSchema,
  targetReps: repsSchema,
  targetWeightKg: weightKgSchema.nullable(),
});

export const rangeTargetSetSchema = z.object({
  setNumber: setNumberSchema,
  targetRepsMin: repsSchema,
  targetRepsMax: repsSchema,
  targetWeightKg: weightKgSchema.nullable(),
});

export type ExactTargetSet = z.infer<typeof exactTargetSetSchema>;
export type RangeTargetSet = z.infer<typeof rangeTargetSetSchema>;

export const programSetSchema = z
  .object({
    setNumber: setNumberSchema,
    // `null` est toléré et traité comme « absent » (coach qui écrit les deux formes).
    targetReps: repsSchema.nullish(),
    targetRepsMin: repsSchema.nullish(),
    targetRepsMax: repsSchema.nullish(),
    targetWeightKg: weightKgSchema.nullable(),
  })
  .superRefine((set, ctx) => {
    const hasExact = set.targetReps != null;
    const hasMin = set.targetRepsMin != null;
    const hasMax = set.targetRepsMax != null;
    if (hasExact && (hasMin || hasMax)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetReps'],
        message: 'les répétitions sont données à la fois en valeur exacte et en plage (une seule forme autorisée)',
      });
    } else if (!hasExact && !(hasMin && hasMax)) {
      ctx.addIssue({
        code: 'custom',
        path: hasMin || hasMax ? [hasMin ? 'targetRepsMax' : 'targetRepsMin'] : ['targetReps'],
        message: hasMin || hasMax
          ? 'la plage de répétitions est incomplète (minimum et maximum requis)'
          : 'aucun objectif de répétitions (targetReps, ou targetRepsMin + targetRepsMax)',
      });
    } else if (hasMin && hasMax && (set.targetRepsMin ?? 0) > (set.targetRepsMax ?? 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetRepsMin'],
        message: 'le minimum de répétitions dépasse le maximum',
      });
    }
  })
  .transform((set): ExactTargetSet | RangeTargetSet =>
    set.targetReps != null
      ? { setNumber: set.setNumber, targetReps: set.targetReps, targetWeightKg: set.targetWeightKg }
      : {
          setNumber: set.setNumber,
          targetRepsMin: set.targetRepsMin ?? 0,
          targetRepsMax: set.targetRepsMax ?? 0,
          targetWeightKg: set.targetWeightKg,
        },
  );

/** Liste de séries prescrites, `setNumber` unique. */
export const programSetListSchema = z.array(programSetSchema).superRefine((sets, ctx) => {
  reportDuplicates(
    ctx,
    sets,
    (s) => s.setNumber,
    (i) => [i, 'setNumber'],
    (n) => `le numéro de série ${n} est utilisé plusieurs fois`,
  );
});

// --- Exercice, cardio, séance, programme ----------------------------------

export const programExerciseSchema = z
  .object({
    id: idSchema,
    order: positiveIntSchema,
    type: z.literal('strength'),
    name: nonEmptyTextSchema,
    category: z.string().nullable(),
    equipment: z.string().nullable(),
    restSec: nonNegativeIntSchema.nullable(),
    notes: z.string().nullable(),
    sets: programSetListSchema,
  })
  .superRefine((exercise, ctx) => {
    if (exercise.sets.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['sets'], message: 'aucune série prescrite' });
    }
  });

export const programCardioSchema = z.object({
  enabled: z.boolean(),
  label: z.string(),
  targetDurationMin: nonNegativeNumberSchema.nullable(),
  notes: z.string().nullable(),
});

export const programSessionSchema = z
  .object({
    id: idSchema,
    name: nonEmptyTextSchema,
    order: positiveIntSchema,
    estimatedDurationMin: nonNegativeIntSchema.nullable(),
    exercises: z.array(programExerciseSchema).min(1),
    cardio: programCardioSchema.nullable(),
  })
  .superRefine((session, ctx) => {
    reportDuplicates(
      ctx,
      session.exercises,
      (e) => e.id,
      (i) => ['exercises', i, 'id'],
      (id) => `l'identifiant d'exercice « ${id} » est utilisé plusieurs fois`,
    );
  });

export const programWeekSchema = z.object({
  id: idSchema,
  label: z.string(),
  startDate: localDateSchema.nullable(),
  endDate: localDateSchema.nullable(),
});

export const trainingProgramSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    type: z.literal('training_program'),
    programId: idSchema,
    name: nonEmptyTextSchema,
    locale: z.string().min(1),
    unitSystem: z.literal('metric'),
    createdAt: dateTimeSchema,
    week: programWeekSchema,
    sessions: z.array(programSessionSchema).min(1),
  })
  .superRefine((program, ctx) => {
    reportDuplicates(
      ctx,
      program.sessions,
      (s) => s.id,
      (i) => ['sessions', i, 'id'],
      (id) => `l'identifiant de séance « ${id} » est utilisé plusieurs fois`,
    );
  });

export type ProgramSet = z.infer<typeof programSetSchema>;
export type ProgramExercise = z.infer<typeof programExerciseSchema>;
export type ProgramCardio = z.infer<typeof programCardioSchema>;
export type ProgramSession = z.infer<typeof programSessionSchema>;
export type ProgramWeek = z.infer<typeof programWeekSchema>;
export type TrainingProgram = z.infer<typeof trainingProgramSchema>;
