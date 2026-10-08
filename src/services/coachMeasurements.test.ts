import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { measurementsInWindow, measurementWindowMode, weightWindowBounds } from '../domain/coachExport';
import type { MeasurementEntry } from '../domain/types';
import { parseCoachExportJson } from '../schemas/parse';
import { dumpDatabase, FIXTURE_SHA256, readFixture, resetDatabase, sha256 } from '../test/fixtures';
import { compactCoachExport, prepareCoachExport, serializeCoachExport, toCoachExport, type CoachSelectionRequest } from './coachExportService';
import { buildSessionArchive } from './driveContent';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from './driveSettings';
import { readStoredData, storedDataTables, type StoredData } from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { previewPastedProgram, previewProgram } from './programService';

const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');
const MEASUREMENTS_HISTORY = 'history-measurements-example.json';
const MEASUREMENTS_COACH = 'coach-export-measurements-example.json';
const EXPORTED_AT = '2026-10-01T18:50:00+02:00';
const SELECTION: CoachSelectionRequest = { mode: 'last_n', selectedIds: ['w-0003', 'w-0002'] };

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data, new Date(2026, 9, 1, 18));
}

const stored = async (): Promise<StoredData> => ({
  ...(await db.transaction('r', storedDataTables(), readStoredData)),
  activeProgramId: 'prog-demo-w37',
  preferences: { unit: 'kg', theme: 'light' },
});

const entry = (date: string, values: Partial<MeasurementEntry> = {}): MeasurementEntry => ({
  date,
  chestCm: null,
  bellyCm: 92,
  waistCm: null,
  bicepsCm: null,
  thighCm: null,
  calfCm: null,
  recordedAt: `${date}T08:00:00+02:00`,
  ...values,
});

beforeEach(async () => {
  await resetDatabase();
  await restoreText(example(MEASUREMENTS_HISTORY));
});

describe('Sans l’option : export identique à avant, octet pour octet (1.1)', () => {
  it('avec des mensurations en base, le fichier reste EXACTEMENT coach-export-weights-example.json', async () => {
    const data = await stored();
    expect((data.measurements ?? []).length).toBe(5); // elles existent, mais ne partent pas
    for (const request of [SELECTION, { ...SELECTION, measurements: false }]) {
      const rebuilt = toCoachExport(data, request, EXPORTED_AT);
      expect(serializeCoachExport(rebuilt)).toBe(example('coach-export-weights-example.json'));
      expect(rebuilt.schemaVersion).toBe('1.1');
      expect(Object.keys(rebuilt)).not.toContain('measurementEntries');
      expect(compactCoachExport(rebuilt)).not.toMatch(/measurement|chestCm/);
    }
  });

  it('fixtures figées intactes (empreintes SHA-256)', () => {
    expect(sha256(example(MEASUREMENTS_COACH))).toBe('688d96c8208b4c330b72f3dcf6d77ee8c9c3e86eed6281cd8909de0e4530aef1');
    expect(sha256(example('coach-export-weights-example.json'))).toBe('7be10d2acad7b018f23daed3d541fadba4e7ec51565dae960546c81cd3e1a5c4');
    expect(sha256(example('coach-export-example.json'))).toBe('53d878bbd3ae840cc76c1256ca792ccde93d2563fe281f8d6d9dea2b24d70be0');
    expect(sha256(example('history-weights-example.json'))).toBe('d49c4e706c22b1a9f37ca0c1435681a11b53431cdcc6792b34b5519893f87961');
    expect(sha256(example(MEASUREMENTS_HISTORY))).toBe('f2fa40220eaa2474bf38dd3368eadb482677fb6b737c177c2a68731cf1a3f98f');
    expect(sha256(example('weight-entry-example.json'))).toBe('088592702a2dc701bf7c61b520b37daef017e2e554f79b45cb469af3645167cf');
    expect(sha256(example('weight-log-example.json'))).toBe('531d2b5dc3db59337f762b80b99aa0f712f7e5cf0cd4771ad015f94824f330db');
    for (const name of ['program-example.json', 'history-example.json'] as const) expect(sha256(readFixture(name))).toBe(FIXTURE_SHA256[name]);
  });
});

describe('Avec l’option : export 1.2', () => {
  it('coach-export-measurements-example.json : valide et reproduit à l’identique par l’app', async () => {
    const parsed = parseCoachExportJson(example(MEASUREMENTS_COACH));
    if (!parsed.ok) throw new Error(parsed.error.message);
    const rebuilt = toCoachExport(await stored(), { ...SELECTION, measurements: true }, EXPORTED_AT);
    expect(rebuilt).toEqual(parsed.value);
    expect(serializeCoachExport(rebuilt)).toBe(example(MEASUREMENTS_COACH));
  });

  it('clés : celles du 1.1 dans le même ordre, puis measurementWindow et measurementEntries', async () => {
    const rebuilt = toCoachExport(await stored(), { ...SELECTION, measurements: true }, EXPORTED_AT);
    const before = toCoachExport(await stored(), SELECTION, EXPORTED_AT);
    expect(Object.keys(rebuilt)).toEqual([...Object.keys(before), 'measurementWindow', 'measurementEntries']);
    expect(rebuilt.schemaVersion).toBe('1.2');
  });

  it('prises triées, incomplètes jointes avec null (jamais 0), sans recordedAt ni Total', async () => {
    const rebuilt = toCoachExport(await stored(), { ...SELECTION, measurements: true }, EXPORTED_AT);
    if (rebuilt.schemaVersion !== '1.2') throw new Error('1.2 attendu');
    expect(rebuilt.measurementWindow).toEqual({ mode: 'auto_30d', from: '2026-09-01', to: '2026-10-01', count: 2 });
    expect(rebuilt.measurementEntries).toEqual([
      { date: '2026-09-01', chestCm: null, bellyCm: 92.5, waistCm: null, bicepsCm: null, thighCm: null, calfCm: null },
      { date: '2026-09-29', chestCm: 104, bellyCm: 92, waistCm: 88.3, bicepsCm: 36.4, thighCm: 58.8, calfCm: 38.5 },
    ]);
    for (const m of rebuilt.measurementEntries) {
      expect(Object.keys(m)).toEqual(['date', 'chestCm', 'bellyCm', 'waistCm', 'bicepsCm', 'thighCm', 'calfCm']);
    }
    expect(JSON.stringify(rebuilt.measurementEntries)).not.toMatch(/recordedAt|total/i);
    expect(JSON.stringify(rebuilt.measurementWindow)).not.toMatch(/total/i);
  });

  it('aucune prise sur la période : measurementEntries [] et count 0, export valide', async () => {
    await db.measurements.clear();
    const rebuilt = toCoachExport(await stored(), { ...SELECTION, measurements: true }, EXPORTED_AT);
    if (rebuilt.schemaVersion !== '1.2') throw new Error('1.2 attendu');
    expect(rebuilt.measurementEntries).toEqual([]);
    expect(rebuilt.measurementWindow).toMatchObject({ mode: 'auto_30d', count: 0 });
    expect(parseCoachExportJson(serializeCoachExport(rebuilt)).ok).toBe(true);
  });

  it('fenêtre : suit celle des pesées ; pesées désactivées → auto_30d', async () => {
    const data = await stored();
    const of = (weights: CoachSelectionRequest['weights']) => {
      const r = toCoachExport(data, { ...SELECTION, weights, measurements: true }, EXPORTED_AT);
      return r.schemaVersion === '1.2' ? { m: r.measurementWindow, w: r.weightWindow } : null;
    };
    expect(of(null)?.m).toMatchObject({ mode: 'auto_30d', from: '2026-09-01', to: '2026-10-01' });
    expect(of(null)?.w).toBeNull();
    const ninety = of('days_90');
    // 90 jours avant le 1er oct. = 3 juillet : la prise du 1er juillet est exclue, comme une pesée le serait.
    expect(ninety?.m).toMatchObject({ mode: 'days_90', from: '2026-07-03', to: '2026-10-01', count: 2 });
    expect(ninety?.m?.from).toBe(ninety?.w?.from);
    // « Tout » : depuis la toute première prise (novembre 2025), comme « Tout » pour les pesées.
    expect(of('all')?.m).toMatchObject({ mode: 'all', from: '2025-11-15', to: '2026-10-01', count: 5 });
  });

  it('bornes incluses : jour de la première séance et aujourd’hui ; dates métier sans effet de l’heure d’été', () => {
    expect(measurementWindowMode('days_90')).toBe('days_90');
    expect(measurementWindowMode(null)).toBe('auto_30d');
    const entries = [entry('2026-09-15'), entry('2026-10-01'), entry('2026-09-14'), entry('2026-10-02')];
    // Première séance le 15 sept., aujourd'hui le 1er oct. : 15 sept. et 1er oct. inclus, pas au-delà.
    const b = weightWindowBounds('auto_30d', '2026-09-15', '2026-10-01', entries);
    expect(b).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(measurementsInWindow(entries, '2026-09-15', b.to).map((m) => m.date)).toEqual(['2026-09-15', '2026-10-01']);
    // Fin de l'heure d'été (25 oct. 2026) et début (29 mars 2026) : arithmétique de dates métier exacte.
    expect(weightWindowBounds('auto_30d', '2026-10-25', '2026-10-25', [])).toEqual({ from: '2026-09-25', to: '2026-10-25' });
    expect(weightWindowBounds('days_90', '2026-03-29', '2026-03-29', [])).toEqual({ from: '2025-12-29', to: '2026-03-29' });
    expect(weightWindowBounds('auto_30d', '2026-03-01', '2026-03-30', [])).toEqual({ from: '2026-02-28', to: '2026-03-30' });
  });
});

describe('Invariants du 1.2 : refus clair en français', () => {
  const coach = () => JSON.parse(example(MEASUREMENTS_COACH)) as Record<string, unknown>;
  const ms = (c: Record<string, unknown>) => c.measurementEntries as Record<string, unknown>[];
  const win = (c: Record<string, unknown>) => c.measurementWindow as Record<string, unknown>;
  it.each<[string, (c: Record<string, unknown>) => void, RegExp]>([
    ['dates en double', (c) => (ms(c)[1] = { ...ms(c)[0] }), /ordre croissant des dates/],
    ['ordre décroissant', (c) => (c.measurementEntries = [...ms(c)].reverse()), /ordre croissant des dates/],
    ['hors fenêtre', (c) => (win(c).from = '2026-09-10'), /hors de la fenêtre|ne correspondent pas à son mode/],
    ['count faux', (c) => (win(c).count = 5), /annonce 5 prise/],
    ['prises sans fenêtre', (c) => (c.measurementWindow = null), /fenêtre des mensurations est absente/],
    ['fenêtre inversée', (c) => Object.assign(win(c), { from: '2026-10-02', to: '2026-10-01' }), /se termine avant de commencer/],
    ['fenêtre dans le futur', (c) => (win(c).to = '2026-10-05'), /se termine dans le futur/],
    ['mode incohérent', (c) => (win(c).mode = 'days_90'), /ne correspondent pas à son mode/],
    ['valeur 0', (c) => ((ms(c)[1] as Record<string, unknown>).chestCm = 0), /0,1 à 300 cm/],
    ['plus de 300 cm', (c) => ((ms(c)[1] as Record<string, unknown>).chestCm = 301), /0,1 à 300 cm/],
    ['2 décimales', (c) => ((ms(c)[1] as Record<string, unknown>).chestCm = 104.25), /au plus 1 décimale/],
    ['aucune mesure', (c) => ((ms(c)[0] as Record<string, unknown>).bellyCm = null), /au moins une mesure/],
    ['zone absente', (c) => delete (ms(c)[0] as Record<string, unknown>).calfCm, /calfCm/],
    ['1.1 avec des mensurations', (c) => (c.schemaVersion = '1.1'), /exigent un export pour le coach en version « 1\.2 »/],
  ])('%s → refusé', (_name, mutate, message) => {
    const c = coach();
    mutate(c);
    const result = parseCoachExportJson(JSON.stringify(c));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(message);
  });

  it('version inconnue (1.3) : refusée', () => {
    const result = parseCoachExportJson(JSON.stringify({ ...coach(), schemaVersion: '1.3' }));
    expect(!result.ok && result.error.message).toMatch(/version de schéma « 1\.3 »/);
  });

  it('un export coach 1.2 n’est JAMAIS restaurable ni importable comme programme ; base inchangée', async () => {
    const before = await dumpDatabase();
    const restore = previewRestore(example(MEASUREMENTS_COACH));
    expect(!restore.ok && restore.error.message).toMatch(/export pour le coach, pas une sauvegarde/);
    const program = previewProgram(example(MEASUREMENTS_COACH));
    expect(!program.ok && program.error.message).toMatch(/export pour le coach, pas un programme/);
    expect(previewPastedProgram(example(MEASUREMENTS_COACH)).ok).toBe(false);
    expect(await dumpDatabase()).toEqual(before);
  });
});

describe('Les deux sorties, la vie privée et l’archive Drive', () => {
  it('fichier ET copie compacte respectent l’option ; copie compacte raisonnable', async () => {
    const now = new Date(2026, 9, 1, 18, 50);
    const without = await prepareCoachExport({ ...SELECTION }, now);
    const withM = await prepareCoachExport({ ...SELECTION, measurements: true }, now);
    expect(without.json).not.toContain('measurement');
    expect(without.compactJson).not.toContain('measurement');
    for (const text of [withM.json, withM.compactJson]) {
      const parsed = parseCoachExportJson(text);
      expect(parsed.ok && parsed.value.schemaVersion === '1.2' && parsed.value.measurementEntries.length).toBe(2);
    }
    expect(withM.compactJson).not.toContain('\n');
    // 2 prises jointes : moins de 600 caractères de plus que sans l'option.
    expect(withM.compactJson.length - without.compactJson.length).toBeLessThan(600);
  });

  it('secret et URL Drive jamais dans l’export avec mensurations', async () => {
    const url = 'https://script.google.com/macros/s/AKfycbCOACHMESURES/exec';
    await saveDriveConfig(url, 'secret-coach-mesures-31');
    await markDriveTested('2026-10-01T10:00:00+02:00', { url, secret: 'secret-coach-mesures-31' });
    await setDriveEnabled(true);
    const withM = await prepareCoachExport({ ...SELECTION, measurements: true }, new Date(2026, 9, 1, 18, 50));
    for (const text of [withM.json, withM.compactJson]) {
      expect(text).not.toContain('secret-coach-mesures-31');
      expect(text).not.toContain('AKfycbCOACHMESURES');
    }
  });

  it('fichiers Drive par séance inchangés : 1.1, sans mensurations, même avec des prises en base', async () => {
    const data = await stored();
    const archive = buildSessionArchive(data, 'w-0003', EXPORTED_AT);
    expect(archive?.data.schemaVersion).toBe('1.1');
    expect(archive?.content).not.toContain('measurement');
    expect(archive?.data).toMatchObject({ weightEntries: [], weightWindow: null, selection: { mode: 'manual', sessionCount: 1 } });
    // Identique au fichier obtenu sans aucune mensuration en base.
    const withoutMeasurements = buildSessionArchive({ ...data, measurements: [] }, 'w-0003', EXPORTED_AT);
    expect(archive?.content).toBe(withoutMeasurements?.content);
  });
});
