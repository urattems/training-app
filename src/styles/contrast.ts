/** Contraste WCAG 2.x entre deux couleurs hexadécimales (#rrggbb). */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Couples texte / fond réellement utilisés pour du TEXTE dans l'app (tokens CSS).
 * Exigence : ≥ 4,5:1 (WCAG AA, texte courant, y compris petit texte et placeholders).
 */
export const TEXT_PAIRS: readonly (readonly [string, string])[] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text-secondary', 'color-bg'],
  ['color-text-secondary', 'color-surface'],
  ['color-text-secondary', 'color-surface-muted'],
  ['color-text-secondary', 'color-surface-pressed'],
  ['color-text-tertiary', 'color-bg'],
  ['color-text-tertiary', 'color-surface'],
  ['color-text-tertiary', 'color-surface-muted'],
  ['color-accent-strong', 'color-bg'],
  ['color-accent-strong', 'color-surface'],
  ['color-accent-strong', 'color-accent-soft'],
  ['color-text-on-strong', 'color-primary'],
  ['color-success', 'color-surface'],
  ['color-success', 'color-success-soft'],
  ['color-warning', 'color-warning-soft'],
  ['color-danger', 'color-danger-soft'],
  ['color-danger', 'color-surface'],
  ['color-text', 'color-warning-soft'],
];

/** Couleur d'un token : hexadécimale à 6 chiffres, ou fonction rgb avec alpha facultatif (V1.7.5). */
export type TokenColor = readonly [number, number, number, number];

const toHex = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

export function parseTokenColor(value: string): TokenColor {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (hex?.[1]) {
    const h = hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`Couleur de token illisible : ${value}`);
}

/** Couleur opaque (#rrggbb) d'une couleur posée sur un fond opaque, avec une opacité en plus. */
export function compose(color: TokenColor, background: TokenColor, opacity = 1): string {
  const alpha = color[3] * opacity;
  return toHex([0, 1, 2].map((i) => (color[i] ?? 0) * alpha + (background[i] ?? 0) * (1 - alpha)));
}

/**
 * Tokens de couleur d'un thème lus dans tokens.css : clair = bloc `:root`, sombre = bloc `:root`
 * surchargé par `:root[data-theme='dark']`.
 */
export function readThemeColors(tokensCss: string, theme: 'light' | 'dark'): Map<string, TokenColor> {
  const block = (selector: string) => {
    const start = tokensCss.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`Bloc ${selector} introuvable`);
    return tokensCss.slice(start, tokensCss.indexOf('\n}', start));
  };
  const colors = new Map<string, TokenColor>();
  const read = (text: string) => {
    for (const m of text.matchAll(/--(color-[a-z-]+):\s*([^;]+);/g)) colors.set(m[1] ?? '', parseTokenColor((m[2] ?? '').trim()));
  };
  read(block(':root'));
  if (theme === 'dark') read(block(":root[data-theme='dark']"));
  return colors;
}
