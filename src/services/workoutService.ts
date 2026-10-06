import { db } from '../db/database';
import { DomainError } from '../domain/errors';
import { getNextSession } from '../domain/rotation';
import type { ProgramSession, WorkoutSession } from '../domain/types';
import { abandonWorkout as abandon, assertChangedSetValues, createWorkout, finishWorkout as finish, isWorkoutEmpty, sanitizeWorkoutTexts } from '../domain/workout';
import { strings } from '../i18n/strings';
import { workoutSessionSchema } from '../schemas/history.schema';
import { createId } from '../utils/ids';
import { getActiveProgramId } from './settingsService';
import { DRIVE_TRIGGERS, notifyDriveQueued, queueDriveTasks } from './driveOutbox';
import { isCoachExportable } from '../domain/coachExport';

const t = strings.workout;

/** Démarre une séance du programme actif. Refusé si une séance est déjà en cours (SPEC §6). */
export async function startWorkout(
  programSessionId: string,
  options: { now?: Date; id?: string } = {},
): Promise<WorkoutSession> {
  return db.transaction('rw', db.programs, db.workouts, db.settings, async () => {
    if ((await db.workouts.where('status').equals('in_progress').count()) > 0) {
      throw new DomainError(t.alreadyInProgress);
    }
    const programId = await getActiveProgramId();
    const program = programId === null ? undefined : await db.programs.get(programId);
    if (!program) throw new DomainError(t.noActiveProgram);

    const workout = createWorkout(program, programSessionId, {
      id: options.id ?? createId(),
      now: options.now ?? new Date(),
    });
    await db.workouts.add(workout);
    return workout;
  });
}

export async function getInProgressWorkout(): Promise<WorkoutSession | null> {
  return (await db.workouts.where('status').equals('in_progress').first()) ?? null;
}

export async function getWorkout(id: string): Promise<WorkoutSession | null> {
  return (await db.workouts.get(id)) ?? null;
}

/**
 * Applique une modification (fonction pure du domaine) et la persiste, en une transaction.
 * Le résultat est revalidé par le schéma du contrat : aucune donnée invalide n'est écrite.
 */
export async function updateWorkout(id: string, update: (workout: WorkoutSession) => WorkoutSession): Promise<WorkoutSession> {
  // `settings` dans la portée : l'intention d'envoi Drive est écrite avec la séance (atomique).
  return db.transaction('rw', [db.workouts, db.settings], async () => {
    const current = await db.workouts.get(id);
    if (!current) throw new DomainError(t.notFound);
    // Textes nettoyés à chaque enregistrement (trim, vide → null), puis revalidation du contrat.
    const next = workoutSessionSchema.parse(sanitizeWorkoutTexts(update(current)));
    if (next.id !== current.id) throw new DomainError(t.notFound);
    if (next.status === 'in_progress' && current.status !== 'in_progress') throw new DomainError(t.notInProgress);
    // Garde-fous de saisie (V1.3.2) sur les seules valeurs nouvelles ou modifiées.
    assertChangedSetValues(current, next);
    await db.workouts.put(next);
    // Archive Drive (V1.3) : séance terminée, abandonnée avec données ou corrigée (§7) → séance +
    // sauvegarde en file, dans la même transaction (sans effet si l'envoi n'est pas activé).
    if (isCoachExportable(next)) await queueDriveTasks(DRIVE_TRIGGERS.sessionSaved(next.id));
    return next;
  }).then((saved) => {
    notifyDriveQueued();
    return saved;
  });
}

/** « Terminer la séance » : enregistre la séance telle quelle. */
export const finishWorkout = (id: string, now: Date = new Date()): Promise<WorkoutSession> =>
  updateWorkout(id, (w) => finish(w, now));

/** Abandon : statut `abandoned`, données conservées. */
export const abandonWorkout = (id: string): Promise<WorkoutSession> => updateWorkout(id, abandon);

/** Prochaine séance du programme actif, `null` sans programme. */
export async function getNextSessionForActiveProgram(): Promise<ProgramSession | null> {
  const programId = await getActiveProgramId();
  const program = programId === null ? undefined : await db.programs.get(programId);
  if (!program) return null;
  const workouts = await db.workouts.where('programId').equals(program.programId).toArray();
  return getNextSession(program, workouts);
}

/**
 * Supprime une séance en cours **vide** (proposé à l'abandon, après confirmation explicite).
 * Vérifié dans la transaction : une séance contenant la moindre saisie n'est jamais supprimée ici.
 */
export async function deleteEmptyWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const workout = await db.workouts.get(id);
    if (!workout) throw new DomainError(t.notFound);
    if (workout.status !== 'in_progress') throw new DomainError(t.notInProgress);
    if (!isWorkoutEmpty(workout)) throw new DomainError(t.notEmpty);
    await db.workouts.delete(id);
  });
}
