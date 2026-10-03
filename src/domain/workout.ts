/**
 * Règles pures d'une séance réelle. Chaque fonction retourne une nouvelle séance
 * sans modifier l'entrée. Les objectifs (`targetSets`) ne sont jamais modifiés :
 * aucune fonction de ce module n'y écrit (SPEC §5.3).
 */
import { strings } from '../i18n/strings';
import { daysBetween, secondsBetween, shiftIsoByDays, toLocalDateString, toLocalIsoString } from '../utils/dates';
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

/** Texte facultatif saisi : espaces de début et de fin retirés ; vide → `null` (non renseigné). */
export function normalizeText(text: string | null): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

export function setComment(workout: WorkoutSession, programExerciseId: string, comment: string): WorkoutSession {
  const value = normalizeText(comment);
  return updateRecord(workout, programExerciseId, (record) => ({ ...record, comment: value }));
}

/**
 * Nettoyage des textes à l'enregistrement : commentaires d'exercice, notes de séance et de
 * cardio (vides → `null`), nom de cardio (trim ; reste une chaîne, car `name` n'est pas
 * nullable dans le contrat JSON).
 */
export function sanitizeWorkoutTexts(workout: WorkoutSession): WorkoutSession {
  return {
    ...workout,
    notes: normalizeText(workout.notes),
    exerciseRecords: workout.exerciseRecords.map((r) => ({ ...r, comment: normalizeText(r.comment) })),
    cardioRecords: workout.cardioRecords.map((c) => ({ ...c, name: c.name.trim(), notes: normalizeText(c.notes) })),
  };
}

export interface IncompleteSets {
  /** Séries prescrites avec une charge mais sans répétitions. */
  missingReps: number[];
  /** Séries prescrites avec des répétitions mais sans charge, alors qu'une charge est prévue. */
  missingWeight: number[];
}

/**
 * Séries prescrites partiellement remplies (avertissement non bloquant à la validation).
 * Une série entièrement vide n'est pas signalée (série non faite, cas normal). Une série
 * au poids du corps (charge prévue `null`) avec seulement des reps est complète.
 */
export function findIncompleteSets(record: WorkoutExercise): IncompleteSets {
  const result: IncompleteSets = { missingReps: [], missingWeight: [] };
  for (const target of record.targetSets) {
    const actual = record.actualSets.find((s) => s.setNumber === target.setNumber);
    if (!actual) continue;
    const hasReps = actual.actualReps !== null;
    const hasWeight = actual.actualWeightKg !== null;
    if (hasWeight && !hasReps) result.missingReps.push(target.setNumber);
    else if (hasReps && !hasWeight && target.targetWeightKg !== null) result.missingWeight.push(target.setNumber);
  }
  return result;
}

/**
 * Séance vide : rien n'a été saisi (aucune valeur de série, aucun cardio, ni sensation,
 * ni commentaire, ni note). Seule une séance vide peut être supprimée à l'abandon.
 */
export function isWorkoutEmpty(workout: WorkoutSession): boolean {
  return (
    workout.cardioRecords.length === 0 &&
    workout.notes === null &&
    workout.exerciseRecords.every(
      (r) =>
        r.sensation === null &&
        r.comment === null &&
        r.actualSets.every((s) => s.actualReps === null && s.actualWeightKg === null),
    )
  );
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
  const updated: CardioEntry = {
    ...current,
    ...patch,
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.notes !== undefined && { notes: normalizeText(patch.notes) }),
  };
  return { ...workout, cardioRecords: workout.cardioRecords.map((e, i) => (i === index ? updated : e)) };
}

/** Retire une entrée cardio ajoutée par erreur. L'UI DOIT demander une confirmation explicite. */
export function removeCardioEntry(workout: WorkoutSession, index: number): WorkoutSession {
  if (!workout.cardioRecords[index]) throw new DomainError(t.unknownCardio);
  return { ...workout, cardioRecords: workout.cardioRecords.filter((_, i) => i !== index) };
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
  // startedAt / completedAt suivent la date : même décalage en jours, heures conservées,
  // offset local du nouveau jour. La durée mesurée (durationSec) n'est pas modifiée.
  const days = daysBetween(workout.date, date);
  if (days === 0) return { ...workout, date };
  return {
    ...workout,
    date,
    startedAt: shiftIsoByDays(workout.startedAt, days),
    completedAt: workout.completedAt === null ? null : shiftIsoByDays(workout.completedAt, days),
  };
}

/** Nombre d'exercices validés, pour la progression « 2 / 6 ». */
export const countValidatedExercises = (workout: WorkoutSession): number =>
  workout.exerciseRecords.filter((r) => r.status === 'completed').length;
