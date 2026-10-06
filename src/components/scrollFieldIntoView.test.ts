// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollFieldIntoView } from './scrollFieldIntoView';

let input: HTMLInputElement;
let scroll: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  input = document.createElement('input');
  document.body.append(input);
  scroll = vi.fn();
  input.scrollIntoView = scroll as unknown as typeof input.scrollIntoView;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('scrollFieldIntoView', () => {
  it('champ actif : défilement doux après le délai du clavier (300 ms)', () => {
    input.focus();
    scrollFieldIntoView(input);
    vi.advanceTimersByTime(299);
    expect(scroll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('champ qui n’est plus actif : aucun défilement', () => {
    input.focus();
    scrollFieldIntoView(input);
    input.blur();
    vi.advanceTimersByTime(300);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('défaut CI reproduit : environnement détruit avant l’échéance → aucune exception, aucun défilement', () => {
    input.focus();
    scrollFieldIntoView(input);
    // Démontage de jsdom par Vitest : `document` n'existe plus quand le minuteur se déclenche.
    vi.stubGlobal('document', undefined);
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('champ retiré du DOM avant l’échéance (écran démonté) → aucune exception, aucun défilement', () => {
    input.focus();
    scrollFieldIntoView(input);
    input.remove();
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    expect(scroll).not.toHaveBeenCalled();
  });
});
