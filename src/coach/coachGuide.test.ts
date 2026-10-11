import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE, COACH_GUIDE_FILE, NAVIGATE_FALLBACK_DENYLIST } from '../pwa/manifest';
import { COACH_MEASUREMENTS_SCHEMA_VERSION, COACH_SCHEMA_VERSION, HISTORY_SCHEMA_VERSION, SCHEMA_VERSION } from '../schemas/common';
import { findIgnoredFields } from '../schemas/ignoredFields';
import { parseProgramJson } from '../schemas/parse';
import { COACH_GUIDE_URL, COACH_PROMPT } from './coachPrompt';

/**
 * Garde-fous de la documentation (V1.8-SPEC §6) : le guide du coach, le README et l'addendum
 * ne peuvent pas diverger du code. T5 (fixtures inchangées) est couvert par les tests d'empreintes
 * existants (`test/fixtures.test.ts`, `services/measurementsBackup.test.ts`, `services/coachMeasurements.test.ts`).
 */
const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const coachMd = read('public/coach.md');

/** Contenu des blocs de code ```<langage> placés en début de ligne. */
const fencedBlocks = (markdown: string, language: string): string[] =>
  [...markdown.matchAll(new RegExp(String.raw`^\`\`\`${language}\n([\s\S]*?)\n\`\`\`$`, 'gm'))].map((m) => m[1] ?? '');

/** Première capture d'un motif, ou échec explicite s'il a disparu du guide. */
function capture(text: string, pattern: RegExp): string[] {
  const match = pattern.exec(text);
  if (!match) throw new Error(`Motif introuvable dans coach.md : ${String(pattern)}`);
  return match.slice(1);
}

describe('T1 — chaque bloc ```json de coach.md est un programme accepté par l’app', () => {
  const blocks = fencedBlocks(coachMd, 'json');

  it('le guide contient au moins un bloc ```json', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((text, i) => [i + 1, text] as const))('bloc %i : parseProgramJson, aucun champ ignoré, notes ≤ 160 caractères', (_n, text) => {
    const parsed = parseProgramJson(text);
    if (!parsed.ok) throw new Error(`${parsed.error.message}\n${parsed.error.details.join('\n')}`);
    expect(findIgnoredFields(JSON.parse(text), parsed.value)).toEqual([]);
    const notes = parsed.value.sessions.flatMap((s) => s.exercises.map((e) => e.notes)).filter((n): n is string => n !== null);
    for (const note of notes) expect(Array.from(note).length, note).toBeLessThanOrEqual(160);
  });
});

describe('T2 — les versions citées dans coach.md sont celles du code', () => {
  it('programme', () => {
    expect(capture(coachMd, /^## 6\. Contrat JSON du programme \(`training_program`, version `([^`]+)`\)$/m)).toEqual([SCHEMA_VERSION]);
    expect(capture(coachMd, /^\| `schemaVersion` \| `"([^"]+)"` \|/m)).toEqual([SCHEMA_VERSION]);
  });

  it('export pour le coach (sans et avec mensurations) et sauvegarde', () => {
    expect(capture(coachMd, /^\| `training_coach_export` \| `"([^"]+)"`, ou `"([^"]+)"` si les mensurations sont jointes \|/m)).toEqual([
      COACH_SCHEMA_VERSION,
      COACH_MEASUREMENTS_SCHEMA_VERSION,
    ]);
    expect(capture(coachMd, /^\| `training_history_export` \| `"([^"]+)"` \|/m)).toEqual([HISTORY_SCHEMA_VERSION]);
    expect(capture(coachMd, /En `"([^"]+)"` seulement : `measurementWindow`/)).toEqual([COACH_MEASUREMENTS_SCHEMA_VERSION]);
    expect(capture(coachMd, /\(export en `"([^"]+)"`\)/)).toEqual([COACH_SCHEMA_VERSION]);
  });

  it('aucune autre version de format n’est citée', () => {
    const known = new Set([SCHEMA_VERSION, HISTORY_SCHEMA_VERSION, COACH_SCHEMA_VERSION, COACH_MEASUREMENTS_SCHEMA_VERSION]);
    const cited = [...coachMd.matchAll(/"(\d+\.\d+)"/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter((v) => v === undefined || !known.has(v))).toEqual([]);
  });
});

describe('T3 — prompt de démarrage : une seule source', () => {
  it('l’URL du guide est l’adresse publique de coach.md, et elle termine le prompt', () => {
    expect(COACH_GUIDE_URL).toBe('https://urattems.github.io/training-app/coach.md');
    expect(COACH_GUIDE_URL).toBe(`https://urattems.github.io${DEFAULT_BASE}${COACH_GUIDE_FILE}`);
    expect(COACH_PROMPT.endsWith(` ${COACH_GUIDE_URL}`)).toBe(true);
    expect(COACH_PROMPT.split(COACH_GUIDE_URL)).toHaveLength(2);
  });

  it('le README contient exactement ce prompt, seul dans un bloc de code', () => {
    expect(fencedBlocks(read('README.md'), 'text')).toContain(COACH_PROMPT);
  });

  it('l’addendum V1.8 (§5.3) cite le même texte', () => {
    expect(read('V1.8-SPEC.md')).toContain(`« ${COACH_PROMPT} »`);
  });
});

describe('T4 — coach.md publié et jamais servi par l’app hors ligne', () => {
  const viteConfig = read('vite.config.ts');

  it('public/coach.md existe (copié tel quel dans dist/)', () => {
    expect(existsSync(resolve(ROOT, 'public', COACH_GUIDE_FILE))).toBe(true);
  });

  it('vite.config.ts exclut coach.md du fallback de navigation du service worker', () => {
    expect(viteConfig).toMatch(/navigateFallback: 'index\.html',/);
    expect(viteConfig).toMatch(/navigateFallbackDenylist: \[\.\.\.NAVIGATE_FALLBACK_DENYLIST\],/);
    const denied = (path: string) => NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(path));
    expect(denied(`${DEFAULT_BASE}${COACH_GUIDE_FILE}`)).toBe(true);
    expect(denied(`${DEFAULT_BASE}${COACH_GUIDE_FILE}?v=2`)).toBe(true);
    // L'app elle-même reste servie hors ligne.
    expect(denied(DEFAULT_BASE)).toBe(false);
    expect(denied(`${DEFAULT_BASE}index.html`)).toBe(false);
    expect(denied(`${DEFAULT_BASE}coach.md.html`)).toBe(false);
  });

  it('coach.md n’est pas précaché (extension .md hors des motifs Workbox)', () => {
    const [extensions] = capture(viteConfig, /globPatterns: \['\*\*\/\*\.\{([^}]+)\}'\]/);
    expect(extensions?.split(',')).not.toContain('md');
  });
});

describe('T6 — aucune vraie adresse de script ni aucun secret dans la documentation publique', () => {
  const SCRIPT_URL = /script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+/;
  const SCRIPT_ID = /AKfy[A-Za-z0-9_-]{20,}/;
  const SECRET_VALUE = /\bsecret\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i;
  const SECRET_PROPERTY = /setProperty\(\s*["']SECRET["']\s*,/;
  const TEXT = /\.(md|gs|txt|json|svg|html|webmanifest)$/;

  function textFiles(path: string): string[] {
    const full = resolve(ROOT, path);
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full).flatMap((name) => textFiles(join(path, name))).filter((f) => TEXT.test(f));
  }

  const files = ['README.md', 'V1.8-SPEC.md', 'docs', 'public'].flatMap(textFiles);

  it('fichiers analysés : README, addendum, docs/ (script Apps Script compris) et public/', () => {
    const names = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(names).toEqual(expect.arrayContaining(['README.md', 'V1.8-SPEC.md', 'docs/guide-drive.md', 'docs/apps-script/muscu-sync.gs', 'public/coach.md']));
  });

  it('aucune correspondance', () => {
    const offenders = files.flatMap((file) =>
      read(relative(ROOT, file))
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(ROOT, file)}:${String(i + 1)}` }))
        .filter(({ line }) => [SCRIPT_URL, SCRIPT_ID, SECRET_VALUE, SECRET_PROPERTY].some((p) => p.test(line)))
        .map(({ at, line }) => `${at} ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('les détecteurs reconnaissent bien ce qu’ils cherchent (et pas l’adresse type du guide)', () => {
    expect(SCRIPT_URL.test('https://script.google.com/macros/s/AKfycbxYz/exec')).toBe(true);
    expect(SCRIPT_URL.test('https://script.google.com/macros/s/…/exec')).toBe(false);
    expect(SCRIPT_ID.test('AKfycbx0123456789abcdefghijk')).toBe(true);
    expect(SECRET_VALUE.test("const SECRET = 'abcdefgh12345678';")).toBe(true);
    expect(SECRET_VALUE.test('"secret": "abcdefgh12345678"')).toBe(true);
    expect(SECRET_PROPERTY.test("PropertiesService.getScriptProperties().setProperty('SECRET', s)")).toBe(true);
    expect(SECRET_VALUE.test('const MIN_SECRET_LENGTH = 20;')).toBe(false);
  });
});
