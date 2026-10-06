import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryExport } from '../schemas/history.schema';
import { resetDatabase } from '../test/fixtures';
import { readStoredData, toHistoryExport } from './exportService';
import { previewRestore, restoreBackup } from './importService';
import { listPrograms } from './programService';

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'examples', 'history-example.json'), 'utf8')) as HistoryExport;

/** Sauvegarde à trois programmes, volontairement dans un ordre NON alphabétique. */
function threePrograms(): HistoryExport {
  const base = fixture.programs[0];
  if (!base) throw new Error('fixture sans programme');
  const copy = (programId: string) => ({ ...structuredClone(base), programId });
  return { ...fixture, programs: [copy('prog-zeta'), copy('prog-alpha'), base], activeProgramId: base.programId };
}

const exportNow = async (): Promise<HistoryExport> => toHistoryExport(await readStoredData(), '2026-10-06T12:00:00+02:00');

beforeEach(resetDatabase);

describe('Restauration : ordre des programmes conservé (V1.3.2)', () => {
  it('aller-retour : l’ordre de la sauvegarde est celui de l’export suivant', async () => {
    const backup = threePrograms();
    const preview = previewRestore(JSON.stringify(backup));
    if (!preview.ok) throw new Error(preview.error.message);
    await restoreBackup(preview.value.data, new Date(2026, 9, 6, 9, 30, 0));

    const ids = backup.programs.map((p) => p.programId);
    expect((await exportNow()).programs.map((p) => p.programId)).toEqual(ids);
    // Liste de l'app (plus récent en premier) : ordre inverse, déterministe.
    expect((await listPrograms()).map((p) => p.programId)).toEqual([...ids].reverse());

    // Deuxième aller-retour : toujours le même ordre.
    await restoreBackup(await exportNow(), new Date(2026, 9, 7, 9, 30, 0));
    expect((await exportNow()).programs.map((p) => p.programId)).toEqual(ids);
  });

  it('importedAt strictement croissants dans l’ordre du tableau, le dernier = heure de restauration', async () => {
    const backup = threePrograms();
    const preview = previewRestore(JSON.stringify(backup));
    if (!preview.ok) throw new Error(preview.error.message);
    await restoreBackup(preview.value.data, new Date(2026, 9, 6, 9, 30, 0));
    const stored = await readStoredData();
    const byId = new Map(stored.programs.map((p) => [p.programId, p.importedAt]));
    const stamps = backup.programs.map((p) => byId.get(p.programId) ?? '');
    expect(stamps.map((s) => s.slice(11, 19))).toEqual(['09:29:58', '09:29:59', '09:30:00']);
    // Archivage inchangé : le programme actif n'est pas archivé, les autres le sont à l'heure de restauration.
    expect(stored.programs.find((p) => p.programId === backup.activeProgramId)?.archivedAt).toBeNull();
    expect(stored.programs.filter((p) => p.archivedAt !== null)).toHaveLength(2);
  });
});
