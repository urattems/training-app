import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { getPreferences } from '../services/settingsService';
import { applyTheme, DARK_SCHEME_QUERY, resolveTheme, systemPrefersDark, writeThemeMirror } from './theme';

/**
 * Applique la préférence de thème de la base (au démarrage, à chaque changement, après une
 * restauration) et tient le miroir localStorage à jour. En mode « Système », suit le réglage de
 * l'appareil (`matchMedia` 'change'), écouteur retiré au changement de mode. Aucun minuteur.
 */
export function ThemeAgent() {
  const preference = useLiveQuery(async () => (await getPreferences()).theme, []);

  useEffect(() => {
    if (preference === undefined) return undefined;
    writeThemeMirror(preference);
    const apply = () => {
      applyTheme(resolveTheme(preference, systemPrefersDark()));
    };
    apply();
    if (preference !== 'system') return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
    };
  }, [preference]);

  return null;
}
