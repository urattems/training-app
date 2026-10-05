/**
 * Remise à zéro de l'écran lors d'un vrai changement d'exercice (fix-ux) :
 * - ferme le clavier (blur du champ actif) ;
 * - place le focus sur le titre, sans faire défiler (`preventScroll`) ;
 * - remet le défilement tout en haut, instantanément (jamais animé).
 *
 * À n'appeler qu'à l'ouverture d'un écran : jamais pendant la saisie, ni après une modification
 * de champ, « Comme prévu », « + Série » ou un enregistrement automatique.
 */
export function resetScreen(title?: HTMLElement | null): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
  title?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}
