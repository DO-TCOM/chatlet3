function joinRoom() {
    var room = document.getElementById('roomInput').value.trim();
    if (!room) { document.getElementById('roomInput').focus(); return; }
    window.location.href = '/' + room;
}

function joinRandom() {
    window.location.href = '/random';
}

document.addEventListener('DOMContentLoaded', function() {
    var input = document.getElementById('roomInput');
    document.getElementById('joinBtn').addEventListener('click', joinRoom);
    document.getElementById('randomBtn').addEventListener('click', joinRandom);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') joinRoom(); });
    input.addEventListener('input', function() {
        input.value = input.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    });
});
