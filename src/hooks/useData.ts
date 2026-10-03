import { useLiveQuery } from 'dexie-react-hooks';
import type { WeightEntry } from '../domain/types';
import { listWeights } from '../services/weightService';
import type { ExerciseSummary, RecentProgression } from '../domain/stats';
import type { ProgramSession, StoredProgram, WorkoutSession } from '../domain/types';
import { listWorkouts } from '../services/historyService';
import { getActiveProgram, getProgram } from '../services/programService';
import { getRecentProgress, getTrackedExercises } from '../services/statisticsService';
import { getLastCoachExportAt, getLastExportAt } from '../services/settingsService';
import { getInProgressWorkout, getNextSessionForActiveProgram, getWorkout } from '../services/workoutService';

/**
 * Lectures réactives de la base : se mettent à jour à chaque écriture.
 * `undefined` = chargement en cours ; `null` = absent.
 */
export const useActiveProgram = (): StoredProgram | null | undefined => useLiveQuery(getActiveProgram, []);

export const useTrackedExercises = (): ExerciseSummary[] | undefined => useLiveQuery(getTrackedExercises, []);

export const useInProgressWorkout = (): WorkoutSession | null | undefined => useLiveQuery(getInProgressWorkout, []);

export const useWorkout = (id: string): WorkoutSession | null | undefined => useLiveQuery(() => getWorkout(id), [id]);

/** Toutes les séances, de la plus récente à la plus ancienne. */
export const useWorkouts = (): WorkoutSession[] | undefined => useLiveQuery(listWorkouts, []);

export const useNextSession = (): ProgramSession | null | undefined => useLiveQuery(getNextSessionForActiveProgram, []);

export const useProgram = (programId: string | undefined): StoredProgram | null | undefined =>
  useLiveQuery(() => (programId === undefined ? Promise.resolve(null) : getProgram(programId)), [programId]);

export const useRecentProgress = (): RecentProgression[] | undefined => useLiveQuery(() => getRecentProgress(3), []);

export const useLastExportAt = (): string | null | undefined => useLiveQuery(getLastExportAt, []);

export const useLastCoachExportAt = (): string | null | undefined => useLiveQuery(getLastCoachExportAt, []);

/** Pesées, par date croissante (V1.2). */
export const useWeights = (): WeightEntry[] | undefined => useLiveQuery(listWeights, []);
