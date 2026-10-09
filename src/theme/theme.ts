import type { UserPreferences } from '../domain/types';

/**
 * Thème (V1.7.5, J8). La préférence (`preferences.theme` en base) est la source de vérité ;
 * un miroir dans localStorage permet au script inline d'index.html de poser `data-theme` sur
 * <html> AVANT le premier rendu (pas de flash). Le mode « Système » est résolu ici en
 * "light" ou "dark" : un seul bloc sombre dans tokens.css.
 */
export type ThemePreference = UserPreferences['theme'];
export type ResolvedTheme = 'light' | 'dark';

/** Clé du miroir localStorage : la même, en dur, dans le script inline d'index.html (vérifié par test). */
export const THEME_STORAGE_KEY = 'training-app-theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_SCHEME_QUERY).matches;
  } catch {
    return false;
  }
}

/** Miroir de la préférence : un stockage indisponible (navigation privée) n'empêche rien. */
export function writeThemeMirror(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Sans miroir, le thème est appliqué au démarrage depuis la base.
  }
}

export function readThemeMirror(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Pose le thème résolu sur <html> et aligne `<meta name="theme-color">` sur le fond résolu
 * (`--color-bg`, lu depuis les tokens : aucune couleur en dur).
 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  const background = getComputedStyle(root).getPropertyValue('--color-bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && background !== '') meta.setAttribute('content', background);
}
