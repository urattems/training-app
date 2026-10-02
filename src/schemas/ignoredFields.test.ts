import { describe, expect, it } from 'vitest';
import { readFixture } from '../test/fixtures';
import { findIgnoredFields, ignoredFieldNames } from './ignoredFields';
import { parseProgramJson } from './parse';

describe('Champs ignorés à l\'import', () => {
  it('aucun pour la fixture contractuelle', () => {
    const text = readFixture('program-example.json');
    const parsed = parseProgramJson(text);
    expect(parsed.ok && findIgnoredFields(JSON.parse(text), parsed.value)).toEqual([]);
  });

  it('liste les clés inconnues, y compris dans les listes ; ignore les null', () => {
    const raw = { a: 1, extra: 'x', list: [{ id: 1, color: 'red' }, { id: 2, targetRepsMin: null }] };
    const parsed = { a: 1, list: [{ id: 1 }, { id: 2 }] };
    expect(findIgnoredFields(raw, parsed)).toEqual(['extra', 'list[0].color']);
  });

  it('résume en noms uniques triés', () => {
    expect(ignoredFieldNames(['sessions[0].color', 'sessions[1].color', 'coachNote'])).toEqual(['coachNote', 'color']);
  });
});
