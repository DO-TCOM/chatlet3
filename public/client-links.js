async function createShortLink() {
    const roomName = window.location.pathname.split('/').pop() || 'friends';
    const pseudo = myDisplayName;
    const color = myProfileColor.replace('#', '');

    try {
        const response = await fetch('/api/room-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: roomName, pseudo, color })
        });
        const result = await response.json();
        if (result.ok) {
            await navigator.clipboard.writeText(result.url);
            showNotification('Lien copié dans le presse-papiers !\n' + result.url);
        }
    } catch (error) {
        console.error('Error creating room link:', error);
        showNotification('Erreur lors de la création du lien');
    }
}

async function createTransferLink() {
    const pseudo = localStorage.getItem('displayName') || myDisplayName;
    const color = localStorage.getItem('profileColor') || myProfileColor.replace('#', '');
    const currentRoom = window.location.pathname.split('/').pop() || 'friends';

    localStorage.setItem('transferProfile', JSON.stringify({
        pseudo: pseudo,
        color: color.replace('#', ''),
        timestamp: Date.now()
    }));

    const transferLink = `${window.location.origin}/${currentRoom}`;
    await navigator.clipboard.writeText(transferLink);
    showNotification('Lien copié !\n' + transferLink + '\n\nLe profil sera transféré automatiquement.');
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-family: monospace;
        font-size: 14px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        white-space: pre-line;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        createTransferLink();
    }
});
