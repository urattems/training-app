// IndexedDB en mémoire pour tester Dexie et les services sur une vraie base.
import 'fake-indexeddb/auto';
// Matchers DOM (toBeInTheDocument…) pour les tests UI en environnement jsdom.
import '@testing-library/jest-dom/vitest';

// jsdom n'implémente pas scrollIntoView (présent dans tous les navigateurs cibles).
if (typeof Element !== 'undefined' && !('scrollIntoView' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: () => undefined, writable: true });
}

// jsdom n'implémente pas matchMedia (utilisé pour prefers-reduced-motion).
if (typeof window !== 'undefined' && typeof (window as { matchMedia?: unknown }).matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
    writable: true,
  });
}

// Tests UI (jsdom) : la page Progression est chargée en différé et sa première compilation
// (Recharts) prend plusieurs secondes à froid. Préchauffée ici une fois par fichier de tests,
// pour que les attentes mesurent l'app et non la compilation (aucune assertion modifiée).
if (typeof window !== 'undefined') {
  await import('../features/progress/ProgressPage');
}

// Garde-fou : le fuseau des tests est fixé par globalSetup (Europe/Paris), jamais celui de la machine.
if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Paris') {
  throw new Error(`Fuseau des tests inattendu : ${Intl.DateTimeFormat().resolvedOptions().timeZone} (attendu Europe/Paris, voir src/test/globalSetup.ts)`);
}

// Données chargées en asynchrone (IndexedDB) : délai d'attente de findBy/waitFor porté à 3 s,
// pour absorber une machine chargée ou un runner CI plus lent (aucune valeur attendue modifiée).
if (typeof window !== 'undefined') {
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 3000 });
}
