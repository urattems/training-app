import { db } from '../db/database';
import { DRIVE_TRIGGERS, notifyDriveQueued, queueDriveTasks } from './driveOutbox';
import { DomainError } from '../domain/errors';
import type { WeightEntry } from '../domain/types';
import { sortWeights, validateWeightDate, validateWeightKg } from '../domain/weight';
import { strings } from '../i18n/strings';
import { weightEntrySchema } from '../schemas/weight.schema';
import { toLocalDateString, toLocalIsoString } from '../utils/dates';

const t = strings.weight;

/** Pesées, par date croissante. */
export async function listWeights(): Promise<WeightEntry[]> {
  return sortWeights(await db.weights.toArray());
}

export const getWeight = (date: string): Promise<WeightEntry | undefined> => db.weights.get(date);

/** Revalidation complète avant toute écriture : schéma du contrat + date jamais future. */
function checkedEntry(entry: WeightEntry, now: Date): WeightEntry {
  const today = toLocalDateString(now);
  const dateError = validateWeightDate(entry.date, today);
  if (dateError === 'invalid') throw new DomainError(t.invalidDate);
  if (dateError === 'future') throw new DomainError(t.futureDate);
  const weight = validateWeightKg(entry.weightKg);
  if (!weight.ok) throw new DomainError(t.inputErrors[weight.error]);
  return weightEntrySchema.parse(entry);
}

export type AddWeightResult =
  | { status: 'added'; entry: WeightEntry }
  | { status: 'replaced'; entry: WeightEntry; previous: WeightEntry }
  /** Une pesée existe déjà ce jour-là : RIEN n'est écrit tant que `replace` n'est pas demandé. */
  | { status: 'exists'; existing: WeightEntry };

export interface AddWeightInput {
  date: string;
  weightKg: number;
  /** Remplacement explicite d'une pesée existante (après confirmation de l'utilisateur). */
  replace?: boolean;
  now?: Date;
}

/**
 * Ajoute la pesée d'un jour (une seule par jour). Jamais de remplacement silencieux :
 * si la date existe, renvoie `exists` sans écrire, sauf `replace: true`.
 * Vérification et écriture dans la même transaction (atomique).
 */
export async function addWeight({ date, weightKg, replace = false, now = new Date() }: AddWeightInput): Promise<AddWeightResult> {
  const entry = checkedEntry({ date, weightKg, recordedAt: toLocalIsoString(now) }, now);
  // Archive Drive (V1.3b) : l'intention d'envoi est écrite dans la même transaction que la pesée.
  const result = await db.transaction('rw', [db.weights, db.settings], async (): Promise<AddWeightResult> => {
    const existing = await db.weights.get(date);
    if (existing && !replace) return { status: 'exists', existing };
    await db.weights.put(entry);
    await queueDriveTasks(DRIVE_TRIGGERS.weightSaved(date));
    return existing ? { status: 'replaced', entry, previous: existing } : { status: 'added', entry };
  });
  if (result.status !== 'exists') notifyDriveQueued();
  return result;
}

/**
 * Corrige le POIDS d'une pesée existante (la date ne change jamais : pour déplacer une pesée,
 * la supprimer puis la recréer). `recordedAt` devient l'instant de la correction.
 */
export async function updateWeight(date: string, weightKg: number, now: Date = new Date()): Promise<WeightEntry> {
  return db.transaction('rw', [db.weights, db.settings], async () => {
    const existing = await db.weights.get(date);
    if (!existing) throw new DomainError(t.notFound);
    const entry = checkedEntry({ date, weightKg, recordedAt: toLocalIsoString(now) }, now);
    await db.weights.put(entry);
    await queueDriveTasks(DRIVE_TRIGGERS.weightSaved(date));
    return entry;
  }).then((entry) => {
    notifyDriveQueued();
    return entry;
  });
}

/** Supprime une pesée. L'interface DOIT demander une confirmation explicite avant l'appel. */
export async function deleteWeight(date: string): Promise<void> {
  // Archive Drive (V1.3b) : le fichier reste dans Drive, la suppression est notée ; l'intention est
  // écrite dans la même transaction que la suppression.
  await db.transaction('rw', [db.weights, db.settings], async () => {
    await db.weights.delete(date);
    await queueDriveTasks(DRIVE_TRIGGERS.weightDeleted(date));
  });
  notifyDriveQueued();
}
