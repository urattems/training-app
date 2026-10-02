import { db } from '../db/database';
import {
  chartMetricFor,
  getExerciseLoadHistory,
  getExerciseRepHistory,
  getExerciseStats,
  getExerciseVolumeHistory,
  getRecentProgressions,
  listTrackedExercises,
  type ExerciseStats,
  type ExerciseSummary,
  type LoadPoint,
  type RecentProgression,
  type RepPoint,
  type VolumePoint,
} from '../domain/stats';

export interface ExerciseProgress {
  metric: 'load' | 'reps';
  load: LoadPoint[];
  reps: RepPoint[];
  volume: VolumePoint[];
  stats: ExerciseStats;
}

const allWorkouts = () => db.workouts.toArray();

export async function getExerciseProgress(programExerciseId: string): Promise<ExerciseProgress> {
  const workouts = await allWorkouts();
  return {
    metric: chartMetricFor(workouts, programExerciseId),
    load: getExerciseLoadHistory(workouts, programExerciseId),
    reps: getExerciseRepHistory(workouts, programExerciseId),
    volume: getExerciseVolumeHistory(workouts, programExerciseId),
    stats: getExerciseStats(workouts, programExerciseId),
  };
}

export async function getTrackedExercises(): Promise<ExerciseSummary[]> {
  return listTrackedExercises(await allWorkouts());
}

export async function getRecentProgress(limit = 3): Promise<RecentProgression[]> {
  return getRecentProgressions(await allWorkouts(), limit);
}
