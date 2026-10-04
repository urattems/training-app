import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { readFixture, resetDatabase } from '../test/fixtures';
import { prepareCoachExport } from './coachExportService';
import { createDriveClient, type FetchLike } from './driveClient';
import { getDriveNames, getOutbox, notifySessionChanged, processDriveOutbox, setDriveClient } from './driveOutbox';
import { markDriveTested, saveDriveConfig, setDriveEnabled } from './driveSettings';
import { prepareExport } from './exportService';
import { deleteWorkout } from './historyService';
import { previewRestore, restoreBackup } from './importService';

const SCRIPT_ID = 'AKfycbSECRETPROOFSCRIPTID';
const URL_ = `https://script.google.com/macros/s/${SCRIPT_ID}/exec`;
const SECRET = 'S3cr3t-qui-ne-doit-jamais-fuiter';

/** Toutes les façons dont une réponse peut échouer, chacune RÉPÉTANT le secret et l'URL. */
const echo = `${SECRET} ${URL_}`;
const FAILURES: (() => Response | Error)[] = [
  () => new Response(`<html>404 ${echo}</html>`, { status: 404, headers: { 'content-type': 'text/html' } }),
  () => new Response(`<html>${echo}</html>`, { status: 200, headers: { 'content-type': 'text/html' } }),
  () => new Response(`pas du json ${echo}`, { status: 200 }),
  () => new Response(`erreur ${echo}`, { status: 500 }),
  () => new Response(JSON.stringify({ ok: false, error: 'busy', retryable: true, debug: echo })),
  () => new Response(JSON.stringify({ ok: false, error: 'unauthorized', debug: echo })),
  () => new Response(JSON.stringify({ ok: false, error: 'mystere', message: echo })),
  () => new TypeError(`Failed to fetch ${echo}`),
];

let failure = 0;
const contents: string[] = [];
const fetch: FetchLike = (_url, init) => {
  const body = JSON.parse(init.body as string) as { content?: string };
  if (body.content !== undefined) contents.push(body.content);
  const out = (FAILURES[failure % FAILURES.length] ?? FAILURES[0])?.() ?? new Response('{}');
  failure++;
  return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
};

beforeEach(async () => {
  await resetDatabase();
  failure = 0;
  contents.length = 0;
  setDriveClient(createDriveClient({ fetch }));
  const preview = previewRestore(readFixture('history-example.json'));
  if (!preview.ok) throw new Error();
  await restoreBackup(preview.value.data);
  await saveDriveConfig(URL_, SECRET);
  await markDriveTested('2026-10-04T10:00:00+02:00', { url: URL_, secret: SECRET });
  await setDriveEnabled(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Le secret et l’URL du script n’apparaissent dans AUCUN fichier, message ou journal', () => {
  it('après tous les modes d’échec : file, erreurs, contenus envoyés, exports, copie interne, console', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    // Chaque séance subit tous les modes d'échec (une passe par mode).
    for (const id of ['w-0001', 'w-0002', 'w-0003']) await notifySessionChanged(id);
    for (let i = 0; i < FAILURES.length * 2; i++) {
      for (const id of ['w-0001', 'w-0002', 'w-0003']) await notifySessionChanged(id);
      await processDriveOutbox('all');
    }
    await deleteWorkout('w-0001');
    await processDriveOutbox('all');
    expect(failure).toBeGreaterThanOrEqual(FAILURES.length);

    // Une restauration écrit une copie interne : elle ne doit pas contenir la configuration.
    const again = previewRestore(readFixture('history-example.json'));
    if (!again.ok) throw new Error();
    await restoreBackup(again.value.data);

    const outbox = await getOutbox();
    const produced: [string, string][] = [
      ['file d’attente (erreurs, détails)', JSON.stringify(outbox)],
      ['noms gelés', JSON.stringify(await getDriveNames())],
      ['contenus envoyés', contents.join('\n')],
      ['sauvegarde (Exporter mes données)', (await prepareExport()).json],
      ['export pour le coach', (await prepareCoachExport({ mode: 'manual', selectedIds: ['w-0002', 'w-0003'] })).json],
      ['copie interne (preRestoreBackup)', JSON.stringify(await db.metadata.get('preRestoreBackup'))],
      ['console', logged.join('\n')],
    ];
    // Les erreurs ont bien été enregistrées (sinon le test ne prouverait rien).
    expect(outbox.tasks.some((t) => t.lastError !== null)).toBe(true);
    for (const [name, text] of produced) {
      expect(text, name).not.toContain(SECRET);
      expect(text, name).not.toContain(SCRIPT_ID);
    }
  });
});
