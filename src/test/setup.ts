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
