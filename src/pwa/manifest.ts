/**
 * Manifest de la PWA (SPEC §9), partagé par vite.config.ts et les tests.
 * Les couleurs viennent des tokens CSS : aucune valeur dupliquée à la main.
 */

/** Base de l'app sur GitHub Pages (`https://<utilisateur>.github.io/training-app/`). */
export const DEFAULT_BASE = '/training-app/';

export const APP_NAME_FULL = 'Carnet d’entraînement';
export const APP_SHORT_NAME = 'Carnet';

export interface ThemeColors {
  background: string;
  theme: string;
}

/** Lit une couleur hexadécimale d'un token dans le texte de tokens.css. */
export function readTokenColor(tokensCss: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss);
  if (!match?.[1]) throw new Error(`Token --${name} introuvable dans tokens.css`);
  return match[1];
}

/** Fond de lancement et barre d'état = fond crème de l'app. */
export const themeColorsFromTokens = (tokensCss: string): ThemeColors => {
  const background = readTokenColor(tokensCss, 'color-bg');
  return { background, theme: background };
};

export const ICONS = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const;

/** Fichiers de `public/` à précacher en plus des assets du build. */
export const STATIC_ASSETS = ['favicon.svg', 'favicon-32.png', 'icons/apple-touch-icon.png'] as const;

export function buildManifest(base: string, colors: ThemeColors) {
  return {
    id: base,
    name: APP_NAME_FULL,
    short_name: APP_SHORT_NAME,
    description: 'Carnet d’entraînement personnel, 100 % local et hors ligne.',
    lang: 'fr',
    dir: 'ltr' as const,
    start_url: base,
    scope: base,
    display: 'standalone' as const,
    orientation: 'portrait' as const,
    background_color: colors.background,
    theme_color: colors.theme,
    icons: ICONS.map((icon) => ({ ...icon })),
  };
}
