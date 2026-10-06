import { DRIVE_TRIGGERS, notifyDriveQueued, queueDriveTasks } from './driveOutbox';
import { db } from '../db/database';
import { DomainError } from '../domain/errors';
import type { WorkoutSession } from '../domain/types';
import { strings } from '../i18n/strings';

/** Historique : séances en ordre chronologique inverse (SPEC §7.7). */
export async function listWorkouts(): Promise<WorkoutSession[]> {
  const workouts = await db.workouts.toArray();
  return workouts.sort((a, b) => (a.date === b.date ? Date.parse(b.startedAt) - Date.parse(a.startedAt) : a.date < b.date ? 1 : -1));
}

/**
 * Suppression d'une séance ABANDONNÉE (V1.3.3 : balayage dans l'historique ou bouton du détail).
 * Exception stricte à « aucune donnée perdue » : vérifiée DANS la transaction, une séance terminée
 * ou en cours est refusée (rien n'est supprimé). Rien d'autre n'est supprimé (pas de cascade).
 * L'UI DOIT demander une confirmation explicite avant l'appel.
 */
export async function deleteAbandonedWorkout(id: string): Promise<void> {
  await db.transaction('rw', [db.workouts, db.settings], async () => {
    const workout = await db.workouts.get(id);
    if (!workout) throw new DomainError(strings.workout.notFound);
    if (workout.status !== 'abandoned') throw new DomainError(strings.history.notAbandoned);
    await db.workouts.delete(id);
    // Archive Drive : même intention que toute suppression (`mark_deleted`, jamais d'effacement).
    await queueDriveTasks(DRIVE_TRIGGERS.sessionDeleted(id));
  });
  notifyDriveQueued();
}

/** Suppression d'une séance. L'UI DOIT demander une confirmation explicite avant l'appel. */
export async function deleteWorkout(id: string): Promise<void> {
  // Archive Drive (V1.3) : le fichier n'est jamais supprimé, la suppression est notée (`mark_deleted`) ;
  // l'intention est écrite dans la même transaction que la suppression.
  await db.transaction('rw', [db.workouts, db.settings], async () => {
    await db.workouts.delete(id);
    await queueDriveTasks(DRIVE_TRIGGERS.sessionDeleted(id));
  });
  notifyDriveQueued();
}
