// Chatlet Mirror - Version Corrigée (Audit Complet + Replica 1:1 + Fixes)
"use strict";

const socket = io();
window.socket = socket;

socket.on('connect_error', () => {
    const existing = document.getElementById('connection-error');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'connection-error';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#cc0000;color:white;text-align:center;padding:10px;font-size:14px;z-index:9999;font-family:sans-serif;';
    banner.innerText = '⚠️ Connection blocked — disable your ad blocker or firewall for this site.';
    document.body.appendChild(banner);
});

socket.on('connect', () => {
    const banner = document.getElementById('connection-error');
    if (banner) banner.remove();
});

const roomId = window.location.pathname.split('/').pop() || 'friends';

socket.on('reconnect', () => {
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
        socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
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
            socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
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
        if (featuredUserId === targetId) {
            const featuredEl = document.querySelector('.peer.featured');
            if (featuredEl) {
                featuredEl.querySelector('.mod-controls')?.remove();
                const id = targetId;
                const modDiv = document.createElement('div');
                modDiv.id = 'featured-mod-controls';
                modDiv.className = 'mod-controls';
                modDiv.style.cssText = 'position:absolute;top:10px;left:10px;display:flex;gap:6px;z-index:10;flex-wrap:wrap;';
                const makeBtn = (label, bg, action) => {
                    const btn = document.createElement('button');
                    btn.innerText = label;
                    btn.style.cssText = `font-size:12px;padding:4px 10px;width:auto;height:auto;background:${bg};color:white;border:none;border-radius:4px;cursor:pointer;`;
                    btn.onclick = (e) => { e.stopPropagation(); socket.emit(action, id); };
                    return btn;
                };
                modDiv.appendChild(makeBtn('Kick', '#ff8800', 'mod-kick'));
                modDiv.appendChild(makeBtn('Kick 30s', '#ff5500', 'mod-kick-temp'));
                modDiv.appendChild(makeBtn('Ban', '#cc0000', 'mod-ban'));
                modDiv.appendChild(buildMuteBtn(id, false, '12px', '4px 10px'));
                featuredEl.appendChild(modDiv);
            }
        }
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
        socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
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

    socket.emit('profile-update', { roomId, displayName: myDisplayName, profileColor: myProfileColor });
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
        socket.emit('profile-update', { displayName: myDisplayName, profileColor: myProfileColor });
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

function createPeerConnection(userId, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: iceServersConfig });
    peers[userId] = pc;
    pc.remoteStream = new MediaStream();
    pc._isInitiator = isInitiator;

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
        if (pc.connectionState === 'failed') {
            if (pc._isInitiator && pc.restartIce) {
                pc.restartIce();
            }
        }
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
        if (!pc._isInitiator && !pc.remoteDescription) return;
        try {
            const offer = await pc.createOffer();
            if (pc.signalingState !== 'stable') return;
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: userId, signal: pc.localDescription });
        } catch (e) { console.error('Negotiation error:', e); }
    };

    return pc;
}

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
        updatePeerUI(id, true);
    }
    socket.emit('profile-update', { displayName: myDisplayName, profileColor: myProfileColor });

    setTimeout(() => {
        if (isModerator) {
            document.querySelectorAll('.peer.miniature').forEach(peer => addModButtons(peer));
        }
    }, 300);
});

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

























































































































































































































































































































































































