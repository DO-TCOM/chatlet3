'use strict';
/*
 * Chaltet — routes HTTP publiques (/health, /api/*)
 *
 * Extrait de server.js — comportement identique, juste isole. Branche
 * dans server.js via app.use(routesApi(deps)).
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { cleanText, clientIp, randomId, b64url, fromB64url } = require('./utils');

module.exports = function routesApi({ store, HASH_EXTRAS, HASH_PROFILES, PUBLIC_DIR }) {
  const router = express.Router();

  const TURN_URL = (process.env.TURN_URL || '').trim();
  const TURN_SECRET = (process.env.TURN_SECRET || process.env.TURN_AUTH_SECRET || '').trim();
  const TURN_USERNAME = (process.env.TURN_USERNAME || '').trim();
  const TURN_CREDENTIAL = (process.env.TURN_CREDENTIAL || '').trim();
  const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

  router.get('/health', (req, res) => {
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

  router.get('/api/ice-servers', async (req, res) => {
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

  router.post('/api/collect', (req, res) => {
    const ip = clientIp(req);
    const uuid = cleanText(req.body && req.body.uuid, 64) || randomId();
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    store.hSet(HASH_EXTRAS, uuid, { ...data, ip, ts: Date.now() }).catch(() => {});
    res.json({ ok: true });
  });

  router.post('/api/get-profile-by-uuid', async (req, res) => {
    const uuid = cleanText(req.body && req.body.uuid, 64);
    if (!uuid) return res.json({ ok: false });
    const all = await store.hGetAll(HASH_PROFILES);
    const raw = all['uuid:' + uuid];
    if (!raw) return res.json({ ok: false });
    let profile = raw;
    try { profile = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return res.json({ ok: false }); }
    res.json({ ok: true, profile: { pseudo: profile.pseudo, color: profile.color } });
  });

  router.get('/api/profile-by-token/:hash', (req, res) => {
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

  router.post('/api/room-profile', (req, res) => {
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

  return router;
};
