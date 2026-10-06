import { describe, expect, it } from 'vitest';
import { measurementEntrySchema } from '../schemas/measurement.schema';
import {
  buildMeasurementSeries,
  departure,
  isComplete,
  latestComplete,
  latestValue,
  MEASUREMENT_ZONE_KEYS,
  MEASUREMENT_ZONES,
  measurementPoints,
  measurementsLostByRestore,
  measurementsRecordedSince,
  measurementStats,
  measurementTotal,
  measurementValueError,
  variation,
  type MeasurementValues,
} from './measurements';
import type { MeasurementEntry } from './types';

const NONE: MeasurementValues = { chestCm: null, bellyCm: null, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null };
const FULL: MeasurementValues = { chestCm: 104.5, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.1, thighCm: 58.2, calfCm: 38.4 };
const entry = (date: string, values: Partial<MeasurementValues>, recordedAt = `${date}T08:00:00+02:00`): MeasurementEntry => ({
  date,
  ...NONE,
  ...values,
  recordedAt,
});

describe('Zones : constante unique, dans l’ordre verrouillé', () => {
  it('Poitrine, Ventre, Taille, Biceps, Cuisse, Mollet, avec leur consigne', () => {
    expect(MEASUREMENT_ZONES.map((z) => z.label)).toEqual(['Poitrine', 'Ventre', 'Taille', 'Biceps', 'Cuisse', 'Mollet']);
    expect(MEASUREMENT_ZONE_KEYS).toEqual(['chestCm', 'bellyCm', 'waistCm', 'bicepsCm', 'thighCm', 'calfCm']);
    expect(MEASUREMENT_ZONES.map((z) => z.instruction)).toEqual([
      'Au niveau des tétons.',
      'Au niveau du nombril.',
      'Au niveau de la ceinture.',
      'Milieu du biceps, bras plié si besoin pour placer le mètre mais sans contracter, même côté à chaque mesure.',
      'Milieu de la cuisse, un seul côté, idéalement toujours le même.',
      'Milieu du mollet, un seul côté, idéalement toujours le même.',
    ]);
  });
});

describe('Règles de valeur', () => {
  it.each([
    [0.1, null],
    [98.5, null],
    [300, null],
    [0, 'not_positive'],
    [-3, 'not_positive'],
    [98.55, 'too_precise'],
    [300.1, 'too_large'],
    [Number.NaN, 'invalid'],
    [Number.POSITIVE_INFINITY, 'invalid'],
  ])('%s → %s', (value, expected) => {
    expect(measurementValueError(value)).toBe(expected);
  });

  it('schéma : chaque zone présente et nullable ; au moins une mesure ; date réelle', () => {
    expect(measurementEntrySchema.safeParse(entry('2026-10-01', { bellyCm: 92 })).success).toBe(true);
    expect(measurementEntrySchema.safeParse(entry('2026-10-01', {})).success).toBe(false); // aucune mesure
    expect(measurementEntrySchema.safeParse(entry('2026-10-01', { chestCm: 0 })).success).toBe(false); // 0 ≠ absent
    expect(measurementEntrySchema.safeParse(entry('2026-10-01', { chestCm: 98.55 })).success).toBe(false);
    expect(measurementEntrySchema.safeParse(entry('2026-10-01', { chestCm: 301 })).success).toBe(false);
    expect(measurementEntrySchema.safeParse(entry('2026-02-30', { chestCm: 98 })).success).toBe(false);
    const missingField: Record<string, unknown> = { ...entry('2026-10-01', { chestCm: 98 }) };
    delete missingField.calfCm;
    expect(measurementEntrySchema.safeParse(missingField).success).toBe(false); // présent, même si null
  });
});

describe('Prise complète et Total', () => {
  it('complète = les 6 mesures ; Total arrondi à 1 décimale, seulement si complète', () => {
    expect(isComplete(FULL)).toBe(true);
    expect(isComplete({ ...FULL, calfCm: null })).toBe(false);
    expect(measurementTotal(FULL)).toBe(417.5); // 104,5 + 92 + 88,3 + 36,1 + 58,2 + 38,4
    expect(measurementTotal({ ...FULL, calfCm: null })).toBeNull();
    // Somme de décimales binaires : pas de 0,30000000000000004.
    expect(measurementTotal({ chestCm: 0.1, bellyCm: 0.2, waistCm: 0.1, bicepsCm: 0.1, thighCm: 0.1, calfCm: 0.1 })).toBe(0.7);
  });

  it('dernière prise complète par date (pas l’ordre de saisie)', () => {
    const entries = [entry('2026-09-20', FULL), entry('2026-10-01', { chestCm: 103 }), entry('2026-08-01', FULL, '2026-10-05T20:00:00+02:00')];
    expect(latestComplete(entries)?.date).toBe('2026-09-20');
    expect(latestComplete([entry('2026-10-01', { chestCm: 103 })])).toBeNull();
  });
});

describe('Départ, dernière valeur, variation', () => {
  // Saisies dans le désordre : la prise du 1er août a été ajoutée en DERNIER (recordedAt récent).
  const entries = [
    entry('2026-09-01', { ...FULL, chestCm: 103 }),
    entry('2026-10-01', { chestCm: 101.5, bicepsCm: 37 }),
    entry('2026-08-01', { bellyCm: 95, waistCm: 90 }, '2026-10-05T20:00:00+02:00'),
  ];

  it('Départ d’une zone = sa plus ancienne valeur PAR DATE ; Total = plus ancienne prise complète', () => {
    expect(departure(entries, 'bellyCm')).toEqual({ date: '2026-08-01', value: 95 });
    expect(departure(entries, 'chestCm')).toEqual({ date: '2026-09-01', value: 103 }); // pas de poitrine le 1er août
    expect(departure(entries, 'total')).toEqual({ date: '2026-09-01', value: 416 }); // 417,5 − 104,5 + 103
    expect(departure([], 'chestCm')).toBeNull();
  });

  it('variation Départ → dernière valeur, signée, arrondie ; null avec une seule valeur', () => {
    expect(latestValue(entries, 'chestCm')).toEqual({ date: '2026-10-01', value: 101.5 });
    expect(variation(entries, 'chestCm')).toBe(-1.5);
    expect(variation(entries, 'bicepsCm')).toBe(0.9); // 36,1 → 37
    expect(variation(entries, 'total')).toBeNull(); // une seule prise complète
    expect(variation(entries, 'calfCm')).toBeNull();
  });

  it('séries par zone : toutes les valeurs disponibles ; Total : prises complètes seulement', () => {
    expect(measurementPoints(entries, 'chestCm').map((p) => p.date)).toEqual(['2026-09-01', '2026-10-01']);
    expect(measurementPoints(entries, 'total').map((p) => p.date)).toEqual(['2026-09-01']);
    const series = buildMeasurementSeries(entries, 'bellyCm', 'all', '2026-10-06');
    expect(series.points.map((p) => [p.date, p.value])).toEqual([
      ['2026-08-01', 95],
      ['2026-09-01', 92],
    ]);
  });

  it('statistiques sur la période : min, max, nombre', () => {
    expect(measurementStats(entries, 'chestCm', 'all', '2026-10-06')).toEqual({
      min: { date: '2026-10-01', value: 101.5 },
      max: { date: '2026-09-01', value: 103 },
      count: 2,
    });
    expect(measurementStats(entries, 'bellyCm', '3M', '2026-10-06').count).toBe(2);
    expect(measurementStats(entries, 'bellyCm', '1M', '2026-10-06').count).toBe(0);
  });
});

describe('Sauvegarde : restauration et rappel d’export', () => {
  it('restaurer un fichier sans mensurations remplace celles de l’app', () => {
    expect(measurementsLostByRestore(0, 4)).toBe(4);
    expect(measurementsLostByRestore(0, 0)).toBeNull();
    expect(measurementsLostByRestore(2, 4)).toBeNull();
  });

  it('prises enregistrées depuis le dernier export', () => {
    const entries = [entry('2026-09-01', FULL, '2026-09-01T08:00:00+02:00'), entry('2026-10-01', FULL, '2026-10-01T08:00:00+02:00')];
    expect(measurementsRecordedSince(entries, null)).toBe(2);
    expect(measurementsRecordedSince(entries, '2026-09-15T10:00:00+02:00')).toBe(1);
  });
});
