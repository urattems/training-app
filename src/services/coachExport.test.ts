import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import type { StoredProgram, WorkoutSession } from '../domain/types';
import { coachExportSchema } from '../schemas/coachExport.schema';
import { checkCoachExportInvariants } from '../schemas/invariants';
import { parseCoachExportJson } from '../schemas/parse';
import { dumpDatabase, FIXTURE_SHA256, fixtureObject, readFixture, resetDatabase, sha256 } from '../test/fixtures';
import {
  coachExportFileName,
  copyCoachExport,
  deliverPreparedCoachExport,
  downloadPreparedCoachExport,
  prepareCoachExport,
  toCoachExport,
  verifyCoachExportIntegrity,
} from './coachExportService';
import { ExportIntegrityError, type DeliveryEnv, type StoredData } from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { previewProgram } from './programService';
import { getLastCoachExportAt, getLastExportAt, setLastExportAt } from './settingsService';

const NOW = new Date(2026, 9, 20, 12, 0, 0);
const EXAMPLE_PATH = resolve(process.cwd(), 'examples', 'coach-export-example.json');
const readExample = () => readFileSync(EXAMPLE_PATH, 'utf8');

async function restoreText(text: string) {
  const preview = previewRestore(text);
  if (!preview.ok) throw new Error(preview.error.message);
  await restoreBackup(preview.value.data);
}

/**
 * Base de test : fixture d'historique (prog-demo-w37, 3 séances) + un programme w40 actif
 * avec une séance terminée, une séance en cours et une abandonnée vide, et un programme
 * archivé jamais référencé.
 */
async function seed() {
  await restoreText(readFixture('history-example.json'));
  // La restauration date l'import de l'instant réel : on fixe une chronologie d'import connue.
  await db.programs.update('prog-demo-w37', { importedAt: '2026-09-01T10:00:00+02:00' });
  const base = (await db.workouts.get('w-0002')) as WorkoutSession;
  const program = previewProgram(readFixture('program-example.json'));
  if (!program.ok) throw new Error();
  const w40: StoredProgram = { ...program.value.program, importedAt: '2026-09-28T10:00:00+02:00', archivedAt: null };
  const unused: StoredProgram = { ...program.value.program, programId: 'prog-unused', importedAt: '2026-09-27T10:00:00+02:00', archivedAt: '2026-09-28T10:00:00+02:00' };
  await db.programs.bulkPut([w40, unused]);
  await db.settings.put({ key: 'activeProgramId', value: 'prog-2026-w40' });
  const at = (id: string, date: string, extra: Partial<WorkoutSession>): WorkoutSession => ({
    ...base,
    id,
    programId: 'prog-2026-w40',
    date,
    startedAt: `${date}T18:00:00+02:00`,
    completedAt: `${date}T19:00:00+02:00`,
    ...extra,
  });
  await db.workouts.bulkPut([
    at('w-0004', '2026-09-29', {}),
    at('w-0005', '2026-10-01', {
      status: 'abandoned',
      completedAt: null,
      durationSec: null,
      notes: null,
      cardioRecords: [],
      exerciseRecords: base.exerciseRecords.map((r) => ({ ...r, sensation: null, comment: null, actualSets: [] })),
    }),
    at('w-0006', '2026-10-02', { status: 'in_progress', completedAt: null, durationSec: null }),
  ]);
}

const downloadEnv = (): DeliveryEnv => ({ navigator: {}, download: vi.fn() });

beforeEach(resetDatabase);

describe('Contenu exact du fichier training_coach_export', () => {
  beforeEach(seed);

  it('séances choisies en ordre chronologique, programmes actif + référencés, selection cohérente', async () => {
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0004', 'w-0001'] }, NOW);
    const data = prepared.data;
    expect(data.type).toBe('training_coach_export');
    expect(data.schemaVersion).toBe('1.0');
    expect(data.exportedAt).toBe('2026-10-20T12:00:00+02:00');
    expect(data.activeProgramId).toBe('prog-2026-w40');
    expect('preferences' in data).toBe(false);
    expect(data.sessions.map((s) => s.id)).toEqual(['w-0001', 'w-0004']);
    // Programme archivé référencé + programme actif, dans l'ordre d'import ; jamais l'inutile.
    expect(data.programs.map((p) => p.programId)).toEqual(['prog-demo-w37', 'prog-2026-w40']);
    expect(data.programs.every((p) => !('importedAt' in p) && !('archivedAt' in p))).toBe(true);
    // 4 exportables : w-0001, w-0002, w-0003, w-0004 (ni la vide w-0005, ni la séance en cours w-0006).
    expect(data.selection).toEqual({
      mode: 'manual',
      sessionCount: 2,
      totalExportableSessions: 4,
      firstSessionDate: '2026-09-08',
      lastSessionDate: '2026-09-29',
    });
    // Séances complètes, identiques à la base (même forme que training_history_export).
    expect(data.sessions[0]).toEqual(await db.workouts.get('w-0001'));
    expect(prepared.file.name).toBe('training-coach-2026-10-20.json');
    expect(coachExportFileName(NOW)).toBe('training-coach-2026-10-20.json');
  });

  it('une séance en cours ou vide demandée n’est jamais exportée', async () => {
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0006', 'w-0005', 'w-0003'] }, NOW);
    expect(prepared.data.sessions.map((s) => s.id)).toEqual(['w-0003']);
    expect(prepared.data.selection.sessionCount).toBe(1);
  });

  it('programme actif inclus même s’il n’est référencé par aucune séance choisie', async () => {
    const prepared = await prepareCoachExport({ mode: 'last_n', selectedIds: ['w-0002'] }, NOW);
    expect(prepared.data.programs.map((p) => p.programId)).toEqual(['prog-demo-w37', 'prog-2026-w40']);
  });

  it('sélection vide : refus de préparer', async () => {
    await expect(prepareCoachExport({ mode: 'manual', selectedIds: [] }, NOW)).rejects.toThrow();
  });

  it('fichier indenté, copie compacte sans texte ajouté : même contenu', async () => {
    const prepared = await prepareCoachExport({ mode: 'last_n', selectedIds: ['w-0004', 'w-0003', 'w-0002'] }, NOW);
    expect(prepared.json).toContain('\n  "schemaVersion"');
    expect(prepared.compactJson).not.toContain('\n');
    expect(prepared.compactJson.startsWith('{"schemaVersion":"1.0","type":"training_coach_export"')).toBe(true);
    expect(JSON.parse(prepared.compactJson)).toEqual(JSON.parse(prepared.json));
    expect(await prepared.file.text()).toBe(prepared.json);
  });
});

describe('Autotest avant remise', () => {
  beforeEach(seed);

  it('le fichier relu passe le schéma et les invariants dédiés', async () => {
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0001'] }, NOW);
    expect(parseCoachExportJson(prepared.json).ok).toBe(true);
    expect(parseCoachExportJson(prepared.compactJson).ok).toBe(true);
  });

  it('un fichier incohérent n’est jamais livré (ExportIntegrityError)', async () => {
    const prepared = await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0001', 'w-0002'] }, NOW);
    const tampered = { ...prepared.data, selection: { ...prepared.data.selection, sessionCount: 5 } };
    expect(() => {
      verifyCoachExportIntegrity(JSON.stringify(tampered), tampered);
    }).toThrow(ExportIntegrityError);
    const differs = JSON.stringify({ ...prepared.data, exportedAt: '2026-10-21T12:00:00+02:00' });
    expect(() => {
      verifyCoachExportIntegrity(differs, prepared.data);
    }).toThrow(ExportIntegrityError);
  });

  it('une donnée corrompue en base bloque la préparation, rien d’écrit', async () => {
    await db.workouts.update('w-0004', { date: 'pas une date' });
    await expect(prepareCoachExport({ mode: 'manual', selectedIds: ['w-0004'] }, NOW)).rejects.toThrow(ExportIntegrityError);
    expect(await getLastCoachExportAt()).toBeNull();
  });
});

describe('Invariants dédiés', () => {
  const valid = () => {
    const parsed = parseCoachExportJson(readExample());
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  };

  it.each([
    ['programme actif absent', (d: ReturnType<typeof valid>) => ({ ...d, activeProgramId: 'inconnu' }), /programme actif « inconnu »/],
    ['programme de séance absent', (d: ReturnType<typeof valid>) => ({ ...d, programs: [] , activeProgramId: null }), /programme absent/],
    ['id de séance en double', (d: ReturnType<typeof valid>) => ({ ...d, sessions: [d.sessions[0], d.sessions[0]], selection: { ...d.selection, sessionCount: 2, lastSessionDate: d.selection.firstSessionDate } }), /utilisé plusieurs fois/],
    ['séance en cours', (d: ReturnType<typeof valid>) => ({ ...d, sessions: d.sessions.map((s, i) => (i === 0 ? { ...s, status: 'in_progress' as const, completedAt: null } : s)) }), /est en cours/],
    ['sessionCount incohérent', (d: ReturnType<typeof valid>) => ({ ...d, selection: { ...d.selection, sessionCount: 9 } }), /annonce 9 séance/],
    ['dates incohérentes', (d: ReturnType<typeof valid>) => ({ ...d, selection: { ...d.selection, lastSessionDate: '2030-01-01' } }), /dates de la sélection/],
    ['ordre non chronologique', (d: ReturnType<typeof valid>) => ({ ...d, sessions: [...d.sessions].reverse() }), /ordre chronologique/],
  ])('%s → refusé', (_name, mutate, message) => {
    const data = mutate(valid()) as ReturnType<typeof valid>;
    expect(checkCoachExportInvariants(coachExportSchema.parse(data)).join(' ')).toMatch(message);
    expect(parseCoachExportJson(JSON.stringify(data)).ok).toBe(false);
  });
});

describe('Sécurité : un export pour le coach ne remplace jamais les données', () => {
  beforeEach(seed);

  it('la restauration le refuse avec un message explicite, base inchangée', async () => {
    const before = await dumpDatabase();
    const result = previewRestore(readExample());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(
      'Restauration impossible : ce fichier est un export pour le coach, pas une sauvegarde. Pour restaurer, utilise un fichier « Exporter mes données ».',
    );
    expect(await dumpDatabase()).toEqual(before);
  });

  it('l’import de programme le refuse (fichier ou collé), base inchangée', async () => {
    const before = await dumpDatabase();
    for (const preview of [previewProgram(readExample())]) {
      expect(preview.ok).toBe(false);
      if (!preview.ok) expect(preview.error.message).toMatch(/^Import impossible : ce fichier est un export pour le coach, pas un programme\./);
    }
    const { previewPastedProgram } = await import('./programService');
    const pasted = previewPastedProgram(`\`\`\`json\n${readExample()}\n\`\`\``);
    expect(pasted.ok).toBe(false);
    expect(await dumpDatabase()).toEqual(before);
  });
});

describe('lastExportAt jamais touché ; lastCoachExportAt seulement en cas de succès', () => {
  beforeEach(seed);
  const prepare = () => prepareCoachExport({ mode: 'last_n', selectedIds: ['w-0004'] }, NOW);

  it('téléchargement → lastCoachExportAt = instant figé ; lastExportAt inchangé', async () => {
    await setLastExportAt('2026-09-01T10:00:00+02:00');
    const prepared = await prepare();
    expect(await deliverPreparedCoachExport(prepared, downloadEnv())).toBe('downloaded');
    expect(await getLastCoachExportAt()).toBe('2026-10-20T12:00:00+02:00');
    expect(await getLastExportAt()).toBe('2026-09-01T10:00:00+02:00');
  });

  it('partage réussi → écrit, sans jamais créer lastExportAt', async () => {
    const prepared = await prepare();
    const share = vi.fn(() => Promise.resolve());
    const pending = deliverPreparedCoachExport(prepared, { navigator: { canShare: () => true, share }, download: vi.fn() });
    expect(share).toHaveBeenCalledOnce();
    expect(await pending).toBe('shared');
    expect(await getLastCoachExportAt()).toBe(prepared.data.exportedAt);
    expect(await getLastExportAt()).toBeNull();
  });

  it('partage annulé → rien d’écrit', async () => {
    const prepared = await prepare();
    const abort = () => Promise.reject(new DOMException('annulé', 'AbortError'));
    expect(await deliverPreparedCoachExport(prepared, { navigator: { canShare: () => true, share: abort }, download: vi.fn() })).toBe('cancelled');
    expect(await getLastCoachExportAt()).toBeNull();
  });

  it('téléchargement en échec → erreur, rien d’écrit', async () => {
    const prepared = await prepare();
    const failing: DeliveryEnv = {
      navigator: {},
      download: () => {
        throw new TypeError('createObjectURL');
      },
    };
    await expect(deliverPreparedCoachExport(prepared, failing)).rejects.toThrow(TypeError);
    expect(await getLastCoachExportAt()).toBeNull();
  });

  it('copie réussie : JSON compact seul, appelé immédiatement → écrit', async () => {
    const prepared = await prepare();
    const writeText = vi.fn(() => Promise.resolve());
    const pending = copyCoachExport(prepared, { writeText });
    expect(writeText).toHaveBeenCalledWith(prepared.compactJson);
    expect(await pending).toBe('copied');
    expect(await getLastCoachExportAt()).toBe(prepared.data.exportedAt);
    expect(await getLastExportAt()).toBeNull();
  });

  it('copie refusée ou presse-papiers absent → unavailable, rien d’écrit', async () => {
    const prepared = await prepare();
    expect(await copyCoachExport(prepared, { writeText: () => Promise.reject(new DOMException('non', 'NotAllowedError')) })).toBe('unavailable');
    expect(await copyCoachExport(prepared, undefined)).toBe('unavailable');
    expect(await copyCoachExport(prepared, {})).toBe('unavailable');
    expect(await getLastCoachExportAt()).toBeNull();
  });

  it('repli téléchargement après échec de copie → écrit', async () => {
    const prepared = await prepare();
    const download = vi.fn();
    await downloadPreparedCoachExport(prepared, download);
    expect(download).toHaveBeenCalledWith(prepared.file);
    expect(await getLastCoachExportAt()).toBe(prepared.data.exportedAt);
  });

  it('lastCoachExportAt survit à une restauration (historique d’envoi propre à l’appareil)', async () => {
    const prepared = await prepare();
    await copyCoachExport(prepared, { writeText: () => Promise.resolve() });
    await restoreText(readFixture('history-example.json'));
    expect(await getLastCoachExportAt()).toBe(prepared.data.exportedAt);
  });
});

describe('examples/coach-export-example.json', () => {
  it('passe le schéma et les invariants dédiés ; cohérent avec la fixture d’historique', () => {
    const parsed = parseCoachExportJson(readExample());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const history = fixtureObject('history-example.json') as { sessions: WorkoutSession[] };
    expect(parsed.value.sessions).toEqual(history.sessions.filter((s) => ['w-0002', 'w-0003'].includes(s.id)));
  });

  it('se reconstruit à l’identique depuis les données de la fixture (même code que l’app)', async () => {
    await restoreText(readFixture('history-example.json'));
    const stored: StoredData = {
      programs: await db.programs.toArray(),
      workouts: await db.workouts.toArray(),
      activeProgramId: 'prog-demo-w37',
      preferences: { unit: 'kg', theme: 'light' },
    };
    const rebuilt = toCoachExport(stored, { mode: 'last_n', selectedIds: ['w-0003', 'w-0002'] }, '2026-10-01T18:50:00+02:00');
    expect(rebuilt).toEqual(JSON.parse(readExample()));
  });

  it('les fixtures contractuelles restent intactes', () => {
    expect(sha256(readFixture('program-example.json'))).toBe(FIXTURE_SHA256['program-example.json']);
    expect(sha256(readFixture('history-example.json'))).toBe(FIXTURE_SHA256['history-example.json']);
  });
});
