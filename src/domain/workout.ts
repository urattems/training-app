/**
 * Règles pures d'une séance réelle. Chaque fonction retourne une nouvelle séance
 * sans modifier l'entrée. Les objectifs (`targetSets`) ne sont jamais modifiés :
 * aucune fonction de ce module n'y écrit (SPEC §5.3).
 */
import { strings } from '../i18n/strings';
import { secondsBetween, toLocalDateString, toLocalIsoString } from '../utils/dates';
import { DomainError } from './errors';
import type {
  ActualSet,
  CardioEntry,
  CardioType,
  ProgramSet,
  RangeTargetSet,
  Sensation,
  TrainingProgram,
  WorkoutExercise,
  WorkoutSession,
} from './types';
import {
  isValidDurationSec,
  isValidInclinePct,
  isValidLocalDate,
  isValidReps,
  isValidSpeedKmh,
  isValidWeightKg,
} from './values';

const t = strings.workout;

export const isRangeTarget = (set: ProgramSet): set is RangeTargetSet => 'targetRepsMin' in set;

// --- Création (snapshot) ------------------------------------------------------

/**
 * Crée une séance à partir d'une séance du programme, en copiant les objectifs
 * (snapshot) : l'historique ne dépend jamais du programme courant.
 * Le réalisé démarre vide (aucun préremplissage).
 */
export function createWorkout(
  program: TrainingProgram,
  programSessionId: string,
  options: { id: string; now: Date },
): WorkoutSession {
  const session = program.sessions.find((s) => s.id === programSessionId);
  if (!session) throw new DomainError(t.unknownSession(programSessionId));

  const exercises = [...session.exercises].sort((a, b) => a.order - b.order);
  return {
    id: options.id,
    programId: program.programId,
    programSessionId: session.id,
    sessionName: session.name,
    date: toLocalDateString(options.now),
    startedAt: toLocalIsoString(options.now),
    completedAt: null,
    durationSec: null,
    status: 'in_progress',
    executionOrder: [],
    exerciseRecords: exercises.map(
      (exercise): WorkoutExercise => ({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        programExerciseId: exercise.id,
        status: 'pending',
        restSec: exercise.restSec,
        targetSets: structuredClone(exercise.sets),
        actualSets: [],
        sensation: null,
        comment: null,
      }),
    ),
    cardioRecords: [],
    notes: null,
  };
}

// --- Exercices --------------------------------------------------------------

export function findRecord(workout: WorkoutSession, programExerciseId: string): WorkoutExercise {
  const record = workout.exerciseRecords.find((r) => r.programExerciseId === programExerciseId);
  if (!record) throw new DomainError(t.unknownExercise(programExerciseId));
  return record;
}

/** Remplace un exercice et inscrit son passage dans l'ordre réel d'exécution. */
function updateRecord(
  workout: WorkoutSession,
  programExerciseId: string,
  update: (record: WorkoutExercise) => WorkoutExercise,
): WorkoutSession {
  const record = findRecord(workout, programExerciseId);
  const updated = update(record);
  return {
    ...workout,
    exerciseRecords: workout.exerciseRecords.map((r) => (r === record ? updated : r)),
    executionOrder: workout.executionOrder.includes(programExerciseId)
      ? workout.executionOrder
      : [...workout.executionOrder, programExerciseId],
  };
}

const sortBySetNumber = (sets: ActualSet[]): ActualSet[] => [...sets].sort((a, b) => a.setNumber - b.setNumber);

export interface ActualValuesPatch {
  actualReps?: number | null;
  actualWeightKg?: number | null;
}

function assertActualValues(patch: ActualValuesPatch): void {
  if (patch.actualReps !== undefined && !isValidReps(patch.actualReps)) {
    throw new DomainError(t.invalidValue(strings.values.reps));
  }
  if (patch.actualWeightKg !== undefined && !isValidWeightKg(patch.actualWeightKg)) {
    throw new DomainError(t.invalidValue(strings.values.weight));
  }
}

/** Saisie réelle d'une série (prescrite ou extra). Les valeurs sont celles tapées par l'utilisateur. */
export function setActualValues(
  workout: WorkoutSession,
  programExerciseId: string,
  setNumber: number,
  patch: ActualValuesPatch,
): WorkoutSession {
  assertActualValues(patch);
  return updateRecord(workout, programExerciseId, (record) => {
    const existing = record.actualSets.find((s) => s.setNumber === setNumber);
    const prescribed = record.targetSets.some((s) => s.setNumber === setNumber);
    if (!existing && !prescribed) throw new DomainError(t.unknownSet(setNumber));

    const base: ActualSet = existing ?? { setNumber, actualReps: null, actualWeightKg: null, isExtra: false };
    const next: ActualSet = {
      ...base,
      ...(patch.actualReps !== undefined && { actualReps: patch.actualReps }),
      ...(patch.actualWeightKg !== undefined && { actualWeightKg: patch.actualWeightKg }),
    };
    const others = record.actualSets.filter((s) => s.setNumber !== setNumber);
    return { ...record, actualSets: sortBySetNumber([...others, next]) };
  });
}

/**
 * Valeurs que « Comme prévu » peut remplir : uniquement les cibles exactes
 * (SPEC §6). Une plage de reps ou une charge `null` ne remplit rien.
 */
export function asPlannedValues(target: ProgramSet): { actualReps?: number; actualWeightKg?: number } {
  return {
    ...(!isRangeTarget(target) && { actualReps: target.targetReps }),
    ...(target.targetWeightKg !== null && { actualWeightKg: target.targetWeightKg }),
  };
}

/** Le bouton « Comme prévu » est masqué si rien n'est remplissable. */
export const canFillAsPlanned = (target: ProgramSet): boolean => Object.keys(asPlannedValues(target)).length > 0;

/** Action explicite « Comme prévu » sur une série prescrite. */
export function applyAsPlanned(workout: WorkoutSession, programExerciseId: string, setNumber: number): WorkoutSession {
  const target = findRecord(workout, programExerciseId).targetSets.find((s) => s.setNumber === setNumber);
  if (!target) throw new DomainError(t.unknownSet(setNumber));
  return setActualValues(workout, programExerciseId, setNumber, asPlannedValues(target));
}

/** « + Série » : série extra, numérotation continue, sans objectif. */
export function addExtraSet(workout: WorkoutSession, programExerciseId: string): WorkoutSession {
  return updateRecord(workout, programExerciseId, (record) => {
    const numbers = [...record.targetSets, ...record.actualSets].map((s) => s.setNumber);
    const setNumber = Math.max(0, ...numbers) + 1;
    const extra: ActualSet = { setNumber, actualReps: null, actualWeightKg: null, isExtra: true };
    return { ...record, actualSets: [...record.actualSets, extra] };
  });
}

export function setSensation(workout: WorkoutSession, programExerciseId: string, sensation: Sensation | null): WorkoutSession {
  return updateRecord(workout, programExerciseId, (record) => ({ ...record, sensation }));
}

export function setComment(workout: WorkoutSession, programExerciseId: string, comment: string): WorkoutSession {
  const value = comment.trim() === '' ? null : comment;
  return updateRecord(workout, programExerciseId, (record) => ({ ...record, comment: value }));
}

/** Valider un exercice : `completed`, sans rien verrouiller ni terminer la séance. */
export function validateExercise(workout: WorkoutSession, programExerciseId: string): WorkoutSession {
  return updateRecord(workout, programExerciseId, (record) => ({ ...record, status: 'completed' }));
}

// --- Cardio -----------------------------------------------------------------

export function addCardioEntry(workout: WorkoutSession, type: CardioType): WorkoutSession {
  const entry: CardioEntry = { type, name: '', durationSec: null, speedKmh: null, inclinePct: null, notes: null };
  return { ...workout, cardioRecords: [...workout.cardioRecords, entry] };
}

export function updateCardioEntry(
  workout: WorkoutSession,
  index: number,
  patch: Partial<CardioEntry>,
): WorkoutSession {
  const current = workout.cardioRecords[index];
  if (!current) throw new DomainError(t.unknownCardio);
  if (patch.durationSec !== undefined && !isValidDurationSec(patch.durationSec)) {
    throw new DomainError(t.invalidValue(strings.values.duration));
  }
  if (patch.speedKmh !== undefined && !isValidSpeedKmh(patch.speedKmh)) {
    throw new DomainError(t.invalidValue(strings.values.speed));
  }
  if (patch.inclinePct !== undefined && !isValidInclinePct(patch.inclinePct)) {
    throw new DomainError(t.invalidValue(strings.values.incline));
  }
  const updated = { ...current, ...patch };
  return { ...workout, cardioRecords: workout.cardioRecords.map((e, i) => (i === index ? updated : e)) };
}

// --- Cycle de vie -------------------------------------------------------------

function assertInProgress(workout: WorkoutSession): void {
  if (workout.status !== 'in_progress') throw new DomainError(t.notInProgress);
}

/** « Terminer la séance » : autorisé même si des exercices restent `pending`. */
export function finishWorkout(workout: WorkoutSession, now: Date): WorkoutSession {
  assertInProgress(workout);
  const completedAt = toLocalIsoString(now);
  return { ...workout, status: 'completed', completedAt, durationSec: secondsBetween(workout.startedAt, completedAt) };
}

/** Abandon : les données saisies sont conservées. */
export function abandonWorkout(workout: WorkoutSession): WorkoutSession {
  assertInProgress(workout);
  return { ...workout, status: 'abandoned' };
}

/** Édition rétroactive de la date d'une séance. */
export function setWorkoutDate(workout: WorkoutSession, date: string): WorkoutSession {
  if (!isValidLocalDate(date)) throw new DomainError(t.invalidValue(strings.values.date));
  return { ...workout, date };
}

/** Nombre d'exercices validés, pour la progression « 2 / 6 ». */
export const countValidatedExercises = (workout: WorkoutSession): number =>
  workout.exerciseRecords.filter((r) => r.status === 'completed').length;
