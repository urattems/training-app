/** Types du serveur factice « Muscu Sync » (tests uniquement). */
import type { Server } from 'node:http';

export interface FakeMuscuSyncOptions {
  secret?: string;
  htmlRate?: number;
  errorRate?: number;
  latencyMin?: number;
  latencyMax?: number;
  seed?: number;
  online?: boolean;
  regressionCounts?: { sessions: number; weights: number; measurements?: number } | null;
  /** V1.6.2 : `sync-3` ajoute `note_deletion` et le compteur des mensurations. */
  version?: 'sync-2' | 'sync-3';
}

export interface FakeFile {
  folder: string;
  name: string;
  content: string;
  meta: Record<string, unknown>;
  writes: number;
  deletedAt: string | null;
}

export interface FakeRequest {
  action: string;
  requestId?: string;
  folder?: string;
  name?: string;
  outcome: string;
  contentType: string | null;
  html: boolean;
  chars?: number;
  force?: boolean;
  /** `note_deletion` (sync-3). */
  kind?: string;
  key?: string;
}

export interface FakeMuscuSync {
  server: Server;
  config: Required<FakeMuscuSyncOptions>;
  files: Map<string, FakeFile>;
  requests: FakeRequest[];
  /** sync-3 : suppressions notées `kind:key` (idempotentes) et leur consommation. */
  deletions: Map<string, { at: string; consumed: boolean }>;
  /** sync-3 : fichiers marqués supprimés (`dossier/nom`), tolérés une fois chacun. */
  marks: Map<string, { kind: 'session' | 'weight'; consumed: boolean }>;
  listen: (port?: number) => Promise<string>;
  close: () => Promise<void>;
}

export function createFakeMuscuSync(options?: FakeMuscuSyncOptions): FakeMuscuSync;
