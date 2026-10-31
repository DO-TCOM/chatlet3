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

module.exports = {
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
};
