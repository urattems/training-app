/**
 * Bannière « Nouvelle version disponible » (DECISIONS.md, J0/J6) :
 * - jamais pendant une séance en cours (elle attend la fin de la séance) ;
 * - jamais de rechargement automatique : seul l'utilisateur déclenche la mise à jour ;
 * - « Plus tard » la masque jusqu'au prochain lancement.
 */
export function shouldShowUpdateBanner(state: {
  /** Un nouveau service worker attend d'être activé. */
  needRefresh: boolean;
  /** Séance en cours : `undefined` tant que l'information n'est pas chargée. */
  workoutInProgress: boolean | undefined;
  dismissed: boolean;
}): boolean {
  return state.needRefresh && state.workoutInProgress === false && !state.dismissed;
}
