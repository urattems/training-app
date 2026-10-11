/**
 * Écran de démarrage (V1.8-SPEC §4.1) : plateforme présélectionnée et mode installé.
 * Fonctions pures (entrées injectées) : testables sans navigateur.
 */
export type Platform = 'iphone' | 'android';

/** Android si l'agent utilisateur le dit ; sinon iPhone (iPhone d'abord, y compris ordinateur). */
export function detectPlatform(userAgent: string): Platform {
  return /android/i.test(userAgent) ? 'android' : 'iphone';
}

interface StandaloneSignals {
  /** `matchMedia('(display-mode: standalone)').matches` (Android, et iOS récent). */
  displayModeStandalone: boolean;
  /** `navigator.standalone` (Safari iOS, app ouverte depuis l'écran d'accueil). */
  navigatorStandalone: boolean | undefined;
}

export function isInstalledApp({ displayModeStandalone, navigatorStandalone }: StandaloneSignals): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

/** Lecture des signaux du navigateur courant, sans jamais lever. */
export function readStandaloneSignals(): StandaloneSignals {
  const displayModeStandalone = (() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  })();
  return { displayModeStandalone, navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone };
}
