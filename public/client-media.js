function syncLocalTracksToPeers() {
    if (!localStream) return;
    const streamTracks = localStream.getTracks();
    for (const id in peers) {
        const pc = peers[id];
        if (!pc || !pc.getSenders) continue;
        const senders = pc.getSenders();
        streamTracks.forEach(track => {
            const exists = senders.some(sender => sender.track && sender.track.id === track.id);
            if (!exists) pc.addTrack(track, localStream);
        });
    }
}

async function handleToggleVideo() {
    if (!localStream) localStream = new MediaStream();

    if (localStream.getVideoTracks().length === 0) {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
            const track = newStream.getVideoTracks()[0];
            localStream.addTrack(track);
            syncLocalTracksToPeers();
        } catch (err) { console.error('Media error:', err); return; }
    }

    updateLocalVideoElement(localStream);
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    toggleVideoBtn.classList.toggle('off', !track.enabled);
    updateVideoVisibility('local', track.enabled);
    socket.emit('video-status', { roomId, enabled: track.enabled });
}

async function handleToggleAudio() {
    if (!localStream) localStream = new MediaStream();

    if (localStream.getAudioTracks().length === 0) {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const track = newStream.getAudioTracks()[0];
            localStream.addTrack(track);
            setupAudioAnalysis(localStream);
            syncLocalTracksToPeers();
        } catch (err) { console.error('Media error:', err); return; }
    }

    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    toggleAudioBtn.classList.toggle('off', !track.enabled);
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
        if (toggleScreenShareBtn) toggleScreenShareBtn.classList.add('off');
        if (localStream && localStream.getVideoTracks().length > 0) {
            const camTrack = localStream.getVideoTracks()[0];
            for (const id in peers) {
                const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(camTrack);
            }
        }
        if (featuredUserId === 'local-screen') {
            featuredUserId = Object.keys(peers)[0] || 'local';
            setFeatured(featuredUserId);
        }
    }
}

async function start(useVideo, useAudio) {
    welcomeLayer.classList.add('hidden');
    conversationLayer.classList.remove('hidden');
    chatLayer.classList.remove('hidden');
    settingsLayer.classList.remove('hidden');

    if (useVideo || useAudio) {
        try {
            const constraints = { video: useVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false, audio: useAudio };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            updateLocalVideoElement(localStream);
            if (useVideo) toggleVideoBtn.classList.remove('off');
            if (useAudio) {
                toggleAudioBtn.classList.remove('off');
                setupAudioAnalysis(localStream);
            }
            syncLocalTracksToPeers();
            getDevices();
        } catch (err) { console.error('Media error:', err); }
    }

    socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor, uuid: getUUID() });
    socket.emit('join-room', roomId);

    if (_urlPseudo || _urlColor) {
        socket.emit('url-identity', { pseudo: _urlPseudo, color: _urlColor });
    }

    const modSecret = localStorage.getItem('modSecret');
    if (modSecret) {
        setTimeout(() => socket.emit('mod-auth', { password: modSecret, displayName: myDisplayName }), 500);
        setTimeout(() => { if (!isModerator) socket.emit('mod-auth', { password: modSecret, displayName: myDisplayName }); }, 1500);
    }
}

function updateLocalVideoElement(stream) {
    const localVideo = document.querySelector('.peer.local video');
    if (localVideo) localVideo.srcObject = stream;
}

function updateVideoVisibility(userId, isEnabled) {
    const el = userId === 'local'
        ? document.querySelector('.peer.local video')
        : (document.getElementById(`peer-${userId}`) ? document.getElementById(`peer-${userId}`).querySelector('video') : null);

    if (el) {
        if (!isEnabled) {
            el.srcObject = null;
        } else {
            el.srcObject = userId === 'local' ? localStream : (peers[userId] ? peers[userId].remoteStream : null);
        }
    }

    if (featuredUserId === userId) {
        const featuredVideo = document.querySelector('.peer.featured video');
        if (featuredVideo) {
            if (!isEnabled) featuredVideo.srcObject = null;
            else featuredVideo.srcObject = userId === 'local' ? localStream : (peers[userId] ? peers[userId].remoteStream : null);
        }
    }
}

socket.on('user-connected', (userId) => {
    if (userId === socket.id) return;

    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    const oldEl = document.getElementById('peer-' + userId);
    if (oldEl) oldEl.remove();

    if (allowSoundNotifications && audioUnconvinced) audioUnconvinced.play().catch(e => {});
    createPeerConnection(userId, true);
    updatePeerUI(userId, true);
    syncLocalTracksToPeers();

    if (myDisplayName && myProfileColor) {
        socket.emit('profile-update', { displayName: myDisplayName, profileColor: myProfileColor, uuid: getUUID() });
    }

    if (isModerator) {
        setTimeout(() => {
            const el = document.getElementById(`peer-${userId}`);
            if (el) addModButtons(el);
        }, 200);
        socket.emit('mod-badge', { roomId });
    }
});

socket.on('signal', (data) => {
    const isNew = !peers[data.from];
    if (isNew) createPeerConnection(data.from, false);
    const pc = peers[data.from];
    if (isNew) updatePeerUI(data.from, !document.getElementById('peer-' + data.from));

    if (data.signal.type === 'offer') {
        pc.setRemoteDescription(new RTCSessionDescription(data.signal))
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => socket.emit('signal', { to: data.from, signal: pc.localDescription }))
            .then(() => flushCandidateQueue(pc));
    } else if (data.signal.type === 'answer') {
        pc.setRemoteDescription(new RTCSessionDescription(data.signal))
            .then(() => flushCandidateQueue(pc));
    } else if (data.signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
            pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(e => {});
        } else {
            if (!pc.candidateQueue) pc.candidateQueue = [];
            pc.candidateQueue.push(new RTCIceCandidate(data.signal.candidate));
        }
    }
});

