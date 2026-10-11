import { describe, expect, it } from 'vitest';
import { detectPlatform, isInstalledApp } from './platform';

describe('Plateforme présélectionnée (V1.8-SPEC §4.1)', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', 'iphone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', 'iphone'],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', 'android'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'android'],
    // Ordinateur ou agent inconnu : iPhone d'abord.
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'iphone'],
    ['', 'iphone'],
  ] as const)('%s → %s', (ua, expected) => {
    expect(detectPlatform(ua)).toBe(expected);
  });
});

describe('Mode installé', () => {
  it('display-mode standalone, ou navigator.standalone (iOS) ; sinon non', () => {
    expect(isInstalledApp({ displayModeStandalone: true, navigatorStandalone: undefined })).toBe(true);
    expect(isInstalledApp({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isInstalledApp({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
    expect(isInstalledApp({ displayModeStandalone: false, navigatorStandalone: undefined })).toBe(false);
  });
});
