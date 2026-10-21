# Chaltet

Appels vidéo, audio & chat **peer-to-peer**. Sans compte, sans téléchargement, chiffré.

Ce dépôt contient :

- `server.js` — serveur Express + socket.io
- `public/` — **les fichiers du site, récupérés tels quels** (landing, room, panel admin, CSS, JS, icônes, images, sons)
- `.env.example` — variables d'environnement à recopier en `.env`

---

## Démarrage local

```bash
npm install
cp .env.example .env    # puis remplis MOD_PASSWORD (64 hex) et STATS_PASSWORD
npm start                # http://localhost:3000
```

Sans `REDIS_URL`, les données (logs, notes, blacklist, profils) sont écrites dans `./data/`.
Sur Render le disque est éphémère : **il faut `REDIS_URL`**.

## Déploiement Render

1. New → Web Service → connecte ce dépôt
2. Build Command : *(vide)* — Start Command : `npm start`
3. Health Check Path : `/health`
4. Environment : `MOD_PASSWORD`, `STATS_PASSWORD`, `REDIS_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`

## Routes HTTP

| Route | Méthode | Réponse |
|---|---|---|
| `/` | GET | landing (`public/index.html`) |
| `/<room>` | GET | page de salle (`public/room.html`) |
| `/health` | GET | `{"status":"ok","uptime":N}` |
| `/api/ice-servers` | GET | configuration STUN/TURN |
| `/api/collect` | POST | fingerprint navigateur (`{ok:true}`) |
| `/api/get-profile-by-uuid` | POST | `{ok, profile:{pseudo,color}}` |
| `/api/profile-by-token/:hash` | GET | `{ok, pseudo, color}` (hash base64url `pseudo:color`) |
| `/api/room-profile` | POST | `{ok, url}` — lien de partage avec profil |
| `/api/shorten` | POST | `{ok, short}` — token admin requis |
| `/admin/api/login` | POST | `{ok, token}` — mot de passe 64 hex |
| `/admin/api/data` | POST | logs, notes, extras, blacklist, config |
| `/admin/api/config` | POST | `whitelist_mode`, `redirect_url` |
| `/admin/api/toggle` | POST | `blocked` / `whitelist` pour une IP |
| `/admin/api/delete` | POST | vide tous les logs |
| `/admin/api/delete-selected` | POST | supprime les lignes d'index donnés |
| `/admin/api/save-notes` | POST | notes par IP |

Inconnu : un chemin **avec extension** renvoie la page 404 en **400**, un chemin **sans extension** est traité
comme un nom de room, un `/api/*` inconnu renvoie **404**.

## Protocole socket.io

**Client → serveur**

| Event | Payload |
|---|---|
| `join-room` | `roomId` |
| `profile-update` | `{roomId?, displayName, profileColor}` |
| `url-identity` | `{pseudo, color}` |
| `chat-message` | `{roomId, userName, message, color}` |
| `signal` | `{to, signal}` |
| `video-status` | `{roomId, enabled}` |
| `peer-speaking` | `{status}` |
| `mod-auth` | `{password, displayName}` |
| `mod-badge` | `{roomId}` |
| `mod-mute` / `mod-unmute` | `id` |
| `mod-kick` / `mod-kick-temp` / `mod-ban` | `id` |

**Serveur → client**

| Event | Payload |
|---|---|
| `user-connected` | `userId` |
| `user-disconnected` | `userId` |
| `signal` | `{from, signal}` |
| `chat-message` | `{id, userName, message, color, ts}` |
| `video-status` | `{id, enabled}` |
| `profile-update` | `{id, displayName, profileColor}` |
| `sync-profiles` | `{ [socketId]: {displayName, profileColor} }` |
| `peer-speaking` | `{id, status}` |
| `spam-warning` | `{muted, message}` |
| `spam-unmuted` | — |
| `mod-status` | `boolean` |
| `mod-badge` | `{id}` |
| `mod-mute-ack` | `{targetId, muted}` |
| `mod-action` | `{type:'muted'\|'unmuted'\|'kicked'\|'kicked-temp'\|'banned', by}` |

## Anti-spam

3 messages / 5 s, 2 messages longs (>100 caractères) / 30 s, mute progressif par IP :
15 s → 1 min → 10 min → 1 h → 1 jour.

## Sécurité

- CSP stricte (aucune ressource externe hors `fonts.gstatic.com` et `images.unsplash.com`)
- `helmet`-equivalent headers : COOP, CORP, `no-referrer`, `nosniff`, `frame-options`, HSTS
- corps de requête limité à 50 Ko
- `script-src-attr 'none'` (plus aucun `onclick` inline)
