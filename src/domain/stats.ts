/**
 * Statistiques et séries de graphiques — valeurs RÉELLES uniquement (SPEC §6, §12).
 * Les objectifs (`targetSets`) ne sont jamais lus ici.
 *
 * Règles (DECISIONS.md) :
 * - séances `completed` et `abandoned` comptent (leurs données sont réelles), `in_progress` jamais ;
 * - le « nombre de séances » ne compte que les séances `completed` ;
 * - une série est « réalisée » si ses reps sont renseignées et > 0 ;
 * - volume = reps × kg ; séries sans reps ou sans charge ignorées ; pas de volume cardio.
 */
import { formatDecimal } from '../utils/numbers';
import { strings } from '../i18n/strings';
import type { ActualSet, WorkoutExercise, WorkoutSession } from './types';

// --- Briques ------------------------------------------------------------------

export const countsForStats = (workout: WorkoutSession): boolean => workout.status !== 'in_progress';

export const isPerformedSet = (set: ActualSet): boolean => set.actualReps !== null && set.actualReps > 0;

export const setVolume = (set: ActualSet): number =>
  set.actualReps !== null && set.actualWeightKg !== null ? set.actualReps * set.actualWeightKg : 0;

export const exerciseVolume = (record: WorkoutExercise): number =>
  record.actualSets.reduce((sum, set) => sum + setVolume(set), 0);

export const workoutVolume = (workout: WorkoutSession): number =>
  workout.exerciseRecords.reduce((sum, record) => sum + exerciseVolume(record), 0);

/** Charge maximale réellement utilisée sur les séries réalisées, `null` si aucune. */
export function maxLoadKg(record: WorkoutExercise): number | null {
  const loads = record.actualSets
    .filter((s) => isPerformedSet(s) && s.actualWeightKg !== null)
    .map((s) => s.actualWeightKg ?? 0);
  return loads.length > 0 ? Math.max(...loads) : null;
}

/** Meilleure série en reps, `null` si aucune série réalisée. */
export function maxReps(record: WorkoutExercise): number | null {
  const reps = record.actualSets.filter(isPerformedSet).map((s) => s.actualReps ?? 0);
  return reps.length > 0 ? Math.max(...reps) : null;
}

/** Nombre de séances terminées (`completed` uniquement). */
export const countCompletedWorkouts = (workouts: readonly WorkoutSession[]): number =>
  workouts.filter((w) => w.status === 'completed').length;

// --- Entrées par exercice -----------------------------------------------------

export interface ExerciseEntry {
  workoutId: string;
  date: string;
  startedAt: string;
  status: WorkoutSession['status'];
  record: WorkoutExercise;
}

const chronological = (a: { date: string; startedAt: string }, b: { date: string; startedAt: string }): number =>
  a.date === b.date ? Date.parse(a.startedAt) - Date.parse(b.startedAt) : a.date < b.date ? -1 : 1;

/** Toutes les occurrences réelles d'un exercice (clé : `programExerciseId`), ordre chronologique. */
export function getExerciseEntries(workouts: readonly WorkoutSession[], programExerciseId: string): ExerciseEntry[] {
  const entries: ExerciseEntry[] = [];
  for (const workout of workouts) {
    if (!countsForStats(workout)) continue;
    const record = workout.exerciseRecords.find((r) => r.programExerciseId === programExerciseId);
    if (record) {
      entries.push({ workoutId: workout.id, date: workout.date, startedAt: workout.startedAt, status: workout.status, record });
    }
  }
  return entries.sort(chronological);
}

// --- Séries de graphiques -----------------------------------------------------

interface PointBase {
  workoutId: string;
  date: string;
  startedAt: string;
  exerciseName: string;
}

/** 1 point = 1 exercice dans 1 séance = charge max réelle ; séries réalisées pour la carte de détail. */
export interface LoadPoint extends PointBase {
  maxLoadKg: number;
  sets: ActualSet[];
}

export interface VolumePoint extends PointBase {
  volumeKg: number;
}

export interface RepPoint extends PointBase {
  maxReps: number;
  sets: ActualSet[];
}

const base = (e: ExerciseEntry): PointBase => ({
  workoutId: e.workoutId,
  date: e.date,
  startedAt: e.startedAt,
  exerciseName: e.record.exerciseName,
});

export function getExerciseLoadHistory(workouts: readonly WorkoutSession[], programExerciseId: string): LoadPoint[] {
  return getExerciseEntries(workouts, programExerciseId).flatMap((e) => {
    const load = maxLoadKg(e.record);
    return load === null ? [] : [{ ...base(e), maxLoadKg: load, sets: e.record.actualSets.filter(isPerformedSet) }];
  });
}

export function getExerciseVolumeHistory(workouts: readonly WorkoutSession[], programExerciseId: string): VolumePoint[] {
  return getExerciseEntries(workouts, programExerciseId).flatMap((e) => {
    const volumeKg = exerciseVolume(e.record);
    return volumeKg > 0 ? [{ ...base(e), volumeKg }] : [];
  });
}

export function getExerciseRepHistory(workouts: readonly WorkoutSession[], programExerciseId: string): RepPoint[] {
  return getExerciseEntries(workouts, programExerciseId).flatMap((e) => {
    const reps = maxReps(e.record);
    return reps === null ? [] : [{ ...base(e), maxReps: reps, sets: e.record.actualSets.filter(isPerformedSet) }];
  });
}

/** Graphique de charge s'il existe au moins une charge réelle, sinon reps max (poids du corps). */
export const chartMetricFor = (workouts: readonly WorkoutSession[], programExerciseId: string): 'load' | 'reps' =>
  getExerciseLoadHistory(workouts, programExerciseId).length > 0 ? 'load' : 'reps';

// --- Records et stats ---------------------------------------------------------

export interface RepRecord {
  weightKg: number;
  reps: number;
  date: string;
  workoutId: string;
}

/** Meilleure série à charge donnée : pour chaque charge, le maximum de reps (première occurrence). */
export function getRepRecordsByLoad(workouts: readonly WorkoutSession[], programExerciseId: string): RepRecord[] {
  const byLoad = new Map<number, RepRecord>();
  for (const e of getExerciseEntries(workouts, programExerciseId)) {
    for (const set of e.record.actualSets) {
      if (!isPerformedSet(set) || set.actualWeightKg === null) continue;
      const reps = set.actualReps ?? 0;
      const current = byLoad.get(set.actualWeightKg);
      if (!current || reps > current.reps) {
        byLoad.set(set.actualWeightKg, { weightKg: set.actualWeightKg, reps, date: e.date, workoutId: e.workoutId });
      }
    }
  }
  return [...byLoad.values()].sort((a, b) => b.weightKg - a.weightKg);
}

export interface ExerciseStats {
  lastLoadKg: number | null;
  lastDate: string | null;
  bestLoadKg: number | null;
  bestLoadDate: string | null;
  /** Série la plus lourde (à égalité, la plus longue). */
  bestSet: RepRecord | null;
  lastSessionVolumeKg: number | null;
  maxSessionVolumeKg: number | null;
  /** Séances `completed` où l'exercice a au moins une série réalisée. */
  completedSessionCount: number;
}

export function getExerciseStats(workouts: readonly WorkoutSession[], programExerciseId: string): ExerciseStats {
  const loads = getExerciseLoadHistory(workouts, programExerciseId);
  const volumes = getExerciseVolumeHistory(workouts, programExerciseId);
  const last = loads[loads.length - 1] ?? null;
  const best = loads.reduce<LoadPoint | null>((b, p) => (b === null || p.maxLoadKg > b.maxLoadKg ? p : b), null);
  const lastEntry = getExerciseEntries(workouts, programExerciseId).at(-1) ?? null;

  return {
    lastLoadKg: last?.maxLoadKg ?? null,
    lastDate: lastEntry?.date ?? null,
    bestLoadKg: best?.maxLoadKg ?? null,
    bestLoadDate: best?.date ?? null,
    bestSet: getRepRecordsByLoad(workouts, programExerciseId)[0] ?? null,
    lastSessionVolumeKg: volumes.at(-1)?.volumeKg ?? null,
    maxSessionVolumeKg: volumes.length > 0 ? Math.max(...volumes.map((v) => v.volumeKg)) : null,
    completedSessionCount: getExerciseEntries(workouts, programExerciseId).filter(
      (e) => e.status === 'completed' && e.record.actualSets.some(isPerformedSet),
    ).length,
  };
}

// --- Périodes -----------------------------------------------------------------

export const PERIODS = ['1M', '3M', '6M', '1A', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const PERIOD_MONTHS: Record<Exclude<Period, 'all'>, number> = { '1M': 1, '3M': 3, '6M': 6, '1A': 12 };

/** Première date incluse (`YYYY-MM-DD`) d'une période, `null` pour « Tout ». */
export function periodStart(period: Period, today: string): string | null {
  if (period === 'all') return null;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, m - 1 - PERIOD_MONTHS[period], 1));
  // Jour borné à la fin du mois (31 mars - 1 mois → 28/29 février).
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(d, lastDay));
  return start.toISOString().slice(0, 10);
}

export function filterByPeriod<T extends { date: string }>(points: readonly T[], period: Period, today: string): T[] {
  const start = periodStart(period, today);
  return start === null ? [...points] : points.filter((p) => p.date >= start && p.date <= today);
}

// --- Progression factuelle ---------------------------------------------------

/** Écart de charge max entre les deux dernières séances, `null` s'il n'y en a pas deux. */
export function lastLoadDelta(points: readonly LoadPoint[]): number | null {
  const last = points.at(-1);
  const previous = points.at(-2);
  return last && previous ? Math.round((last.maxLoadKg - previous.maxLoadKg) * 100) / 100 : null;
}

/** Écart signé : « +2,5 kg », « −2,5 kg », « 0 kg ». */
export function formatSignedKg(deltaKg: number): string {
  const sign = deltaKg > 0 ? '+' : deltaKg < 0 ? '−' : '';
  return `${sign}${formatDecimal(Math.abs(deltaKg))} kg`;
}

/** Texte factuel, jamais de conseil : « +2,5 kg vs séance précédente ». */
export function formatLoadDelta(deltaKg: number): string {
  return deltaKg === 0 ? strings.progress.sameLoad : strings.progress.loadDelta(formatSignedKg(deltaKg));
}

export interface ExerciseSummary {
  programExerciseId: string;
  exerciseName: string;
  lastDate: string;
}

/** Exercices présents dans l'historique réel (nom le plus récent), triés par nom. */
export function listTrackedExercises(workouts: readonly WorkoutSession[]): ExerciseSummary[] {
  const latest = new Map<string, { workout: WorkoutSession; record: WorkoutExercise }>();
  for (const workout of workouts) {
    if (!countsForStats(workout)) continue;
    for (const record of workout.exerciseRecords) {
      if (!record.actualSets.some(isPerformedSet)) continue;
      const current = latest.get(record.programExerciseId);
      if (!current || chronological(current.workout, workout) < 0) {
        latest.set(record.programExerciseId, { workout, record });
      }
    }
  }
  return [...latest.values()]
    .map(({ workout, record }) => ({
      programExerciseId: record.programExerciseId,
      exerciseName: record.exerciseName,
      lastDate: workout.date,
    }))
    .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName, 'fr'));
}

export interface RecentProgression {
  programExerciseId: string;
  exerciseName: string;
  deltaKg: number;
  date: string;
}

/** Variations de charge récentes non nulles (accueil, SPEC §7.2), les plus récentes d'abord. */
export function getRecentProgressions(workouts: readonly WorkoutSession[], limit = 3): RecentProgression[] {
  return listTrackedExercises(workouts)
    .flatMap((exercise) => {
      const points = getExerciseLoadHistory(workouts, exercise.programExerciseId);
      const delta = lastLoadDelta(points);
      const last = points.at(-1);
      return delta === null || delta === 0 || !last
        ? []
        : [{ programExerciseId: exercise.programExerciseId, exerciseName: last.exerciseName, deltaKg: delta, date: last.date, startedAt: last.startedAt }];
    })
    .sort((a, b) => -chronological(a, b))
    .slice(0, limit)
    .map(({ programExerciseId, exerciseName, deltaKg, date }) => ({ programExerciseId, exerciseName, deltaKg, date }));
}
