import { DRIVE_TRIGGERS, notifyDriveQueued, queueDriveTasks } from './driveOutbox';
import { db } from '../db/database';
import type { WorkoutSession } from '../domain/types';

/** Historique : séances en ordre chronologique inverse (SPEC §7.7). */
export async function listWorkouts(): Promise<WorkoutSession[]> {
  const workouts = await db.workouts.toArray();
  return workouts.sort((a, b) => (a.date === b.date ? Date.parse(b.startedAt) - Date.parse(a.startedAt) : a.date < b.date ? 1 : -1));
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
