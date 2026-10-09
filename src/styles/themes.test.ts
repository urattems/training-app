import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compose, contrastRatio, readThemeColors, TEXT_PAIRS } from './contrast';

/**
 * Thèmes clair et sombre (V1.7.5, J8) : contrastes mesurés pour CHAQUE thème, sur les couples
 * réellement utilisés par les styles, et thème clair figé au caractère près.
 */
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8').replace(/\r\n/g, '\n');
const THEMES = ['light', 'dark'] as const;
const palettes = { light: readThemeColors(tokens, 'light'), dark: readThemeColors(tokens, 'dark') };

/** Couleur opaque d'un token, posée (si transparente) sur le fond indiqué. */
function color(theme: (typeof THEMES)[number], name: string, over = 'color-surface', opacity = 1): string {
  const palette = palettes[theme];
  const value = palette.get(name);
  const background = palette.get(over);
  if (!value || !background) throw new Error(`Token ${name} ou ${over} absent`);
  return compose(value, background, opacity);
}

const ratio = (theme: (typeof THEMES)[number], fg: string, bg: string) => contrastRatio(color(theme, fg, bg), color(theme, bg));

/** Texte (≥ 4,5:1) : les couples historiques, plus ceux que l'audit V1.7.5 a trouvés dans les styles. */
const TEXT = [
  ...TEXT_PAIRS,
  ['color-text', 'color-surface-muted'],
  ['color-text', 'color-surface-pressed'],
  ['color-text', 'color-accent-soft'],
  ['color-text-secondary', 'color-surface-pressed'],
  ['color-text-on-strong', 'color-primary-pressed'],
  // Action « Supprimer » du balayage (historique).
  ['color-text-on-strong', 'color-danger'],
  ['color-warning', 'color-surface'],
] as const;

/** Éléments graphiques et d'interface (≥ 3:1, WCAG 1.4.11). */
const UI = [
  // Courbes et points des graphiques, cases actives du calendrier, interrupteur coché.
  ['color-accent', 'color-surface'],
  ['color-accent', 'color-bg'],
  ['color-accent-strong', 'color-surface'],
  // Case active du calendrier face à une case inactive.
  ['color-accent', 'color-surface-muted'],
  // Contour « aujourd'hui » du calendrier.
  ['color-text-secondary', 'color-surface'],
  // Barre de progression des séries sur sa piste.
  ['color-success', 'color-surface-pressed'],
  // Bouton principal sur la carte et sur le fond.
  ['color-primary', 'color-surface'],
  ['color-primary', 'color-bg'],
] as const;

describe.each(THEMES)('Thème %s — contrastes', (theme) => {
  it.each(TEXT)('texte %s sur %s ≥ 4,5:1', (fg, bg) => {
    const r = ratio(theme, fg, bg);
    expect(r, `${theme} : ${fg} sur ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it('placeholder « prévu » (texte tertiaire) sur le champ et texte secondaire, ≥ 4,5:1', () => {
    expect(ratio(theme, 'color-text-tertiary', 'color-surface')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, 'color-text-secondary', 'color-surface-muted')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI)('interface %s sur %s ≥ 3:1', (fg, bg) => {
    const r = ratio(theme, fg, bg);
    expect(r, `${theme} : ${fg} sur ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it('bouton désactivé (opacité 0,5 sur la carte) : texte encore lisible, ≥ 3:1', () => {
    const surface = color(theme, 'color-surface');
    const fill = color(theme, 'color-primary', 'color-surface', 0.5);
    const label = color(theme, 'color-text-on-strong', 'color-surface', 0.5);
    expect(contrastRatio(label, fill)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color(theme, 'color-text', 'color-surface', 0.5), surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('Thème sombre — au moins aussi lisible que le clair là où aucun seuil WCAG ne s’applique', () => {
  // Bordures, cases inactives et jours à venir du calendrier : discrets par conception dans le
  // clair (référence) ; le sombre ne doit pas l'être davantage.
  it.each([
    ['color-border-strong', 'color-surface'],
    ['color-border', 'color-surface'],
    ['color-border-strong', 'color-surface-muted'],
  ])('%s sur %s', (fg, bg) => {
    expect(ratio('dark', fg, bg)).toBeGreaterThanOrEqual(ratio('light', fg, bg));
  });
});

describe('Thème clair strictement inchangé', () => {
  it('bloc :root identique au caractère près à la V1.7.0 (empreinte SHA-256)', () => {
    const start = tokens.indexOf(':root {');
    const block = tokens.slice(start, tokens.indexOf('\n}', start) + 2);
    expect(createHash('sha256').update(block).digest('hex')).toBe('dfb677427fb12d96a65ef0ecbbb5b4147ac8ff819edaf93919acc2caf5ad1744');
    expect(block).toContain('color-scheme: light;');
  });

  it('le sombre ne redéfinit que des couleurs, le focus et les ombres, et toutes les couleurs', () => {
    const start = tokens.indexOf(":root[data-theme='dark'] {");
    const dark = tokens.slice(start, tokens.indexOf('\n}', start));
    const names = [...dark.matchAll(/--([a-z-]+):/g)].map((m) => m[1] ?? '');
    expect(names.every((n) => n.startsWith('color-') || n === 'focus-ring' || n.startsWith('shadow-'))).toBe(true);
    expect([...palettes.light.keys()].every((n) => names.includes(n))).toBe(true);
    expect(dark).toContain('color-scheme: dark;');
  });
});

describe('Graphiques (Recharts) en sombre', () => {
  // Recharts 3 garde ses gris par défaut sur la grille et les libellés d'axe (les règles .grid et
  // .axis ne les atteignent pas) : en sombre, ils sont rattachés aux tokens ; le clair n'y touche pas.
  const css = readFileSync(resolve(process.cwd(), 'src/features/progress/ProgressChart.module.css'), 'utf8');
  it('grille et libellés d’axe suivent les tokens sous data-theme="dark" uniquement', () => {
    expect(css).toMatch(/:global\(:root\[data-theme='dark'\]\) \.chart :global\(\.recharts-cartesian-grid line\) \{\s*stroke: var\(--color-border\);/);
    expect(css).toMatch(/:global\(:root\[data-theme='dark'\]\) \.chart :global\(\.recharts-cartesian-axis-tick-value\) \{\s*fill: var\(--color-text-tertiary\);/);
  });

  it('libellés d’axe en sombre lisibles (texte tertiaire sur la carte ≥ 4,5:1)', () => {
    expect(ratio('dark', 'color-text-tertiary', 'color-surface')).toBeGreaterThanOrEqual(4.5);
  });
});
