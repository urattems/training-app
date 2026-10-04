/**
 * Contenu d'un fichier de séance de l'archive Drive (V1.3 spec §5) : un `training_coach_export`
 * 1.1 contenant CETTE seule séance et son programme, validé par son schéma AVANT tout envoi.
 */
import { isCoachExportable } from '../domain/coachExport';
import type { WorkoutSession } from '../domain/types';
import type { CoachExport } from '../schemas/coachExport.schema';
import { serializeCoachExport, toCoachExport, verifyCoachExportIntegrity } from './coachExportService';
import type { StoredData } from './exportService';

export interface SessionArchive {
  data: CoachExport;
  content: string;
  meta: {
    kind: 'session';
    sessionId: string;
    date: string;
    sessionName: string;
    status: WorkoutSession['status'];
    programId: string;
    weekLabel: string;
  };
}

/**
 * `null` si la séance n'est plus exportable (en cours, vide, disparue) : la tâche est alors
 * abandonnée sans erreur. Lève `ExportIntegrityError` si le contenu ne passe pas son schéma.
 */
export function buildSessionArchive(stored: StoredData, sessionId: string, exportedAt: string): SessionArchive | null {
  const session = stored.workouts.find((w) => w.id === sessionId);
  if (!session || !isCoachExportable(session)) return null;
  const program = stored.programs.find((p) => p.programId === session.programId);
  // Seulement le programme de la séance ; le programme actif n'est cité que s'il s'agit de lui.
  const scoped: StoredData = {
    ...stored,
    programs: program ? [program] : [],
    activeProgramId: stored.activeProgramId === session.programId ? session.programId : null,
  };
  const data = toCoachExport(scoped, { mode: 'manual', selectedIds: [sessionId], weights: null }, exportedAt);
  const content = serializeCoachExport(data);
  verifyCoachExportIntegrity(content, data);
  return {
    data,
    content,
    meta: {
      kind: 'session',
      sessionId,
      date: session.date,
      sessionName: session.sessionName,
      status: session.status,
      programId: session.programId,
      weekLabel: program?.week.label ?? '',
    },
  };
}
