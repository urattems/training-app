import { strings } from '../i18n/strings';
import type { HistoryExport } from './history.schema';

const findDuplicates = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) duplicates.add(v);
    seen.add(v);
  }
  return [...duplicates];
};

/**
 * Invariants de cohérence d'une sauvegarde (SPEC §10.5), vérifiés après Zod.
 * Retourne la liste des violations (vide = fichier cohérent).
 */
export function checkHistoryInvariants(data: HistoryExport): string[] {
  const t = strings.invariants;
  const violations: string[] = [];

  const programIds = data.programs.map((p) => p.programId);
  for (const id of findDuplicates(programIds)) violations.push(t.duplicateProgramId(id));
  for (const id of findDuplicates(data.sessions.map((s) => s.id))) violations.push(t.duplicateWorkoutId(id));

  const inProgress = data.sessions.filter((s) => s.status === 'in_progress');
  if (inProgress.length > 1) violations.push(t.severalInProgress(inProgress.map((s) => s.id).join(', ')));

  const known = new Set(programIds);
  if (data.activeProgramId !== null && !known.has(data.activeProgramId)) {
    violations.push(t.unknownActiveProgram(data.activeProgramId));
  }

  for (const session of data.sessions) {
    if (!known.has(session.programId)) violations.push(t.unknownProgram(session.id, session.programId));
    if (session.status === 'completed' && session.completedAt === null) violations.push(t.completedWithoutEnd(session.id));
    if (session.status === 'in_progress' && session.completedAt !== null) violations.push(t.inProgressWithEnd(session.id));
  }

  return violations;
}
