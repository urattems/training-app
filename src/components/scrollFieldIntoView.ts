/** Délai laissé au clavier iOS pour s'ouvrir et réduire la zone visible. */
const KEYBOARD_DELAY_MS = 300;

/**
 * Garde le champ actif visible au-dessus du clavier (iOS ne le fait pas toujours en PWA).
 * Pas de bouton fixe en bas d'écran : le contenu défile librement sous le champ.
 */
export function scrollFieldIntoView(element: HTMLElement): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    if (document.activeElement === element) {
      element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, KEYBOARD_DELAY_MS);
}
