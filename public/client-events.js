socket.on('peer-speaking', (data) => {
    updateSpeakingUI(data.id, data.status);
});

socket.on('spam-warning', (data) => {
    const chatInput = document.querySelector('.chat .input');
    const div = document.createElement('div');
    div.className = 'message hint';
    div.style.color = data.muted ? '#ff4444' : '#ffaa00';
    div.textContent = data.message;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (data.muted && chatInput) {
        chatInput.disabled = true;
        chatInput.placeholder = data.message;
        chatInput.style.opacity = '0.5';
    }
});

socket.on('spam-unmuted', () => {
    const chatInput = document.querySelector('.chat .input');
    if (chatInput) {
        chatInput.disabled = false;
        chatInput.placeholder = '';
        chatInput.style.opacity = '1';
    }
    const div = document.createElement('div');
    div.className = 'message hint';
    div.style.color = '#44ff88';
    div.textContent = '✅ Tu peux de nouveau envoyer des messages.';
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

socket.on('chat-message', (data) => {
    if (allowSoundNotifications && audioMessage) audioMessage.play().catch(e => {});
    const div = document.createElement('div'); div.className = 'message';
    div.innerHTML = `<span style="color: ${sanitizeColor(data.color)}"><span class="user-name">${escapeHTML(data.userName)} :</span> ${linkify(data.message)}</span>`;
    messagesContainer.appendChild(div); messagesContainer.scrollTop = messagesContainer.scrollHeight;
    const snippet = document.querySelector('.snippet');
    if (snippet && chatPanel.classList.contains('hidden')) {
        snippet.innerText = `${data.userName}: ${data.message}`; snippet.classList.remove('hidden', 'faded');
        clearTimeout(snippet.hideTimeout); snippet.hideTimeout = setTimeout(() => snippet.classList.add('faded'), 3000);
    }
});

socket.on('video-status', (data) => {
    updateVideoVisibility(data.id, data.enabled);
});

socket.on('profile-update', (data) => {
    if (data.id === socket.id) return;
    remoteProfiles[data.id] = { displayName: data.displayName, profileColor: sanitizeColor(data.profileColor) };
    updatePeerUI(data.id);
    if (featuredUserId === data.id) setFeatured(data.id);
});

socket.on('sync-profiles', (profiles) => {
    for (const id in profiles) {
        if (id === socket.id || id === 'local') continue;
        const prof = profiles[id] || {};
        remoteProfiles[id] = {
            displayName:  prof.displayName  || 'Guest',
            profileColor: sanitizeColor(prof.profileColor || '#4A90E2')
        };
        // Cree la connexion des l'arrivee (meme sans cam/micro actif tout de
        // suite) : sans ca, activer sa cam plus tard ne rejoint jamais les
        // pairs deja presents qui, eux, n'ont rien active non plus.
        ensurePeer(id);
        updatePeerUI(id, true);
    }
    syncLocalTracksToPeers();
    socket.emit('profile-update', { displayName: myDisplayName, profileColor: myProfileColor, uuid: getUUID() });

    setTimeout(() => {
        if (isModerator) {
            document.querySelectorAll('.peer.miniature').forEach(peer => addModButtons(peer));
        }
    }, 300);
});

socket.on('room-blocked', (data) => {
    const reason = (data && data.reason) || 'banned';
    const redirect = String((data && data.redirect) || '').trim();
    socket.disconnect();

    // Mode liste blanche + redirection parametree par l'admin (redirect_url).
    if (reason === 'whitelist' && /^https?:\/\//i.test(redirect)) {
        window.location.href = redirect;
        return;
    }
    showModOverlay(reason === 'whitelist' ? 'ACCES RESTREINT' : 'BAN', () => {
        window.location.href = 'https://www.google.com';
    });
});

