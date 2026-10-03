import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTokenColor } from '../pwa/manifest';
import { contrastRatio, TEXT_PAIRS } from './contrast';

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

describe('Contraste des textes (WCAG AA ≥ 4,5:1, SPEC §8)', () => {
  it('calcul de référence', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it.each(TEXT_PAIRS)('%s sur %s', (foreground, background) => {
    const ratio = contrastRatio(readTokenColor(tokens, foreground), readTokenColor(tokens, background));
    expect(ratio, `${foreground} sur ${background} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});
