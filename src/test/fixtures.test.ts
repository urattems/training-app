import { beforeEach, describe, expect, it } from 'vitest';
import { parseHistoryJson, parseProgramJson } from '../schemas/parse';
import { buildHistoryExport } from '../services/exportService';
import { restoreBackup } from '../services/importService';
import { importProgram } from '../services/programService';
import { FIXTURE_SHA256, readFixture, resetDatabase, sha256, type FixtureName } from './fixtures';

const NAMES: FixtureName[] = ['program-example.json', 'history-example.json'];

beforeEach(resetDatabase);

describe('Fixtures contractuelles (examples/)', () => {
  it.each(NAMES)('%s n\'a jamais été modifiée (empreinte SHA-256)', (name) => {
    expect(sha256(readFixture(name))).toBe(FIXTURE_SHA256[name]);
  });

  it('les deux fixtures passent le pipeline complet telles quelles, et restent intactes', async () => {
    const programText = readFixture('program-example.json');
    const historyText = readFixture('history-example.json');

    const program = parseProgramJson(programText);
    const history = parseHistoryJson(historyText);
    expect(program.ok).toBe(true);
    expect(history.ok).toBe(true);
    if (!program.ok || !history.ok) return;

    await restoreBackup(history.value);
    expect((await importProgram(program.value)).ok).toBe(true);
    await buildHistoryExport();

    for (const name of NAMES) expect(sha256(readFixture(name))).toBe(FIXTURE_SHA256[name]);
  });
});
