import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { getExportReminder } from '../domain/exportReminder';
import type { MeasurementValues } from '../domain/measurements';
import { parseCoachExportJson, parseHistoryJson } from '../schemas/parse';
import { FIXTURE_SHA256, readFixture, resetDatabase, sha256 } from '../test/fixtures';
import { prepareCoachExport } from './coachExportService';
import { buildBackupFile } from './driveContent';
import { buildHistoryExport, prepareExport } from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { addMeasurement, listMeasurements } from './measurementService';

const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');
const MEASUREMENTS_HISTORY = 'history-measurements-example.json';
const NOW = new Date(2026, 9, 6, 10, 0);
const NONE: MeasurementValues = { chestCm: null, bellyCm: null, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null };
const FULL: MeasurementValues = { chestCm: 104.5, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.1, thighCm: 58.2, calfCm: 38.4 };

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data, NOW);
}

const fixtureObject = (): Record<string, unknown> => JSON.parse(example(MEASUREMENTS_HISTORY)) as Record<string, unknown>;
const refusal = (mutate: (h: Record<string, unknown> & { measurementEntries: Record<string, unknown>[] }) => void) => {
  const h = fixtureObject() as Record<string, unknown> & { measurementEntries: Record<string, unknown>[] };
  mutate(h);
  const parsed = parseHistoryJson(JSON.stringify(h), '2026-10-06');
  return parsed.ok ? null : parsed.error.message;
};

beforeEach(resetDatabase);

describe('Fixture history-measurements-example.json (1.2)', () => {
  it('valide ; empreinte figée ; fixtures existantes intactes', () => {
    const parsed = parseHistoryJson(example(MEASUREMENTS_HISTORY));
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.schemaVersion).toBe('1.2');
    expect(parsed.value.measurementEntries.map((m) => m.date)).toEqual(['2025-11-15', '2026-03-30', '2026-07-01', '2026-09-01', '2026-09-29']);
    expect(sha256(example(MEASUREMENTS_HISTORY))).toBe('f2fa40220eaa2474bf38dd3368eadb482677fb6b737c177c2a68731cf1a3f98f');
    for (const name of ['program-example.json', 'history-example.json'] as const) expect(sha256(readFixture(name))).toBe(FIXTURE_SHA256[name]);
    expect(sha256(example('history-weights-example.json'))).toBe('d49c4e706c22b1a9f37ca0c1435681a11b53431cdcc6792b34b5519893f87961');
    expect(sha256(example('coach-export-example.json'))).toBe('53d878bbd3ae840cc76c1256ca792ccde93d2563fe281f8d6d9dea2b24d70be0');
    expect(sha256(example('coach-export-weights-example.json'))).toBe('7be10d2acad7b018f23daed3d541fadba4e7ec51565dae960546c81cd3e1a5c4');
    expect(sha256(example('weight-entry-example.json'))).toBe('088592702a2dc701bf7c61b520b37daef017e2e554f79b45cb469af3645167cf');
    expect(sha256(example('weight-log-example.json'))).toBe('531d2b5dc3db59337f762b80b99aa0f712f7e5cf0cd4771ad015f94824f330db');
  });
});

describe('Sauvegarde 1.2 : mensurations comprises', () => {
  it('aller-retour export → restauration : égalité profonde, puis JSON identique', async () => {
    const parsed = parseHistoryJson(example(MEASUREMENTS_HISTORY));
    if (!parsed.ok) throw new Error(parsed.error.message);
    await restoreText(example(MEASUREMENTS_HISTORY));
    const first = await prepareExport(NOW);
    expect({ ...first.data, exportedAt: parsed.value.exportedAt }).toEqual(parsed.value);
    expect(first.measurementCount).toBe(5);
    await resetDatabase();
    await restoreText(first.json);
    const second = await prepareExport(NOW);
    expect(second.json).toBe(first.json);
  });

  it('export : mensurations triées par date croissante, null conservé (jamais 0)', async () => {
    await addMeasurement('2026-10-02', { ...NONE, bellyCm: 91.5 }, NOW);
    await addMeasurement('2026-09-20', FULL, NOW);
    const exported = await buildHistoryExport(NOW);
    expect(exported.schemaVersion).toBe('1.2');
    expect(exported.measurementEntries).toEqual([
      { date: '2026-09-20', ...FULL, recordedAt: '2026-10-06T10:00:00+02:00' },
      { date: '2026-10-02', ...NONE, bellyCm: 91.5, recordedAt: '2026-10-06T10:00:00+02:00' },
    ]);
  });

  it('migrations : 1.0 → 1.2 et 1.1 → 1.2 donnent measurementEntries: []', () => {
    const v10 = parseHistoryJson(readFixture('history-example.json'));
    const v11 = parseHistoryJson(example('history-weights-example.json'));
    expect(v10.ok && { v: v10.value.schemaVersion, w: v10.value.weightEntries, m: v10.value.measurementEntries }).toEqual({ v: '1.2', w: [], m: [] });
    expect(v11.ok && { v: v11.value.schemaVersion, w: v11.value.weightEntries.length, m: v11.value.measurementEntries }).toEqual({ v: '1.2', w: 10, m: [] });
    const preview = previewRestore(example('history-weights-example.json'));
    expect(preview.ok && { version: preview.value.schemaVersion, measurements: preview.value.measurementCount }).toEqual({ version: '1.1', measurements: 0 });
  });

  it('sauvegarde plus récente que l’app (1.3) : refusée proprement, rien n’est écrit', async () => {
    const newer = { ...fixtureObject(), schemaVersion: '1.3' };
    const preview = previewRestore(JSON.stringify(newer));
    expect(preview.ok ? null : preview.error.message).toBe(
      'Restauration impossible : ce fichier utilise la version de schéma « 1.3 », non prise en charge (version gérée : 1.2).',
    );
    expect(await db.measurements.count()).toBe(0);
  });

  it.each([
    ['date en double', (h: { measurementEntries: Record<string, unknown>[] }) => h.measurementEntries.push({ ...h.measurementEntries[0] }), /deux prises de mensurations portent la même date \(2025-11-15\)/],
    ['date future', (h: { measurementEntries: Record<string, unknown>[] }) => h.measurementEntries.push({ ...h.measurementEntries[0], date: '2026-10-07' }), /prise de mensurations du 2026-10-07 est datée dans le futur/],
    ['aucune mesure', (h: { measurementEntries: Record<string, unknown>[] }) => Object.assign(h.measurementEntries[3] ?? {}, { bellyCm: null }), /au moins une mesure/],
    ['valeur 0', (h: { measurementEntries: Record<string, unknown>[] }) => Object.assign(h.measurementEntries[0] ?? {}, { chestCm: 0 }), /0,1 à 300 cm/],
    ['2 décimales', (h: { measurementEntries: Record<string, unknown>[] }) => Object.assign(h.measurementEntries[0] ?? {}, { chestCm: 106.55 }), /au plus 1 décimale/],
    ['> 300 cm', (h: { measurementEntries: Record<string, unknown>[] }) => Object.assign(h.measurementEntries[0] ?? {}, { thighCm: 301 }), /0,1 à 300 cm/],
    ['zone manquante', (h: { measurementEntries: Record<string, unknown>[] }) => delete h.measurementEntries[0]?.calfCm, /calfCm/],
    ['tableau absent en 1.2', (h: Record<string, unknown>) => delete h.measurementEntries, /measurementEntries/],
  ])('refus (%s) : fichier refusé en bloc', (_label, mutate, message) => {
    expect(refusal(mutate as (h: Record<string, unknown> & { measurementEntries: Record<string, unknown>[] }) => void)).toMatch(message);
  });
});

describe('Restauration et mensurations existantes', () => {
  it('ancienne sauvegarde sans mensurations : [] ; la copie de sécurité interne (1.2) les conserve', async () => {
    await restoreText(example(MEASUREMENTS_HISTORY));
    expect(await db.measurements.count()).toBe(5);
    await restoreText(example('history-weights-example.json'));
    expect(await listMeasurements()).toEqual([]);
    const copy = await db.metadata.get('preRestoreBackup');
    const data = copy?.data;
    expect(data?.schemaVersion).toBe('1.2');
    expect(data?.measurementEntries).toHaveLength(5);
  });
});

describe('Rappel d’export : une prise depuis le dernier export = donnée non sauvegardée', () => {
  it('sans séance ni pesée nouvelles, une mensuration récente déclenche le rappel', () => {
    const lastExport = '2026-09-01T10:00:00+02:00';
    const now = new Date(2026, 9, 6, 10);
    expect(getExportReminder([], lastExport, now, [], [])).toBeNull();
    expect(getExportReminder([], lastExport, now, [], [{ recordedAt: '2026-08-31T08:00:00+02:00' }])).toBeNull();
    expect(getExportReminder([], lastExport, now, [], [{ recordedAt: '2026-10-01T08:00:00+02:00' }])).not.toBeNull();
  });
});

describe('Un test par chemin de lecture : mensurations présentes, rien ne casse', () => {
  beforeEach(async () => {
    await restoreText(example(MEASUREMENTS_HISTORY));
  });

  it('export (« Exporter mes données ») : mensurations incluses', async () => {
    const prepared = await prepareExport(NOW);
    expect(prepared.data.measurementEntries).toHaveLength(5);
  });

  it('sauvegarde Drive (sauvegarde-derniere.json) : contenu = l’export, mensurations incluses', async () => {
    const file = await buildBackupFile('backup_latest', NOW);
    const parsed = parseHistoryJson(file.content);
    expect(parsed.ok && parsed.value.measurementEntries.length).toBe(5);
  });

  it('export coach : préparé sans erreur, format coach inchangé (pas de mensurations)', async () => {
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0001'] }, NOW);
    expect(prepared.data.schemaVersion).toBe('1.1');
    expect(parseCoachExportJson(prepared.json).ok).toBe(true);
    expect(prepared.json).not.toContain('measurement');
  });

  it('restauration : lecture de l’existant (copie de sécurité) et écriture dans la même transaction', async () => {
    const file = await buildBackupFile('backup_latest', NOW);
    await restoreText(file.content);
    expect(await db.measurements.count()).toBe(5);
    expect((await db.metadata.get('preRestoreBackup'))?.data.measurementEntries).toHaveLength(5);
  });
});
