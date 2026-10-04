import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeMuscuSync, type FakeMuscuSync } from '../../scripts/fake-muscu-sync.mjs';
import { createDriveClient, type FetchLike } from './driveClient';

const CONFIG = { url: 'https://script.google.com/macros/s/AKfycbTESTSCRIPTID/exec', secret: 'secret-de-test-4242' };

/** `fetch` simulé : renvoie la réponse donnée et garde la requête. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return { fetch, calls };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const htmlResponse = (status = 404) => new Response('<!DOCTYPE html><html><body>Page introuvable</body></html>', { status, headers: { 'content-type': 'text/html' } });

describe('Classement strict des réponses', () => {
  it('confirmé : JSON avec ok: true (seul cas)', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ ok: true, version: 'sync-2', rootReady: true }));
    const result = await createDriveClient({ fetch }).ping(CONFIG);
    expect(result).toMatchObject({ kind: 'confirmed', body: { version: 'sync-2' } });
  });

  it.each([
    ['unauthorized', undefined, false],
    ['forbidden_name', undefined, false],
    ['busy', undefined, true],
    ['drive_error', true, true],
    ['integrity', undefined, true],
    ['bad_request', false, false],
  ])('rejeté : %s (retryable %s) → réessayable %s', async (error, retryable, expected) => {
    const { fetch } = fakeFetch(() => jsonResponse({ ok: false, error, ...(retryable !== undefined && { retryable }) }));
    expect(await createDriveClient({ fetch }).ping(CONFIG)).toMatchObject({ kind: 'rejected', error, retryable: expected });
  });

  it.each<[string, () => Response, string]>([
    ['page HTML 404', () => htmlResponse(404), 'html'],
    ['page HTML 200', () => htmlResponse(200), 'html'],
    ['JSON invalide', () => new Response('{ok: true', { status: 200 }), 'invalid_json'],
    ['JSON sans ok', () => jsonResponse({ version: 'sync-2' }), 'invalid_json'],
    ['tableau JSON', () => jsonResponse([1, 2]), 'invalid_json'],
    ['HTTP 500', () => new Response('erreur', { status: 500 }), 'http'],
  ])('non confirmé : %s', async (_name, respond, reason) => {
    const { fetch } = fakeFetch(respond);
    expect(await createDriveClient({ fetch }).ping(CONFIG)).toMatchObject({ kind: 'unconfirmed', reason });
  });

  it('non confirmé : réseau absent (fetch rejette)', async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await createDriveClient({ fetch }).ping(CONFIG)).toMatchObject({ kind: 'unconfirmed', reason: 'network', detail: 'TypeError: Failed to fetch' });
  });

  it('non confirmé : délai dépassé (requête annulée proprement)', async () => {
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init.signal ?? undefined;
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    const result = await createDriveClient({ fetch, timeoutMs: 30 }).ping(CONFIG);
    expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('ne lève jamais d’exception (même si fetch lève de façon synchrone)', async () => {
    const fetch: FetchLike = () => {
      throw new Error('synchrone');
    };
    await expect(createDriveClient({ fetch }).ping(CONFIG)).resolves.toMatchObject({ kind: 'unconfirmed', reason: 'network' });
  });
});

describe('Forme des requêtes (contrat sync-2)', () => {
  it('POST, corps JSON en chaîne (text/plain), AUCUN en-tête, redirections suivies', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ ok: true }));
    await createDriveClient({ fetch }).put(CONFIG, { folder: 'Semaine 40', name: 'a.json', content: 'é'.repeat(5), meta: { kind: 'session' } });
    const init = calls[0]?.init;
    expect(calls[0]?.url).toBe(CONFIG.url);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBeUndefined();
    expect(init?.redirect).toBe('follow');
    expect(typeof init?.body).toBe('string');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ secret: CONFIG.secret, action: 'put', folder: 'Semaine 40', name: 'a.json', content: 'ééééé', chars: 5, meta: { kind: 'session' } });
    expect(body).not.toHaveProperty('force');
    expect(new Request('https://x.test', { method: 'POST', body: init?.body as string }).headers.get('content-type')).toBe('text/plain;charset=UTF-8');
  });

  it('requestId : nouvel UUID à chaque tentative ; mark_deleted avec at', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ ok: true }));
    const client = createDriveClient({ fetch });
    await client.markDeleted(CONFIG, { folder: 'S', name: 'b.json', at: '2026-10-04T10:00:00+02:00' });
    await client.markDeleted(CONFIG, { folder: 'S', name: 'b.json', at: '2026-10-04T10:00:00+02:00' });
    const ids = calls.map((c) => (JSON.parse(c.init.body as string) as { requestId: string; action: string; at: string }));
    expect(ids[0]?.action).toBe('mark_deleted');
    expect(ids[0]?.at).toBe('2026-10-04T10:00:00+02:00');
    expect(ids[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]?.requestId).not.toBe(ids[1]?.requestId);
  });

  it('le secret et l’identifiant du script n’apparaissent dans aucun résultat, même si la réponse les répète', async () => {
    const echo = `<html>${CONFIG.secret} ${CONFIG.url}</html>`;
    const { fetch } = fakeFetch(() => new Response(echo, { status: 404, headers: { 'content-type': 'text/html' } }));
    const network: FetchLike = () => Promise.reject(new TypeError(`Failed to fetch ${CONFIG.url} ${CONFIG.secret}`));
    const results = [await createDriveClient({ fetch }).ping(CONFIG), await createDriveClient({ fetch: network }).ping(CONFIG)];
    for (const result of results) {
      const text = JSON.stringify(result);
      expect(text).not.toContain(CONFIG.secret);
      expect(text).not.toContain('AKfycbTESTSCRIPTID');
    }
  });
});

describe('Intégration HTTP réelle avec le serveur factice (302 → GET, CORS, HTML 404)', () => {
  let fake: FakeMuscuSync;
  let url = '';
  beforeAll(async () => {
    fake = createFakeMuscuSync({ secret: 'fake-secret-1234', htmlRate: 0, errorRate: 0, latencyMin: 5, latencyMax: 20 });
    url = await fake.listen();
  });
  afterAll(async () => {
    await fake.close();
  });

  it('ping et put confirmés après la redirection ; fichier écrit tel quel', async () => {
    const client = createDriveClient();
    const config = { url, secret: 'fake-secret-1234' };
    expect(await client.ping(config)).toMatchObject({ kind: 'confirmed', body: { version: 'sync-2', rootReady: true } });
    const put = await client.put(config, { folder: 'Semaine 40', name: '2026-10-04_1810_Seance-A_w1.json', content: '{"a":"é"}', meta: { kind: 'session' } });
    expect(put.kind).toBe('confirmed');
    expect(fake.files.get('Semaine 40/2026-10-04_1810_Seance-A_w1.json')?.content).toBe('{"a":"é"}');
    expect(fake.requests.at(-1)?.contentType).toBe('text/plain;charset=UTF-8');
  });

  it('refus du script : secret faux, _INDEX.json, mauvaise extension ; not_in_index', async () => {
    const client = createDriveClient();
    const good = { url, secret: 'fake-secret-1234' };
    expect(await client.ping({ url, secret: 'mauvais-secret' })).toMatchObject({ kind: 'rejected', error: 'unauthorized', retryable: false });
    expect(await client.put(good, { folder: 'Muscu', name: '_INDEX.json', content: '{}', meta: {} })).toMatchObject({ error: 'forbidden_name' });
    expect(await client.put(good, { folder: 'S', name: 'a.txt', content: '{}', meta: {} })).toMatchObject({ error: 'bad_extension' });
    expect(await client.markDeleted(good, { folder: 'S', name: 'inconnu.json', at: '2026-10-04T10:00:00Z' })).toMatchObject({ error: 'not_in_index' });
  });

  it('page HTML 404 (défaut mesuré) : non confirmé, alors que l’écriture a pu avoir lieu', async () => {
    fake.config.htmlRate = 1;
    const result = await createDriveClient().put({ url, secret: 'fake-secret-1234' }, { folder: 'S', name: 'h.json', content: '{}', meta: {} });
    fake.config.htmlRate = 0;
    expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'html', status: 404 });
    expect(fake.files.has('S/h.json')).toBe(true);
  });

  it('erreurs réessayables du script (busy, drive_error)', async () => {
    fake.config.errorRate = 1;
    const result = await createDriveClient().put({ url, secret: 'fake-secret-1234' }, { folder: 'S', name: 'b.json', content: '{}', meta: {} });
    fake.config.errorRate = 0;
    expect(result).toMatchObject({ kind: 'rejected', retryable: true });
    expect(['busy', 'drive_error']).toContain(result.kind === 'rejected' ? result.error : '');
  });

  it('serveur injoignable : non confirmé (réseau)', async () => {
    const result = await createDriveClient().ping({ url: 'http://127.0.0.1:1/macros/s/X/exec', secret: 'fake-secret-1234' });
    expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'network' });
  });
});

