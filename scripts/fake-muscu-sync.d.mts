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
  regressionCounts?: { sessions: number; weights: number } | null;
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
}

export interface FakeMuscuSync {
  server: Server;
  config: Required<FakeMuscuSyncOptions>;
  files: Map<string, FakeFile>;
  requests: FakeRequest[];
  listen: (port?: number) => Promise<string>;
  close: () => Promise<void>;
}

export function createFakeMuscuSync(options?: FakeMuscuSyncOptions): FakeMuscuSync;
