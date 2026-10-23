'use strict';
/*
 * Chaltet — serveur (Express + socket.io)
 *
 * Reconstitué à partir du contrat observé sur le site live :
 *   - routes HTTP : /, /<room>, /health, /api/*, /admin/api/*
 *   - en-têtes de sécurité + CSP identiques à ceux servis en production
 *   - protocole socket.io vu dans client.js (11 emissions client, 14 emissions serveur)
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
        reconnectStrategy: (retries) => (retries >= 3 ? new Error('redis abandonne') : Math.min(retries * 200, 1500)),
        connectTimeout: 5000,
      },
    });
    let reported = false;
    client.on('error', (e) => {
      if (!reported) { reported = true; console.error('[redis] connexion impossible, repli sur fichiers :', e.message); }
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
};

const HASH_PROFILES = 'socket_profiles';
const HASH_NOTES = 'notes';
const HASH_BLACKLIST = 'blacklist';
const HASH_EXTRAS = 'extras';
const KEY_LOGS = 'logs';
const KEY_CONFIG = 'config';

const HASH_RE = /^[!-~]{16,128}$/;

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

app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/socket.io')) return;
    const ip = clientIp(req);
    const browser = detectBrowser(req.headers['user-agent']);
    const room = req.path === '/' ? '/' : req.path.replace(/^\//, '');
    store.rPush(KEY_LOGS, logLine(ip, browser, room)).catch(() => {});
  });
  next();
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  dotfiles: 'ignore',
  maxAge: 0,
  setHeaders(res) { res.setHeader('cache-control', 'public, max-age=0'); },
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

app.post('/api/shorten', async (req, res) => {
  const body = req.body || {};
  const token = cleanText(body.token, 128);
  if (!token || !(await isValidAdminToken(token))) return res.status(401).json({ ok: false });
  const url = cleanText(body.url, 2048);
  if (!url) return res.status(400).json({ ok: false });
  const short = `https://${req.headers.host || 'localhost'}/${randomId(6)}`;
  res.json({ ok: true, short });
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
  const password = cleanText(req.body && req.body.password, 128);
  if (!HASH_RE.test(password)) {
    return res.status(400).json({ ok: false, message: 'Invalid password format' });
  }
  const ok = (MOD_PASSWORD && password === MOD_PASSWORD) || (STATS_PASSWORD && password === STATS_PASSWORD);
  if (!ok) return res.status(401).json({ ok: false, message: 'Mot de passe incorrect' });
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
  for (const [k, v] of Object.entries(rawExtras)) extras[k] = parse(v);
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
  const st = spamState.get(ip) || { window: [], longs: [], muteUntil: 0, level: 0 };
  spamState.set(ip, st);

  if (st.muteUntil > now) {
    const left = Math.ceil((st.muteUntil - now) / 1000);
    return { blocked: true, muted: true, message: `Tu es mute. Reessaye dans ${left}s.` };
  }
  st.window = st.window.filter((t) => now - t < 5000);
  st.longs = st.longs.filter((t) => now - t < 30000);

  if (st.window.length >= 3) {
    st.level = Math.min(st.level + 1, MUTE_STEPS.length - 1);
    st.muteUntil = now + MUTE_STEPS[st.level];
    return { blocked: true, muted: true, message: 'Trop de messages. Tu es mute temporairement.' };
  }
  if (String(message || '').length > 100) {
    if (st.longs.length >= 2) {
      st.level = Math.min(st.level + 1, MUTE_STEPS.length - 1);
      st.muteUntil = now + MUTE_STEPS[st.level];
      return { blocked: true, muted: true, message: 'Trop de messages longs. Tu es mute temporairement.' };
    }
    st.longs.push(now);
  }
  st.window.push(now);
  return { blocked: false, muted: false, message: '' };
}

function isMod(socket) {
  return socket.data && socket.data.isMod === true;
}
function modBy(socket) {
  return (socket.data && socket.data.modName) || 'Mod';
}

io.on('connection', (socket) => {
  socket.data = { room: null, profile: { displayName: 'Guest', profileColor: '#4A90E2' }, isMod: false, modName: 'Mod' };
  const ip = clientIp(socket.request);

  socket.on('join-room', async (roomId) => {
    const room = cleanText(roomId, 64) || 'friends';
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
    const password = cleanText(data && data.password, 128);
    const ok = (MOD_PASSWORD && password === MOD_PASSWORD) || (STATS_PASSWORD && password === STATS_PASSWORD);
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
      io.to(id).emit('mod-mute-ack', { targetId: id, muted });
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
  if (redisClient) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const pub = redisClient.duplicate();
      const sub = redisClient.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      console.log('[socket.io] adapter Redis actif');
    } catch (e) {
      console.error('[socket.io] adapter Redis indisponible :', e.message);
    }
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Chaltet sur http://0.0.0.0:${PORT} (${redisClient ? 'redis' : 'fichiers locaux'})`);
  });
})();













































































