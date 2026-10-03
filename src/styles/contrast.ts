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
