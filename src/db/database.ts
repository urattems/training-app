import { Dexie, type EntityTable, type Table } from 'dexie';
import { DB_NAME } from '../config';
import { watchConnection } from './connectionStatus';
import type { HistoryExport, StoredProgram, UserPreferences, WeightEntry, WorkoutSession } from '../domain/types';

/**
 * Version du schéma IndexedDB. Chaque évolution ajoute un `this.version(n)` ; les versions
 * précédentes restent déclarées pour que Dexie sache mettre à jour une base ancienne.
 * - 1 (V1) : programmes, séances, réglages, métadonnées ;
 * - 2 (V1.2) : + `weights` (pesées). Aucun store existant n'est modifié, aucune donnée réécrite.
 */
export const DB_VERSION = 2;

/** Stores de la version 1 : figés, ne jamais les modifier (base des mises à jour). */
export const STORES_V1 = {
  // Pas d'index sur `archivedAt` : `null` n'est pas indexable dans IndexedDB.
  programs: '&programId',
  workouts: '&id, status, date, programId',
  settings: '&key',
  metadata: '&key',
} as const;

/** Version 2 : ajoute SEULEMENT les pesées, clé primaire = date locale (une pesée par jour). */
export const STORES_V2_ADDED = {
  weights: '&date',
} as const;

/** Réglages persistés. Le programme actif n'est défini qu'ici (DECISIONS.md). */
export type SettingRecord =
  | { key: 'activeProgramId'; value: string | null }
  | { key: 'preferences'; value: UserPreferences }
  | { key: 'lastExportAt'; value: string | null }
  /** Dernier envoi au coach (V1.1b) : distinct de `lastExportAt`, ne compte jamais comme sauvegarde. */
  | { key: 'lastCoachExportAt'; value: string | null };

export type SettingKey = SettingRecord['key'];

/**
 * Copie interne des données remplacées lors d'une restauration.
 * Écrite en 1.1 depuis la V1.2 (pesées comprises) ; une copie écrite avant reste en 1.0.
 */
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
  weights!: EntityTable<WeightEntry, 'date'>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores(STORES_V1);
    // Mise à jour 1 → 2 : création du store `weights` (vide), sans `upgrade()` : rien à réécrire.
    this.version(DB_VERSION).stores(STORES_V2_ADDED);
    // Autre onglet sur une autre version : message clair au lieu d'une attente ou d'une erreur obscure.
    watchConnection(this);
  }
}

/** Instance unique de l'application. */
export const db = new TrainingDatabase();
