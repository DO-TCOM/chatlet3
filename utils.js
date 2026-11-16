'use strict';
/*
 * Chaltet — fonctions utilitaires partagees
 *
 * Pures, sans etat : validation, nettoyage de texte, encodage, detection
 * navigateur, format de ligne de log. Extrait de server.js — comportement
 * identique, juste isole. Utilise par server.js (routes admin, socket.io)
 * et par routes-api.js (routes /api/*).
 */

const crypto = require('crypto');

const HASH_RE = /^[!-~]{16,128}$/;
const ROOM_NAME_RE = /^[a-zA-Z0-9]{1,20}$/;

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

function isValidRoomName(room) {
  if (!room || typeof room !== 'string') return false;
  const cleaned = room.trim();
  if (!ROOM_NAME_RE.test(cleaned)) return false;
  if (isReservedRoomName(cleaned)) return false;
  return true;
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

/* ─────── Identite moderateur reservee (anti-usurpation de pseudo/couleur) ───────
 * Pseudo officiel : -OvO- . Couleur officielle : #ed632d .
 * isReservedIdentityName() bloque le pseudo exact ET toute variante visuelle :
 *   - chiffre 0 a la place du O, lettres/symboles sosies du O (Cyrillique, Grec,
 *     pleine chasse, degre, cercles pleins/vides...)
 *   - n'importe quel tiret/trait d'union sosie (en dash, em dash, signe moins...)
 *   - caracteres invisibles/de controle/bidi glisses pour casser la detection
 *   - n'importe quel caractere au milieu (OwO, OuO, O<O, O^O, etc.) : la regle
 *     est structurelle ("O" + 1 caractere quelconque + "O"), pas liee a une
 *     liste de sosies du "v" — ca couvre aussi les generateurs de texte "inverse".
 * Pas une garantie mathematique a 100% (Unicode a des milliers de caracteres
 * confusables), mais couvre toutes les techniques de contournement realistes.
 */
const RESERVED_PROFILE_COLOR = '#ed632d';

function normalizeIdentityCore(raw) {
  let s = String(raw == null ? '' : raw).normalize('NFKD');
  // caracteres de controle / invisibles / bidi / joiners / BOM / soft-hyphen
  s = s.replace(/[\u0000-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤﻿]/g, '');
  // marques combinantes (accents issus de la decomposition NFKD)
  s = s.replace(/\p{M}/gu, '');
  s = s.toLowerCase();
  const O_LIKE = new Set(['0', 'о', 'ο', 'օ', 'ø', 'ｏ', '°', '⊙', '◯', '○', '●', '⭕']);
  const DASH_LIKE = new Set(['–', '—', '‐', '‑', '‒', '―', '−', '－', '﹘', '﹣', '⁃', '_']);
  const core = [];
  for (const ch of s) {
    if (/\s/.test(ch)) continue; // espaces ignores, n'importe ou dans la chaine
    if (DASH_LIKE.has(ch) || ch === '-') continue; // tirets ignores, n'importe ou
    core.push(O_LIKE.has(ch) ? 'o' : ch);
  }
  return core;
}

function isReservedIdentityName(raw) {
  const core = normalizeIdentityCore(raw);
  // bloque le pseudo officiel et toute variante structurelle "O + 1 caractere + O"
  return core.length === 3 && core[0] === 'o' && core[2] === 'o';
}

// Distance euclidienne RGB (0 = identique, ~441 = noir vs blanc). En dessous
// du seuil, on considere la teinte "trop proche" visuellement et on la bloque
// aussi, pas seulement le hex exact.
const RESERVED_COLOR_DISTANCE_THRESHOLD = 45;

function hexToRgb(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorDistance(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return Infinity;
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function isReservedIdentityColor(color) {
  const c = String(color || '');
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return false;
  return colorDistance(c, RESERVED_PROFILE_COLOR) <= RESERVED_COLOR_DISTANCE_THRESHOLD;
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

module.exports = {
  HASH_RE,
  ROOM_NAME_RE,
  RESERVED_ROOM_NAMES,
  isReservedRoomName,
  isValidRoomName,
  b64url,
  fromB64url,
  randomId,
  sanitizeColor,
  isReservedIdentityName,
  isReservedIdentityColor,
  cleanText,
  clientIp,
  detectBrowser,
  logLine,
};
