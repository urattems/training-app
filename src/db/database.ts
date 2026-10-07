import { Dexie, type EntityTable, type Table } from 'dexie';
import { DB_NAME } from '../config';
import { watchConnection } from './connectionStatus';
import type { DriveNames, DriveOutboxState } from '../domain/driveOutbox';
import type { HistoryExport, MeasurementEntry, StoredProgram, UserPreferences, WeightEntry, WorkoutSession } from '../domain/types';

/**
 * Version du schéma IndexedDB. Chaque évolution ajoute un `this.version(n)` ; les versions
 * précédentes restent déclarées pour que Dexie sache mettre à jour une base ancienne.
 * - 1 (V1) : programmes, séances, réglages, métadonnées ;
 * - 2 (V1.2) : + `weights` (pesées). Aucun store existant n'est modifié, aucune donnée réécrite.
 * - 3 (V1.5.0) : + `measurements` (mensurations). Même principe : création d'un store vide.
 */
export const DB_VERSION = 3;

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

/** Version 3 : ajoute SEULEMENT les mensurations, clé primaire = date locale (une prise par jour). */
export const STORES_V3_ADDED = {
  measurements: '&date',
} as const;

/** Réglages persistés. Le programme actif n'est défini qu'ici (DECISIONS.md). */
export type SettingRecord =
  | { key: 'activeProgramId'; value: string | null }
  | { key: 'preferences'; value: UserPreferences }
  | { key: 'lastExportAt'; value: string | null }
  /** Dernier envoi au coach (V1.1b) : distinct de `lastExportAt`, ne compte jamais comme sauvegarde. */
  | { key: 'lastCoachExportAt'; value: string | null }
  /**
   * Archive Drive (V1.3), PAR APPAREIL : jamais exportée, jamais dans `preRestoreBackup`,
   * jamais écrasée par une restauration. Aucun changement de version de base (table `settings`).
   */
  | { key: 'driveSync'; value: DriveSyncSettings }
  | { key: 'driveOutbox'; value: DriveOutboxState }
  | { key: 'driveNames'; value: DriveNames }
  /**
   * Dernière `sauvegarde-derniere.json` CONFIRMÉE (`ok: true`) : instant où son contenu a été figé
   * (même définition que `lastExportAt`). Compte comme sauvegarde pour le rappel d'export (§9).
   */
  | { key: 'lastAutoBackupAt'; value: string | null }
  /** Dernière copie hebdomadaire CONFIRMÉE (`ok: true`). */
  | { key: 'lastWeeklyBackupAt'; value: string | null }
  /**
   * Version du script annoncée par le dernier `ping` confirmé (« sync-3 »), `null` = inconnue
   * (V1.6.2). PAR APPAREIL, comme l'URL et le secret : jamais exportée ni restaurée.
   */
  | { key: 'driveScriptVersion'; value: string | null };

/** Configuration de l'envoi vers le script « Muscu Sync » de l'utilisateur. */
export interface DriveSyncSettings {
  url: string;
  secret: string;
  enabled: boolean;
  /** Dernier test (`ping`) confirmé pour CES url et secret : requis pour activer l'envoi. */
  testedAt: string | null;
}

/** Réglages propres à l'appareil, conservés tels quels par une restauration. */
export const DEVICE_SETTING_KEYS = [
  'lastExportAt',
  'lastCoachExportAt',
  'driveSync',
  'driveOutbox',
  'driveNames',
  'lastAutoBackupAt',
  'lastWeeklyBackupAt',
  'driveScriptVersion',
] as const;

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
  measurements!: EntityTable<MeasurementEntry, 'date'>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores(STORES_V1);
    // Mise à jour 1 → 2 : création du store `weights` (vide), sans `upgrade()` : rien à réécrire.
    this.version(2).stores(STORES_V2_ADDED);
    // Mise à jour 2 → 3 : création du store `measurements` (vide), sans `upgrade()`.
    this.version(DB_VERSION).stores(STORES_V3_ADDED);
    // Autre onglet sur une autre version : message clair au lieu d'une attente ou d'une erreur obscure.
    watchConnection(this);
  }
}

/** Instance unique de l'application. */
export const db = new TrainingDatabase();
