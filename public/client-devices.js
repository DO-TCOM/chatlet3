const noSleep = new NoSleep();

let _harkInstance = null;

function setupAudioAnalysis(stream) {
    if (_harkInstance) {
        _harkInstance.stop();
        _harkInstance = null;
    }
    _harkInstance = hark(stream, { interval: 100, threshold: -65, play: false });
    _harkInstance.on('speaking', () => {
        updateSpeakingUI('local', true);
        socket.emit('peer-speaking', { status: true });
    });
    _harkInstance.on('stopped_speaking', () => {
        updateSpeakingUI('local', false);
        socket.emit('peer-speaking', { status: false });
    });
}

function updateSpeakingUI(id, isSpeaking) {
    const el = id === 'local'
        ? document.querySelector('.toggleAudio')
        : (document.getElementById(`peer-${id}`) ? document.getElementById(`peer-${id}`).querySelector('.toggleMute') : null);
    if (el) { el.classList.toggle('speaking', isSpeaking); el.classList.toggle('sound', isSpeaking); }

    if (featuredUserId === id) {
        const featuredMute = document.querySelector('.peer.featured .toggleMute');
        if (featuredMute) {
            featuredMute.classList.toggle('speaking', isSpeaking);
            featuredMute.classList.toggle('sound', isSpeaking);
        }
    }
}

async function getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoSelect.innerHTML = ''; audioSelect.innerHTML = '';
    devices.forEach(device => {
        const option = document.createElement('option'); option.value = device.deviceId;
        if (device.kind === 'videoinput') { option.text = device.label || `Camera ${videoSelect.options.length + 1}`; videoSelect.appendChild(option); }
        else if (device.kind === 'audioinput') { option.text = device.label || `Microphone ${audioSelect.options.length + 1}`; audioSelect.appendChild(option); }
    });
    if (videoSelect.options.length > 0) videoSelect.disabled = false;
    if (audioSelect.options.length > 0) audioSelect.disabled = false;

    if (!videoSelect._listenerAttached) {
        videoSelect._listenerAttached = true;
        videoSelect.addEventListener('change', async () => {
            if (!localStream) return;
            const deviceId = videoSelect.value;
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
                });
                const newTrack = newStream.getVideoTracks()[0];
                for (const id in peers) {
                    const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) await sender.replaceTrack(newTrack);
                }
                localStream.getVideoTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
                localStream.addTrack(newTrack);
                updateLocalVideoElement(localStream);
            } catch (err) { console.error('Video device switch error:', err); }
        });
    }

    if (!audioSelect._listenerAttached) {
        audioSelect._listenerAttached = true;
        audioSelect.addEventListener('change', async () => {
            if (!localStream) return;
            const deviceId = audioSelect.value;
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
                const newTrack = newStream.getAudioTracks()[0];
                for (const id in peers) {
                    const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
                    if (sender) await sender.replaceTrack(newTrack);
                }
                localStream.getAudioTracks().forEach(t => { t.stop(); localStream.removeTrack(t); });
                localStream.addTrack(newTrack);
                setupAudioAnalysis(localStream);
            } catch (err) { console.error('Audio device switch error:', err); }
        });
    }
}

