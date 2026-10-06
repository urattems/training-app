import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { DomainError } from '../domain/errors';
import type { MeasurementValues } from '../domain/measurements';
import { dumpDatabase, resetDatabase } from '../test/fixtures';
import { addMeasurement, deleteMeasurement, getMeasurement, listMeasurements, updateMeasurement } from './measurementService';

const NOW = new Date(2026, 9, 6, 9, 30); // mardi 6 octobre 2026, 9 h 30 (Europe/Paris)
const NONE: MeasurementValues = { chestCm: null, bellyCm: null, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null };
const FULL: MeasurementValues = { chestCm: 104.5, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.1, thighCm: 58.2, calfCm: 38.4 };

beforeEach(resetDatabase);

describe('measurementService', () => {
  it('ajout : prise datée, null = absente, recordedAt local ; liste par date croissante', async () => {
    await addMeasurement('2026-10-06', { ...NONE, bellyCm: 92 }, NOW);
    await addMeasurement('2026-09-01', FULL, NOW);
    expect(await getMeasurement('2026-10-06')).toEqual({ date: '2026-10-06', ...NONE, bellyCm: 92, recordedAt: '2026-10-06T09:30:00+02:00' });
    expect((await listMeasurements()).map((m) => m.date)).toEqual(['2026-09-01', '2026-10-06']);
  });

  it('une seule prise par date : un second ajout est REFUSÉ, rien n’est écrasé', async () => {
    await addMeasurement('2026-10-01', FULL, NOW);
    const before = await dumpDatabase();
    await expect(addMeasurement('2026-10-01', { ...FULL, chestCm: 99 }, NOW)).rejects.toThrow(
      new DomainError('Une prise de mensurations existe déjà le jeudi 1 octobre : modifie-la plutôt.'),
    );
    expect(await dumpDatabase()).toEqual(before);
  });

  it('modification : mêmes date, nouvelles mesures, nouvel instant ; prise inconnue refusée', async () => {
    await addMeasurement('2026-10-01', FULL, NOW);
    const later = new Date(2026, 9, 6, 20, 0);
    const updated = await updateMeasurement('2026-10-01', { ...FULL, calfCm: null }, later);
    expect(updated).toMatchObject({ date: '2026-10-01', calfCm: null, recordedAt: '2026-10-06T20:00:00+02:00' });
    expect(await db.measurements.count()).toBe(1);
    await expect(updateMeasurement('2026-09-01', FULL, NOW)).rejects.toThrow('Cette prise de mensurations n’existe plus.');
  });

  it('suppression', async () => {
    await addMeasurement('2026-10-01', FULL, NOW);
    await deleteMeasurement('2026-10-01');
    expect(await db.measurements.count()).toBe(0);
  });

  it.each([
    ['0', { ...NONE, chestCm: 0 }, 'Poitrine : la mesure doit être supérieure à 0.'],
    ['négatif', { ...NONE, waistCm: -2 }, 'Taille : la mesure doit être supérieure à 0.'],
    ['NaN', { ...NONE, bellyCm: Number.NaN }, 'Ventre : valeur invalide (ex. 98,5).'],
    ['2 décimales', { ...NONE, bicepsCm: 36.15 }, 'Biceps : au plus 1 décimale (ex. 98,5).'],
    ['> 300', { ...NONE, thighCm: 300.5 }, 'Cuisse : 300 cm au maximum.'],
    ['vide', NONE, 'Indique au moins une mesure.'],
  ])('refus (%s) : message clair, rien n’est écrit', async (_label, values, message) => {
    await expect(addMeasurement('2026-10-01', values, NOW)).rejects.toThrow(new DomainError(message));
    expect(await db.measurements.count()).toBe(0);
  });

  it('refus d’une date future ou invalide (date locale de l’appareil)', async () => {
    await expect(addMeasurement('2026-10-07', FULL, NOW)).rejects.toThrow('La date ne peut pas être dans le futur.');
    await expect(addMeasurement('2026-02-30', FULL, NOW)).rejects.toThrow('Date invalide.');
    // Juste avant minuit : « aujourd'hui » reste le jour local.
    await addMeasurement('2026-10-06', FULL, new Date(2026, 9, 6, 23, 59));
    expect(await db.measurements.count()).toBe(1);
  });

  it('aucun champ parasite n’est stocké', async () => {
    await addMeasurement('2026-10-01', { ...FULL, extra: 1 } as MeasurementValues, NOW);
    expect(Object.keys((await getMeasurement('2026-10-01')) ?? {}).sort()).toEqual(
      ['bellyCm', 'bicepsCm', 'calfCm', 'chestCm', 'date', 'recordedAt', 'thighCm', 'waistCm'],
    );
  });
});
