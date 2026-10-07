/**
 * Client du script « Muscu Sync » (contrat `sync-2`, V1.3 spec §2). Ne lève JAMAIS d'exception :
 * chaque appel renvoie un résultat strictement classé.
 * - `confirmed` : réponse JSON avec `ok: true` (seul cas qui vaut envoi réussi) ;
 * - `rejected`  : réponse JSON avec `ok: false` (`error`, `retryable`) ;
 * - `unconfirmed` : tout le reste (réseau, délai, page HTML, JSON invalide, HTTP anormal).
 * Requête : POST, corps JSON en `text/plain` (aucun en-tête : pas de préflight CORS), redirections
 * suivies (défaut de fetch), 90 s maximum. Le secret n'apparaît dans AUCUN résultat.
 */
import { redact } from '../domain/driveNames';
import { createId } from '../utils/ids';

export const DRIVE_TIMEOUT_MS = 90_000;
/** Longueur maximale d'un extrait de réponse conservé pour le diagnostic. */
const SNIPPET_LENGTH = 200;

/** Erreurs du script qu'il est utile de réessayer (spec §2), si `retryable` est absent. */
const RETRYABLE_ERRORS = new Set(['integrity', 'busy', 'drive_error']);

export interface DriveConfig {
  url: string;
  secret: string;
}

export type UnconfirmedReason = 'network' | 'timeout' | 'html' | 'invalid_json' | 'http';

export type DriveResult =
  | { kind: 'confirmed'; body: Record<string, unknown>; latencyMs: number; requestId: string }
  | { kind: 'rejected'; error: string; retryable: boolean; body: Record<string, unknown>; latencyMs: number; requestId: string }
  | { kind: 'unconfirmed'; reason: UnconfirmedReason; status: number | null; detail: string; latencyMs: number; requestId: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface DriveClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

export interface PutRequest {
  folder: string;
  name: string;
  content: string;
  meta: Record<string, unknown>;
  force?: boolean;
}

export interface MarkDeletedRequest {
  folder: string;
  name: string;
  at: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const looksLikeHtml = (text: string, contentType: string): boolean =>
  /html/i.test(contentType) || /^\s*</.test(text);

export interface DriveClient {
  ping: (config: DriveConfig) => Promise<DriveResult>;
  put: (config: DriveConfig, request: PutRequest) => Promise<DriveResult>;
  markDeleted: (config: DriveConfig, request: MarkDeletedRequest) => Promise<DriveResult>;
  /** sync-3 (V1.6.2) : note la suppression d'une donnée sans fichier propre (mensuration). */
  noteDeletion: (config: DriveConfig, request: NoteDeletionRequest) => Promise<DriveResult>;
}

export interface NoteDeletionRequest {
  kind: 'measurement';
  /** Date de la prise (`YYYY-MM-DD`). */
  key: string;
  at: string;
}

export function createDriveClient({ fetch: fetchImpl, timeoutMs = DRIVE_TIMEOUT_MS, now = () => Date.now() }: DriveClientOptions = {}): DriveClient {
  async function call(config: DriveConfig, action: string, payload: Record<string, unknown>): Promise<DriveResult> {
    // Nouvel identifiant par tentative (diagnostic côté script) ; fonctionne hors contexte sécurisé.
    const requestId = createId();
    const started = now();
    const elapsed = () => Math.max(0, Math.round(now() - started));
    const unconfirmed = (reason: UnconfirmedReason, status: number | null, detail: string): DriveResult => ({
      kind: 'unconfirmed',
      reason,
      status,
      detail: redact(detail, config).slice(0, SNIPPET_LENGTH),
      latencyMs: elapsed(),
      requestId,
    });

    const doFetch: FetchLike | undefined = fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    if (!doFetch) return unconfirmed('network', null, 'fetch indisponible');

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      // Corps en chaîne : le navigateur envoie `text/plain;charset=UTF-8`, sans en-tête ajouté.
      const response = await doFetch(config.url, {
        method: 'POST',
        body: JSON.stringify({ secret: config.secret, action, requestId, ...payload }),
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      if (response.status !== 200) {
        return unconfirmed(looksLikeHtml(text, contentType) ? 'html' : 'http', response.status, `HTTP ${String(response.status)} ${text}`);
      }
      if (looksLikeHtml(text, contentType)) return unconfirmed('html', response.status, text);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return unconfirmed('invalid_json', response.status, text);
      }
      if (!isRecord(body) || typeof body.ok !== 'boolean') return unconfirmed('invalid_json', response.status, text);
      if (body.ok) return { kind: 'confirmed', body, latencyMs: elapsed(), requestId };
      const error = typeof body.error === 'string' ? body.error : 'unknown';
      const retryable = typeof body.retryable === 'boolean' ? body.retryable : RETRYABLE_ERRORS.has(error);
      return { kind: 'rejected', error, retryable, body, latencyMs: elapsed(), requestId };
    } catch (error) {
      if (controller.signal.aborted) return unconfirmed('timeout', null, `délai de ${String(Math.round(timeoutMs / 1000))} s dépassé`);
      return unconfirmed('network', null, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ping: (config) => call(config, 'ping', {}),
    put: (config, { folder, name, content, meta, force }) =>
      // `chars` toujours envoyé : le script vérifie l'intégrité du contenu reçu.
      call(config, 'put', { folder, name, content, chars: content.length, meta, ...(force === true && { force: true }) }),
    markDeleted: (config, { folder, name, at }) => call(config, 'mark_deleted', { folder, name, at }),
    noteDeletion: (config, { kind, key, at }) => call(config, 'note_deletion', { kind, key, at }),
  };
}
