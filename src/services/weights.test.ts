import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import type { WorkoutSession } from '../domain/types';
import { weightsLostByRestore } from '../domain/weight';
import { parseCoachExportJson, parseHistoryJson } from '../schemas/parse';
import { TEST_TIME_ZONE } from '../test/globalSetup';
import { dumpDatabase, FIXTURE_SHA256, fixtureObject, readFixture, resetDatabase, sha256 } from '../test/fixtures';
import { prepareCoachExport, toCoachExport } from './coachExportService';
import { buildHistoryExport, prepareExport, type StoredData } from './exportService';
import { countWeights, previewRestore, restoreBackup } from './importService';
import { previewProgram, previewPastedProgram } from './programService';
import { addWeight, deleteWeight, getWeight, listWeights, updateWeight } from './weightService';

const NOW = new Date(2026, 9, 3, 8, 30);
const example = (name: string) => readFileSync(resolve(process.cwd(), 'examples', name), 'utf8');
const WEIGHTS_HISTORY = 'history-weights-example.json';
const WEIGHTS_COACH = 'coach-export-weights-example.json';

/** Empreintes des fixtures V1.2 (comme les fixtures contractuelles : toute modification échoue). */
const V12_SHA256: Record<string, string> = {
  'history-weights-example.json': 'd49c4e706c22b1a9f37ca0c1435681a11b53431cdcc6792b34b5519893f87961',
  'coach-export-weights-example.json': '7be10d2acad7b018f23daed3d541fadba4e7ec51565dae960546c81cd3e1a5c4',
  'coach-export-example.json': '53d878bbd3ae840cc76c1256ca792ccde93d2563fe281f8d6d9dea2b24d70be0',
};

async function restoreText(text: string, now = NOW) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data, now);
}

beforeEach(resetDatabase);

describe('weightService : une pesée par jour, jamais de remplacement silencieux', () => {
  it('ajoute, refuse un doublon SANS écrire, remplace seulement sur demande explicite', async () => {
    expect(await addWeight({ date: '2026-10-03', weightKg: 79.2, now: NOW })).toMatchObject({ status: 'added' });
    const first = await getWeight('2026-10-03');
    expect(first).toEqual({ date: '2026-10-03', weightKg: 79.2, recordedAt: '2026-10-03T08:30:00+02:00' });

    const exists = await addWeight({ date: '2026-10-03', weightKg: 78.9, now: new Date(2026, 9, 3, 9) });
    expect(exists).toEqual({ status: 'exists', existing: first });
    expect(await getWeight('2026-10-03')).toEqual(first);

    const replaced = await addWeight({ date: '2026-10-03', weightKg: 78.9, replace: true, now: new Date(2026, 9, 3, 9) });
    expect(replaced).toMatchObject({ status: 'replaced', previous: first, entry: { weightKg: 78.9, recordedAt: '2026-10-03T09:00:00+02:00' } });
    expect(await listWeights()).toHaveLength(1);
  });

  it('ajout manuel à une date passée ; date future refusée ; rien d’écrit en cas de refus', async () => {
    await addWeight({ date: '2026-09-28', weightKg: 80.1, now: NOW });
    await expect(addWeight({ date: '2026-10-04', weightKg: 80, now: NOW })).rejects.toThrow('Une pesée ne peut pas être datée dans le futur.');
    await expect(addWeight({ date: '2026-02-30', weightKg: 80, now: NOW })).rejects.toThrow('Date invalide');
    await expect(addWeight({ date: '2026-10-02', weightKg: 80.123, now: NOW })).rejects.toThrow('Au plus 2 décimales');
    await expect(addWeight({ date: '2026-10-02', weightKg: 0, now: NOW })).rejects.toThrow('supérieur à 0');
    await expect(addWeight({ date: '2026-10-02', weightKg: Number.NaN, now: NOW })).rejects.toThrow();
    expect((await listWeights()).map((w) => w.date)).toEqual(['2026-09-28']);
  });

  it('modifier change le POIDS seulement (même date), recordedAt = instant de la correction', async () => {
    await addWeight({ date: '2026-09-28', weightKg: 80.1, now: new Date(2026, 8, 28, 7) });
    const updated = await updateWeight('2026-09-28', 80.15, NOW);
    expect(updated).toEqual({ date: '2026-09-28', weightKg: 80.15, recordedAt: '2026-10-03T08:30:00+02:00' });
    await expect(updateWeight('2026-09-29', 80, NOW)).rejects.toThrow('Cette pesée n’existe plus.');
    await expect(updateWeight('2026-09-28', 80.155, NOW)).rejects.toThrow('Au plus 2 décimales');
    expect(await getWeight('2026-09-28')).toEqual(updated);
  });

  it('supprimer', async () => {
    await addWeight({ date: '2026-09-28', weightKg: 80.1, now: NOW });
    await deleteWeight('2026-09-28');
    expect(await listWeights()).toEqual([]);
  });
});

describe('Fuseaux horaires : la date d’une pesée est la date LOCALE de l’appareil', () => {
  afterEach(() => {
    process.env.TZ = TEST_TIME_ZONE;
  });

  // Même instant physique : 3 octobre 2026, 22:30 UTC.
  const INSTANT = new Date(Date.UTC(2026, 9, 3, 22, 30));
  it.each([
    ['UTC', '2026-10-03', '2026-10-03T22:30:00+00:00'],
    ['Europe/Paris', '2026-10-04', '2026-10-04T00:30:00+02:00'],
    ['America/Los_Angeles', '2026-10-03', '2026-10-03T15:30:00-07:00'],
    ['Pacific/Kiritimati', '2026-10-04', '2026-10-04T12:30:00+14:00'],
  ])('%s', async (tz, date, recordedAt) => {
    process.env.TZ = tz;
    const today = INSTANT.toLocaleDateString('sv-SE', { timeZone: tz });
    expect(today).toBe(date);
    const result = await addWeight({ date: today, weightKg: 80, now: INSTANT });
    expect(result).toMatchObject({ status: 'added', entry: { date, recordedAt } });
    // Le lendemain local est toujours refusé comme date future.
    const tomorrow = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)) + 1)).toISOString().slice(0, 10);
    await expect(addWeight({ date: tomorrow, weightKg: 80, now: INSTANT })).rejects.toThrow('futur');
  });
});

describe('Sauvegarde 1.1 : pesées comprises', () => {
  it('export en 1.1, pesées complètes triées par date croissante', async () => {
    await addWeight({ date: '2026-10-02', weightKg: 80.4, now: new Date(2026, 9, 2, 7) });
    await addWeight({ date: '2026-09-20', weightKg: 81.05, now: new Date(2026, 8, 20, 7) });
    const exported = await buildHistoryExport(NOW);
    expect(exported.schemaVersion).toBe('1.2'); // V1.5.0 (adaptation signalée) : version produite 1.2, pesées inchangées
    expect(exported.weightEntries).toEqual([
      { date: '2026-09-20', weightKg: 81.05, recordedAt: '2026-09-20T07:00:00+02:00' },
      { date: '2026-10-02', weightKg: 80.4, recordedAt: '2026-10-02T07:00:00+02:00' },
    ]);
  });

  it('aller-retour avec pesées (history-weights-example.json) : égalité profonde', async () => {
    const parsed = parseHistoryJson(example(WEIGHTS_HISTORY));
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.value.weightEntries).toHaveLength(10);
    await restoreText(example(WEIGHTS_HISTORY));
    const first = await prepareExport(NOW);
    expect({ ...first.data, exportedAt: parsed.value.exportedAt }).toEqual(parsed.value);
    await resetDatabase();
    await restoreText(first.json);
    const second = await prepareExport(NOW);
    expect(second.json).toBe(first.json);
  });

  it('fichier 1.0 (history-example.json) accepté via la migration : weightEntries vide', () => {
    const parsed = parseHistoryJson(readFixture('history-example.json'));
    expect(parsed.ok && parsed.value.schemaVersion).toBe('1.2'); // V1.5.0 (adaptation signalée) : chaîne 1.0 → 1.1 → 1.2
    expect(parsed.ok && parsed.value.weightEntries).toEqual([]);
    const preview = previewRestore(readFixture('history-example.json'));
    expect(preview.ok && { version: preview.value.schemaVersion, weights: preview.value.weightCount }).toEqual({ version: '1.0', weights: 0 });
  });

  const invalid = (mutate: (h: Record<string, unknown>) => void) => {
    const h = JSON.parse(example(WEIGHTS_HISTORY)) as Record<string, unknown>;
    mutate(h);
    return JSON.stringify(h);
  };
  const weights = (h: Record<string, unknown>) => h.weightEntries as Record<string, unknown>[];

  it.each<[string, (h: Record<string, unknown>) => void, RegExp]>([
    ['date en double', (h) => (weights(h)[1] = { ...weights(h)[0] }), /même date/],
    ['date future', (h) => (weights(h)[9] = { date: '2099-01-01', weightKg: 80, recordedAt: '2026-10-01T07:00:00+02:00' }), /dans le futur/],
    ['date mal formée', (h) => (weights(h)[0] = { ...weights(h)[0], date: '02/09/2026' }), /AAAA-MM-JJ/],
    ['date irréelle', (h) => (weights(h)[0] = { ...weights(h)[0], date: '2026-02-30' }), /AAAA-MM-JJ/],
    ['poids nul', (h) => (weights(h)[0] = { ...weights(h)[0], weightKg: 0 }), /supérieur à 0/],
    ['3 décimales', (h) => (weights(h)[0] = { ...weights(h)[0], weightKg: 80.123 }), /2 décimales/],
    ['poids en texte', (h) => (weights(h)[0] = { ...weights(h)[0], weightKg: '80' }), /nombre attendu/],
    ['recordedAt invalide', (h) => (weights(h)[0] = { ...weights(h)[0], recordedAt: '2026-09-02 07:12' }), /date-heure ISO/],
    ['weightEntries absent en 1.1', (h) => delete h.weightEntries, /pesées/],
  ])('%s → refus en bloc, rien d’écrit', async (_name, mutate, message) => {
    await addWeight({ date: '2026-10-01', weightKg: 79, now: NOW });
    const before = await dumpDatabase();
    const result = previewRestore(invalid(mutate));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(message);
    expect(await dumpDatabase()).toEqual(before);
    expect(await listWeights()).toHaveLength(1);
  });
});

describe('Restauration avec pesées', () => {
  it('pesées dans la transaction unique ; copie interne et export de sécurité les contiennent', async () => {
    await addWeight({ date: '2026-10-01', weightKg: 79.5, now: NOW });
    const safety = await prepareExport(NOW);
    expect(safety.data.weightEntries).toHaveLength(1);

    await restoreText(example(WEIGHTS_HISTORY));
    expect((await listWeights()).map((w) => w.date)).toHaveLength(10);
    expect(await getWeight('2026-10-01')).toMatchObject({ weightKg: 80.6 });
    const backup = await db.metadata.get('preRestoreBackup');
    expect(backup?.data.weightEntries).toEqual(safety.data.weightEntries);
  });

  it('échec simulé pendant l’écriture des pesées : rien ne change (atomique)', async () => {
    await restoreText(readFixture('history-example.json'));
    await addWeight({ date: '2026-10-01', weightKg: 79.5, now: NOW });
    const before = await dumpDatabase();
    const beforeWeights = await listWeights();
    const spy = vi.spyOn(db.weights, 'bulkPut').mockRejectedValueOnce(new Error('échec simulé'));
    const preview = previewRestore(example(WEIGHTS_HISTORY));
    if (!preview.ok) throw new Error();
    await expect(restoreBackup(preview.value.data, NOW)).rejects.toThrow('échec simulé');
    spy.mockRestore();
    expect(await dumpDatabase()).toEqual(before);
    expect(await listWeights()).toEqual(beforeWeights);
  });

  it('résumé : nombre de pesées du fichier ; avertissement si le fichier n’en a aucune', async () => {
    const withWeights = previewRestore(example(WEIGHTS_HISTORY));
    expect(withWeights.ok && withWeights.value.weightCount).toBe(10);
    await addWeight({ date: '2026-10-01', weightKg: 79.5, now: NOW });
    await addWeight({ date: '2026-10-02', weightKg: 79.4, now: NOW });
    const none = previewRestore(readFixture('history-example.json'));
    if (!none.ok) throw new Error();
    expect(weightsLostByRestore(none.value.weightCount, await countWeights())).toBe(2);
  });
});

describe('Export pour le coach 1.1 : pesées et fenêtre', () => {
  /** Séances de la fixture + pesées du 2 sept. au 1er oct. (fixture V1.2). */
  async function seedWithWeights() {
    await restoreText(example(WEIGHTS_HISTORY));
  }

  it('fenêtre auto_30d par défaut : 30 derniers jours si les séances sont récentes', async () => {
    await seedWithWeights();
    // « Aujourd'hui » = 20 octobre : 30 jours → 20 sept. ; la séance choisie (22 sept.) est plus récente.
    const prepared = await prepareCoachExport({ mode: 'last_n', selectedIds: ['w-0003'] }, new Date(2026, 9, 20, 12));
    expect(prepared.data.schemaVersion).toBe('1.1');
    expect(prepared.data.weightWindow).toEqual({ mode: 'auto_30d', from: '2026-09-20', to: '2026-10-20', count: 4 });
    expect(prepared.data.weightEntries).toEqual([
      { date: '2026-09-22', weightKg: 81.2 },
      { date: '2026-09-25', weightKg: 80.95 },
      { date: '2026-09-28', weightKg: 80.8 },
      { date: '2026-10-01', weightKg: 80.6 },
    ]);
  });

  it('auto_30d s’étend jusqu’à la plus ancienne séance choisie si elle est plus ancienne', async () => {
    await seedWithWeights();
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0001', 'w-0003'] }, new Date(2026, 9, 20, 12));
    expect(prepared.data.weightWindow).toEqual({ mode: 'auto_30d', from: '2026-09-08', to: '2026-10-20', count: 8 });
  });

  it('90 jours, tout l’historique, désactivé', async () => {
    await seedWithWeights();
    await addWeight({ date: '2026-03-01', weightKg: 85, now: NOW });
    const at = new Date(2026, 9, 20, 12);
    const days90 = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0003'], weights: 'days_90' }, at);
    expect(days90.data.weightWindow).toEqual({ mode: 'days_90', from: '2026-07-22', to: '2026-10-20', count: 10 });
    const all = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0003'], weights: 'all' }, at);
    expect(all.data.weightWindow).toEqual({ mode: 'all', from: '2026-03-01', to: '2026-10-20', count: 11 });
    expect(all.data.weightEntries[0]).toEqual({ date: '2026-03-01', weightKg: 85 });
    const off = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0003'], weights: null }, at);
    expect(off.data.weightWindow).toBeNull();
    expect(off.data.weightEntries).toEqual([]);
    // Compact : jamais de recordedAt dans l'export coach.
    expect(all.compactJson).not.toContain('recordedAt');
  });

  it('aucune pesée en base : fenêtre annoncée, liste vide', async () => {
    await restoreText(readFixture('history-example.json'));
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0003'] }, new Date(2026, 9, 20, 12));
    expect(prepared.data.weightWindow).toMatchObject({ count: 0 });
    expect(prepared.data.weightEntries).toEqual([]);
  });

  const coachInvalid = (mutate: (c: Record<string, unknown>) => void) => {
    const c = JSON.parse(example(WEIGHTS_COACH)) as Record<string, unknown>;
    mutate(c);
    return JSON.stringify(c);
  };
  const cw = (c: Record<string, unknown>) => c.weightEntries as { date: string; weightKg: number }[];
  const win = (c: Record<string, unknown>) => c.weightWindow as Record<string, unknown>;

  it.each<[string, (c: Record<string, unknown>) => void, RegExp]>([
    ['dates en double', (c) => (cw(c)[1] = { ...(cw(c)[0] as { date: string; weightKg: number }) }), /ordre croissant/],
    ['ordre décroissant', (c) => c.weightEntries = [...cw(c)].reverse(), /ordre croissant/],
    ['hors fenêtre', (c) => (win(c).from = '2026-09-10'), /hors de la fenêtre/],
    ['count faux', (c) => (win(c).count = 3), /annonce 3 pesée/],
    ['pesées sans fenêtre', (c) => (c.weightWindow = null), /désactivées/],
    ['fenêtre inversée', (c) => Object.assign(win(c), { from: '2026-10-02', to: '2026-10-01' }), /se termine avant/],
    ['mode inconnu', (c) => (win(c).mode = 'auto_7d'), /valeur acceptée/],
  ])('invariant : %s → refusé', (_name, mutate, message) => {
    const result = parseCoachExportJson(coachInvalid(mutate));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(message);
  });

  it('fichier coach 1.0 migré : weightEntries vide, weightWindow null', () => {
    const migrated = parseCoachExportJson(example('coach-export-example.json'));
    expect(migrated.ok && { v: migrated.value.schemaVersion, e: migrated.value.weightEntries, w: migrated.value.weightWindow }).toEqual({ v: '1.1', e: [], w: null });
  });

  it.each(['coach-export-example.json', WEIGHTS_COACH])('%s : refusé par la restauration ET l’import de programme, base inchangée', async (name) => {
    await restoreText(example(WEIGHTS_HISTORY));
    const before = await dumpDatabase();
    const restore = previewRestore(example(name));
    expect(!restore.ok && restore.error.message).toMatch(/export pour le coach, pas une sauvegarde/);
    const program = previewProgram(example(name));
    expect(!program.ok && program.error.message).toMatch(/export pour le coach, pas un programme/);
    expect(previewPastedProgram(example(name)).ok).toBe(false);
    expect(await dumpDatabase()).toEqual(before);
  });
});

describe('Fixtures V1.2', () => {
  it('history-weights-example.json : valide (1.1, 10 pesées)', () => {
    const parsed = parseHistoryJson(example(WEIGHTS_HISTORY));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.weightEntries.map((w) => w.date)).toHaveLength(10);
  });

  it('coach-export-weights-example.json : valide et reproduit à l’identique par l’app', async () => {
    const parsed = parseCoachExportJson(example(WEIGHTS_COACH));
    if (!parsed.ok) throw new Error(parsed.error.message);
    await restoreText(example(WEIGHTS_HISTORY));
    const stored: StoredData = {
      programs: await db.programs.toArray(),
      workouts: await db.workouts.toArray(),
      activeProgramId: 'prog-demo-w37',
      preferences: { unit: 'kg', theme: 'light' },
      weights: await db.weights.toArray(),
    };
    const rebuilt = toCoachExport(stored, { mode: 'last_n', selectedIds: ['w-0003', 'w-0002'] }, '2026-10-01T18:50:00+02:00');
    expect(rebuilt).toEqual(parsed.value);
    expect(rebuilt.sessions).toEqual((fixtureObject('history-example.json') as { sessions: WorkoutSession[] }).sessions.slice(1));
  });

  it('empreintes SHA-256 : fixtures V1.2 et fixtures existantes intactes', () => {
    for (const [name, hash] of Object.entries(V12_SHA256)) expect(sha256(example(name)), name).toBe(hash);
    expect(sha256(readFixture('program-example.json'))).toBe(FIXTURE_SHA256['program-example.json']);
    expect(sha256(readFixture('history-example.json'))).toBe(FIXTURE_SHA256['history-example.json']);
  });
});
