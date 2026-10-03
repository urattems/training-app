import { strings } from '../i18n/strings';
import { err, ok, type Result } from '../utils/result';
import { SCHEMA_VERSION } from './common';
import { importFailure, zodFailure, type DocumentKind, type ImportFailure } from './errors';
import { historyExportSchema, type HistoryExport } from './history.schema';
import { coachExportSchema, COACH_EXPORT_TYPE, type CoachExport } from './coachExport.schema';
import { checkCoachExportInvariants, checkHistoryInvariants } from './invariants';
import { migrateToVersion, type JsonObject } from './migrations';
import { trainingProgramSchema, type TrainingProgram } from './program.schema';

const EXPECTED_TYPE: Record<DocumentKind, string> = {
  program: 'training_program',
  history: 'training_history_export',
  coach: COACH_EXPORT_TYPE,
};

const wrongTypeReason = (doc: DocumentKind, type: string): string => {
  // Un export partiel pour le coach ne peut JAMAIS remplacer les données (SPEC §10.6).
  if (type === COACH_EXPORT_TYPE) {
    return doc === 'program' ? strings.import.coachExportNotProgram : strings.import.coachExportNotBackup;
  }
  if (doc === 'program') return strings.import.expectedProgram(type);
  if (doc === 'history') return strings.import.expectedHistory(type);
  return strings.import.expectedCoach(type);
};

/**
 * Étapes communes : JSON.parse → objet → type de document → version/migration.
 * Aucune donnée n'est écrite ici : tout échec refuse le fichier en bloc.
 */
function readDocument(text: string, doc: DocumentKind): Result<{ raw: JsonObject }, ImportFailure> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return err(importFailure('invalid_json', doc, strings.import.invalidJson, [String(e)]));
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(importFailure('invalid_schema', doc, strings.import.notAnObject));
  }
  const raw = parsed as JsonObject;

  const type = raw.type;
  if (typeof type === 'string' && type !== EXPECTED_TYPE[doc]) {
    return err(importFailure('wrong_type', doc, wrongTypeReason(doc, type)));
  }

  const migration = migrateToVersion(raw);
  if (!migration.ok) {
    return err(
      migration.reason === 'missing_version'
        ? importFailure('invalid_schema', doc, strings.import.missingVersion)
        : importFailure('unsupported_version', doc, strings.import.unsupportedVersion(migration.version, SCHEMA_VERSION)),
    );
  }
  return ok({ raw: migration.document });
}

/** Valide un fichier programme (SPEC §10.1). */
export function parseProgramJson(text: string): Result<TrainingProgram, ImportFailure> {
  const read = readDocument(text, 'program');
  if (!read.ok) return read;
  const result = trainingProgramSchema.safeParse(read.value.raw);
  if (!result.success) return err(zodFailure(result.error, read.value.raw, 'program'));
  return ok(result.data);
}

/** Valide un fichier de sauvegarde/historique, invariants §10.5 compris (SPEC §10.3). */
export function parseHistoryJson(text: string): Result<HistoryExport, ImportFailure> {
  const read = readDocument(text, 'history');
  if (!read.ok) return read;
  const result = historyExportSchema.safeParse(read.value.raw);
  if (!result.success) return err(zodFailure(result.error, read.value.raw, 'history'));

  const violations = checkHistoryInvariants(result.data);
  const first = violations[0];
  if (first !== undefined) {
    const more = violations.length > 1 ? ` ${strings.import.moreErrors(violations.length - 1)}` : '';
    return err(importFailure('invariant', 'history', first + more, violations));
  }
  return ok(result.data);
}

/** Relit un export pour le coach, invariants dédiés compris (autotest avant remise, SPEC §10.6). */
export function parseCoachExportJson(text: string): Result<CoachExport, ImportFailure> {
  const read = readDocument(text, 'coach');
  if (!read.ok) return read;
  const result = coachExportSchema.safeParse(read.value.raw);
  if (!result.success) return err(zodFailure(result.error, read.value.raw, 'coach'));

  const violations = checkCoachExportInvariants(result.data);
  const first = violations[0];
  if (first !== undefined) {
    const more = violations.length > 1 ? ` ${strings.import.moreErrors(violations.length - 1)}` : '';
    return err(importFailure('invariant', 'coach', first + more, violations));
  }
  return ok(result.data);
}
