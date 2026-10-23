// Chatlet Mirror - Version Corrigée (Audit Complet + Replica 1:1 + Fixes)
"use strict";

const socket = io();
window.socket = socket;

let connectErrorCount = 0;
socket.on('connect_error', () => {
    connectErrorCount++;
    const existing = document.getElementById('connection-error');
    if (existing) {
        if (connectErrorCount > 10) {
            existing.innerText = '⚠️ La connexion prend plus de temps que prévu. Vérifiez votre pare-feu ou bloqueur de publicité.';
        }
        return;
    }
    const banner = document.createElement('div');
    banner.id = 'connection-error';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#d35400;color:white;text-align:center;padding:10px;font-size:14px;z-index:9999;font-family:sans-serif;font-weight:bold;transition:opacity 0.3s;';
    banner.innerText = '⏳ Connexion au serveur en cours (réveil du serveur)... Veuillez patienter.';
    document.body.appendChild(banner);
});

const roomId = window.location.pathname.split('/').pop() || 'friends';

// socket.io v4 n'emet plus l'evenement "reconnect" sur le Socket (il est passe sur
// le Manager). L'ancien handler ne se declenchait donc jamais : apres une coupure
// reseau, le client gardait des peers fantomes et ne rejoignait plus la salle.
// On reutilise "connect" en ignorant la toute premiere connexion.
let hasConnectedOnce = false;

socket.on('connect', () => {
    connectErrorCount = 0;
    const banner = document.getElementById('connection-error');
    if (banner) banner.remove();

    if (!hasConnectedOnce) { hasConnectedOnce = true; return; }

    // Reconnexion : nettoyage des connexions cassees, puis rejointe de la salle.
    for (const id in peers) {
        try { peers[id].close(); } catch(e) {}
        delete peers[id];
    }
    document.querySelectorAll('.peer.miniature').forEach(el => el.remove());
    Object.keys(remoteProfiles).forEach(k => delete remoteProfiles[k]);
    featuredUserId = null;
    const featuredEl = document.querySelector('.peer.featured');
    if (featuredEl) featuredEl.classList.add('hidden');

    const modSecret = localStorage.getItem('modSecret');
    if (modSecret) setTimeout(() => socket.emit('mod-auth', { password: modSecret, displayName: myDisplayName }), 500);
    if (roomId) {
        socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor, uuid: getUUID() });
        socket.emit('join-room', roomId);
    }
    if (isModerator) {
        setTimeout(() => socket.emit('mod-badge', { roomId }), 600);
    }
});
let localStream = null;
const peers = {};

const epicNames = [
    "LukeSkywalker","DarthVader","ObiWanKenobi","HanSolo","PrincessLeia","Yoda","BobaFett",
    "ReyPalpatine","KyloRen","MaceWindu","AhsokaTano","Grogu","DarthMaul","CountDooku",
    "PadmeAmidala","GeneralGrievous","GrandMoffTarkin","GrandAdmiralThrawn","JangoFett","DarthSidious",
    "Goku","Vegeta","Gohan","Piccolo","Frieza","CellPerfect","MajinBuu","FutureTrunks","BrolyLSSJ",
    "Krillin","Yamcha","TienShinhan","Videl","Android18","Bardock","Raditz","Nappa","Pan","Uub",
    "GogetaSSB","VegitoBlue","UltraInstinct","Beerus","Whis","Jiren","HitHitter","CabbaSaiyan",
    "NarutoUzumaki","SasukeUchiha","SakuraHaruno","KakashiHatake","ItachiUchiha","MadaraUchiha",
    "ObitoUchiha","MinatoNamekaze","TsunadeSenju","JiraiyaSennin","OrochimaruSama","GaaraSuna",
    "ShikamaruNara","HinataHyuga","NejiHyuga","RockLee","TenTen","KibaInuzuka","SaiYamato","Killer_Bee",
    "MonkeyDLuffy","RoronoaZoro","NamiNavigator","UsoppSniper","VinsmokeSanji","NicoRobin",
    "TonyTonyChopper","FrankySuper","BrookYoHoHo","ShanksRedHair","SilverRayleigh","BoaHancock",
    "HawkeyeMihawk","CrocodileSama","DonquixoteDoflamingo","KaidoYonko","BigMomLinlin",
    "MarshallDTeach","PortgasDAce","SaboRevolutionary","WhitebeardNewgate","GolDRoger",
    "FrodoBaggins","GandalfTheGrey","AragornElessar","LegolasGreenleaf","GimliBaelin",
    "SamwiseGamgee","MeriadocBrandybuck","PeregrinTook","BoromirGondor","FaramirIthilien",
    "EowynShieldmaiden","TheodénKing","GaladrielLothlórien","ElrondRivendell","SarumanWhite",
    "SauronDarkLord","GollumSmeagol","ThorinOakenshield","BilboBaggins","TaurielElf",
    "TonyStarkIronMan","SteveRogersCapAm","ThorOdinson","BruceBannerHulk","NatashaRomanoff",
    "ClintonBarton","NickFury","WandaMaximoff","VisionSynthezoid","SamWilsonFalcon",
    "SpiderManPeter","DoctorStrange","BlackPantherTChalla","CaptainMarvel","AntManScott",
    "ThanosInfinity","LokiAsgard","UltraVision","NebulaGamora","RocketRaccoon","GrootIAmGroot",
    "HarryPotter","HermioneGranger","RonWeasley","AlbusDumbledore","SeverusSnape","LordVoldemort",
    "SiriusBlack","RemusLupin","BellatrixLestrange","NymphadoraTonks","MadEyeMoody","Dobby",
    "DracoMalfoy","GinnyWeasley","LunaLovegood","NevilleNeville","FredWeasley","GeorgeWeasley",
    "MasterChief","KratosSpartiate","GeraltDeRivie","LinkHylien","SamusAran","SolidSnake",
    "ClouDStrife","LightningFarron","NoctisLucisC","DoomSlayer","ArthurMorgan","AloyHorizon",
    "EzioAuditore","AltairIbnLaAhad","ConnorKenway","Bayek","EllieTLOU","JoelMiller",
    "BruceWayneBat","ClarkKentSuper","DianaWonder","BarryAllenFlash","HalJordanGL",
    "ArthurCurryAqua","VictorStoneC","LexLuthorCorp","TheJokerHaha","HarleyQuinnBAM",
    "TheElderDragon","DragonbornDova","ArthasLichKing","IllidanStormrage","SylvanasBansh",
    "ThrallWorldSham","JainaProudmoor","VarianWrynn","AndromédaNova","ZenyattaMonk",
    "GargantUa","Astérix","Obélix","Vercingétorix","Charlemagne","NapoléonBonaparte",
    "AramisDArtagnan","PorthosAthos","EdmondDantès","JeanValjean","QuasimodoND",
    "PhantomOpera","ArseneLupin","HerculePoi","NémoCapitaine","MichelStrogoff"
];

const pastelColors = [
    "#ef9a9a","#f48fb1","#ce93d8","#b39ddb","#9fa8da","#90caf9","#81d4fa","#80deea","#80cbc4","#a5d6a7",
    "#ff4081","#e040fb","#7c4dff","#448aff","#00e5ff","#1de9b6","#76ff03","#ffea00","#ff6d00","#ff1744",
    "#ff7043","#ffa726","#ffca28","#d4e157","#66bb6a","#26c6da","#42a5f5","#5c6bc0","#ab47bc","#ec407a",
    "#00bcd4","#009688","#4caf50","#8bc34a","#cddc39","#03a9f4","#2196f3","#3f51b5","#9c27b0","#e91e63",
    "#00e676","#40c4ff","#ff6e40","#ffd740","#69f0ae","#ea80fc","#ff80ab","#b388ff","#82b1ff","#84ffff"
];

function generateRandomName() {
    return epicNames[Math.floor(Math.random() * epicNames.length)];
}

let savedColor = localStorage.getItem('profileColor');
if (!pastelColors.includes(savedColor)) savedColor = null;

const _urlParams = new URLSearchParams(window.location.search);
const _urlPseudo = _urlParams.get('pseudo');
const _urlColor = _urlParams.get('color') ? '#' + _urlParams.get('color') : null;

(function applyHashProfile() {
    const hash = window.location.hash.replace('#', '').trim();
    if (!hash || hash.length < 4) return;
    try {
        const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = decodeURIComponent(escape(atob(b64)));
        const colonIdx = decoded.lastIndexOf(':');
        if (colonIdx === -1) return;
        const pseudo = decoded.slice(0, colonIdx).trim();
        const color  = decoded.slice(colonIdx + 1).trim();
        if (!pseudo || !color) return;
        const fullColor = color.startsWith('#') ? color : '#' + color;
        if (!/^#[0-9a-fA-F]{6}$/i.test(fullColor)) return;
        localStorage.setItem('displayName', pseudo);
        localStorage.setItem('profileColor', fullColor);
        history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) {}
})();

let transferredProfile = null;
let groupProfiles = null;
try {
    const stored = localStorage.getItem('transferProfile');
    if (stored) {
        const profile = JSON.parse(stored);
        if (Date.now() - profile.timestamp < 5 * 60 * 1000) {
            if (profile.profiles) {
                groupProfiles = profile.profiles;
            } else {
                transferredProfile = profile;
            }
            localStorage.removeItem('transferProfile');
        }
    }
} catch (e) {
    console.error('Error reading transferred profile:', e);
}

function getUUID() {
    let uuid = localStorage.getItem('userUUID');
    if (!uuid) {
        uuid = crypto.randomUUID();
        localStorage.setItem('userUUID', uuid);
    }
    return uuid;
}

async function fetchProfileByUUID() {
    const uuid = getUUID();
    try {
        const response = await fetch('/api/get-profile-by-uuid', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ uuid })
        });
        const data = await response.json();
        if (data.ok && data.profile) {
            return data.profile;
        }
    } catch (e) {
        console.error('Error fetching profile by UUID:', e);
    }
    return null;
}

async function fetchProfileByToken() {
    const hash = window.location.hash.replace('#', '').trim();
    if (!hash || hash.length < 5 || hash.includes(':')) return null;
    try {
        const res = await fetch('/api/profile-by-token/' + hash);
        const data = await res.json();
        if (data.ok) {
            return { pseudo: data.pseudo, color: data.color };
        }
    } catch (e) {}
    return null;
}

const _matchedGroupProfile = (groupProfiles && groupProfiles.length > 0) ? findMatchingProfile(groupProfiles) : null;
let myDisplayName  = _urlPseudo
    || (_matchedGroupProfile ? _matchedGroupProfile.pseudo : null)
    || (transferredProfile   ? transferredProfile.pseudo   : null)
    || localStorage.getItem('displayName')
    || generateRandomName();
let myProfileColor = (_urlColor && /^#[0-9a-fA-F]{6}$/.test(_urlColor) ? _urlColor : null)
    || (_matchedGroupProfile && _matchedGroupProfile.color ? '#' + _matchedGroupProfile.color : null)
    || (transferredProfile && transferredProfile.color ? '#' + transferredProfile.color : null)
    || savedColor
    || pastelColors[Math.floor(Math.random() * pastelColors.length)];

localStorage.setItem('displayName', myDisplayName);
localStorage.setItem('profileColor', myProfileColor);

(async () => {
    let applied = false;
    const tokenProfile = await fetchProfileByToken();
    if (tokenProfile) {
        myDisplayName  = tokenProfile.pseudo;
        myProfileColor = tokenProfile.color.startsWith('#') ? tokenProfile.color : '#' + tokenProfile.color;
        applied = true;
    } else {
        const uuidProfile = await fetchProfileByUUID();
        if (uuidProfile) {
            myDisplayName  = uuidProfile.pseudo || myDisplayName;
            myProfileColor = uuidProfile.color  || myProfileColor;
            applied = true;
        }
    }

    if (applied) {
        localStorage.setItem('displayName',   myDisplayName);
        localStorage.setItem('profileColor',  myProfileColor);
        const nameInput = document.querySelector('.settings .input');
        if (nameInput) nameInput.value = myDisplayName;
        if (typeof updateLocalProfileUI === 'function') updateLocalProfileUI();
        if (socket && socket.connected && roomId) {
            socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor, uuid: getUUID() });
        }
    }
})();

function findMatchingProfile(profiles) {
    if (!profiles || profiles.length === 0) return null;
    const uuid = getUUID();
    if (uuid) {
        const uuidMatch = profiles.find(p => p.uuid === uuid);
        if (uuidMatch) return uuidMatch;
    }
    return profiles[0];
}
let allowSoundNotifications = localStorage.getItem('allowSoundNotifications') !== 'false';

const welcomeLayer = document.querySelector('.welcome');
const conversationLayer = document.querySelector('.conversation');
const backgroundLayer = document.querySelector('.layer.background');
const chatLayer = document.querySelector('.layer.chat');
const settingsLayer = document.querySelector('.layer.settings');
const chatPanel = document.querySelector('.chat .panel');
const messagesContainer = document.querySelector('.messages');
const roomNameDisplay = document.querySelector('.roomName');
const nameInput = document.querySelector('.settings .input');
const chatInputField = document.querySelector('.chat .input');

const joinVideoBtn = document.querySelector('.joinVideo');
const joinAudioBtn = document.querySelector('.joinAudio');
const joinChatBtn = document.querySelector('.joinChat');
const toggleChatBtn = document.querySelector('.toggleChat');
const toggleMenuBtn = document.querySelector('.toggleMenu');
const menuElement = document.querySelector('.menu');
const soundNotificationsCheckbox = document.getElementById('soundNotifications');
let isModerator = false;

const toggleVideoBtn = document.querySelector('.toggleVideo');
const toggleAudioBtn = document.querySelector('.toggleAudio');
const videoSelect = document.getElementById('videoSource');
const audioSelect = document.getElementById('audioSource');

const audioUnconvinced = document.getElementById('audioUnconvinced');
const audioUnsure = document.getElementById('audioUnsure');
const audioMessage = document.getElementById('audioMessage');

const remoteProfiles = {};
const mutedPeers = new Set();
let screenStream;
// Bouton de partage d'ecran : le style .toggleScreenShare existe deja dans
// client.css mais le bouton n'est pas encore dans room.html. Declaration
// obligatoire : sans elle, stopScreenShare() leverait un ReferenceError.
let toggleScreenShareBtn = null;
let featuredUserId = null;
let iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }];

function sanitizeColor(color) {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
    return '#4A90E2';
}

function escapeHTML(str) {
    const p = document.createElement("p");
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
}

function linkify(str) {
    const urlRegex = /(https?:\/\/[^\s<>\"]+)/g;
    const parts = str.split(urlRegex);
    return parts.map((part, i) => {
        if (i % 2 === 1) {
            const safeUrl = part.replace(/"/g, '%22');
            return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" style="color:#77FFFF;text-decoration:underline;">' + escapeHTML(part) + '</a>';
        }
        return escapeHTML(part);
    }).join('');
}

function updateLocalProfileUI() {
    const safeColor = sanitizeColor(myProfileColor);
    const localPeer = document.querySelector('.peer.local');
    const localName = document.querySelector('.peer.local .name');
    if (localPeer) localPeer.style.backgroundColor = safeColor;
    if (localName) { localName.innerText = myDisplayName; localName.style.color = safeColor; }
    if (featuredUserId === 'local') {
        setFeatured('local');
    }
}

