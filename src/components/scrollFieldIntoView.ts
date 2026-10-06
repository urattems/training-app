/** Délai laissé au clavier iOS pour s'ouvrir et réduire la zone visible. */
const KEYBOARD_DELAY_MS = 300;

/**
 * Garde le champ actif visible au-dessus du clavier (iOS ne le fait pas toujours en PWA).
 * Pas de bouton fixe en bas d'écran : le contenu défile librement sous le champ.
 *
 * `prefers-reduced-motion` est lu tout de suite (au focus, l'environnement existe forcément).
 * Au déclenchement du minuteur, l'environnement peut avoir disparu (V1.4.1 : en CI, le minuteur
 * survivait au démontage de jsdom → « document is not defined ») : on ne fait alors rien.
 * Dans l'app réelle, `document` existe toujours ; un champ retiré de l'écran entre-temps n'est
 * jamais le champ actif, donc le comportement est inchangé.
 */
export function scrollFieldIntoView(element: HTMLElement): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    if (typeof document === 'undefined' || !element.isConnected) return;
    if (document.activeElement !== element) return;
    element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, KEYBOARD_DELAY_MS);
}
