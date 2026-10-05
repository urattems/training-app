/**
 * Types JSON de l'archive Drive pour les pesées (V1.3 spec §5, §11), version 1.0 :
 * - `weight_entry` : une pesée (`Pesees/AAAA-MM-JJ.json`) ;
 * - `weight_log` : toutes les pesées regroupées (`Pesees/_pesees.json`), croissantes par date.
 */
import { z } from 'zod';
import { strings } from '../i18n/strings';
import { canonicalJson } from '../utils/canonicalJson';
import { err, ok, type Result } from '../utils/result';
import { dateTimeSchema, nonNegativeIntSchema } from './common';
import { bodyWeightKgSchema, weightDateSchema, weightEntrySchema, type WeightEntry } from './weight.schema';

export const WEIGHT_ARCHIVE_SCHEMA_VERSION = '1.0';

export const weightEntryFileSchema = z.object({
  schemaVersion: z.literal(WEIGHT_ARCHIVE_SCHEMA_VERSION),
  type: z.literal('weight_entry'),
  date: weightDateSchema,
  weightKg: bodyWeightKgSchema,
  recordedAt: dateTimeSchema,
});

export const weightLogSchema = z.object({
  schemaVersion: z.literal(WEIGHT_ARCHIVE_SCHEMA_VERSION),
  type: z.literal('weight_log'),
  exportedAt: dateTimeSchema,
  count: nonNegativeIntSchema,
  entries: z.array(weightEntrySchema),
});

export type WeightEntryFile = z.infer<typeof weightEntryFileSchema>;
export type WeightLog = z.infer<typeof weightLogSchema>;

/** Invariants de `weight_log` : dates uniques ET strictement croissantes, `count` exact. */
export function checkWeightLogInvariants(log: WeightLog): string[] {
  const t = strings.invariants;
  const violations: string[] = [];
  if (log.count !== log.entries.length) violations.push(t.weightLogCountMismatch(log.count, log.entries.length));
  const increasing = log.entries.every((e, i) => i === 0 || (log.entries[i - 1]?.date ?? '') < e.date);
  if (!increasing) violations.push(t.weightLogNotIncreasing);
  return violations;
}

// --- Fabriques ------------------------------------------------------------------------------

export const toWeightEntryFile = (entry: WeightEntry): WeightEntryFile => ({
  schemaVersion: WEIGHT_ARCHIVE_SCHEMA_VERSION,
  type: 'weight_entry',
  date: entry.date,
  weightKg: entry.weightKg,
  recordedAt: entry.recordedAt,
});

export function toWeightLog(entries: readonly WeightEntry[], exportedAt: string): WeightLog {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    schemaVersion: WEIGHT_ARCHIVE_SCHEMA_VERSION,
    type: 'weight_log',
    exportedAt,
    count: sorted.length,
    entries: sorted.map((e) => ({ date: e.date, weightKg: e.weightKg, recordedAt: e.recordedAt })),
  };
}

// --- Relecture (contrôle avant envoi, tests, exemples) -------------------------------------

function parseWith<T>(text: string, schema: z.ZodType<T>, invariants: (value: T) => string[]): Result<T, string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return err([String(e)]);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`));
  const violations = invariants(parsed.data);
  return violations.length > 0 ? err(violations) : ok(parsed.data);
}

export const parseWeightEntryFile = (text: string): Result<WeightEntryFile, string[]> => parseWith(text, weightEntryFileSchema, () => []);
export const parseWeightLog = (text: string): Result<WeightLog, string[]> => parseWith(text, weightLogSchema, checkWeightLogInvariants);

/** Sérialisation lisible (fichiers Drive). */
export const serializeArchive = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Contrôle avant envoi : le texte relu passe son schéma et ses invariants, et redonne exactement
 * les données (sinon rien n'est envoyé). Renvoie la liste des problèmes (vide = conforme).
 */
export function verifyArchiveText<T>(text: string, value: T, parse: (text: string) => Result<T, string[]>): string[] {
  const parsed = parse(text);
  if (!parsed.ok) return parsed.error;
  return canonicalJson(parsed.value) === canonicalJson(value) ? [] : ['Le fichier relu diffère des données.'];
}
