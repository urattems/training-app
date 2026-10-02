/**
 * Types métier. Tout ce qui appartient au contrat JSON (SPEC §11) est dérivé
 * des schémas Zod (`z.infer`) : une seule source de vérité. Seuls les champs
 * internes à l'app étendent ces types.
 */
import type { TrainingProgram } from '../schemas/program.schema';

export type {
  ExactTargetSet,
  ProgramCardio,
  ProgramExercise,
  ProgramSession,
  ProgramSet,
  ProgramWeek,
  RangeTargetSet,
  TrainingProgram,
} from '../schemas/program.schema';

export type {
  ActualSet,
  CardioEntry,
  CardioType,
  ExerciseStatus,
  HistoryExport,
  Sensation,
  UserPreferences,
  WorkoutExercise,
  WorkoutSession,
  WorkoutStatus,
} from '../schemas/history.schema';

/** Programme tel que stocké : contrat JSON + métadonnées internes (retirées à l'export). */
export type StoredProgram = TrainingProgram & {
  importedAt: string;
  /** Informatif uniquement : le programme actif est `settings.activeProgramId`. */
  archivedAt: string | null;
};
