/**
 * Configuration de l'archive Drive (V1.3), par appareil, dans `settings.driveSync`.
 * Jamais exportée ni restaurée (cf. `DEVICE_SETTING_KEYS`, `toHistoryExport`).
 */
import { db, type DriveSyncSettings } from '../db/database';
import { DomainError } from '../domain/errors';
import { strings } from '../i18n/strings';

const t = strings.drive;

export const EMPTY_DRIVE_SYNC: DriveSyncSettings = { url: '', secret: '', enabled: false, testedAt: null };
/** Longueur minimale du secret (un secret trop court ne pourrait pas être masqué sans risque). */
export const MIN_SECRET_LENGTH = 8;

export async function getDriveSync(): Promise<DriveSyncSettings> {
  const record = await db.settings.get('driveSync');
  return record?.key === 'driveSync' ? record.value : { ...EMPTY_DRIVE_SYNC };
}

/** URL acceptée : HTTPS (le script Apps Script), ou HTTP local (serveur factice des tests). */
export function validateDriveUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return t.invalidUrl;
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local)) return null;
  return t.invalidUrl;
}

/**
 * Enregistre URL et secret. Tout changement de l'un ou de l'autre annule le test réussi
 * et DÉSACTIVE l'envoi : un nouveau test sera exigé avant de réactiver.
 */
export async function saveDriveConfig(url: string, secret: string): Promise<DriveSyncSettings> {
  const cleanUrl = url.trim();
  const cleanSecret = secret.trim();
  const urlError = validateDriveUrl(cleanUrl);
  if (urlError !== null) throw new DomainError(urlError);
  if (cleanSecret.length < MIN_SECRET_LENGTH) throw new DomainError(t.secretTooShort(MIN_SECRET_LENGTH));
  return db.transaction('rw', db.settings, async () => {
    const current = await getDriveSync();
    const changed = current.url !== cleanUrl || current.secret !== cleanSecret;
    const next: DriveSyncSettings = changed ? { url: cleanUrl, secret: cleanSecret, enabled: false, testedAt: null } : current;
    await db.settings.put({ key: 'driveSync', value: next });
    return next;
  });
}

/** Test réussi (`ping` confirmé) pour la configuration ACTUELLE. */
export async function markDriveTested(at: string, tested: { url: string; secret: string }): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await getDriveSync();
    // Configuration modifiée pendant le test : le résultat ne la concerne plus.
    if (current.url !== tested.url || current.secret !== tested.secret) return;
    await db.settings.put({ key: 'driveSync', value: { ...current, testedAt: at } });
  });
}

/** Active ou désactive l'envoi automatique. Activer exige un test réussi (spec §8.3). */
export async function setDriveEnabled(enabled: boolean): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const current = await getDriveSync();
    if (enabled && current.testedAt === null) throw new DomainError(t.testRequired);
    await db.settings.put({ key: 'driveSync', value: { ...current, enabled } });
  });
}

/** Envoi actif ET configuré. */
export const isDriveActive = (config: DriveSyncSettings): boolean => config.enabled && config.url !== '' && config.secret !== '';
