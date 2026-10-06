import { db } from '../db/database';
import { DomainError } from '../domain/errors';
import { hasAnyMeasurement, MEASUREMENT_ZONES, measurementValueError, sortMeasurements, valuesOf, type MeasurementValues } from '../domain/measurements';
import type { MeasurementEntry } from '../domain/types';
import { validateWeightDate } from '../domain/weight';
import { strings } from '../i18n/strings';
import { measurementEntrySchema } from '../schemas/measurement.schema';
import { toLocalDateString, toLocalIsoString } from '../utils/dates';
import { formatDayLong } from '../utils/format';

const t = strings.measurements;

/** Prises de mensurations, par date croissante. */
export async function listMeasurements(): Promise<MeasurementEntry[]> {
  return sortMeasurements(await db.measurements.toArray());
}

export const getMeasurement = (date: string): Promise<MeasurementEntry | undefined> => db.measurements.get(date);

/**
 * Revalidation complète avant toute écriture : date réelle et jamais future (date locale de
 * l'appareil), chaque mesure (> 0, 1 décimale, ≤ 300 cm), au moins une mesure, schéma du contrat.
 */
function checkedEntry(date: string, values: MeasurementValues, now: Date): MeasurementEntry {
  const dateError = validateWeightDate(date, toLocalDateString(now));
  if (dateError === 'invalid') throw new DomainError(t.invalidDate);
  if (dateError === 'future') throw new DomainError(t.futureDate);
  for (const zone of MEASUREMENT_ZONES) {
    const value = values[zone.key];
    const error = value === null ? null : measurementValueError(value);
    if (error !== null) throw new DomainError(t.valueErrors[error](zone.label));
  }
  if (!hasAnyMeasurement(values)) throw new DomainError(t.empty);
  // Les 6 mesures seulement, dans l'ordre : aucun champ parasite n'est stocké.
  const entry: MeasurementEntry = { date, ...valuesOf(values), recordedAt: toLocalIsoString(now) };
  return measurementEntrySchema.parse(entry);
}

/**
 * Ajoute la prise d'une date (une seule par date). Une date qui a déjà une prise est REFUSÉE
 * (erreur explicite, rien n'est écrit) : jamais d'écrasement silencieux, il faut la modifier.
 */
export async function addMeasurement(date: string, values: MeasurementValues, now: Date = new Date()): Promise<MeasurementEntry> {
  const entry = checkedEntry(date, values, now);
  return db.transaction('rw', [db.measurements, db.settings], async () => {
    if (await db.measurements.get(date)) throw new DomainError(t.exists(formatDayLong(date)));
    await db.measurements.add(entry);
    return entry;
  });
}

/**
 * Modifie les mesures d'une prise existante. La date ne change jamais (pour déplacer une prise :
 * la supprimer puis la recréer). `recordedAt` devient l'instant de la modification.
 */
export async function updateMeasurement(date: string, values: MeasurementValues, now: Date = new Date()): Promise<MeasurementEntry> {
  return db.transaction('rw', [db.measurements, db.settings], async () => {
    if (!(await db.measurements.get(date))) throw new DomainError(t.notFound);
    const entry = checkedEntry(date, values, now);
    await db.measurements.put(entry);
    return entry;
  });
}

/** Supprime une prise. L'interface DOIT demander une confirmation explicite avant l'appel. */
export async function deleteMeasurement(date: string): Promise<void> {
  await db.transaction('rw', [db.measurements, db.settings], async () => {
    await db.measurements.delete(date);
  });
}
