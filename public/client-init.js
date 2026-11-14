document.addEventListener('DOMContentLoaded', async () => {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/api/ice-servers', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) iceServersConfig = await res.json();
    } catch(e) { console.warn('Could not fetch ICE servers config, using default STUN', e); }

    roomNameDisplay.innerText = roomId;
    nameInput.value = myDisplayName;
    if (soundNotificationsCheckbox) soundNotificationsCheckbox.checked = allowSoundNotifications;

    const inviteLink = document.getElementById('inviteLink');
    if (inviteLink) inviteLink.innerText = window.location.host + '/' + roomId;

    if (roomId === 'kids') {
        backgroundLayer.style.backgroundImage = "url('/backgroundkids.jpg')";
    } else if (roomId === 'turtle') {
        backgroundLayer.style.backgroundImage = "url('/background-turtle.png')";
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center';
    } else if (roomId === 'lildurk') {
        backgroundLayer.style.backgroundImage = "url('/background-lildurk.webp')";
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center top';
    } else if (roomId === 'ovo') {
        backgroundLayer.style.backgroundImage = "url('/background-ovo.jpg')";
        backgroundLayer.style.backgroundSize = 'contain';
        backgroundLayer.style.backgroundRepeat = 'no-repeat';
        backgroundLayer.style.backgroundPosition = 'center center';
    } else if (roomId === 'nutquack') {
        backgroundLayer.style.backgroundImage = "url('https://images.unsplash.com/photo-1459262838948-3e2de6c1ec80?w=1600&q=80')";
    } else if (roomId === 'elly') {
        backgroundLayer.style.backgroundImage = "url('/elly.jpeg')";
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center';
    } else if (roomId === 'bonjour') {
        backgroundLayer.style.backgroundImage = "url('/background-bonjour.jpg')";
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center';
    } else if (roomId === 'grenadine') {
        backgroundLayer.style.backgroundImage = "url('/background-grenadine.jpg')";
        backgroundLayer.style.backgroundSize = 'contain';
        backgroundLayer.style.backgroundRepeat = 'no-repeat';
        backgroundLayer.style.backgroundPosition = 'center center';
        backgroundLayer.style.backgroundColor = '#000000';
    } else {
        const DAILY_BACKGROUNDS = [
            '/backgrounds/background-general-11.jpg',
            '/backgrounds/background-general-6.jpg',
            '/backgrounds/background-general-7.jpg',
            '/backgrounds/background-general.jpg',
            '/backgrounds/crescent-moon-desert-mountains-wallpaper-4096x3072-1-1920x1080.jpg'
        ];
        // Rotation automatique quotidienne basée sur le jour (change à minuit)
        const now = new Date();
        const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / (24 * 60 * 60 * 1000));
        const bgUrl = DAILY_BACKGROUNDS[dayNumber % DAILY_BACKGROUNDS.length];
        backgroundLayer.style.backgroundImage = `url('${bgUrl}')`;
        backgroundLayer.style.backgroundSize = 'cover';
        backgroundLayer.style.backgroundPosition = 'center';
    }
    chatInputField.style.color = myProfileColor;

    updateLocalProfileUI();

    toggleVideoBtn.addEventListener('click', handleToggleVideo);
    toggleAudioBtn.addEventListener('click', handleToggleAudio);
    toggleScreenShareBtn = document.querySelector('.toggleScreenShare');
    if (toggleScreenShareBtn) toggleScreenShareBtn.addEventListener('click', handleToggleScreenShare);

    // noSleep activé sur le premier geste utilisateur (requis sur iOS/Safari)
    document.addEventListener('click', () => noSleep.enable(), { once: true });
    document.addEventListener('touchstart', () => noSleep.enable(), { once: true });

    toggleChatBtn.addEventListener('click', () => {
        chatPanel.classList.toggle('hidden');
        const snippet = document.querySelector('.snippet');
        if (snippet) snippet.classList.add('hidden');
    });
    toggleMenuBtn.addEventListener('click', () => menuElement.classList.toggle('hidden'));

    (function initChatPanelResize() {
        const handleLeft = document.querySelector('.chat .panel .resizeLeft');
        const handleTop = document.querySelector('.chat .panel .resizeTop');
        const handleGrip = document.querySelector('.chat .panel .resizeGrip');
        if (!handleLeft || !handleTop || !chatPanel) return;

        const savedWidth = localStorage.getItem('chatPanelWidth');
        const savedHeight = localStorage.getItem('chatPanelHeight');
        if (savedWidth) chatPanel.style.width = savedWidth;
        if (savedHeight) chatPanel.style.height = savedHeight;

        function startDrag(handle, onMove) {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const onMouseMove = (ev) => onMove(ev);
                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        startDrag(handleLeft, (ev) => {
            const rect = chatPanel.getBoundingClientRect();
            const newWidth = Math.min(Math.max(rect.right - ev.clientX, 240), window.innerWidth);
            chatPanel.style.width = newWidth + 'px';
            localStorage.setItem('chatPanelWidth', newWidth + 'px');
        });

        function resizeHeight(ev) {
            const rect = chatPanel.getBoundingClientRect();
            const newHeight = Math.min(Math.max(rect.bottom - ev.clientY, 160), window.innerHeight);
            chatPanel.style.height = newHeight + 'px';
            localStorage.setItem('chatPanelHeight', newHeight + 'px');
        }

        startDrag(handleTop, resizeHeight);

        if (handleGrip) {
            startDrag(handleGrip, (ev) => {
                const rect = chatPanel.getBoundingClientRect();
                const newWidth = Math.min(Math.max(rect.right - ev.clientX, 240), window.innerWidth);
                chatPanel.style.width = newWidth + 'px';
                localStorage.setItem('chatPanelWidth', newWidth + 'px');
                resizeHeight(ev);
            });
        }
    })();

    if (soundNotificationsCheckbox) {
        soundNotificationsCheckbox.addEventListener('change', (e) => {
            allowSoundNotifications = e.target.checked;
            localStorage.setItem('allowSoundNotifications', allowSoundNotifications);
        });
    }

    socket.on('mod-status', (status) => {
        isModerator = status;
        if (status) {
            document.querySelectorAll('.peer.miniature').forEach(peer => addModButtons(peer));
            addModBadge(document.querySelector('.peer.local'));
            socket.emit('mod-badge', { roomId });
        }
    });

    socket.on('mod-badge', (data) => {
        const applyBadge = () => {
            const el = document.getElementById(`peer-${data.id}`);
            if (el) {
                addModBadge(el);
            } else {
                setTimeout(applyBadge, 300);
            }
            if (featuredUserId === data.id) {
                addModBadge(document.querySelector('.peer.featured'));
            }
        };
        applyBadge();
    });

    socket.on('mod-mute-ack', (data) => {
        const { targetId, muted } = data;
        if (muted) {
            mutedPeers.add(targetId);
        } else {
            mutedPeers.delete(targetId);
        }
        syncMuteButtons(targetId);
    });

    socket.on('mod-action', (action) => {
        const type = typeof action === 'object' ? action.type : action;
        const by   = typeof action === 'object' ? (action.by || 'Mod') : 'Mod';

        if (type === 'muted') {
            chatInputField.disabled = true;
            chatInputField.placeholder = 'You are muted by ' + by + '.';
            if (localStream) {
                localStream.getAudioTracks().forEach(t => { t.enabled = false; });
                toggleAudioBtn.classList.add('off');
            }
            showModOverlay('Muted by ' + by, () => {}, true);
        } else if (type === 'unmuted') {
            chatInputField.disabled = false;
            chatInputField.placeholder = '';
            if (localStream) {
                localStream.getAudioTracks().forEach(t => { t.enabled = true; });
                toggleAudioBtn.classList.remove('off');
            }
            showModOverlay('Unmuted by ' + by, () => {}, true);
        } else if (type === 'kicked') {
            socket.disconnect();
            showModOverlay('KICK by ' + by, () => window.location.reload());
        } else if (type === 'kicked-temp') {
            socket.disconnect();
            showModOverlay('KICK 30s by ' + by, () => {
                setTimeout(() => window.location.reload(), 30000);
            });
        } else if (type === 'banned') {
            socket.disconnect();
            showModOverlay('BAN by ' + by, () => { window.location.href = 'https://www.google.com'; });
        }
    });

    nameInput.addEventListener('input', (e) => {
        myDisplayName = e.target.value.substring(0, 50);
        localStorage.setItem('displayName', myDisplayName);
        updateLocalProfileUI();
        socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor, uuid: getUUID() });
    });

    chatInputField.maxLength = 200;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (document.activeElement !== chatInputField) {
                chatPanel.classList.remove('hidden');
                chatInputField.focus();
            } else {
                const msg = chatInputField.value.trim();
                if (msg !== '') {
                    socket.emit('chat-message', { roomId, userName: myDisplayName, message: msg.substring(0, 200), color: myProfileColor });
                    chatInputField.value = '';
                } else {
                    chatPanel.classList.add('hidden');
                    chatInputField.blur();
                }
            }
        }
    });

    const featuredMuteBtn = document.querySelector('.peer.featured .toggleMute');
    const featuredVideoBtn = document.querySelector('.peer.featured .toggleRemoteVideo');
    const featuredVideoEl = document.querySelector('.peer.featured video');

    if (featuredMuteBtn && featuredVideoEl) {
        featuredMuteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            featuredVideoEl.muted = !featuredVideoEl.muted;
            featuredMuteBtn.classList.toggle('muted', featuredVideoEl.muted);
            if (featuredUserId && featuredUserId !== 'local' && featuredUserId !== 'local-screen') {
                const mini = document.getElementById(`peer-${featuredUserId}`);
                if (mini) mini.querySelector('.toggleMute').classList.toggle('muted', featuredVideoEl.muted);
            }
        });
    }

    if (featuredVideoBtn && featuredVideoEl) {
        featuredVideoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = featuredVideoEl.style.opacity === '0';
            featuredVideoEl.style.opacity = isHidden ? '1' : '0';
            featuredVideoBtn.classList.toggle('muted', !isHidden);
            if (featuredUserId && featuredUserId !== 'local' && featuredUserId !== 'local-screen') {
                const mini = document.getElementById(`peer-${featuredUserId}`);
                if (mini) mini.querySelector('.toggleRemoteVideo').classList.toggle('muted', !isHidden);
            }
        });
    }
});
