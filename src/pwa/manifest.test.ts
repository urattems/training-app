import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, DEFAULT_BASE, ICONS, readTokenColor, STATIC_ASSETS, themeColorsFromTokens } from './manifest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const tokens = read('src/styles/tokens.css');

/** Dimensions d'un PNG (en-tête IHDR). */
function pngSize(path: string): [number, number] {
  const buffer = readFileSync(resolve(root, 'public', path));
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

describe('Manifest PWA', () => {
  const manifest = buildManifest(DEFAULT_BASE, themeColorsFromTokens(tokens));

  it('champs obligatoires, standalone, portrait, français', () => {
    expect(manifest).toMatchObject({
      name: 'Carnet d’entraînement',
      short_name: 'Carnet',
      display: 'standalone',
      orientation: 'portrait',
      lang: 'fr',
    });
  });

  it('start_url, scope et id alignés sur la base GitHub Pages', () => {
    expect(DEFAULT_BASE).toBe('/training-app/');
    expect(manifest.start_url).toBe(DEFAULT_BASE);
    expect(manifest.scope).toBe(DEFAULT_BASE);
    expect(manifest.id).toBe(DEFAULT_BASE);
    expect(buildManifest('/autre/', { background: '#000000', theme: '#000000' }).start_url).toBe('/autre/');
  });

  it('couleurs issues des tokens (aucune valeur en dur)', () => {
    expect(manifest.background_color).toBe(readTokenColor(tokens, 'color-bg'));
    expect(manifest.theme_color).toBe(readTokenColor(tokens, 'color-bg'));
    expect(() => readTokenColor(tokens, 'inexistant')).toThrow();
  });

  it('icônes 192, 512 et maskable présentes, aux bonnes dimensions', () => {
    expect(manifest.icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
    for (const icon of ICONS) {
      const [w, h] = pngSize(icon.src);
      expect(`${String(w)}x${String(h)}`).toBe(icon.sizes);
    }
    // Chemins relatifs : résolus sous la base, à côté du manifest.
    expect(ICONS.every((i) => !i.src.startsWith('/'))).toBe(true);
  });

  it('apple-touch-icon 180 et favicons présents', () => {
    expect(pngSize('icons/apple-touch-icon.png')).toEqual([180, 180]);
    expect(pngSize('favicon-32.png')).toEqual([32, 32]);
    for (const asset of STATIC_ASSETS) expect(existsSync(resolve(root, 'public', asset)), asset).toBe(true);
    expect(read('public/favicon.svg')).toContain(readTokenColor(tokens, 'color-bg'));
  });
});

describe('index.html — balises iOS', () => {
  const html = read('index.html');

  it('viewport-fit=cover, mode standalone iOS, titre, barre d\'état', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Carnet" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />');
    expect(html).toContain('lang="fr"');
  });

  it('apple-touch-icon et favicons sous la base (%BASE_URL%), fichiers existants', () => {
    const hrefs = [...html.matchAll(/<link rel="(?:apple-touch-icon|icon)" href="%BASE_URL%([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(hrefs).toEqual(['favicon.svg', 'favicon-32.png', 'icons/apple-touch-icon.png']);
    for (const href of hrefs) expect(existsSync(resolve(root, 'public', href)), href).toBe(true);
  });

  it('theme-color identique au token --color-bg', () => {
    expect(html).toContain(`<meta name="theme-color" content="${readTokenColor(tokens, 'color-bg')}" />`);
  });
});

describe('Déploiement GitHub Pages', () => {
  it('le workflow vérifie, construit avec la base par défaut et déploie via les actions officielles', () => {
    const workflow = read('.github/workflows/deploy.yml');
    for (const step of ['npm ci', 'npm run typecheck', 'npm run lint', 'npm test', 'npm run build']) expect(workflow).toContain(step);
    expect(workflow).toContain('actions/upload-pages-artifact');
    expect(workflow).toContain('actions/deploy-pages');
    expect(workflow).not.toContain('VITE_BASE');
  });

  it('runner épinglé sur ubuntu-24.04 (ubuntu-latest migre vers Ubuntu 26 le 19/10/2026)', () => {
    const workflow = read('.github/workflows/deploy.yml');
    expect(workflow).not.toContain('ubuntu-latest');
    expect([...workflow.matchAll(/runs-on: (\S+)/g)].map((m) => m[1])).toEqual(['ubuntu-24.04', 'ubuntu-24.04']);
  });
});
