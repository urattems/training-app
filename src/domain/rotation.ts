import type { ProgramSession, TrainingProgram, WorkoutSession } from './types';

/**
 * Prochaine séance (SPEC §6) : celle qui suit, par `order`, la dernière séance
 * terminée du programme actif, avec retour à la première. Sans séance terminée :
 * la séance d'`order` le plus bas. Les séances abandonnées ne font pas avancer la rotation.
 */
export function getNextSession(program: TrainingProgram, workouts: readonly WorkoutSession[]): ProgramSession {
  const sessions = [...program.sessions].sort((a, b) => a.order - b.order);
  const first = sessions[0];
  if (!first) throw new Error('Programme sans séance');

  const lastCompleted = workouts
    .filter((w) => w.programId === program.programId && w.status === 'completed' && w.completedAt !== null)
    .reduce<WorkoutSession | null>(
      (latest, w) => (latest === null || Date.parse(w.completedAt ?? '') > Date.parse(latest.completedAt ?? '') ? w : latest),
      null,
    );
  if (!lastCompleted) return first;

  const index = sessions.findIndex((s) => s.id === lastCompleted.programSessionId);
  if (index === -1) return first;
  return sessions[(index + 1) % sessions.length] ?? first;
}
