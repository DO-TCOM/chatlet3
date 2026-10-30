'use strict';
/*
 * Chaltet — couche stockage
 *
 * Redis si REDIS_URL est defini, sinon fichiers JSON locaux (./data).
 * Extrait de server.js — comportement identique, juste isole.
 */

const path = require('path');
const fs = require('fs');

const REDIS_URL = (process.env.REDIS_URL || '').trim();
const DATA_DIR = path.join(__dirname, 'data');

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
  // A appeler une fois au demarrage du serveur.
  async connect() {
    redisClient = await initRedis();
    return !!redisClient;
  },
  usingRedis() { return !!redisClient; },

  async hGetAll(hash) {
    if (redisClient) return await redisClient.hGetAll(hash);
    if (!memory.hashes.has(hash)) memory.hashes.set(hash, readFile('hash', hash, {}));
    return memory.hashes.get(hash) || {};
  },
  async hGet(hash, key) {
    if (redisClient) return await redisClient.hGet(hash, key);
    if (!memory.hashes.has(hash)) memory.hashes.set(hash, readFile('hash', hash, {}));
    const h = memory.hashes.get(hash) || {};
    return h[key] !== undefined ? h[key] : null;
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
const HASH_AUTH_ATTEMPTS = 'auth_attempts';
const HASH_SPAM_STATE = 'spam_state';
// Suivi ip -> pseudos/salons utilises, pour les colonnes « Pseudo(s) » et
// « Room(s) » du panneau admin (les logs ne contiennent ni pseudo ni salon).
const HASH_IP_VISITS = 'ip_visits';
// Bans temporaires (« Kick 30s ») persistes par IP : { ip: { until } }.
// Sans ca, la cible se reconnectait immediatement (le deconnexion socket
// seule ne bloque rien). Expiration = timestamp ms.
const HASH_TEMP_BANS = 'temp_bans';
const TEMP_BAN_MS = 30 * 1000;
const KEY_LOGS = 'logs';
const KEY_CONFIG = 'config';
// Nombre maximum de lignes de logs conservees (voir store.lTrimLast).
const LOGS_MAX_LINES = 5000;

module.exports = {
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
};
