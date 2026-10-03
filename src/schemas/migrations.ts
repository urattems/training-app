import { SCHEMA_VERSION } from './common';

export type JsonObject = Record<string, unknown>;

/** Étape de migration d'un document JSON externe d'une version de schéma à la suivante. */
export interface SchemaMigration {
  from: string;
  to: string;
  migrate: (document: JsonObject) => JsonObject;
}

/**
 * Chaînes des migrations de schéma (SPEC §10.4), une par type de document.
 * Programme (`training_program`) : toujours en 1.0, aucune migration.
 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [];

/** Sauvegarde : 1.0 → 1.1 ajoute les pesées (`weightEntries`, vide pour un ancien fichier). */
export const HISTORY_MIGRATIONS: readonly SchemaMigration[] = [
  { from: '1.0', to: '1.1', migrate: (document) => ({ ...document, weightEntries: [] }) },
];

/** Export pour le coach : 1.0 → 1.1 ajoute les pesées (aucune) et leur fenêtre (`null`). */
export const COACH_MIGRATIONS: readonly SchemaMigration[] = [
  { from: '1.0', to: '1.1', migrate: (document) => ({ ...document, weightEntries: [], weightWindow: null }) },
];

export type MigrationOutcome =
  | { ok: true; document: JsonObject; appliedSteps: string[] }
  | { ok: false; reason: 'missing_version' }
  | { ok: false; reason: 'unsupported_version'; version: string };

/**
 * Amène un document jusqu'à la version cible en appliquant la chaîne de migrations.
 * Le document d'entrée n'est jamais modifié. Une version inconnue (ex. future) est refusée.
 */
export function migrateToVersion(
  input: JsonObject,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
  target: string = SCHEMA_VERSION,
): MigrationOutcome {
  const initial = input.schemaVersion;
  if (typeof initial !== 'string') return { ok: false, reason: 'missing_version' };

  let document = input;
  let version = initial;
  const appliedSteps: string[] = [];
  const visited = new Set<string>();

  while (version !== target) {
    const step = migrations.find((m) => m.from === version);
    if (!step || visited.has(version)) return { ok: false, reason: 'unsupported_version', version: initial };
    visited.add(version);
    document = { ...step.migrate(structuredClone(document)), schemaVersion: step.to };
    appliedSteps.push(`${step.from} → ${step.to}`);
    version = step.to;
  }
  return { ok: true, document, appliedSteps };
}
