import { useLiveQuery } from 'dexie-react-hooks';
import { strings } from '../../i18n/strings';
import { THEMES } from '../../schemas/history.schema';
import { getPreferences, setThemePreference } from '../../services/settingsService';
import styles from './SettingsPage.module.css';

const t = strings.settings;

/**
 * Sélecteur de thème (V1.7.5) : trois boutons radio natifs (VoiceOver : « bouton radio, 1 sur 3 »),
 * lignes de 44 px au moins. Le choix est écrit en base ; ThemeAgent l'applique.
 */
export function ThemeSelector() {
  const current = useLiveQuery(async () => (await getPreferences()).theme, []);

  return (
    <fieldset className={styles.themeChoices}>
      <legend className={styles.themeLegend}>{t.theme}</legend>
      {THEMES.map((theme) => (
        <label key={theme} className={styles.themeChoice}>
          <input
            type="radio"
            name="theme"
            className={styles.themeRadio}
            checked={current === theme}
            onChange={() => {
              void setThemePreference(theme);
            }}
          />
          <span>{t.themeOptions[theme]}</span>
        </label>
      ))}
      <p className={styles.themeHint}>{t.themeHint}</p>
    </fieldset>
  );
}
