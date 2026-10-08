import { strings } from '../i18n/strings';
import { toLocalDateString } from '../utils/dates';
import { err, ok, type Result } from '../utils/result';
import { COACH_MEASUREMENTS_SCHEMA_VERSION, COACH_SCHEMA_VERSION, HISTORY_SCHEMA_VERSION, SCHEMA_VERSION } from './common';
import { importFailure, zodFailure, type DocumentKind, type ImportFailure } from './errors';
import { historyExportSchema, type HistoryExport } from './history.schema';
import { coachExportSchema, COACH_EXPORT_TYPE, type CoachExport } from './coachExport.schema';
import { checkCoachExportInvariants, checkHistoryInvariants } from './invariants';
import { COACH_MIGRATIONS, HISTORY_MIGRATIONS, migrateToVersion, SCHEMA_MIGRATIONS, type JsonObject, type SchemaMigration } from './migrations';
import { trainingProgramSchema, type TrainingProgram } from './program.schema';

const EXPECTED_TYPE: Record<DocumentKind, string> = {
  program: 'training_program',
  history: 'training_history_export',
  coach: COACH_EXPORT_TYPE,
};

/**
 * Chaîne de migrations et version courante de chaque type de document. `alsoFinal` : versions
 * lues TELLES QUELLES, sans migration (V1.7.0 : l'export coach 1.2, produit seulement avec les
 * mensurations ; un 1.1 reste un 1.1, jamais migré en 1.2).
 */
const VERSIONING: Record<DocumentKind, { migrations: readonly SchemaMigration[]; target: string; alsoFinal?: readonly string[] }> = {
  program: { migrations: SCHEMA_MIGRATIONS, target: SCHEMA_VERSION },
  history: { migrations: HISTORY_MIGRATIONS, target: HISTORY_SCHEMA_VERSION },
  coach: { migrations: COACH_MIGRATIONS, target: COACH_SCHEMA_VERSION, alsoFinal: [COACH_MEASUREMENTS_SCHEMA_VERSION] },
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

  const { migrations, target, alsoFinal = [] } = VERSIONING[doc];
  if (typeof raw.schemaVersion === 'string' && alsoFinal.includes(raw.schemaVersion)) return ok({ raw });
  const migration = migrateToVersion(raw, migrations, target);
  if (!migration.ok) {
    return err(
      migration.reason === 'missing_version'
        ? importFailure('invalid_schema', doc, strings.import.missingVersion)
        : importFailure('unsupported_version', doc, strings.import.unsupportedVersion(migration.version, target)),
    );
  }
  return ok({ raw: migration.document });
}

const invariantFailure = (doc: DocumentKind, violations: string[]): ImportFailure | null => {
  const first = violations[0];
  if (first === undefined) return null;
  const more = violations.length > 1 ? ` ${strings.import.moreErrors(violations.length - 1)}` : '';
  return importFailure('invariant', doc, first + more, violations);
};

/** Valide un fichier programme (SPEC §10.1). */
export function parseProgramJson(text: string): Result<TrainingProgram, ImportFailure> {
  const read = readDocument(text, 'program');
  if (!read.ok) return read;
  const result = trainingProgramSchema.safeParse(read.value.raw);
  if (!result.success) return err(zodFailure(result.error, read.value.raw, 'program'));
  return ok(result.data);
}

/**
 * Valide un fichier de sauvegarde (1.0 migré ou 1.1), invariants §10.5 compris (SPEC §10.3).
 * `today` (date locale de l'appareil) sert à refuser une pesée datée dans le futur.
 */
export function parseHistoryJson(text: string, today: string = toLocalDateString(new Date())): Result<HistoryExport, ImportFailure> {
  const read = readDocument(text, 'history');
  if (!read.ok) return read;
  const result = historyExportSchema.safeParse(read.value.raw);
  if (!result.success) return err(zodFailure(result.error, read.value.raw, 'history'));
  const failure = invariantFailure('history', checkHistoryInvariants(result.data, today));
  return failure ? err(failure) : ok(result.data);
}

/** Relit un export pour le coach, invariants dédiés compris (autotest avant remise, SPEC §10.6). */
export function parseCoachExportJson(text: string): Result<CoachExport, ImportFailure> {
  const read = readDocument(text, 'coach');
  if (!read.ok) return read;
  const result = coachExportSchema.safeParse(read.value.raw);
  if (!result.success) return err(zodFailure(result.error, read.value.raw, 'coach'));
  const failure = invariantFailure('coach', checkCoachExportInvariants(result.data));
  return failure ? err(failure) : ok(result.data);
}

/** Version de schéma telle qu'écrite dans le fichier (avant migration), pour le résumé. */
export function sourceSchemaVersion(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed && typeof parsed.schemaVersion === 'string') {
      return parsed.schemaVersion;
    }
  } catch {
    return null;
  }
  return null;
}
