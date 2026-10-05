import { db } from '../db/database';
import type { UserPreferences } from '../domain/types';
import { DEFAULT_PREFERENCES } from '../schemas/history.schema';

export async function getActiveProgramId(): Promise<string | null> {
  const record = await db.settings.get('activeProgramId');
  return record?.key === 'activeProgramId' ? record.value : null;
}

export async function getPreferences(): Promise<UserPreferences> {
  const record = await db.settings.get('preferences');
  return record?.key === 'preferences' ? record.value : { ...DEFAULT_PREFERENCES };
}

export async function getLastExportAt(): Promise<string | null> {
  const record = await db.settings.get('lastExportAt');
  return record?.key === 'lastExportAt' ? record.value : null;
}

export async function setLastExportAt(iso: string): Promise<void> {
  await db.settings.put({ key: 'lastExportAt', value: iso });
}

/** Dernier envoi au coach (export partiel) : n'agit jamais sur le rappel de sauvegarde. */
export async function getLastCoachExportAt(): Promise<string | null> {
  const record = await db.settings.get('lastCoachExportAt');
  return record?.key === 'lastCoachExportAt' ? record.value : null;
}

export async function setLastCoachExportAt(iso: string): Promise<void> {
  await db.settings.put({ key: 'lastCoachExportAt', value: iso });
}

/** Dernière sauvegarde automatique CONFIRMÉE vers Drive (V1.3b), `null` sinon. */
export async function getLastAutoBackupAt(): Promise<string | null> {
  const record = await db.settings.get('lastAutoBackupAt');
  return record?.key === 'lastAutoBackupAt' ? record.value : null;
}

export async function setLastAutoBackupAt(iso: string): Promise<void> {
  await db.settings.put({ key: 'lastAutoBackupAt', value: iso });
}

/** Dernière copie hebdomadaire CONFIRMÉE vers Drive (V1.3b), `null` sinon. */
export async function getLastWeeklyBackupAt(): Promise<string | null> {
  const record = await db.settings.get('lastWeeklyBackupAt');
  return record?.key === 'lastWeeklyBackupAt' ? record.value : null;
}

export async function setLastWeeklyBackupAt(iso: string): Promise<void> {
  await db.settings.put({ key: 'lastWeeklyBackupAt', value: iso });
}

/** Le plus récent de deux instants ISO (`null` ignoré) : base du rappel d'export (V1.3b §9). */
export function latestInstant(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
