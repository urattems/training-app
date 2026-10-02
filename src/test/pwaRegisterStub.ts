/**
 * Remplace `virtual:pwa-register/react` (module virtuel de vite-plugin-pwa, absent sous Vitest).
 * Les tests pilotent « nouvelle version disponible » et observent l'appel de mise à jour.
 */
import { useSyncExternalStore } from 'react';

let needRefresh = false;
const listeners = new Set<() => void>();

export const pwaStub = {
  updateCalls: 0,
  setNeedRefresh(value: boolean) {
    needRefresh = value;
    listeners.forEach((l) => {
      l();
    });
  },
  reset() {
    this.updateCalls = 0;
    this.setNeedRefresh(false);
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useRegisterSW() {
  const value = useSyncExternalStore(subscribe, () => needRefresh);
  return {
    needRefresh: [value, (v: boolean) => {
      pwaStub.setNeedRefresh(v);
    }] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: () => {
      pwaStub.updateCalls++;
      return Promise.resolve();
    },
  };
}
