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
