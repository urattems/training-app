import { describe, expect, it } from 'vitest';
import { previewPastedProgram } from '../services/programService';
import { readFixture } from '../test/fixtures';
import { unwrapPastedJson } from './pasted';

const program = readFixture('program-example.json');

describe('unwrapPastedJson — tolérance strictement limitée', () => {
  it('retire espaces, retours à la ligne et BOM autour du texte', () => {
    const BOM = String.fromCharCode(0xfeff);
    expect(unwrapPastedJson(`${BOM} \n  {"a":1}  \n\t`)).toBe('{"a":1}');
  });

  it('déballe une clôture Markdown unique ```json … ```', () => {
    expect(unwrapPastedJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapPastedJson('  ```JSON\r\n{"a":1}\r\n```  \n')).toBe('{"a":1}');
    expect(unwrapPastedJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('ne devine rien d’autre : texte autour, plusieurs blocs, clôture incomplète', () => {
    const withText = 'Voici le programme :\n```json\n{"a":1}\n```';
    expect(unwrapPastedJson(withText)).toBe(withText);
    const twoBlocks = '```json\n{"a":1}\n```\n```json\n{"b":2}\n```';
    expect(unwrapPastedJson(twoBlocks)).toBe(twoBlocks);
    expect(unwrapPastedJson('```json\n{"a":1}')).toBe('```json\n{"a":1}');
    expect(unwrapPastedJson('```python\n{"a":1}\n```')).toBe('```python\n{"a":1}\n```');
  });
});

describe('previewPastedProgram — même pipeline que le fichier', () => {
  it('accepte le programme collé tel quel, avec ou sans clôture Markdown', () => {
    for (const text of [program, `\n\n${program}\n`, `\`\`\`json\n${program}\n\`\`\``]) {
      const preview = previewPastedProgram(text);
      expect(preview.ok).toBe(true);
      if (preview.ok) expect(preview.value.program.programId).toBe('prog-2026-w40');
    }
  });

  it('texte invalide : message « le texte collé n’est pas du JSON valide » + détails techniques', () => {
    const preview = previewPastedProgram('Voici ton programme : {"schemaVersion": "1.0",}');
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.error.kind).toBe('invalid_json');
    expect(preview.error.message).toBe("Import impossible : le texte collé n'est pas du JSON valide.");
    expect(preview.error.details.length).toBeGreaterThan(0);
  });

  it('aucune réparation : virgule finale ou guillemets typographiques refusés', () => {
    expect(previewPastedProgram(program.replace(/\}\s*$/, ',}')).ok).toBe(false);
    expect(previewPastedProgram(program.replace('"schemaVersion"', '“schemaVersion”')).ok).toBe(false);
  });

  it('erreurs de contenu : mêmes messages que pour un fichier', () => {
    const broken = JSON.parse(program) as { sessions: { exercises: Record<string, unknown>[] }[] };
    delete broken.sessions[0]?.exercises[0]?.id;
    const preview = previewPastedProgram(JSON.stringify(broken));
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.error.message).toBe('Import impossible : la séance A contient un exercice sans identifiant.');
  });
});
