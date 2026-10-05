/**
 * Serveur FACTICE du script « Muscu Sync » (contrat sync-2), pour les tests uniquement.
 * Jamais utilisé en production ; le vrai script et sa vraie URL ne sont jamais contactés.
 *
 * Imite fidèlement le vrai script ET ses défauts mesurés (V1.3 spec §2) :
 * - POST /macros/s/<id>/exec → réponse 302 vers /macros/echo?user_content_key=… (suivie en GET) ;
 * - en-tête CORS « Access-Control-Allow-Origin: * » sur la redirection et la réponse finale ;
 *   un préflight (OPTIONS, provoqué par un en-tête personnalisé) est REFUSÉ, comme Apps Script ;
 * - environ 18 % de réponses « 404 » en HTML (la requête a pu être traitée : l'app doit renvoyer) ;
 * - latence aléatoire de 0,2 à 3 s ; erreurs réessayables (busy, drive_error) ;
 * - secret, actions ping / put / mark_deleted, refus de _INDEX.json et LISEZMOI.txt ;
 * - refus de RÉGRESSION (V1.3b) : `Sauvegardes/sauvegarde-derniere.json` n'est jamais remplacée par
 *   une sauvegarde contenant moins de séances ou moins de pesées (`meta.counts`), sauf `force: true`.
 *   À la demande des tests : `regressionCounts` simule un Drive déjà plus complet.
 *
 * Usage : `node scripts/fake-muscu-sync.mjs [port]` (défaut 4190, secret FAKE_SECRET ou
 * « fake-secret-1234 »). Pilotage pour les tests : GET /__state, POST /__config, POST /__reset.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  secret: 'fake-secret-1234',
  htmlRate: 0.18,
  errorRate: 0.05,
  latencyMin: 200,
  latencyMax: 3000,
  seed: 42,
  /** `false` : le réseau « tombe » (connexion coupée sans réponse). */
  online: true,
  /** `{ sessions, weights }` : contenu (simulé) de la sauvegarde déjà présente dans Drive. */
  regressionCounts: null,
};

const LATEST_KEY = 'Sauvegardes/sauvegarde-derniere.json';

const MAX_CONTENT = 5_000_000;
const FORBIDDEN_NAMES = new Set(['_INDEX.json', 'LISEZMOI.txt']);

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HTML_404 = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Page introuvable</title></head>
<body><div>Google Drive</div><p>Désolé, le fichier demandé n'existe pas.</p></body></html>`;

export function createFakeMuscuSync(options = {}) {
  const config = { ...DEFAULTS, ...options };
  let random = seeded(config.seed);
  /** Fichiers écrits : `dossier/nom` → { folder, name, content, meta, writes, deletedAt }. */
  const files = new Map();
  /** Journal des requêtes reçues (sans le secret). */
  const requests = [];
  /** Réponses en attente de la redirection GET. */
  const pending = new Map();
  let tokenCounter = 0;

  const json = (body) => ({ status: 200, type: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  const fail = (error, retryable = false, extra = {}) => json({ ok: false, error, retryable, ...extra });

  function handleAction(raw) {
    let request;
    try {
      request = JSON.parse(raw);
    } catch {
      return { log: { action: '?', outcome: 'bad_json' }, response: fail('bad_json') };
    }
    const { secret, action, requestId } = request;
    const log = { action, requestId, folder: request.folder, name: request.name };
    if (secret !== config.secret) return { log: { ...log, outcome: 'unauthorized' }, response: fail('unauthorized') };

    if (action === 'ping') {
      return { log: { ...log, outcome: 'ok' }, response: json({ ok: true, version: 'sync-2', serverTime: new Date().toISOString(), rootReady: true }) };
    }
    if (action !== 'put' && action !== 'mark_deleted') return { log: { ...log, outcome: 'bad_request' }, response: fail('bad_request') };

    const { folder, name } = request;
    if (typeof folder !== 'string' || typeof name !== 'string' || folder === '' || name === '') {
      return { log: { ...log, outcome: 'bad_request' }, response: fail('bad_request') };
    }
    if (FORBIDDEN_NAMES.has(name) || /[\\/]/.test(name) || /[\\/]/.test(folder)) {
      return { log: { ...log, outcome: 'forbidden_name' }, response: fail('forbidden_name') };
    }
    const key = `${folder}/${name}`;

    if (action === 'mark_deleted') {
      const file = files.get(key);
      if (!file) return { log: { ...log, outcome: 'not_in_index' }, response: fail('not_in_index') };
      file.deletedAt = request.at;
      return { log: { ...log, outcome: 'ok' }, response: json({ ok: true, deletedAt: request.at }) };
    }

    if (!name.endsWith('.json')) return { log: { ...log, outcome: 'bad_extension' }, response: fail('bad_extension') };
    if (typeof request.content !== 'string') return { log: { ...log, outcome: 'bad_request' }, response: fail('bad_request') };
    if (request.content.length > MAX_CONTENT) return { log: { ...log, outcome: 'too_big' }, response: fail('too_big') };
    if (request.chars !== request.content.length) return { log: { ...log, outcome: 'integrity' }, response: fail('integrity', true) };
    if (random() < config.errorRate) {
      const error = random() < 0.5 ? 'busy' : 'drive_error';
      return { log: { ...log, outcome: error }, response: fail(error, true) };
    }
    if (key === LATEST_KEY && request.force !== true) {
      const existing = config.regressionCounts ?? files.get(LATEST_KEY)?.meta?.counts ?? null;
      const incoming = request.meta?.counts ?? { sessions: 0, weights: 0 };
      if (existing && (incoming.sessions < existing.sessions || incoming.weights < existing.weights)) {
        const current = { sessions: existing.sessions, weights: existing.weights };
        return {
          log: { ...log, outcome: 'regression' },
          response: fail('regression', false, { current, incoming: { sessions: incoming.sessions, weights: incoming.weights } }),
        };
      }
    }
    if (key === LATEST_KEY && request.force === true) config.regressionCounts = null;
    const previous = files.get(key);
    files.set(key, { folder, name, content: request.content, meta: request.meta, writes: (previous?.writes ?? 0) + 1, deletedAt: previous?.deletedAt ?? null });
    return { log: { ...log, outcome: 'ok', chars: request.chars, force: request.force === true }, response: json({ ok: true, folder, name, chars: request.chars }) };
  }

  const cors = { 'Access-Control-Allow-Origin': '*' };
  const latency = () => config.latencyMin + random() * (config.latencyMax - config.latencyMin);
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // --- Pilotage des tests ---------------------------------------------------------
    if (url.pathname === '/__state') {
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ files: [...files.values()], requests }));
      return;
    }
    if (url.pathname === '/__config' && req.method === 'POST') {
      const changes = JSON.parse((await readBody(req)) || '{}');
      Object.assign(config, changes);
      if ('seed' in changes) random = seeded(config.seed);
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify(config));
      return;
    }
    if (url.pathname === '/__reset' && req.method === 'POST') {
      files.clear();
      requests.length = 0;
      pending.clear();
      res.writeHead(204, cors).end();
      return;
    }

    // --- Comportement du script -----------------------------------------------------
    // Préflight CORS (en-tête personnalisé) : refusé, comme Apps Script.
    if (req.method === 'OPTIONS') {
      res.writeHead(405).end();
      return;
    }
    if (!config.online) {
      req.socket.destroy();
      return;
    }
    if (req.method === 'POST' && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
      const raw = await readBody(req);
      await new Promise((r) => setTimeout(r, latency()));
      if (!config.online) {
        req.socket.destroy();
        return;
      }
      const { log, response } = handleAction(raw);
      // Défaut mesuré : ~18 % de pages 404 en HTML (la requête a pu être traitée).
      const html = random() < config.htmlRate;
      requests.push({ ...log, contentType: req.headers['content-type'] ?? null, html, at: new Date().toISOString() });
      const token = `k${String(++tokenCounter)}`;
      pending.set(token, html ? { status: 404, type: 'text/html; charset=utf-8', body: HTML_404 } : response);
      res.writeHead(302, { Location: `/macros/echo?user_content_key=${token}`, ...cors });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/macros/echo') {
      const token = url.searchParams.get('user_content_key') ?? '';
      const response = pending.get(token);
      pending.delete(token);
      if (!response) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', ...cors });
        res.end(HTML_404);
        return;
      }
      res.writeHead(response.status, { 'content-type': response.type, ...cors });
      res.end(response.body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', ...cors });
    res.end(HTML_404);
  });

  return {
    server,
    config,
    files,
    requests,
    /** Démarre l'écoute ; renvoie l'URL `/exec` à configurer dans l'app. */
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          const { port: actual } = server.address();
          resolve(`http://127.0.0.1:${String(actual)}/macros/s/FAKE-SCRIPT-ID/exec`);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// Lancement direct : `node scripts/fake-muscu-sync.mjs [port]`.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fake = createFakeMuscuSync({ secret: process.env.FAKE_SECRET ?? DEFAULTS.secret, seed: Date.now() % 100000 });
  const url = await fake.listen(Number(process.argv[2] ?? 4190));
  console.log(`Faux Muscu Sync : ${url} (secret : ${fake.config.secret})`);
}
