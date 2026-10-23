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
const REDIS_URL = (process.env.REDIS_URL || '').trim();
const TURN_URL = (process.env.TURN_URL || '').trim();
const TURN_SECRET = (process.env.TURN_SECRET || process.env.TURN_AUTH_SECRET || '').trim();
const TURN_USERNAME = (process.env.TURN_USERNAME || '').trim();
const TURN_CREDENTIAL = (process.env.TURN_CREDENTIAL || '').trim();
const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const app = express();

app.set('trust proxy', true);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

/* ─────────────────────────── Stockage ─────────────────────────── */
/* Redis si REDIS_URL est defini, sinon fichiers JSON locaux.       */

const memory = { hashes: new Map(), lists: new Map() };

function filePath(kind, name) {
  return path.join(DATA_DIR, `${kind}_${name}.json`);
}

function readFile(kind, name, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath(kind, name), 'utf8')); }
  catch (e) { return fallback; }
}
function writeFile(kind, name, value) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath(kind, name), JSON.stringify(value));
  } catch (e) { /* ignore */ }
}

let redisClient = null;
async function initRedis() {
  if (!REDIS_URL) return null;
  let client = null;
  try {
    const { createClient } = require('redis');
    client = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
        connectTimeout: 10000,
        keepAlive: 30000,
      },
    });
    client.on('error', (e) => {
      console.error('[redis] erreur socket:', e.message);
    });
    client.on('reconnecting', () => {
      console.log('[redis] reconnexion en cours...');
    });
    client.on('ready', () => {
      console.log('[redis] connexion active');
    });
    await client.connect();
    return client;
  } catch (e) {
    console.error('[redis] connexion impossible, repli sur fichiers :', e.message);
    try { await client?.quit(); } catch (e2) { /* ignore */ }
    return null;
  }
}

const store = {
  async hGetAll(hash) {
    if (redisClient) return await redisClient.hGetAll(hash);
    if (!memory.hashes.has(hash)) memory.hashes.set(hash, readFile('hash', hash, {}));
    return memory.hashes.get(hash) || {};
  },
  async hSet(hash, key, value) {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (redisClient) return await redisClient.hSet(hash, key, s);
    const h = memory.hashes.get(hash) || {};
    h[key] = s;
    memory.hashes.set(hash, h);
    writeFile('hash', hash, h);
  },
  async hDel(hash, key) {
    if (redisClient) return await redisClient.hDel(hash, key);
    const h = memory.hashes.get(hash) || {};
    delete h[key];
    memory.hashes.set(hash, h);
    writeFile('hash', hash, h);
  },
  async lRange(key) {
    if (redisClient) return await redisClient.lRange(key, 0, -1);
    return memory.lists.get(key) || [];
  },
  async rPush(key, value) {
    if (redisClient) return await redisClient.rPush(key, value);
    const l = memory.lists.get(key) || [];
    l.push(value);
    memory.lists.set(key, l);
    writeFile('list', key, l);
  },
  async lSet(key, arr) {
    if (redisClient) {
      await redisClient.del(key);
      if (arr.length) await redisClient.rPush(key, arr);
      return;
    }
    memory.lists.set(key, arr);
    writeFile('list', key, arr);
  },
  async lDelAt(key, index) {
    const arr = await store.lRange(key);
    arr.splice(index, 1);
    await store.lSet(key, arr);
  },
  // Ne garde que les `max` dernieres entrees : sans cela la liste grossit sans
  // borne et finit par depasser le quota (64 Mo) du Redis Upstash gratuit.
  async lTrimLast(key, max) {
    if (redisClient) return await redisClient.lTrim(key, -max, -1);
    const l = memory.lists.get(key) || [];
    const kept = l.slice(-max);
    memory.lists.set(key, kept);
    writeFile('list', key, kept);
  },
};

const HASH_PROFILES = 'socket_profiles';
const HASH_NOTES = 'notes';
const HASH_BLACKLIST = 'blacklist';
const HASH_EXTRAS = 'extras';
const KEY_LOGS = 'logs';
const KEY_CONFIG = 'config';
// Nombre maximum de lignes de logs conservees (voir store.lTrimLast).
const LOGS_MAX_LINES = 5000;

const HASH_RE = /^[!-~]{16,128}$/;

const RESERVED_ROOM_NAMES = new Set([
  'api', 'admin', 'health', 'socket.io', 'socketio', 'favicon.ico', 'robots.txt',
  'manifest.json', 'index.html', 'room.html', '404.html', 'admin-stats.html', 'health.txt',
  'client.js', 'client.css', 'landing.js', 'adapter.js', 'fonts.css', 'profile-transfer.html',
  'fonts', 'images', 'audio', 'media',
]);

function isReservedRoomName(room) {
  if (!room) return true;
  const cleaned = room.replace(/^\/+/, '').toLowerCase();
  if (!cleaned) return true;
  if (RESERVED_ROOM_NAMES.has(cleaned)) return true;
  if (cleaned.startsWith('api')) return true;
  if (cleaned.startsWith('admin')) return true;
  if (cleaned.startsWith('health')) return true;
  if (cleaned.startsWith('socket.io')) return true;
  const lastSegment = cleaned.split('/').filter(Boolean).pop() || '';
  return /\.[a-z0-9]{1,8}$/i.test(lastSegment);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}
function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}
function sanitizeColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#4A90E2';
}
function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}
function clientIp(req) {
  // Derriere Cloudflare, cf-connecting-ip est pose par le CDN et ecrase la valeur
  // envoyee par le client : c'est la seule valeur fiable. X-Forwarded-For reste un
  // repli (appels directs au serveur, tests locaux).
  const cf = (req.headers['cf-connecting-ip'] || '').trim();
  if (cf) return cf;
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function detectBrowser(ua) {
  const s = String(ua || '');
  if (/Edg\//i.test(s)) return 'Edge';
  if (/OPR\//i.test(s)) return 'Opera';
  if (/Chrome\//i.test(s)) return 'Chrome';
  if (/Firefox\//i.test(s)) return 'Firefox';
  if (/Safari\//i.test(s)) return 'Safari';
  if (/curl/i.test(s)) return 'curl';
  if (/Postman/i.test(s)) return 'Postman';
  return 'Autre';
}
function logLine(ip, browser, room) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const letter = 'Z';
  return `[${date}] IP: ${ip} | ${letter} | Unknown(Unknown) |  |  | ${browser} | ${room || '/'} `;
}

/* ─────────────────── Limiteur d'authentification ─────────────────── */
/* Compte les tentatives de login admin et de mod-auth socket par IP.  */
/* Le compteur est remis a zero des qu'une tentative reussit, afin de  */
/* ne pas penaliser un moderateur legitime.                            */

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;
const authAttempts = new Map();

function authRateLimit(ip) {
  const now = Date.now();
  let st = authAttempts.get(ip);
  if (!st || now >= st.resetAt) {
    st = { count: 0, resetAt: now + AUTH_WINDOW_MS };
    authAttempts.set(ip, st);
  }
  st.count += 1;
  return {
    blocked: st.count > AUTH_MAX_ATTEMPTS,
    retryAfter: Math.ceil((st.resetAt - now) / 1000),
  };
}
function authRateClear(ip) {
  authAttempts.delete(ip);
}

/* Purge periodique : evite que la Map croisse sans borne, un IP etant
   une cle librement falsifiable via X-Forwarded-For.                  */
setInterval(() => {
  const now = Date.now();
  for (const [ip, st] of authAttempts) {
    if (now >= st.resetAt) authAttempts.delete(ip);
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

let twilioCache = { at: 0, servers: null };
async function fetchTwilioIce() {
  if (twilioCache.servers && Date.now() - twilioCache.at < 50 * 60 * 1000) return twilioCache.servers;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Tokens.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'Ttl=3600',
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('twilio ' + r.status);
  const j = await r.json();
  const list = (j.ice_servers || []).map((x) => ({
    url: x.url || x.urls,
    urls: x.urls || x.url,
    ...(x.username ? { username: x.username, credential: x.credential } : {}),
  }));
  if (!list.length) throw new Error('twilio: aucun serveur');
  twilioCache = { at: Date.now(), servers: list };
  return list;
}

function buildMeteredIceServers() {
  if (!TURN_USERNAME || !TURN_CREDENTIAL) return [];
  return [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: TURN_USERNAME, credential: TURN_CREDENTIAL },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: TURN_USERNAME, credential: TURN_CREDENTIAL },
    { urls: 'turn:global.relay.metered.ca:443', username: TURN_USERNAME, credential: TURN_CREDENTIAL },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: TURN_USERNAME, credential: TURN_CREDENTIAL },
  ];
}

app.get('/api/ice-servers', async (req, res) => {
  let servers = [];
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try { servers = await fetchTwilioIce(); } catch (e) { console.error('[ice] twilio :', e.message); }
  }
  if (!servers.length) {
    const metered = buildMeteredIceServers();
    if (metered.length) servers = metered;
  }
  if (!servers.length) {
    servers.push({ url: 'stun:global.stun.twilio.com:3478', urls: 'stun:global.stun.twilio.com:3478' });
    if (TURN_URL && TURN_SECRET) {
      const username = String(Math.floor(Date.now() / 1000) + 86400);
      const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
      for (const transport of ['udp', 'tcp']) {
        const sep = TURN_URL.includes('?') ? '&' : '?';
        const url = `${TURN_URL}${sep}transport=${transport}`;
        servers.push({ url, urls: url, username, credential });
      }
    }
  }
  res.json(servers);
});

app.post('/api/collect', (req, res) => {
  const ip = clientIp(req);
  const uuid = cleanText(req.body && req.body.uuid, 64) || randomId();
  const data = req.body && typeof req.body === 'object' ? req.body : {};
  store.hSet(HASH_EXTRAS, uuid, { ...data, ip, ts: Date.now() }).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/get-profile-by-uuid', async (req, res) => {
  const uuid = cleanText(req.body && req.body.uuid, 64);
  if (!uuid) return res.json({ ok: false });
  const all = await store.hGetAll(HASH_PROFILES);
  const raw = all['uuid:' + uuid];
  if (!raw) return res.json({ ok: false });
  let profile = raw;
  try { profile = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return res.json({ ok: false }); }
  res.json({ ok: true, profile: { pseudo: profile.pseudo, color: profile.color } });
});

app.get('/api/profile-by-token/:hash', (req, res) => {
  const hash = cleanText(req.params.hash, 512);
  if (!hash || hash.length < 5) return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  let decoded = '';
  try { decoded = fromB64url(hash); } catch (e) { return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')); }
  const idx = decoded.lastIndexOf(':');
  if (idx === -1) return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  const pseudo = decoded.slice(0, idx).trim();
  const color = decoded.slice(idx + 1).trim();
  if (!pseudo || !color) return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  res.json({ ok: true, pseudo, color: color.startsWith('#') ? color : '#' + color });
});

app.post('/api/room-profile', (req, res) => {
  const room = cleanText(req.body && req.body.room, 64);
  const pseudo = cleanText(req.body && req.body.pseudo, 50);
  const color = cleanText(req.body && req.body.color, 16);
  if (!room || !pseudo) return res.status(400).json({ ok: false });
  const payload = `${pseudo}:${color.replace(/^#/, '')}`;
  const token = b64url(payload);
  const host = req.headers.host || 'localhost';
  const url = `https://${host}/${room}#${token}`;
  res.json({ ok: true, url, token });
});

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

app.post('/admin/api/login', async (req, res) => {
  const ip = clientIp(req);
  const limit = authRateLimit(ip);
  if (limit.blocked) {
    return res.status(429).json({ ok: false, message: `Trop de tentatives. Reessaye dans ${limit.retryAfter}s.` });
  }
  const password = cleanText(req.body && req.body.password, 128);
  if (!HASH_RE.test(password)) {
    return res.status(400).json({ ok: false, message: 'Invalid password format' });
  }
  const ok = (MOD_PASSWORD && password === MOD_PASSWORD) || (STATS_PASSWORD && password === STATS_PASSWORD);
  if (!ok) return res.status(401).json({ ok: false, message: 'Mot de passe incorrect' });
  authRateClear(ip);
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
  res.json({
    ok: true,
    logs: logs.join('\n'),
    extras,
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
const spamState = new Map();

function spamCheck(ip, message) {
  const now = Date.now();
  const st = spamState.get(ip) || { window: [], longs: [], muteUntil: 0, level: 0, lastSeen: 0 };
  st.lastSeen = now;
  spamState.set(ip, st);

  if (st.muteUntil > now) {
    const left = Math.ceil((st.muteUntil - now) / 1000);
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
    return { blocked: true, muted: true, muteExpired: false, message: 'Trop de messages. Tu es mute temporairement.' };
  }
  if (String(message || '').length > 100) {
    if (st.longs.length >= 2) {
      st.level = Math.min(st.level + 1, MUTE_STEPS.length - 1);
      st.muteUntil = now + MUTE_STEPS[st.level];
      return { blocked: true, muted: true, muteExpired: false, message: 'Trop de messages longs. Tu es mute temporairement.' };
    }
    st.longs.push(now);
  }
  st.window.push(now);
  // Note : le niveau d'escalade n'est pas remis a zero (escalade stricte).
  return { blocked: false, muted: false, muteExpired, message: '' };
}

/* spamState est indexe par IP, une cle librement falsifiable : la Map doit
   etre purgee periodiquement, comme authAttempts plus haut.               */
const SPAM_PURGE_MS = 10 * 60 * 1000;
const SPAM_MAX_ENTRIES = 20000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, st] of spamState) {
    const idle = now - (st.lastSeen || 0);
    if (st.muteUntil <= now && idle > 60 * 60 * 1000) spamState.delete(ip);
  }
  // Filet de securite : si la Map explose malgre la purge, on tronque.
  if (spamState.size > SPAM_MAX_ENTRIES) {
    for (const ip of spamState.keys()) {
      if (spamState.size <= SPAM_MAX_ENTRIES) break;
      spamState.delete(ip);
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

io.on('connection', (socket) => {
  socket.data = { room: null, profile: { displayName: 'Guest', profileColor: '#4A90E2' }, isMod: false, modName: 'Mod' };
  const ip = clientIp(socket.request);

  socket.on('join-room', async (roomId) => {
    const room = cleanText(roomId, 64) || 'friends';

    // Blacklist / liste blanche : refus avant de rejoindre la salle.
    const access = await checkRoomAccess(ip);
    if (!access.allowed) {
      socket.emit('room-blocked', { reason: access.reason, redirect: access.redirect });
      socket.disconnect(true);
      return;
    }

    const prev = socket.data.room;
    if (prev && prev !== room) await socket.leave(prev);

    socket.data.room = room;
    await socket.join(room);

    socket.to(room).emit('user-connected', socket.id);

    const profiles = await store.hGetAll(HASH_PROFILES);
    const mine = {};
    for (const [key, raw] of Object.entries(profiles)) {
      if (!key.startsWith(room + ':')) continue;
      const id = key.slice(room.length + 1);
      if (id === socket.id) continue;
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

  socket.on('profile-update', async (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room) return;
    socket.data.room = room;
    const displayName = cleanText(data && data.displayName, 50) || 'Guest';
    const profileColor = sanitizeColor(data && data.profileColor);
    socket.data.profile = { displayName, profileColor };

    const uuid = cleanText(data && data.uuid, 64) || socket.id;
    await store.hSet(HASH_PROFILES, `${room}:${socket.id}`, { displayName, profileColor, uuid });
    await store.hSet(HASH_PROFILES, `uuid:${uuid}`, { pseudo: displayName, color: profileColor });

    socket.to(room).emit('profile-update', { id: socket.id, displayName, profileColor });
  });

  socket.on('url-identity', (data) => {
    const pseudo = cleanText(data && data.pseudo, 50);
    const color = sanitizeColor(data && data.color);
    if (pseudo) socket.data.profile = { displayName: pseudo, profileColor: color };
  });

  socket.on('chat-message', (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room) return;
    const message = cleanText(data && data.message, 200);
    if (!message) return;

    const check = spamCheck(ip, message);
    if (check.blocked) {
      socket.emit('spam-warning', check);
      return;
    }
    // Le mute automatique vient d'expirer : le client re-active son champ de saisie.
    if (check.muteExpired) socket.emit('spam-unmuted');
    const payload = {
      id: socket.id,
      userName: cleanText(data && data.userName, 50) || 'Guest',
      message,
      color: sanitizeColor(data && data.color),
      ts: Date.now(),
    };
    socket.to(room).emit('chat-message', payload);
    socket.emit('chat-message', payload);
  });

  socket.on('signal', (data) => {
    const to = cleanText(data && data.to, 64);
    if (!to || !data.signal) return;
    io.to(to).emit('signal', { from: socket.id, signal: data.signal });
  });

  socket.on('video-status', (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room) return;
    socket.to(room).emit('video-status', { id: socket.id, enabled: data.enabled === true });
  });

  socket.on('peer-speaking', (data) => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('peer-speaking', { id: socket.id, status: data && data.status === true });
  });

  socket.on('mod-auth', (data) => {
    const limit = authRateLimit(ip);
    if (limit.blocked) {
      socket.emit('mod-status', false);
      return;
    }
    const password = cleanText(data && data.password, 128);
    const ok = (MOD_PASSWORD && password === MOD_PASSWORD) || (STATS_PASSWORD && password === STATS_PASSWORD);
    if (ok) authRateClear(ip);
    socket.data.isMod = ok;
    socket.data.modName = cleanText(data && data.displayName, 50) || 'Mod';
    socket.emit('mod-status', ok);
  });

  socket.on('mod-badge', (data) => {
    const room = cleanText(data && data.roomId, 64) || socket.data.room;
    if (!room || !isMod(socket)) return;
    socket.to(room).emit('mod-badge', { id: socket.id });
  });

  const modAction = (event, type) => async (targetId) => {
    if (!isMod(socket)) return;
    const id = cleanText(targetId, 64);
    if (!id) return;
    const by = modBy(socket);

    if (event === 'mod-mute' || event === 'mod-unmute') {
      const muted = event === 'mod-mute';
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
      for (const s of target) s.disconnect(true);
    }
  };
  socket.on('mod-mute', modAction('mod-mute'));
  socket.on('mod-unmute', modAction('mod-unmute'));
  socket.on('mod-kick', modAction('mod-kick'));
  socket.on('mod-kick-temp', modAction('mod-kick-temp'));
  socket.on('mod-ban', modAction('mod-ban'));

  socket.on('disconnect', async () => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('user-disconnected', socket.id);
    await store.hDel(HASH_PROFILES, `${room}:${socket.id}`);
  });
});

(async () => {
  redisClient = await initRedis();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Chaltet sur http://0.0.0.0:${PORT} (${redisClient ? 'redis' : 'fichiers locaux'})`);
  });
})();
