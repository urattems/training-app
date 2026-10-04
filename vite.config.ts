import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { buildManifest, DEFAULT_BASE, STATIC_ASSETS, themeColorsFromTokens } from './src/pwa/manifest.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const tokensCss = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');

// Horodatage du build : affiché dans Informations, et garantit un nouveau service worker par build.
const BUILD_ID = process.env.APP_BUILD_ID ?? new Date().toISOString().slice(0, 16).replace('T', ' ');

// GitHub Pages sert l'app sous /training-app/ ; surchargeable via VITE_BASE (cf. DECISIONS.md).
export default defineConfig(({ command, isPreview }) => {
  const base = process.env.VITE_BASE ?? (command === 'build' || isPreview === true ? DEFAULT_BASE : '/');
  return {
    base,
    plugins: [
      react(),
      // Pas de PWA sous Vitest : inutile (module virtuel remplacé par un stub) et coûteux en transformations.
      process.env.VITEST === undefined &&
      VitePWA({
        // Mise à jour proposée à l'utilisateur, jamais appliquée automatiquement (DECISIONS.md).
        registerType: 'prompt',
        // Enregistrement fait par l'app (useRegisterSW), pas par un script injecté.
        injectRegister: false,
        includeAssets: [...STATIC_ASSETS],
        manifest: buildManifest(base, themeColorsFromTokens(tokensCss)),
        workbox: {
          // Precache de TOUS les assets du build, chunk Progression/Recharts compris.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          // HashRouter : seule index.html est demandée en navigation.
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          // Aucun runtimeCaching : le service worker n'utilise que Cache Storage, jamais IndexedDB.
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      rolldownOptions: {
        output: {
          // Bibliothèques stables à part : mieux mises en cache d'une version de l'app à l'autre.
          codeSplitting: {
            groups: [
              // Séparateurs `/` et `\` acceptés (chemins Windows).
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'dexie', test: /node_modules[\\/](dexie|dexie-react-hooks)[\\/]/ },
              { name: 'zod', test: /node_modules[\\/]zod[\\/]/ },
            ],
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_BUILD__: JSON.stringify(BUILD_ID),
    },
    css: {
      modules: { localsConvention: 'camelCaseOnly' },
    },
    test: {
      // Module virtuel de vite-plugin-pwa : remplacé par un stub pilotable sous Vitest.
      alias: { 'virtual:pwa-register/react': new URL('./src/test/pwaRegisterStub.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
      environment: 'node',
      // Fuseau fixe (Europe/Paris) posé avant le démarrage des workers : local = CI.
      globalSetup: ['./src/test/globalSetup.ts'],
      setupFiles: ['./src/test/setup.ts'],
      // Scénarios UI complets (2 à 3 s seuls) : marge pour une machine ou un runner CI chargé
      // (40 fichiers en parallèle). Aucune assertion n'en dépend (cf. DECISIONS.md, V1.2b).
      testTimeout: 15_000,
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
