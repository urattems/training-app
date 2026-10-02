import { useLiveQuery } from 'dexie-react-hooks';
import type { StoredProgram } from '../domain/types';
import type { ExerciseSummary } from '../domain/stats';
import { getActiveProgram } from '../services/programService';
import { getTrackedExercises } from '../services/statisticsService';

/**
 * Lectures réactives de la base : se mettent à jour à chaque écriture.
 * `undefined` = chargement en cours.
 */
export const useActiveProgram = (): StoredProgram | null | undefined => useLiveQuery(getActiveProgram, []);

export const useTrackedExercises = (): ExerciseSummary[] | undefined => useLiveQuery(getTrackedExercises, []);
