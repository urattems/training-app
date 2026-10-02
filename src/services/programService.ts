import { db } from '../db/database';
import type { StoredProgram, TrainingProgram } from '../domain/types';
import { strings } from '../i18n/strings';
import { importFailure, type ImportFailure } from '../schemas/errors';
import { findIgnoredFields } from '../schemas/ignoredFields';
import { parseProgramJson } from '../schemas/parse';
import { toLocalIsoString } from '../utils/dates';
import { err, ok, type Result } from '../utils/result';
import { getActiveProgramId } from './settingsService';

export interface ProgramPreview {
  program: TrainingProgram;
  name: string;
  weekLabel: string;
  sessionCount: number;
  exerciseCount: number;
  /** Chemins des champs inconnus du contrat, ignorés à l'import. */
  ignoredFields: string[];
}

/** Valide un fichier programme et prépare la prévisualisation (SPEC §10.1). Rien n'est écrit. */
export function previewProgram(text: string): Result<ProgramPreview, ImportFailure> {
  const parsed = parseProgramJson(text);
  if (!parsed.ok) return parsed;
  const program = parsed.value;
  return ok({
    program,
    name: program.name,
    weekLabel: program.week.label,
    sessionCount: program.sessions.length,
    exerciseCount: program.sessions.reduce((n, s) => n + s.exercises.length, 0),
    // Le texte a déjà été validé : le JSON.parse ne peut pas échouer ici.
    ignoredFields: findIgnoredFields(JSON.parse(text), program),
  });
}

/** Contrat JSON seul, sans les champs internes. */
export function toTrainingProgram(stored: StoredProgram): TrainingProgram {
  const { importedAt, archivedAt, ...program } = stored;
  return program;
}

/**
 * Importe un programme validé : il devient actif, l'ancien est archivé (conservé).
 * Un `programId` déjà présent est refusé (décision J0). Tout se fait en une transaction.
 */
export async function importProgram(program: TrainingProgram, now: Date = new Date()): Promise<Result<StoredProgram, ImportFailure>> {
  const stamp = toLocalIsoString(now);
  return db.transaction('rw', db.programs, db.settings, async () => {
    if (await db.programs.get(program.programId)) {
      return err(importFailure('duplicate_program', 'program', strings.import.duplicateProgram(program.programId)));
    }
    const previousId = await getActiveProgramId();
    if (previousId !== null) await db.programs.update(previousId, { archivedAt: stamp });

    const stored: StoredProgram = { ...structuredClone(program), importedAt: stamp, archivedAt: null };
    await db.programs.add(stored);
    await db.settings.put({ key: 'activeProgramId', value: program.programId });
    return ok(stored);
  });
}

export async function getActiveProgram(): Promise<StoredProgram | null> {
  const id = await getActiveProgramId();
  return id === null ? null : ((await db.programs.get(id)) ?? null);
}

export async function getProgram(programId: string): Promise<StoredProgram | null> {
  return (await db.programs.get(programId)) ?? null;
}

/** Tous les programmes, du plus récemment importé au plus ancien. */
export async function listPrograms(): Promise<StoredProgram[]> {
  const programs = await db.programs.toArray();
  return programs.sort((a, b) => Date.parse(b.importedAt) - Date.parse(a.importedAt));
}
