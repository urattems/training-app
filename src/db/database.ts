import { Dexie, type EntityTable, type Table } from 'dexie';
import { DB_NAME } from '../config';
import type { HistoryExport, StoredProgram, UserPreferences, WorkoutSession } from '../domain/types';

/** Version du schéma IndexedDB. Chaque évolution ajoute un `this.version(n)` avec `upgrade()`. */
export const DB_VERSION = 1;

/** Réglages persistés. Le programme actif n'est défini qu'ici (DECISIONS.md). */
export type SettingRecord =
  | { key: 'activeProgramId'; value: string | null }
  | { key: 'preferences'; value: UserPreferences }
  | { key: 'lastExportAt'; value: string | null }
  /** Dernier envoi au coach (V1.1b) : distinct de `lastExportAt`, ne compte jamais comme sauvegarde. */
  | { key: 'lastCoachExportAt'; value: string | null };

export type SettingKey = SettingRecord['key'];

/** Copie interne des données remplacées lors d'une restauration. */
export interface PreRestoreBackupRecord {
  key: 'preRestoreBackup';
  savedAt: string;
  data: HistoryExport;
}

export type MetadataRecord = PreRestoreBackupRecord;

export class TrainingDatabase extends Dexie {
  programs!: EntityTable<StoredProgram, 'programId'>;
  workouts!: EntityTable<WorkoutSession, 'id'>;
  settings!: Table<SettingRecord, SettingKey>;
  metadata!: Table<MetadataRecord, MetadataRecord['key']>;

  constructor(name: string = DB_NAME) {
    super(name);
    // Pas d'index sur `archivedAt` : `null` n'est pas indexable dans IndexedDB.
    this.version(DB_VERSION).stores({
      programs: '&programId',
      workouts: '&id, status, date, programId',
      settings: '&key',
      metadata: '&key',
    });
  }
}

/** Instance unique de l'application. */
export const db = new TrainingDatabase();
