import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aucune couleur en dur hors de tokens.css (V1.7.5) : c'est ce qui garantit qu'un thème se
 * résume à un jeu de variables. Code applicatif seulement (tests et outillage de test exclus).
 */
const SRC = resolve(process.cwd(), 'src');
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    return /\.(css|ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Couleurs : tokens.css uniquement', () => {
  it('aucun hex, rgb() ni hsl() dans src en dehors de tokens.css', () => {
    const files = sourceFiles(SRC).filter((path) => !path.endsWith('tokens.css'));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(SRC, path)}:${String(i + 1)}` }))
        .filter(({ line }) => COLOR.test(line))
        .map(({ at, line }) => `${at} ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('le détecteur reconnaît bien une couleur en dur', () => {
    expect(COLOR.test('color: #2b2926;')).toBe(true);
    expect(COLOR.test("stroke: 'rgb(0 0 0)'")).toBe(true);
    expect(COLOR.test('fill: hsl(10 20% 30%)')).toBe(true);
    expect(COLOR.test("to: '#/settings'")).toBe(false);
  });
});
