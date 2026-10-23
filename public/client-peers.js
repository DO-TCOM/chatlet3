function flushCandidateQueue(pc) {
    if (pc.candidateQueue) {
        pc.candidateQueue.forEach(c => pc.addIceCandidate(c).catch(e => {}));
        pc.candidateQueue = [];
    }
}

function showModOverlay(message, callback, autoDismiss = false) {
    if (autoDismiss) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#ff4444;font-size:1rem;font-weight:bold;padding:10px 24px;border-radius:999px;z-index:9999;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
        return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;font-family:sans-serif;';
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'color:#ff4444;font-size:2.5rem;font-weight:bold;letter-spacing:0.1em;margin-bottom:1rem;';
    msgEl.textContent = message;
    overlay.appendChild(msgEl);
    document.body.appendChild(overlay);
    setTimeout(callback, 2500);
}

function addModBadge(peerElement) {
    if (!peerElement || peerElement.querySelector('.mod-badge')) return;
    const badge = document.createElement('div');
    badge.className = 'mod-badge';
    badge.title = 'Moderator';
    badge.style.cssText = 'position:absolute;bottom:4px;right:4px;width:28px;height:28px;z-index:10;';
    badge.innerHTML = `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
        <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="#8B4513" stroke="#6B3010" stroke-width="1"/>
        <polygon points="14,4 23,9.5 23,18.5 14,24 5,18.5 5,9.5" fill="#A0522D"/>
        <text x="14" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" font-weight="bold" fill="#FFD700" letter-spacing="0.5">MOD</text>
    </svg>`;
    peerElement.appendChild(badge);
}

function buildMuteBtn(id, isMini, fs, pad) {
    const isMuted = mutedPeers.has(id);
    const btn = document.createElement('button');
    btn.dataset.modMuteId = id;
    btn.innerText = isMuted ? (isMini ? 'M' : 'Unmute') : (isMini ? 'M' : 'Mute');
    btn.style.cssText = `font-size:${fs};padding:${pad};width:auto;height:auto;background:${isMuted ? '#cc0000' : '#22aa44'};color:white;border:none;border-radius:3px;cursor:pointer;`;
    btn.onclick = (e) => {
        e.stopPropagation();
        if (mutedPeers.has(id)) {
            socket.emit('mod-unmute', id);
        } else {
            socket.emit('mod-mute', id);
        }
    };
    return btn;
}

function syncMuteButtons(id) {
    const isMuted = mutedPeers.has(id);
    document.querySelectorAll(`[data-mod-mute-id="${id}"]`).forEach(btn => {
        const isMini = btn.closest('.miniature') !== null;
        btn.innerText = isMuted ? (isMini ? 'M' : 'Unmute') : (isMini ? 'M' : 'Mute');
        btn.style.background = isMuted ? '#cc0000' : '#22aa44';
    });
}

function addModButtons(peerElement) {
    if (!isModerator || peerElement.querySelector('.mod-controls')) return;
    if (!peerElement.id || !peerElement.id.startsWith('peer-')) return;
    const id = peerElement.id.replace('peer-', '');
    const isMini = peerElement.classList.contains('miniature');
    const fs = isMini ? '9px' : '11px';
    const pad = isMini ? '2px 4px' : '3px 8px';

    const modDiv = document.createElement('div');
    modDiv.className = 'mod-controls';
    modDiv.style.cssText = `position:absolute;top:5px;left:5px;display:flex;flex-wrap:wrap;gap:3px;z-index:10;max-width:${isMini ? '90px' : '200px'};`;

    const makeBtn = (label, bg, action) => {
        const btn = document.createElement('button');
        btn.innerText = label;
        btn.style.cssText = `font-size:${fs};padding:${pad};width:auto;height:auto;background:${bg};color:white;border:none;border-radius:3px;cursor:pointer;`;
        btn.onclick = (e) => { e.stopPropagation(); socket.emit(action, id); };
        return btn;
    };

    modDiv.appendChild(makeBtn(isMini ? 'K' : 'Kick', '#ff8800', 'mod-kick'));
    modDiv.appendChild(makeBtn(isMini ? 'K30' : 'Kick30s', '#ff5500', 'mod-kick-temp'));
    modDiv.appendChild(makeBtn(isMini ? 'B' : 'Ban', '#cc0000', 'mod-ban'));
    modDiv.appendChild(buildMuteBtn(id, isMini, fs, pad));
    peerElement.appendChild(modDiv);
}

function updatePeerUI(userId, forceCreate = false) {
    if (userId === socket.id || userId === 'local') return;
    let peerEl = document.getElementById(`peer-${userId}`);
    const prof = remoteProfiles[userId] || { displayName: 'Guest', profileColor: '#4A90E2' };
    const safeColor = sanitizeColor(prof.profileColor);

    if (!peerEl) {
        if (!forceCreate) return;
        peerEl = document.createElement('div');
        peerEl.id = `peer-${userId}`;
        peerEl.className = 'peer miniature';
        peerEl.style.backgroundColor = safeColor;
        peerEl.dataset.createdAt = Date.now();
        peerEl.innerHTML = `
            <video class="video" autoplay playsinline disablepictureinpicture></video>
            <div class="name" style="color: ${safeColor}">${escapeHTML(prof.displayName)}</div>
            <div class="toggleMute"></div>
            <div class="toggleRemoteVideo" style="top: 2.2rem"></div>
        `;
        document.querySelector('.conversation').appendChild(peerEl);
        peerEl.addEventListener('click', () => setFeatured(userId));

        const muteBtn = peerEl.querySelector('.toggleMute');
        const videoBtn = peerEl.querySelector('.toggleRemoteVideo');
        const videoEl = peerEl.querySelector('video');

        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            videoEl.muted = !videoEl.muted;
            muteBtn.classList.toggle('muted', videoEl.muted);
        });

        videoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = videoEl.style.opacity === '0';
            videoEl.style.opacity = isHidden ? '1' : '0';
            videoBtn.classList.toggle('muted', !isHidden);
        });

        if (isModerator) addModButtons(peerEl);
        if (!featuredUserId || featuredUserId === 'local') setFeatured(userId);
    } else {
        if (isModerator) addModButtons(peerEl);
        const nameEl = peerEl.querySelector('.name');
        if (nameEl) { nameEl.innerText = prof.displayName; nameEl.style.color = safeColor; }
        peerEl.style.backgroundColor = safeColor;
    }

    if (featuredUserId === userId) peerEl.classList.add('is-featured');
    else peerEl.classList.remove('is-featured');
}

function setFeatured(idOrTag, streamOverride = null) {
    document.querySelectorAll('.peer.miniature').forEach(el => el.classList.remove('is-featured'));
    document.querySelector('.peer.local').classList.remove('is-featured');

    featuredUserId = idOrTag;
    const featuredEl = document.querySelector('.peer.featured');
    if (!idOrTag) { featuredEl.classList.add('hidden'); return; }

    if (idOrTag === 'local') {
        document.querySelector('.peer.local').classList.add('is-featured');
        document.querySelector('.peer.local').classList.add('hidden');
    } else if (idOrTag !== 'local-screen') {
        document.querySelector('.peer.local').classList.remove('hidden');
        const newMini = document.getElementById(`peer-${idOrTag}`);
        if (newMini) {
            newMini.classList.add('is-featured');
        }
    }

    featuredEl.classList.remove('hidden');
    const featuredVideo = featuredEl.querySelector('video');
    const featuredName = featuredEl.querySelector('.name');
    featuredEl.querySelector('.mod-controls')?.remove();
    if (isModerator && idOrTag && idOrTag !== 'local' && idOrTag !== 'local-screen') {
        const id = idOrTag;
        const modDiv = document.createElement('div');
        modDiv.id = 'featured-mod-controls';
        modDiv.className = 'mod-controls';
        modDiv.style.cssText = 'position:absolute;top:10px;left:10px;display:flex;gap:6px;z-index:10;flex-wrap:wrap;';
        const makeBtn = (label, bg, action) => {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.style.cssText = `font-size:12px;padding:4px 10px;width:auto;height:auto;background:${bg};color:white;border:none;border-radius:4px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.25);`;
            btn.onclick = (e) => { e.stopPropagation(); socket.emit(action, id); };
            return btn;
        };
        modDiv.appendChild(makeBtn('Kick', '#ff8800', 'mod-kick'));
        modDiv.appendChild(makeBtn('Kick 30s', '#ff5500', 'mod-kick-temp'));
        modDiv.appendChild(makeBtn('Ban', '#cc0000', 'mod-ban'));
        modDiv.appendChild(buildMuteBtn(id, false, '12px', '4px 10px'));
        featuredEl.appendChild(modDiv);
    }

    if (idOrTag === 'local-screen' && streamOverride) {
        featuredName.innerText = "Your Screen";
        featuredName.style.color = "#FFFFFF";
        featuredEl.style.backgroundColor = "#222";
        featuredVideo.srcObject = streamOverride;
    } else {
        const prof = (idOrTag === 'local')
            ? { displayName: myDisplayName, profileColor: myProfileColor }
            : (remoteProfiles[idOrTag] || { displayName: 'Guest', profileColor: '#4A90E2' });

        featuredName.innerText = prof.displayName;
        featuredName.style.color = sanitizeColor(prof.profileColor);
        featuredEl.style.backgroundColor = sanitizeColor(prof.profileColor);
        if (idOrTag === 'local') { featuredVideo.srcObject = null; featuredVideo.srcObject = localStream; }
        else if (peers[idOrTag] && peers[idOrTag].remoteStream) { featuredVideo.srcObject = null; featuredVideo.srcObject = peers[idOrTag].remoteStream; }
    }
}

socket.on('user-disconnected', (userId) => {
    if (allowSoundNotifications && audioUnsure) audioUnsure.play().catch(e => {});
    if (peers[userId]) peers[userId].close();
    const el = document.getElementById(`peer-${userId}`);
    if (el) el.remove();
    delete remoteProfiles[userId]; delete peers[userId];
    if (featuredUserId === userId) {
        const remaining = Object.keys(peers);
        if (remaining.length === 0) {
            featuredUserId = null;
            const featuredEl = document.querySelector('.peer.featured');
            if (featuredEl) featuredEl.classList.add('hidden');
            const localEl = document.querySelector('.peer.local');
            if (localEl) { localEl.classList.remove('is-featured'); localEl.classList.remove('hidden'); }
        } else {
            featuredUserId = remaining[0];
            setFeatured(featuredUserId);
        }
    }
});

// "Perfect negotiation" (cf. w3.org/TR/webrtc/#perfect-negotiation-example) :
// chaque cote calcule seul, sans coordination reseau, un role "poli"/"impoli"
// complementaire via la comparaison des socket.id. Ca permet aux DEUX pairs de
// lancer une negociation des qu'ils ont quelque chose a envoyer (cam/micro
// active a tout moment, par n'importe lequel des deux, dans n'importe quel
// ordre), tout en resolvant proprement une eventuelle offre simultanee.
function createPeerConnection(userId) {
    const pc = new RTCPeerConnection({ iceServers: iceServersConfig });
    peers[userId] = pc;
    pc.remoteStream = new MediaStream();
    pc.polite = socket.id > userId;
    pc.makingOffer = false;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { to: userId, signal: { candidate: e.candidate } }); };

    pc.ontrack = (e) => {
        e.streams[0].getTracks().forEach(track => {
            if (!pc.remoteStream.getTracks().find(t => t.id === track.id)) {
                pc.remoteStream.addTrack(track);
            }
        });
        let peerEl = document.getElementById(`peer-${userId}`);
        if (!peerEl) {
            updatePeerUI(userId, true);
            peerEl = document.getElementById(`peer-${userId}`);
        }
        if (peerEl) {
            const videoEl = peerEl.querySelector('video');
            if (videoEl && videoEl.srcObject !== pc.remoteStream) {
                videoEl.srcObject = pc.remoteStream;
            }
        }
        if (featuredUserId === userId) setFeatured(userId);
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && pc.restartIce) pc.restartIce();
        if (pc.connectionState === 'connected') {
            const peerEl = document.getElementById(`peer-${userId}`);
            if (peerEl && pc.remoteStream.getTracks().length > 0) {
                const videoEl = peerEl.querySelector('video');
                if (videoEl && videoEl.srcObject !== pc.remoteStream) {
                    videoEl.srcObject = pc.remoteStream;
                }
            }
        }
    };

    pc.onnegotiationneeded = async () => {
        try {
            pc.makingOffer = true;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: userId, signal: pc.localDescription });
        } catch (e) { console.error('Negotiation error:', e); }
        finally { pc.makingOffer = false; }
    };

    return pc;
}

// Reutilise la connexion existante si deja etablie (par l'autre cote), sinon
// en cree une nouvelle. A appeler des qu'un pair est connu (user-connected,
// sync-profiles) pour que les DEUX cotes aient toujours un objet pc pret,
// meme sans cam/micro actif pour l'instant.
function ensurePeer(userId) {
    return peers[userId] || createPeerConnection(userId);
}

