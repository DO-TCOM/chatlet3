'use strict';
/*
 * Chaltet — serveur (Express + socket.io)
 *
 * Reconstitué à partir du contrat observé sur le site live :
 *   - routes HTTP : /, /<room>, /health, /api/*, /admin/api/*
 *   - en-têtes de sécurité + CSP identiques à ceux servis en production
 *   - protocole socket.io vu dans les fichiers client-*.js (11 emissions client, 14 emissions serveur)
 *   - anti-spam, moderation, panneau admin /admin-stats.html
 *
 * Les fichiers statiques du site sont dans ./public (copie verbatim du live).
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const MOD_PASSWORD = (process.env.MOD_PASSWORD || '').trim();
const STATS_PASSWORD = (process.env.STATS_PASSWORD || '').trim();
// REDIS_URL, TURN_*, TWILIO_* : lus directement par storage.js / routes-api.js.

const PUBLIC_DIR = path.join(__dirname, 'public');
const app = express();

app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

/* ─────────────────────────── Stockage ─────────────────────────── */
/* Deplace dans ./storage.js (Redis si REDIS_URL, sinon fichiers).  */

const {
  store,
  HASH_PROFILES,
  HASH_NOTES,
  HASH_BLACKLIST,
  HASH_EXTRAS,
  HASH_AUTH_ATTEMPTS,
  HASH_SPAM_STATE,
  HASH_IP_VISITS,
  HASH_TEMP_BANS,
  TEMP_BAN_MS,
  KEY_LOGS,
  KEY_CONFIG,
  LOGS_MAX_LINES,
} = require('./storage');

/* ─────────────────── Fonctions utilitaires ─────────────────── */
/* Deplacees dans ./utils.js (validation, encodage, detection UA). */

const {
  HASH_RE,
  RESERVED_ROOM_NAMES,
  isReservedRoomName,
  b64url,
  fromB64url,
  randomId,
  sanitizeColor,
  cleanText,
  clientIp,
  detectBrowser,
  logLine,
} = require('./utils');

/* ─────────── Historique IP → pseudos / salons (panneau admin) ─────────── */
/* Les logs HTTP ne contiennent que l'IP et le chemin visite : jamais le     */
/* pseudo choisi dans la room. Chaque profile-update (une par page de room)  */
/* enregistre ici l'IP, le pseudo et le salon vus — c'est la source des      */
/* colonnes « Pseudo(s) » et « Room(s) » de admin-stats.html.                */
const VISIT_PURGE_MS = 60 * 60 * 1000;        // purge horaire
const VISIT_MAX_IDLE = 30 * 24 * 60 * 60 * 1000; // 30 jours d'inactivite
const VISIT_MAX_IPS = 5000;                   // filet de securite taille
async function recordVisit(ip, pseudo, room) {
  if (!ip) return;
  try {
    const raw = await store.hGet(HASH_IP_VISITS, ip);
    let v = null;
    try { v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
    if (!v || typeof v !== 'object') v = { ps: {}, rm: {}, seen: 0 };
    const now = Date.now();
    if (pseudo) v.ps = { ...(v.ps || {}), [pseudo]: now };
    if (room) v.rm = { ...(v.rm || {}), [room]: now };
    v.seen = now;
    // Borne la taille : ne garder que les entrees les plus recentes.
    const trim = (o, max) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, max));
    v.ps = trim(v.ps, 20);
    v.rm = trim(v.rm, 30);
    await store.hSet(HASH_IP_VISITS, ip, v);
  } catch (e) { /* jamais bloquant */ }
}

/* Purge periodique : evite que le hash grossisse sans borne dans Upstash
   (quota 64 Mo), meme logique que auth_attempts plus haut.                */
setInterval(async () => {
  try {
    const now = Date.now();
    const all = await store.hGetAll(HASH_IP_VISITS);
    const entries = Object.entries(all);
    for (const [ip, raw] of entries) {
      let v = null;
      try { v = JSON.parse(raw); } catch (e) { v = null; }
      if (!v || typeof v !== 'object' || now - (v.seen || 0) > VISIT_MAX_IDLE) {
        await store.hDel(HASH_IP_VISITS, ip);
      }
    }
    const rest = Object.entries(await store.hGetAll(HASH_IP_VISITS));
    if (rest.length > VISIT_MAX_IPS) {
      const seenOf = (raw) => { try { return JSON.parse(raw).seen || 0; } catch (e) { return 0; } };
      rest.sort((a, b) => seenOf(a[1]) - seenOf(b[1]));
      for (const [ip] of rest.slice(0, rest.length - VISIT_MAX_IPS)) await store.hDel(HASH_IP_VISITS, ip);
    }
  } catch (e) { /* ignore */ }
}, VISIT_PURGE_MS).unref();

/* ─────────────────── Limiteur d'authentification ─────────────────── */
/* Compte les tentatives de login admin et de mod-auth socket par IP.  */
/* Le compteur est remis a zero des qu'une tentative reussit, afin de  */
/* ne pas penaliser un moderateur legitime.                            */

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;

// Stocke dans Redis/fichier (plus une Map en memoire) : un redemarrage de
// l'instance (Render free tier se met en veille) ne doit pas remettre a
// zero le compteur de tentatives de connexion admin/mod.
async function authRateLimit(ip) {
  const now = Date.now();
  const all = await store.hGetAll(HASH_AUTH_ATTEMPTS);
  let st = null;
  try { st = all[ip] ? JSON.parse(all[ip]) : null; } catch (e) { st = null; }
  if (!st || now >= st.resetAt) st = { count: 0, resetAt: now + AUTH_WINDOW_MS };
  st.count += 1;
  await store.hSet(HASH_AUTH_ATTEMPTS, ip, st);
  return {
    blocked: st.count > AUTH_MAX_ATTEMPTS,
    retryAfter: Math.ceil((st.resetAt - now) / 1000),
  };
}
async function authRateClear(ip) {
  await store.hDel(HASH_AUTH_ATTEMPTS, ip);
}

/* Purge periodique : evite que le hash croisse sans borne, un IP etant
   une cle librement falsifiable via X-Forwarded-For.                  */
setInterval(async () => {
  const now = Date.now();
  const all = await store.hGetAll(HASH_AUTH_ATTEMPTS);
  for (const [ip, raw] of Object.entries(all)) {
    let st = null;
    try { st = JSON.parse(raw); } catch (e) { st = null; }
    if (!st || now >= st.resetAt) await store.hDel(HASH_AUTH_ATTEMPTS, ip);
  }
}, AUTH_WINDOW_MS).unref();

app.use((req, res, next) => {
  const host = req.headers.host || 'localhost';
  const wss = 'wss://' + host;
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.gstatic.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' https://images.unsplash.com data:",
      `connect-src 'self' ${wss} wss://chaltet.com wss://www.chaltet.com https://global.relay.metered.ca`,
      "media-src 'self' data:",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "script-src-attr 'none'",
      'upgrade-insecure-requests',
    ].join(';')
  );
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-dns-prefetch-control', 'off');
  res.setHeader('x-download-options', 'noopen');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('x-permitted-cross-domain-policies', 'none');
  res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  next();
});

let logWritesSinceTrim = 0;

app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/socket.io')) return;
    // Health checks Render : ~518k commandes/mois, hors quota Upstash free.
    if (req.path === '/health') return;
    // Fichiers statiques (.css/.js/.img/son) : ~20 lignes par page, pas des visites.
    if (/\.[a-z0-9]{1,8}$/i.test(req.path)) return;
    // Ignorer les robots / services de monitoring externes pour préserver les quotas
    const ua = String(req.headers['user-agent'] || '');
    if (/UptimeRobot|bot|crawler|spider/i.test(ua)) return;
    const ip = clientIp(req);
    const browser = detectBrowser(ua);
    const room = req.path === '/' ? '/' : req.path.replace(/^\//, '');
    store.rPush(KEY_LOGS, logLine(ip, browser, room)).catch(() => {});
    // Rotation : un trim tous les 50 enregistrements evite une commande Redis
    // par requete tout en bornant la taille de la liste.
    if (++logWritesSinceTrim >= 50) {
      logWritesSinceTrim = 0;
      store.lTrimLast(KEY_LOGS, LOGS_MAX_LINES).catch(() => {});
    }
  });
  next();
});

// TTL par type d'asset : le code (CSS/JS) reste court pour que les deploiements
// se propagent vite, les medias/fonts peuvent etre caches longtemps.
const ASSET_CODE_RE = /\.(css|js|mjs)$/i;
const ASSET_MEDIA_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|webm|wav|ogg|woff2?|ttf|otf)$/i;

app.use(express.static(PUBLIC_DIR, {
  index: false,
  dotfiles: 'ignore',
  maxAge: 0,
  setHeaders(res, filePath) {
    // Sans un max-age reel, Cloudflare renvoie cf-cache-status: DYNAMIC et le CDN
    // ne met rien en cache. Les HTML passent par sendFile et restent en max-age=0.
    if (ASSET_CODE_RE.test(filePath)) { res.setHeader('cache-control', 'public, max-age=600'); return; }
    if (ASSET_MEDIA_RE.test(filePath)) { res.setHeader('cache-control', 'public, max-age=604800'); return; }
    res.setHeader('cache-control', 'public, max-age=0');
  },
}));

/* ─────────────────── Routes publiques (/health, /api/*) ─────────────────── */
/* Deplacees dans ./routes-api.js.                                           */

app.use(require('./routes-api')({ store, HASH_EXTRAS, HASH_PROFILES, PUBLIC_DIR }));

const HASH_ADMIN_TOKENS = 'admin_tokens';

async function issueAdminToken() {
  const token = randomId(32);
  await store.hSet(HASH_ADMIN_TOKENS, token, { exp: Date.now() + 1000 * 60 * 60 * 12 });
  return token;
}
async function isValidAdminToken(token) {
  if (!token) return false;
  const all = await store.hGetAll(HASH_ADMIN_TOKENS);
  const raw = all[token];
  if (!raw) return false;
  let rec = raw;
  try { rec = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return false; }
  if (rec && rec.exp > Date.now()) return true;
  await store.hDel(HASH_ADMIN_TOKENS, token);
  return false;
}

/* Purge periodique : sans ca, un token jamais relu apres son expiration
   (connexion admin abandonnee) reste indefiniment dans le hash.        */
const ADMIN_TOKEN_PURGE_MS = 60 * 60 * 1000;
setInterval(async () => {
  const now = Date.now();
  const all = await store.hGetAll(HASH_ADMIN_TOKENS);
  for (const [token, raw] of Object.entries(all)) {
    let rec = null;
    try { rec = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { /* entree corrompue */ }
    if (!rec || !(rec.exp > now)) await store.hDel(HASH_ADMIN_TOKENS, token);
  }
}, ADMIN_TOKEN_PURGE_MS).unref();

app.post('/admin/api/login', async (req, res) => {
  const ip = clientIp(req);
  const limit = await authRateLimit(ip);
  if (limit.blocked) {
    return res.status(429).json({ ok: false, message: `Trop de tentatives. Reessaye dans ${limit.retryAfter}s.` });
  }
  const password = cleanText(req.body && req.body.password, 128);
  if (!HASH_RE.test(password)) {
    return res.status(400).json({ ok: false, message: 'Invalid password format' });
  }
  const ok = (MOD_PASSWORD && password === MOD_PASSWORD) || (STATS_PASSWORD && password === STATS_PASSWORD);
  if (!ok) return res.status(401).json({ ok: false, message: 'Mot de passe incorrect' });
  await authRateClear(ip);
  res.json({ ok: true, token: await issueAdminToken() });
});

app.post('/admin/api/data', async (req, res) => {
  const token = cleanText(req.body && req.body.token, 128);
  if (!(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return v; } };
  const logs = await store.lRange(KEY_LOGS);
  const rawExtras = await store.hGetAll(HASH_EXTRAS);
  const rawNotes = await store.hGetAll(HASH_NOTES);
  const rawBl = await store.hGetAll(HASH_BLACKLIST);
  const rawConfig = await store.hGetAll(KEY_CONFIG);
  const extras = {};
  // /api/collect indexe les entrees sous la cle UUID fournie par le visiteur,
  // alors que le panneau les consulte par IP (data.extras[g.ip]) : ces
  // informations n'apparaissaient donc jamais. On re-cle a la lecture via
  // l'IP enregistree dans chaque valeur.
  for (const [k, v] of Object.entries(rawExtras)) {
    const rec = parse(v);
    if (!rec || typeof rec !== 'object') continue;
    const ipKey = cleanText(rec.ip, 64) || k;
    const prev = extras[ipKey];
    if (!prev) { extras[ipKey] = rec; continue; }
    // Meme IP avec UUID differents (connexions partagees) : on fusionne la
    // liste de pseudos et on conserve les champs les plus recents.
    const merged = { ...rec, ts: Math.max(Number(prev.ts) || 0, Number(rec.ts) || 0) };
    const all = new Set([
      ...String(prev.pseudos || '').split(', '),
      ...String(rec.pseudos || '').split(', '),
    ].filter(Boolean));
    if (all.size) merged.pseudos = Array.from(all).join(', ');
    extras[ipKey] = merged;
  }
  // Suivi admin : ip -> pseudos + salons vus (source fiable cote serveur,
  // alimentee par profile-update — voir recordVisit).
  const rawVisits = await store.hGetAll(HASH_IP_VISITS);
  const visits = {};
  const byRecency = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  for (const [ip, raw] of Object.entries(rawVisits)) {
    const v = parse(raw);
    if (!v || typeof v !== 'object') continue;
    visits[ip] = { pseudos: byRecency(v.ps), rooms: byRecency(v.rm), lastSeen: v.seen || 0 };
  }
  res.json({
    ok: true,
    logs: logs.join('\n'),
    extras,
    visits,
    notes: rawNotes,
    blacklist: Object.values(rawBl).map(parse),
    config: {
      whitelist_mode: rawConfig.whitelist_mode === 'true' || rawConfig.whitelist_mode === true,
      redirect_url: rawConfig.redirect_url || '',
    },
  });
});

app.post('/admin/api/config', async (req, res) => {
  const token = cleanText(req.body && req.body.token, 128);
  if (!(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  const body = req.body || {};
  if (body.whitelist_mode !== undefined) {
    await store.hSet(KEY_CONFIG, 'whitelist_mode', String(body.whitelist_mode === true));
  }
  if (body.redirect_url !== undefined) {
    await store.hSet(KEY_CONFIG, 'redirect_url', cleanText(body.redirect_url, 512));
  }
  cacheConfig.exp = 0;
  res.json({ ok: true });
});

app.post('/admin/api/toggle', async (req, res) => {
  const token = cleanText(req.body && req.body.token, 128);
  if (!(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  const { ip, field, value } = req.body || {};
  const key = cleanText(ip, 64);
  if (!key) return res.status(400).json({ ok: false });
  const current = (await store.hGetAll(HASH_BLACKLIST))[key] || {};
  const rec = { blocked: current.blocked === true, whitelist: current.whitelist === true };
  if (field === 'blocked' || field === 'whitelist') rec[field] = value === true || value === 'true';
  await store.hSet(HASH_BLACKLIST, key, rec);
  cacheBlacklist.exp = 0;
  res.json({ ok: true });
});

app.post('/admin/api/delete', async (req, res) => {
  const token = cleanText(req.body && req.body.token, 128);
  if (!(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  await store.lSet(KEY_LOGS, []);
  res.json({ ok: true });
});

app.post('/admin/api/delete-selected', async (req, res) => {
  const token = cleanText(req.body && req.body.token, 128);
  if (!(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  const indices = Array.isArray(req.body && req.body.indices) ? req.body.indices : [];
  const logs = await store.lRange(KEY_LOGS);
  const drop = new Set(indices.map(Number).filter((n) => Number.isInteger(n) && n >= 0));
  const kept = logs.filter((_, i) => !drop.has(i));
  await store.lSet(KEY_LOGS, kept);
  res.json({ ok: true, removed: logs.length - kept.length });
});

app.post('/admin/api/save-notes', async (req, res) => {
  const token = cleanText(req.body && req.body.token, 128);
  if (!(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  const notes = req.body && req.body.notes;
  if (notes && typeof notes === 'object') {
    for (const [ip, note] of Object.entries(notes)) {
      await store.hSet(HASH_NOTES, cleanText(ip, 64), cleanText(note, 2000));
    }
  }
  res.json({ ok: true });
});

const notFound = (res, code = 404) => res.status(code).sendFile(path.join(PUBLIC_DIR, '404.html'));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Servir les assets statiques même s'ils sont demandés avec le préfixe de la room (ex: /friends/client.css)
app.get('/:room/:file([a-zA-Z0-9_.-]+\\.[a-z0-9]{1,8})', (req, res, next) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(PUBLIC_DIR, file);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  next();
});

app.get('/:room', (req, res) => {
  const room = decodeURIComponent(req.params.room || '').trim();
  if (!room) return notFound(res, 404);
  if (room.includes('/')) return notFound(res, 404);
  if (isReservedRoomName(room)) return notFound(res, 404);
  res.sendFile(path.join(PUBLIC_DIR, 'room.html'));
});

app.get(/.*/, (req, res) => {
  const last = req.path.split('/').pop() || '';
  if (/\.[a-z0-9]{1,8}$/i.test(last)) return notFound(res, 400);
  if (req.path.startsWith('/api/')) return notFound(res, 404);
  if (req.path.startsWith('/admin/')) return notFound(res, 404);
  res.sendFile(path.join(PUBLIC_DIR, 'room.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
  transports: ['websocket', 'polling'],
  allowEIO3: true,
});

const MUTE_STEPS = [15e3, 60e3, 600e3, 3600e3, 86400e3];
// Mute impose par un moderateur (mod-mute) : empeche reellement l'envoi de
// messages cote serveur, contrairement a l'ancien systeme purement visuel.
const mutedSockets = new Set();

// Stocke dans Redis/fichier (plus une Map en memoire) : un redemarrage de
// l'instance (Render free tier se met en veille) ne doit pas remettre a
// zero le niveau de mute progressif anti-spam par IP.
async function spamCheck(ip, message) {
  const now = Date.now();
  const all = await store.hGetAll(HASH_SPAM_STATE);
  let st = null;
  try { st = all[ip] ? JSON.parse(all[ip]) : null; } catch (e) { st = null; }
  if (!st) st = { window: [], longs: [], muteUntil: 0, level: 0, lastSeen: 0 };
  st.lastSeen = now;

  if (st.muteUntil > now) {
    const left = Math.ceil((st.muteUntil - now) / 1000);
    await store.hSet(HASH_SPAM_STATE, ip, st);
    return { blocked: true, muted: true, muteExpired: false, message: `Tu es mute. Reessaye dans ${left}s.` };
  }
  // Un mute existait et vient d'expirer : le client doit etre prevenu pour
  // reactiver son champ de message (event spam-unmuted).
  const muteExpired = st.muteUntil > 0;
  st.muteUntil = 0;
  st.window = st.window.filter((t) => now - t < 5000);
  st.longs = st.longs.filter((t) => now - t < 30000);

  if (st.window.length >= 3) {
    st.level = Math.min(st.level + 1, MUTE_STEPS.length - 1);
    st.muteUntil = now + MUTE_STEPS[st.level];
    await store.hSet(HASH_SPAM_STATE, ip, st);
    return { blocked: true, muted: true, muteExpired: false, message: 'Trop de messages. Tu es mute temporairement.' };
  }
  if (String(message || '').length > 100) {
    if (st.longs.length >= 2) {
      st.level = Math.min(st.level + 1, MUTE_STEPS.length - 1);
      st.muteUntil = now + MUTE_STEPS[st.level];
      await store.hSet(HASH_SPAM_STATE, ip, st);
      return { blocked: true, muted: true, muteExpired: false, message: 'Trop de messages longs. Tu es mute temporairement.' };
    }
    st.longs.push(now);
  }
  st.window.push(now);
  await store.hSet(HASH_SPAM_STATE, ip, st);
  // Note : le niveau d'escalade n'est pas remis a zero (escalade stricte).
  return { blocked: false, muted: false, muteExpired, message: '' };
}

/* HASH_SPAM_STATE est indexe par IP, une cle librement falsifiable : il doit
   etre purge periodiquement, comme HASH_AUTH_ATTEMPTS plus haut.          */
const SPAM_PURGE_MS = 10 * 60 * 1000;
const SPAM_MAX_ENTRIES = 20000;
setInterval(async () => {
  const now = Date.now();
  const all = await store.hGetAll(HASH_SPAM_STATE);
  const entries = Object.entries(all);
  for (const [ip, raw] of entries) {
    let st = null;
    try { st = JSON.parse(raw); } catch (e) { /* entree corrompue */ }
    const idle = now - ((st && st.lastSeen) || 0);
    if (!st || (st.muteUntil <= now && idle > 60 * 60 * 1000)) await store.hDel(HASH_SPAM_STATE, ip);
  }
  // Filet de securite : si le hash explose malgre la purge, on tronque les
  // plus anciennes entrees restantes.
  if (entries.length > SPAM_MAX_ENTRIES) {
    const remaining = Object.keys(await store.hGetAll(HASH_SPAM_STATE));
    for (let i = 0; i < remaining.length - SPAM_MAX_ENTRIES; i++) {
      await store.hDel(HASH_SPAM_STATE, remaining[i]);
    }
  }
}, SPAM_PURGE_MS).unref();

function isMod(socket) {
  return socket.data && socket.data.isMod === true;
}
function modBy(socket) {
  return (socket.data && socket.data.modName) || 'Mod';
}

let cacheBlacklist = { data: null, exp: 0 };
let cacheConfig = { data: null, exp: 0 };
let cacheTempBans = { data: null, exp: 0 };

/* Applique les reglages admin (blacklist / liste blanche / redirection).
   Cache en mémoire (15s) pour économiser les quotas Upstash Redis.       */
async function checkRoomAccess(ip) {
  const now = Date.now();
  let rules = cacheBlacklist.data;
  if (!rules || now > cacheBlacklist.exp) {
    rules = await store.hGetAll(HASH_BLACKLIST);
    cacheBlacklist = { data: rules, exp: now + 15000 };
  }
  let rec = null;
  const raw = rules ? rules[ip] : undefined;
  if (raw) {
    try { rec = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { rec = null; }
  }
  if (rec && rec.blocked === true) return { allowed: false, reason: 'banned', redirect: '' };

  // Ban temporaire (« Kick 30s ») : bloque la reconnexion jusqu'a expiration.
  let tb = cacheTempBans.data;
  if (!tb || now > cacheTempBans.exp) {
    tb = await store.hGetAll(HASH_TEMP_BANS);
    cacheTempBans = { data: tb, exp: now + 3000 };
  }
  const tbRaw = tb ? tb[ip] : undefined;
  if (tbRaw) {
    let tbRec = null;
    try { tbRec = typeof tbRaw === 'string' ? JSON.parse(tbRaw) : tbRaw; } catch (e) { tbRec = null; }
    const until = tbRec && Number(tbRec.until) || 0;
    if (until > now) return { allowed: false, reason: 'tempbanned', redirect: '', until };
    // expire : on nettoie (best effort)
    if (until && until <= now) { store.hDel(HASH_TEMP_BANS, ip).catch(() => {}); cacheTempBans.exp = 0; }
  }

  let cfg = cacheConfig.data;
  if (!cfg || now > cacheConfig.exp) {
    cfg = await store.hGetAll(KEY_CONFIG);
    cacheConfig = { data: cfg, exp: now + 15000 };
  }
  const whitelistMode = cfg && (cfg.whitelist_mode === 'true' || cfg.whitelist_mode === true);
  if (whitelistMode && !(rec && rec.whitelist === true)) {
    return { allowed: false, reason: 'whitelist', redirect: String((cfg && cfg.redirect_url) || '') };
  }
  return { allowed: true };
}

/* Purge periodique des bans temporaires expires : sans ca, une IP
   temp-bannie qui ne revient jamais laisse une entree orpheline dans le
   hash. Meme logique que les autres purges (voir plus haut).             */
setInterval(async () => {
  try {
    const now = Date.now();
    const all = await store.hGetAll(HASH_TEMP_BANS);
    for (const [ip, raw] of Object.entries(all)) {
      let rec = null;
      try { rec = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { rec = null; }
      const until = (rec && Number(rec.until)) || 0;
      if (!until || until <= now) await store.hDel(HASH_TEMP_BANS, ip);
    }
    cacheTempBans.exp = 0;
  } catch (e) { /* ignore */ }
}, 60 * 1000).unref();

io.on('connection', (socket) => {
  socket.data = { room: null, profile: { displayName: 'Guest', profileColor: '#4A90E2' }, isMod: false, modName: 'Mod' };
  const ip = clientIp(socket.request);

  socket.on('join-room', async (roomId) => {
    const room = cleanText(roomId, 64) || 'friends';

    // Blacklist / liste blanche : refus avant de rejoindre la salle.
    const access = await checkRoomAccess(ip);
    if (!access.allowed) {
      // `until` (ban temporaire) est transmis pour que la victime puisse
      // afficher un decompte (« Reviens dans Xs ») au lieu d'un simple BAN.
      socket.emit('room-blocked', { reason: access.reason, redirect: access.redirect, until: access.until });
      socket.disconnect(true);
      return;
    }

    const prev = socket.data.room;
    if (prev && prev !== room) await socket.leave(prev);

    socket.data.room = room;
    await socket.join(room);

    socket.to(room).emit('user-connected', socket.id);

    const profiles = await store.hGetAll(HASH_PROFILES);
    const live = io.sockets.adapter.rooms.get(room) || new Set();
    const mine = {};
    for (const [key, raw] of Object.entries(profiles)) {
      if (!key.startsWith(room + ':')) continue;
      const id = key.slice(room.length + 1);
      if (id === socket.id) continue;
      if (!live.has(id)) { store.hDel(HASH_PROFILES, key).catch(() => {}); continue; }
      let p = raw;
      try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { /* ignore */ }
      mine[id] = { displayName: p.displayName || 'Guest', profileColor: p.profileColor || '#4A90E2' };
    }
    socket.emit('sync-profiles', mine);
  });

  socket.on('leave-room', async (roomId) => {
    const room = cleanText(roomId, 64) || socket.data.room;
    if (!room) return;
    const prev = socket.data.room;
    if (prev && prev === room) socket.data.room = null;
    await socket.leave(room);
    socket.to(room).emit('user-disconnected', socket.id);
    await store.hDel(HASH_PROFILES, `${room}:${socket.id}`);
  });

  socket.on('profile-update', async (data, ack) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room) { if (typeof ack === 'function') ack(); return; }
    const access = await checkRoomAccess(ip);
    if (!access.allowed) {
      socket.emit('room-blocked', { reason: access.reason, redirect: access.redirect });
      socket.disconnect(true);
      return;
    }
    socket.data.room = room;
    const displayName = cleanText(data && data.displayName, 50) || 'Guest';
    const profileColor = sanitizeColor(data && data.profileColor);
    socket.data.profile = { displayName, profileColor };
    // Alimente la table ip -> pseudos/salons du panneau admin.
    recordVisit(ip, displayName, room);

    const uuid = cleanText(data && data.uuid, 64) || socket.id;
    await store.hSet(HASH_PROFILES, `${room}:${socket.id}`, { displayName, profileColor, uuid });
    await store.hSet(HASH_PROFILES, `uuid:${uuid}`, { pseudo: displayName, color: profileColor });

    // Une seule session par uuid et par salle : evince l'ancien socket (onglet
    // rafraichi / reconnexion) qui sinon reste affiche en double jusqu'au timeout.
    if (data && data.uuid) {
      const all = await store.hGetAll(HASH_PROFILES);
      for (const [key, raw] of Object.entries(all)) {
        if (!key.startsWith(room + ':')) continue;
        const oldId = key.slice(room.length + 1);
        if (oldId === socket.id) continue;
        let p = raw;
        try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { continue; }
        if (p && p.uuid === uuid) {
          await store.hDel(HASH_PROFILES, key);
          socket.to(room).emit('user-disconnected', oldId);
          io.sockets.sockets.get(oldId)?.disconnect(true);
        }
      }
    }

    socket.to(room).emit('profile-update', { id: socket.id, displayName, profileColor });
    // Ack : garantit que l'eviction de l'ancien socket (ci-dessus) est bien
    // terminee avant que le client n'envoie join-room, sinon join-room peut
    // lire le store avant la suppression et renvoyer brievement un profil
    // fantome (l'ancienne connexion du meme uuid) via sync-profiles.
    if (typeof ack === 'function') ack();
  });

  socket.on('url-identity', (data) => {
    const pseudo = cleanText(data && data.pseudo, 50);
    const color = sanitizeColor(data && data.color);
    if (pseudo) socket.data.profile = { displayName: pseudo, profileColor: color };
  });

  socket.on('chat-message', async (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room) return;
    const access = await checkRoomAccess(ip);
    if (!access.allowed) {
      socket.emit('room-blocked', { reason: access.reason, redirect: access.redirect });
      socket.disconnect(true);
      return;
    }
    if (mutedSockets.has(socket.id)) {
      socket.emit('spam-warning', { blocked: true, muted: true, muteExpired: false, message: 'Tu es mute par un moderateur.' });
      return;
    }

    const message = cleanText(data && data.message, 200);
    if (!message) return;

    const check = await spamCheck(ip, message);
    if (check.blocked) {
      socket.emit('spam-warning', check);
      return;
    }
    // Le mute automatique vient d'expirer : le client re-active son champ de saisie.
    if (check.muteExpired) socket.emit('spam-unmuted');
    // Le pseudo/couleur viennent du profil connu du serveur (profile-update),
    // pas du payload client : sinon un visiteur peut usurper un autre pseudo
    // a chaque message sans jamais changer son profil reel.
    const profile = (socket.data && socket.data.profile) || {};
    const payload = {
      id: socket.id,
      userName: profile.displayName || 'Guest',
      message,
      color: sanitizeColor(profile.profileColor),
      ts: Date.now(),
    };
    socket.to(room).emit('chat-message', payload);
    socket.emit('chat-message', payload);
  });

  socket.on('signal', (data) => {
    const to = cleanText(data && data.to, 64);
    if (!to || !data.signal) return;
    const room = socket.data.room;
    if (!room || !io.sockets.adapter.rooms.get(room)?.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, signal: data.signal });
  });

  socket.on('video-status', async (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room) return;
    if (!(await checkRoomAccess(ip)).allowed) return;
    socket.to(room).emit('video-status', { id: socket.id, enabled: data.enabled === true });
  });

  socket.on('peer-speaking', (data) => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('peer-speaking', { id: socket.id, status: data && data.status === true });
  });

  socket.on('mod-auth', async (data) => {
    const limit = await authRateLimit(ip);
    if (limit.blocked) {
      socket.emit('mod-status', false);
      return;
    }
    const password = cleanText(data && data.password, 128);
    const ok = (MOD_PASSWORD && password === MOD_PASSWORD) || (STATS_PASSWORD && password === STATS_PASSWORD);
    if (ok) await authRateClear(ip);
    socket.data.isMod = ok;
    socket.data.modName = cleanText(data && data.displayName, 50) || 'Mod';
    socket.emit('mod-status', ok);
  });

  socket.on('mod-badge', async (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room || !isMod(socket)) return;
    if (!(await checkRoomAccess(ip)).allowed) return;
    socket.to(room).emit('mod-badge', { id: socket.id });
  });

  const modAction = (event, type) => async (targetId) => {
    if (!isMod(socket)) return;
    const id = cleanText(targetId, 64);
    if (!id) return;
    const by = modBy(socket);

    if (event === 'mod-mute' || event === 'mod-unmute') {
      const muted = event === 'mod-mute';
      if (muted) mutedSockets.add(id); else mutedSockets.delete(id);
      io.to(id).emit('mod-action', { type: muted ? 'muted' : 'unmuted', by });
      // L'ack revient au moderateur (celui qui a clique), pas a la cible :
      // c'est lui qui tient mutedPeers pour basculer le bouton Mute/Unmute.
      socket.emit('mod-mute-ack', { targetId: id, muted });
      return;
    }
    if (event === 'mod-kick' || event === 'mod-kick-temp' || event === 'mod-ban') {
      const kind = event === 'mod-kick' ? 'kicked' : event === 'mod-kick-temp' ? 'kicked-temp' : 'banned';
      io.to(id).emit('mod-action', { type: kind, by });
      const target = await io.in(id).fetchSockets();
      if (event === 'mod-ban') {
        // Persiste le ban par IP (Redis/fichier) : sans ca, la cible pouvait
        // se reconnecter immediatement apres la simple deconnexion socket.
        for (const s of target) {
          const targetIp = clientIp(s.request);
          if (targetIp) await store.hSet(HASH_BLACKLIST, targetIp, { blocked: true, whitelist: false });
        }
        cacheBlacklist.exp = 0;
      }
      if (event === 'mod-kick-temp') {
        // Kick 30s persistant : bloque aussi la RECONNEXION par IP pendant
        // TEMP_BAN_MS. La deconnexion seule ne suffisait pas (reconnect
        // immediate possible). On note l'expiration et checkRoomAccess
        // refuse l'entree jusqu'a celle-ci.
        const until = Date.now() + TEMP_BAN_MS;
        for (const s of target) {
          const targetIp = clientIp(s.request);
          if (targetIp) await store.hSet(HASH_TEMP_BANS, targetIp, { until });
        }
        cacheTempBans.exp = 0;
      }
      for (const s of target) { mutedSockets.delete(s.id); s.disconnect(true); }
    }
  };
  socket.on('mod-mute', modAction('mod-mute'));
  socket.on('mod-unmute', modAction('mod-unmute'));
  socket.on('mod-kick', modAction('mod-kick'));
  socket.on('mod-kick-temp', modAction('mod-kick-temp'));
  socket.on('mod-ban', modAction('mod-ban'));

  socket.on('disconnect', async () => {
    mutedSockets.delete(socket.id);
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('user-disconnected', socket.id);
    await store.hDel(HASH_PROFILES, `${room}:${socket.id}`);
  });
});

(async () => {
  await store.connect();
  try {
    const all = await store.hGetAll(HASH_PROFILES);
    for (const k of Object.keys(all)) if (!k.startsWith('uuid:')) await store.hDel(HASH_PROFILES, k);
  } catch (e) { /* ignore */ }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Chaltet sur http://0.0.0.0:${PORT} (${store.usingRedis() ? 'redis' : 'fichiers locaux'})`);
  });
})();
