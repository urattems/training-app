/**
 * ============================================================
 *  MUSCU SYNC : script de réception (version sync-3)
 * ============================================================
 * Reçoit les fichiers JSON envoyés par l'app « Carnet d'entraînement »
 * et les range dans ton Drive, dossier « Muscu ».
 *
 * ÉCRITURE SEULE : aucune action ne renvoie le contenu de tes fichiers.
 * Le secret n'est PAS dans le code : il est dans « Propriétés du script ».
 *
 * Actions acceptées (POST, corps JSON envoyé en text/plain) :
 *   ping          -> vérifie la liaison
 *   put           -> crée ou ÉCRASE un fichier (idempotent) et met l'index à jour
 *                    (garde-fou : refuse d'écraser « sauvegarde-derniere.json » par une sauvegarde
 *                     MOINS complète, sauf si force=true : voir regression_ ; sync-3 tolère la baisse
 *                     exactement égale au nombre de suppressions notées depuis la dernière sauvegarde acceptée)
 *   mark_deleted  -> note dans l'index qu'un fichier a été supprimé dans l'app (le fichier reste)
 *   note_deletion -> (sync-3) note dans l'index qu'une mensuration a été supprimée dans l'app (aucun fichier)
 *   reindex       -> reconstruit l'index en parcourant les dossiers (maintenance, lent)
 */

const VERSION = 'sync-3';
const ROOT_NAME = 'Muscu';
const INDEX_NAME = '_INDEX.json';
const README_NAME = 'LISEZMOI.txt';
const MAX_CONTENT_CHARS = 8 * 1024 * 1024;
const MIN_SECRET_LENGTH = 20;

/* ------------------------------------------------------------
 *  Outils
 * ------------------------------------------------------------ */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function sanitizeName_(s) {
  const r = String(s == null ? '' : s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return (r === '.' || r === '..') ? '' : r;
}

function safeEqual_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Les opérations Drive échouent parfois de façon passagère (constaté au diagnostic : « Access denied: DriveApp »).
// On réessaie, ce qui est sans risque car tout est idempotent.
function retry_(fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return fn(); } catch (e) {
      last = e;
      if (!/access denied|service|rate|temporar|timed out|internal error|unavailable|try again|server error/i.test(String(e))) throw e;
      Utilities.sleep(600 * (i + 1));
    }
  }
  throw last;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'busy', retryable: true };
  try { return fn(); } finally { lock.releaseLock(); }
}

function getRoot_() {
  const id = prop_('ROOT_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* introuvable : on cherche ou on recrée */ }
  }
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
  setProp_('ROOT_ID', f.getId());
  PropertiesService.getScriptProperties().deleteProperty('INDEX_ID'); // l'index sera retrouvé (ou recréé) dans CE dossier
  return f;
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function writeFile_(folder, name, content) {
  const it = folder.getFilesByName(name);
  if (it.hasNext()) {
    const file = it.next();
    file.setContent(content);
    return { file: file, created: false };
  }
  const mime = /\.json$/i.test(name) ? 'application/json' : MimeType.PLAIN_TEXT;
  return { file: folder.createFile(name, content, mime), created: true };
}

/* ------------------------------------------------------------
 *  Index (_INDEX.json) : mis à jour pas à pas, reconstruit seulement à la demande
 * ------------------------------------------------------------ */

function emptyIndex_() {
  return { schema: 'muscu-index-1', updatedAt: null, folders: {}, deletions: {}, lastSession: null, lastWeight: null };
}

function loadIndex_(root) {
  let file = null;
  const id = prop_('INDEX_ID');
  if (id) {
    try { file = DriveApp.getFileById(id); if (file.isTrashed()) file = null; } catch (e) { file = null; }
  }
  if (!file) {
    const it = root.getFilesByName(INDEX_NAME);
    if (it.hasNext()) { file = it.next(); setProp_('INDEX_ID', file.getId()); }
  }
  let idx = emptyIndex_();
  if (file) {
    try { idx = JSON.parse(file.getBlob().getDataAsString()); }
    catch (e) { idx = emptyIndex_(); idx.recoveredAt = nowIso_(); }
    if (!idx.folders) idx.folders = {};
    if (!idx.deletions) idx.deletions = {};
  }
  return { file: file, idx: idx };
}

function saveIndex_(root, state) {
  state.idx.updatedAt = nowIso_();
  const text = JSON.stringify(state.idx, null, 1);
  if (state.file) {
    state.file.setContent(text);
  } else {
    state.file = root.createFile(INDEX_NAME, text, 'application/json');
    setProp_('INDEX_ID', state.file.getId());
  }
}

function updateIndexEntry_(root, folderName, fileName, file, meta) {
  const st = loadIndex_(root);
  const idx = st.idx;
  const bucket = idx.folders[folderName] = idx.folders[folderName] || { files: {} };
  if (!bucket.files) bucket.files = {};
  const prev = bucket.files[fileName] || {};
  const entry = {
    bytes: file.getSize(),
    firstSentAt: prev.firstSentAt || nowIso_(),
    updatedAt: nowIso_(),
    meta: meta || prev.meta || null
  };
  if (prev.deletedInAppAt && !meta) { // renvoi sans meta : on garde la trace
    entry.deletedInAppAt = prev.deletedInAppAt;
    if (prev.deletionNotedAt) entry.deletionNotedAt = prev.deletionNotedAt;
  }
  bucket.files[fileName] = entry;
  const kind = entry.meta && entry.meta.kind;
  if (kind === 'session') idx.lastSession = { folder: folderName, file: fileName, at: entry.updatedAt, meta: entry.meta };
  if (kind === 'weight' && (!idx.lastWeight || String(entry.meta.date) >= String(idx.lastWeight.date))) {
    idx.lastWeight = { folder: folderName, file: fileName, date: entry.meta.date, weightKg: entry.meta.weightKg, at: entry.updatedAt };
  }
  saveIndex_(root, st);
}

function reindex_() {
  return withLock_(function () {
    return retry_(function () {
      const root = getRoot_();
      const old = loadIndex_(root).idx;
      const fresh = emptyIndex_();
      fresh.lastSession = old.lastSession || null;
      fresh.lastWeight = old.lastWeight || null;
      fresh.deletions = old.deletions || {};
      let nFiles = 0;
      const folders = root.getFolders();
      while (folders.hasNext()) {
        const f = folders.next();
        const name = f.getName();
        const prevFiles = (old.folders[name] && old.folders[name].files) || {};
        const bucket = fresh.folders[name] = { files: {} };
        const files = f.getFiles();
        while (files.hasNext()) {
          const x = files.next();
          const p = prevFiles[x.getName()] || {};
          bucket.files[x.getName()] = {
            bytes: x.getSize(),
            firstSentAt: p.firstSentAt || null,
            updatedAt: Utilities.formatDate(x.getLastUpdated(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX"),
            meta: p.meta || null
          };
          if (p.deletedInAppAt) bucket.files[x.getName()].deletedInAppAt = p.deletedInAppAt;
          if (p.deletionNotedAt) bucket.files[x.getName()].deletionNotedAt = p.deletionNotedAt;
          nFiles++;
        }
      }
      const st = loadIndex_(root);
      st.idx = fresh;
      st.idx.reindexedAt = nowIso_();
      saveIndex_(root, st);
      return { ok: true, action: 'reindex', folders: Object.keys(fresh.folders).length, files: nFiles };
    });
  });
}

/* ------------------------------------------------------------
 *  Actions
 * ------------------------------------------------------------ */

// Garde-fou anti-perte : une nouvelle sauvegarde qui contient MOINS de séances, de pesées ou de mensurations que
// celle déjà présente dans Drive est refusée (cas typique : app réinstallée, donc vide). Il faut force=true pour passer outre.
// (sync-3) Exception : la baisse est tolérée quand elle est exactement égale au nombre de suppressions notées par l'app
// depuis la dernière sauvegarde acceptée (« allowed »). Une app réinstallée n'a noté aucune suppression : refus inchangé.
// Un type absent d'un des deux côtés n'est pas comparé (ancienne version de l'app, ou sauvegarde plus ancienne).
function regression_(cur, inc, allowed) {
  if (!cur || !inc) return false;
  const num = function (v) { return typeof v === 'number' && isFinite(v); };
  const ok = allowed || {};
  return ['sessions', 'weights', 'measurements'].some(function (k) {
    if (!num(cur[k]) || !num(inc[k])) return false;
    const tolerated = (typeof ok[k] === 'number' && ok[k] > 0) ? ok[k] : 0;
    return inc[k] < cur[k] - tolerated;
  });
}

// (sync-3) Nombre de suppressions notées APRÈS l'instant « sinceIso » (dernière sauvegarde acceptée), par type.
// Date illisible = non comptée (on préfère refuser et demander confirmation que laisser passer une perte).
function allowedDrops_(idx, sinceIso) {
  const allowed = { sessions: 0, weights: 0, measurements: 0 };
  const since = Date.parse(sinceIso);
  if (isNaN(since)) return allowed;
  const after = function (iso) { const t = Date.parse(iso); return !isNaN(t) && t > since; };
  const folders = (idx && idx.folders) || {};
  Object.keys(folders).forEach(function (fn) {
    const files = (folders[fn] && folders[fn].files) || {};
    Object.keys(files).forEach(function (name) {
      const e = files[name];
      if (!e || !e.deletedInAppAt) return;
      if (!after(e.deletionNotedAt || e.deletedInAppAt)) return;
      const kind = e.meta && e.meta.kind;
      if (kind === 'session') allowed.sessions++;
      else if (kind === 'weight') allowed.weights++;
    });
  });
  const m = (idx && idx.deletions && idx.deletions.measurement) || {};
  Object.keys(m).forEach(function (key) {
    if (m[key] && after(m[key].notedAt || m[key].at)) allowed.measurements++;
  });
  return allowed;
}

function put_(d) {
  const folderName = sanitizeName_(d.folder);
  const fileName = sanitizeName_(d.name);
  const content = typeof d.content === 'string' ? d.content : null;
  if (!folderName || !fileName || content === null) return { ok: false, error: 'bad_request', retryable: false };
  if (fileName === INDEX_NAME || fileName === README_NAME) return { ok: false, error: 'forbidden_name', retryable: false };
  if (!/\.(json|txt)$/i.test(fileName)) return { ok: false, error: 'bad_extension', retryable: false };
  if (content.length > MAX_CONTENT_CHARS) return { ok: false, error: 'too_big', retryable: false };
  if (typeof d.chars === 'number' && d.chars !== content.length) return { ok: false, error: 'integrity', retryable: true };
  const meta = (d.meta && typeof d.meta === 'object') ? d.meta : null;

  return withLock_(function () {
    return retry_(function () {
      const root = getRoot_();
      if (folderName === 'Sauvegardes' && fileName === 'sauvegarde-derniere.json' && meta && meta.counts && d.force !== true) {
        const idx = loadIndex_(root).idx;
        const cur = idx.folders['Sauvegardes'];
        const curEntry = cur && cur.files && cur.files[fileName];
        const curCounts = curEntry && curEntry.meta && curEntry.meta.counts;
        const allowed = allowedDrops_(idx, curEntry && curEntry.updatedAt);
        if (regression_(curCounts, meta.counts, allowed)) {
          return { ok: false, error: 'regression', retryable: false, current: curCounts, incoming: meta.counts, allowed: allowed, requestId: d.requestId || null };
        }
      }
      const folder = getOrCreateFolder_(root, folderName);
      const r = writeFile_(folder, fileName, content);
      updateIndexEntry_(root, folderName, fileName, r.file, meta);
      return { ok: true, action: 'put', folder: folderName, name: fileName, created: r.created,
               bytes: r.file.getSize(), fileId: r.file.getId(), requestId: d.requestId || null };
    });
  });
}

function markDeleted_(d) {
  const folderName = sanitizeName_(d.folder);
  const fileName = sanitizeName_(d.name);
  if (!folderName || !fileName) return { ok: false, error: 'bad_request', retryable: false };
  const at = typeof d.at === 'string' ? d.at.slice(0, 40) : nowIso_();
  return withLock_(function () {
    return retry_(function () {
      const root = getRoot_();
      const st = loadIndex_(root);
      const bucket = st.idx.folders[folderName];
      const entry = bucket && bucket.files && bucket.files[fileName];
      if (!entry) return { ok: false, error: 'not_in_index', retryable: false };
      if (!entry.deletedInAppAt) { // idempotent : un renvoi ne recrée pas une « nouvelle » suppression
        entry.deletedInAppAt = at;
        entry.deletionNotedAt = new Date().toISOString(); // horloge du serveur (précise à la milliseconde)
        saveIndex_(root, st);
      }
      return { ok: true, action: 'mark_deleted', folder: folderName, name: fileName, requestId: d.requestId || null };
    });
  });
}

// (sync-3) Note la suppression d'une mensuration (aucun fichier par prise : on garde seulement une trace dans l'index).
function noteDeletion_(d) {
  const kind = d.kind === 'measurement' ? 'measurement' : null;
  const key = sanitizeName_(d.key);
  if (!kind || !key) return { ok: false, error: 'bad_request', retryable: false };
  const at = typeof d.at === 'string' ? d.at.slice(0, 40) : nowIso_();
  return withLock_(function () {
    return retry_(function () {
      const root = getRoot_();
      const st = loadIndex_(root);
      if (!st.idx.deletions) st.idx.deletions = {};
      const bucket = st.idx.deletions[kind] = st.idx.deletions[kind] || {};
      if (!bucket[key]) { // idempotent par (kind, key)
        bucket[key] = { at: at, notedAt: new Date().toISOString() };
        saveIndex_(root, st);
      }
      return { ok: true, action: 'note_deletion', kind: kind, key: key, requestId: d.requestId || null };
    });
  });
}

function route_(req) {
  try {
    if (req.method === 'GET') {
      return { ok: true, service: 'muscu-sync', version: VERSION };
    }
    const secret = prop_('SECRET');
    if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, error: 'not_configured', retryable: false };

    let d;
    try { d = JSON.parse(req.body || ''); } catch (e) { return { ok: false, error: 'bad_json', retryable: false }; }
    if (!d || typeof d !== 'object' || !safeEqual_(d.secret, secret)) return { ok: false, error: 'unauthorized', retryable: false };

    switch (d.action) {
      case 'ping': {
        let rootReady = false;
        try { rootReady = !!getRoot_(); } catch (e) { rootReady = false; }
        return { ok: true, action: 'ping', version: VERSION, serverTime: nowIso_(), rootReady: rootReady, requestId: d.requestId || null };
      }
      case 'put': return put_(d);
      case 'mark_deleted': return markDeleted_(d);
      case 'note_deletion': return noteDeletion_(d);
      case 'reindex': return reindex_();
      default: return { ok: false, error: 'unknown_action', retryable: false };
    }
  } catch (e) {
    const msg = String(e);
    return { ok: false, error: 'drive_error', retryable: true, message: msg.slice(0, 200) };
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) { return respond_(route_({ method: 'GET' })); }

function doPost(e) {
  return respond_(route_({ method: 'POST', body: e && e.postData ? e.postData.contents : '' }));
}

/* ------------------------------------------------------------
 *  À LANCER DEPUIS L'ÉDITEUR
 * ------------------------------------------------------------ */

// 1) Vérifie l'installation et prépare le dossier Muscu (à lancer une fois, et après chaque modification)
function verifier_installation() {
  const lignes = [];
  const secret = prop_('SECRET');
  if (!secret) lignes.push('❌ Propriété SECRET absente : Paramètres du projet > Propriétés du script > Ajouter.');
  else if (secret.length < MIN_SECRET_LENGTH) lignes.push('❌ SECRET trop court (' + secret.length + ' caractères, minimum ' + MIN_SECRET_LENGTH + ').');
  else lignes.push('✅ SECRET configuré (' + secret.length + ' caractères)');

  try {
    const root = getRoot_();
    lignes.push('✅ Dossier « ' + ROOT_NAME + ' » prêt');
    const texte = [
      'CARNET D\'ENTRAINEMENT : ARCHIVE AUTOMATIQUE',
      '',
      'Ce dossier est rempli automatiquement par l\'app (rien à faire à la main).',
      '',
      '_INDEX.json                  Sommaire : tous les fichiers, leur date, les séances supprimées dans l\'app.',
      'Semaine XX/                  Un fichier JSON par séance (format « export pour le coach »).',
      'Pesees/                      Une pesée par jour (AAAA-MM-JJ.json) + _pesees.json (toutes les pesées).',
      'Sauvegardes/                 sauvegarde-derniere.json (à jour après chaque séance) et des copies datées chaque semaine.',
      '',
      'Pour donner tout le contexte à un coach (ChatGPT) : envoie Sauvegardes/sauvegarde-derniere.json.',
      'Pour restaurer l\'app : réinstalle l\'app, puis Paramètres > Restaurer une sauvegarde > ce même fichier.',
      '',
      'Les fichiers par séance ne sont PAS restaurables : seule la sauvegarde complète l\'est.',
      'Garde-fou : une sauvegarde moins complète que celle déjà ici n\'écrase rien sans confirmation dans l\'app.',
      'Une séance supprimée dans l\'app reste ici (marquée dans l\'index).'
    ].join('\n');
    writeFile_(root, README_NAME, texte);
    lignes.push('✅ ' + README_NAME + ' écrit');

    const test = getOrCreateFolder_(root, '_test-installation');
    const f = writeFile_(test, 'essai.json', '{"é":"💪"}').file;
    const ok = f.getBlob().getDataAsString() === '{"é":"💪"}';
    test.setTrashed(true);
    lignes.push(ok ? '✅ Écriture, relecture et suppression de test OK' : '❌ Relecture différente de l\'écriture');
  } catch (e) {
    lignes.push('❌ Erreur Drive : ' + e);
  }
  lignes.push('ℹ️ Fuseau du script : ' + Session.getScriptTimeZone() + ' (attendu : Europe/Paris)');
  Logger.log(lignes.join('\n'));
}

// 2) Reconstruit l'index à la main (si un jour il semble faux)
function reconstruire_index() {
  Logger.log(JSON.stringify(reindex_()));
}