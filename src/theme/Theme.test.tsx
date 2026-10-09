// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';
import { db } from '../db/database';
import { parseHistoryJson } from '../schemas/parse';
import { prepareExport } from '../services/exportService';
import { previewRestore, restoreBackup } from '../services/importService';
import { getPreferences, setThemePreference } from '../services/settingsService';
import { resetDatabase } from '../test/fixtures';
import { applyTheme, DARK_SCHEME_QUERY, readThemeMirror, resolveTheme, THEME_STORAGE_KEY, writeThemeMirror } from './theme';

/** matchMedia simulé : réglage clair/sombre de l'appareil modifiable, écouteurs comptés. */
function mockSystemScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === DARK_SCHEME_QUERY ? dark : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    listeners,
    set(value: boolean) {
      dark = value;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

const html = () => document.documentElement;
const measurementsBackup = () => readFileSync(resolve(process.cwd(), 'examples/history-measurements-example.json'), 'utf8');
const inlineScript = () => {
  const source = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const match = /<script>([\s\S]*?)<\/script>/.exec(source);
  if (!match?.[1]) throw new Error('script inline du thème introuvable');
  return match[1];
};

/** Exécute le script inline tel qu'il est écrit dans index.html (c'est lui qui est testé). */
function runInlineScript() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- code d'index.html, lu tel quel
  new Function(inlineScript())();
}

function renderSettings() {
  window.location.hash = '#/settings';
  const user = userEvent.setup();
  render(<App />);
  return user;
}

beforeEach(async () => {
  await resetDatabase();
  localStorage.clear();
  html().removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Résolution et miroir', () => {
  it('Système suit l’appareil ; Clair et Sombre s’imposent', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('miroir localStorage : stockage indisponible sans erreur', () => {
    writeThemeMirror('dark');
    expect(readThemeMirror()).toBe('dark');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('refusé', 'SecurityError');
    });
    expect(() => {
      writeThemeMirror('light');
    }).not.toThrow();
    expect(readThemeMirror()).toBeNull();
  });

  it('applyTheme pose data-theme et aligne theme-color sur --color-bg résolu', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = 'avant';
    document.head.append(meta);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => (name === '--color-bg' ? ' valeur-du-token ' : '') } as unknown as CSSStyleDeclaration);
    applyTheme('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(meta.content).toBe('valeur-du-token');
    meta.remove();
  });
});

describe('Script inline d’index.html (avant le rendu, sans flash)', () => {
  it('utilise la même clé et la même requête que l’app', () => {
    const script = inlineScript();
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(script).toContain(`'${DARK_SCHEME_QUERY}'`);
    expect(script).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });

  it.each([
    [null, false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['inconnu', true, 'light'],
  ] as const)('miroir %s, appareil sombre = %s → %s', (mirror, systemDark, expected) => {
    if (mirror !== null) localStorage.setItem(THEME_STORAGE_KEY, mirror);
    const scheme = mockSystemScheme(systemDark);
    runInlineScript();
    scheme.restore();
    expect(html().getAttribute('data-theme')).toBe(expected);
  });

  it('stockage inaccessible : aucune erreur, thème clair des tokens (aucun attribut)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('refusé', 'SecurityError');
    });
    expect(runInlineScript).not.toThrow();
    expect(html().hasAttribute('data-theme')).toBe(false);
  });
});

describe('Sélecteur de thème (Paramètres)', () => {
  it('trois choix accessibles ; Clair par défaut pour un utilisateur existant', async () => {
    // Utilisateur existant : préférences écrites par une version précédente.
    await db.settings.put({ key: 'preferences', value: { unit: 'kg', theme: 'light' } });
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Thème' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['Clair', 'Sombre', 'Système']);
    await waitFor(() => {
      expect(within(group).getByRole('radio', { name: 'Clair' })).toBeChecked();
    });
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('light');
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('base vierge : Clair', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Clair' })).toBeChecked();
    });
    expect(await getPreferences()).toEqual({ unit: 'kg', theme: 'light' });
  });

  it('Clair → Sombre → Système : base, miroir et <html> suivent ; Système suit l’appareil et se détache', async () => {
    const scheme = mockSystemScheme(false);
    const user = renderSettings();
    await user.click(await screen.findByRole('radio', { name: 'Sombre' }));
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('dark');
    });
    expect(await getPreferences()).toEqual({ unit: 'kg', theme: 'dark' });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(scheme.listeners.size).toBe(0);

    await user.click(screen.getByRole('radio', { name: 'Système' }));
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('light');
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(scheme.listeners.size).toBe(1);
    scheme.set(true);
    expect(html().getAttribute('data-theme')).toBe('dark');
    scheme.set(false);
    expect(html().getAttribute('data-theme')).toBe('light');

    // Retour à Clair : l'écouteur est retiré, le réglage de l'appareil n'a plus d'effet.
    await user.click(screen.getByRole('radio', { name: 'Clair' }));
    await waitFor(() => {
      expect(scheme.listeners.size).toBe(0);
    });
    scheme.set(true);
    expect(html().getAttribute('data-theme')).toBe('light');
    scheme.restore();
  });

  it('démontage de l’app en mode Système : écouteur retiré', async () => {
    const scheme = mockSystemScheme(true);
    await setThemePreference('system');
    renderSettings();
    await waitFor(() => {
      expect(html().getAttribute('data-theme')).toBe('dark');
    });
    expect(scheme.listeners.size).toBe(1);
    cleanup();
    expect(scheme.listeners.size).toBe(0);
    scheme.restore();
  });

  it('miroir périmé (autre valeur que la base) : resynchronisé au démarrage depuis la base', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await setThemePreference('dark');
    renderSettings();
    await waitFor(() => {
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });
    expect(html().getAttribute('data-theme')).toBe('dark');
  });
});

describe('Thème, sauvegarde et restauration (format 1.2 inchangé)', () => {
  it('le choix part dans la sauvegarde (preferences.theme), relue sans erreur', async () => {
    await setThemePreference('system');
    const prepared = await prepareExport(new Date(2026, 9, 1, 12, 0, 0));
    const parsed = parseHistoryJson(prepared.json);
    expect(parsed.ok && parsed.value.schemaVersion).toBe('1.2');
    expect(parsed.ok && parsed.value.preferences).toEqual({ unit: 'kg', theme: 'system' });
  });

  it('la restauration conserve le thème de l’appareil (le fichier porte « light »)', async () => {
    await setThemePreference('dark');
    const preview = previewRestore(measurementsBackup());
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.value.data.preferences.theme).toBe('light');
    await restoreBackup(preview.value.data);
    expect(await getPreferences()).toEqual({ unit: 'kg', theme: 'dark' });
  });

  it('la restauration ne force pas non plus le thème du fichier sur un appareil en clair', async () => {
    const preview = previewRestore(measurementsBackup());
    if (!preview.ok) throw new Error(preview.error.message);
    await restoreBackup({ ...preview.value.data, preferences: { unit: 'kg', theme: 'dark' } });
    expect(await getPreferences()).toEqual({ unit: 'kg', theme: 'light' });
  });
});
