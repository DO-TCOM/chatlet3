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
        const NATURE_BACKGROUNDS = [
            'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1600&q=80',
            'https://images.unsplash.com/photo-1425913397330-cf8af2ff40a1?w=1600&q=80',
            'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1600&q=80',
            'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1600&q=80',
            'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=1600&q=80',
            'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1600&q=80',
            'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80',
            'https://images.unsplash.com/photo-1504214208698-ea1916a2195a?w=1600&q=80',
            'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=1600&q=80',
            'https://images.unsplash.com/photo-1471922694854-ff1b63b20054?w=1600&q=80',
            'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&q=80',
            'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=1600&q=80',
            'https://images.unsplash.com/photo-1434394354979-a235cd36269d?w=1600&q=80',
            'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1600&q=80',
            'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1600&q=80',
            'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1600&q=80',
            'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1600&q=80',
            'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1600&q=80',
            'https://images.unsplash.com/photo-1490682143684-14369e18dce8?w=1600&q=80',
            'https://images.unsplash.com/photo-1513002749550-c59d786b8e6c?w=1600&q=80',
            'https://images.unsplash.com/photo-1474511320723-9a56873867b5?w=1600&q=80',
            'https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?w=1600&q=80',
            'https://images.unsplash.com/photo-1437622368342-7a3d73a34c8f?w=1600&q=80',
            'https://images.unsplash.com/photo-1551969014-7d2c4cddf0b6?w=1600&q=80',
            'https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=1600&q=80',
            'https://images.unsplash.com/photo-1444464666168-49d633b86797?w=1600&q=80',
            'https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=1600&q=80',
            'https://images.unsplash.com/photo-1522926193341-e9ffd686c60f?w=1600&q=80',
            'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1600&q=80',
            'https://images.unsplash.com/photo-1440648130659-8474a2aa671f?w=1600&q=80',
            'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1600&q=80',
            'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=1600&q=80',
            'https://images.unsplash.com/photo-1559827291-72ee739d0d9a?w=1600&q=80',
            'https://images.unsplash.com/photo-1437622368342-7a3d73a34c8f?w=1600&q=80',
            'https://images.unsplash.com/photo-1596944924616-7b38e7cfac36?w=1600&q=80',
            'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?w=1600&q=80',
            'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600&q=80',
            'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1600&q=80',
            'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1600&q=80',
            'https://images.unsplash.com/photo-1455218873509-8097305ee378?w=1600&q=80',
            'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1600&q=80',
            'https://images.unsplash.com/photo-1504192010706-dd7f569ee2be?w=1600&q=80',
            'https://images.unsplash.com/photo-1518623489648-a173ef7824f3?w=1600&q=80',
            'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1600&q=80',
            'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1600&q=80',
            'https://images.unsplash.com/photo-1490750967868-88df5691cc84?w=1600&q=80',
            'https://images.unsplash.com/photo-1464347744102-11db6282a4a5?w=1600&q=80',
            'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&q=80',
            'https://images.unsplash.com/photo-1464852045489-bccb7d17fe39?w=1600&q=80',
            'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1600&q=80',
            'https://images.unsplash.com/photo-1444080748397-f442aa95c3e5?w=1600&q=80',
        ];
        let seed = 0;
        for (let i = 0; i < roomId.length; i++) seed += roomId.charCodeAt(i);
        const bgUrl = NATURE_BACKGROUNDS[seed % NATURE_BACKGROUNDS.length];
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

    joinVideoBtn.addEventListener('click', () => { noSleep.enable(); start(true, true); });
    joinAudioBtn.addEventListener('click', () => { noSleep.enable(); start(false, true); });
    joinChatBtn.addEventListener('click', () => { noSleep.enable(); start(false, false); });

    toggleChatBtn.addEventListener('click', () => {
        chatPanel.classList.toggle('hidden');
        const snippet = document.querySelector('.snippet');
        if (snippet) snippet.classList.add('hidden');
    });
    toggleMenuBtn.addEventListener('click', () => menuElement.classList.toggle('hidden'));

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
