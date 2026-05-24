import { renderDrunterDrueber, initDDGame, checkDDCorrect } from './dd-logic.js';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { inject } from '@vercel/analytics';

// ===================================================
//  BUSFAHRER – app.js
//  Full multiplayer via Firebase Realtime Database
// ===================================================

const PLAYER_DISCONNECT_TIMEOUT_MS = 120 * 1000; // 2 Minuten Puffer
const APP_VERSION = '2.1.7'; // Muss mit der Version in version.json übereinstimmen

// ── Deck Utilities ──────────────────────────────────────
const SUITS = ['♥','♦','♠','♣'];
const SUIT_NAMES = { '♥': 'Herz', '♦': 'Karo', '♠': 'Pik', '♣': 'Kreuz' };
const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
export const VALUE_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
export { cardHTML, escHtml, toast };
function isRed(suit) { return suit === '♥' || suit === '♦'; }

function cardColor(suit) { return isRed(suit) ? 'red' : 'black'; }

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ suit: s, value: v });
  return shuffle(deck);
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Firebase ──────────────────────────────────────────
let db, ref, set, get, push, onValue, update, remove, onDisconnect;
let fbReady = false;

// Zeit-Synchronisation
let serverOffset = 0;
function getServerNow() {
  return Date.now() + serverOffset;
}

// Deine festen Zugangsdaten
const myConfig = {
  apiKey: "AIzaSyBXl_VNTyQ3zPFNn-93KQr3-GMI7Mqcq9w",
  authDomain: "partyspiele-41436.firebaseapp.com",
  databaseURL: "https://partyspiele-41436-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "partyspiele-41436",
  storageBucket: "partyspiele-41436.firebasestorage.app",
  messagingSenderId: "137961342879",
  appId: "1:137961342879:web:8e19d386038009a371dfaa",
  measurementId: "G-572QV9R5KM"
};

async function initFirebase(config) {
  // Warten, bis Firebase-Module verfügbar sind (Safari-Fix)
  let m = window._firebaseModules;
  let retries = 0;
  while (!m && retries < 50) { // Max 5 Sekunden warten
    await new Promise(r => setTimeout(r, 100));
    m = window._firebaseModules;
    retries++;
  }
  if (!m) throw new Error("Firebase konnte nicht geladen werden.");

  const app = m.initializeApp(config); 
  db = m.getDatabase(app);
  ref = m.ref; set = m.set; get = m.get; push = m.push;
  onValue = m.onValue; update = m.update; remove = m.remove;
  onDisconnect = m.onDisconnect;

  // Serverzeit-Offset abrufen
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    serverOffset = snap.val() || 0;
  });

  fbReady = true;
}

// ── State ───────────────────────────────────────────────
let myName = '';
let myId = localStorage.getItem('bf_uid');
if (!myId) {
  myId = 'u_' + Math.random().toString(36).slice(2, 9);
  localStorage.setItem('bf_uid', myId);
}
let lobbyId = null;
let isHost = false;
let unsubFns = [];
let hostCleanupInterval = null;
let hostTimerInterval = null;
let isProcessing = false; 
let pyramidSize = 10;
let selectedGameMode = 'busfahrer';

// ── Screens ──────────────────────────────────────────────
function hideAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
}

function showScreen(id) {
  const target = document.getElementById('screen-' + id);
  if (!target) return;
  
  // Verhindert den Redundanten Toggle-Bug in Safari
  if (target.classList.contains('active')) {
    hideAllModals();
    return;
  }

  hideAllModals();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Card HTML ──────────────────────────────────────────────
function cardHTML(card, small = false, extra = '', idx = null) {
  const dataIdx = idx !== null ? `data-idx="${idx}"` : '';
  if (!card) return `<div class="card${small ? '-sm' : ''} face-down ${extra}" ${dataIdx}></div>`;
  const cls = `${small ? 'card-sm' : 'card'} ${cardColor(card.suit)} ${extra}`;
  return `<div class="${cls}" ${dataIdx}>
    <span class="card-value">${card.value}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

// ── Lobby Code Gen ────────────────────────────────────────
function genCode() {
  const chars = '1234567890';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── INIT ──────────────────────────────────────────────────
async function initApp() {
  // 0. Sofortiger Versions-Check bevor die App "lebt"
  // Wir warten auf diesen Check, um einen "Zombie-Ladevorgang" zu verhindern.
  const updateTriggered = await checkVersion();
  if (updateTriggered) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) statusEl.textContent = "Update wird geladen...";
    return; // Initialisierung abbrechen, da die Seite neu lädt
  }

  try {
    // 1. Zuerst die UI aufbauen
    setupHomeUI();
    injectSpeedInsights(); 
    inject(); 
  } catch (e) {
    console.error("UI Setup Fehler:", e);
  }

  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    statusEl.textContent = "Verbinde mit Server...";
    statusEl.classList.add('connecting');
  }

  try {
    // Firebase-Initialisierung
    initFirebase(myConfig).then(() => {
      const modal = document.getElementById('firebase-modal');
      if (modal) modal.classList.remove('active');
      
      if (statusEl) {
        statusEl.textContent = "Bereit";
        statusEl.classList.remove('connecting');
        statusEl.classList.add('ready');

        // Reconnect-Logik: Falls der Tab neu geladen wurde, versuchen wir die Lobby wiederherzustellen
        const savedLobbyId = localStorage.getItem('bf_lobbyId');
        const urlParams = new URLSearchParams(window.location.search);
        if (savedLobbyId && !urlParams.get('join')) {
          joinLobby(savedLobbyId);
        }

        setTimeout(() => { statusEl.style.opacity = "0"; }, 2000);
      }
    }).catch(e => {
      console.error("Firebase Fehler:", e);
      if (statusEl) {
        statusEl.textContent = "Verbindungsfehler";
        statusEl.classList.remove('connecting');
        statusEl.classList.add('error');
      }
      showFirebaseModal();
    });
  } catch (error) {
    console.error("Initialisierungsfehler:", error);
  }
}

// Sicherstellen, dass der DOM wirklich bereit ist (wichtig für iOS Safari)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

async function checkVersion() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const versionInUrl = urlParams.get('v');

    const response = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();

    if (data.version && data.version !== APP_VERSION) {
      // Nur neu laden, wenn wir nicht GERADE erst durch genau DIESE Version neu geladen wurden
      if (versionInUrl !== data.version) {
        console.log(`Update gefunden: ${APP_VERSION} -> ${data.version}`);
        // location.replace ist besser für Safari, da es die History nicht mit "toten" Seiten füllt
        window.location.replace(window.location.pathname + '?v=' + data.version);
        return true;
      }
    }
    
    // Wenn wir hier landen und ein 'v' in der URL haben, sind wir aktuell.
    // Wir säubern die URL für die Ästhetik.
    if (versionInUrl) {
      setTimeout(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 1000);
    }
    return false;
  } catch (e) {
    console.warn("Versions-Check fehlgeschlagen (evtl. offline)");
    return false;
  }
}

function showFirebaseModal() {
  document.getElementById('firebase-modal').classList.add('active');
}

function setupHomeUI() {
  // Verhindert mehrfache Zuweisung falls setupHomeUI öfter aufgerufen wird
  if (document.body.dataset.uiReady === 'true') return;
  
  showScreen('home');

  // Restore name
  const savedName = localStorage.getItem('bf_name');
  if (savedName) document.getElementById('input-name').value = savedName;

  // QR-Code / Einladungslink Check
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get('join');
  if (joinCode) {
    const codeInput = document.getElementById('input-code');
    const nameInput = document.getElementById('input-name');
    const createBtn = document.getElementById('btn-create');
    const divider = document.querySelector('.divider');
    const joinBtn = document.getElementById('btn-join');

    codeInput.value = joinCode.toUpperCase();
    
    // UI radikal vereinfachen für "Quick Join"
    if (createBtn) createBtn.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (codeInput) codeInput.style.display = 'none'; // Code ist fix, also verstecken
    if (joinBtn) {
      joinBtn.textContent = "Lobby beitreten";
      joinBtn.classList.add('btn-primary', 'btn-large');
    }

    window.history.replaceState({}, document.title, window.location.pathname);

    if (nameInput.value) {
      // Falls Name schon da ist: Automatisch joinen, sobald Firebase bereit ist
      const checkReady = setInterval(() => {
        if (fbReady) { clearInterval(checkReady); joinLobby(); }
      }, 100);
    } else {
      nameInput.focus();
      toast("Gib deinen Namen ein, um beizutreten! 👋");
    }
  }

  // --- Custom Mode Switcher Logic ---
  const initCustomSelect = (containerId) => {
    const container = document.getElementById(containerId);
    if (!container || container.dataset.init === 'true') return;
    const trigger = container.querySelector('.select-trigger');
    const options = container.querySelectorAll('.option');

    trigger.onclick = (e) => {
      e.stopPropagation();
      if (container.classList.contains('disabled')) {
        if (lobbyId && !isHost) toast("Nur der Host kann den Modus ändern.");
        return;
      }
      document.querySelectorAll('.custom-select').forEach(c => {
        if (c !== container) c.classList.remove('active');
      });
      container.classList.toggle('active');
    };

    options.forEach(opt => {
      opt.onclick = async () => {
        const newMode = opt.dataset.value;
        container.classList.remove('active');
        
        if (lobbyId && lastGameState && lastGameState.phase !== 'end' && lastGameState.phase !== 'waiting') {
          toast("Wechsel während des Spiels nicht möglich ❌");
          return;
        }

        if (lobbyId && isHost) {
          await update(ref(db, `lobbies/${lobbyId}`), { gameType: newMode });
        } else if (!lobbyId) {
          selectedGameMode = newMode;
          updateCustomSelectUI(newMode);
        }
      };
    });
    container.dataset.init = 'true';
  };

  initCustomSelect('mode-select-lobby');
  initCustomSelect('mode-select-game');

  // Klick außerhalb schließt Dropdown
  window.onclick = () => {
    document.querySelectorAll('.custom-select').forEach(c => c.classList.remove('active'));
  };

  document.getElementById('btn-create').addEventListener('click', createLobby);
  document.getElementById('btn-join').addEventListener('click', joinLobby);
  document.getElementById('input-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinLobby();
  });
  document.getElementById('input-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (document.getElementById('input-code').style.display === 'none') joinLobby();
      else document.getElementById('input-code').focus();
    }
  });
  const confirmBtn = document.getElementById('btn-confirm-drinking');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmSips);

  document.getElementById('btn-show-qr').onclick = showQRCode;
  document.body.dataset.uiReady = 'true';
}

function updateCustomSelectUI(mode) {
  const containers = ['mode-select-lobby', 'mode-select-game'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = mode === 'busfahrer' ? 'Busfahrer' : 'Drunter & Drüber';
    el.querySelector('.current-value').textContent = label;
    el.querySelectorAll('.option').forEach(opt => opt.classList.toggle('selected', opt.dataset.value === mode));
  });
}

// ── CREATE LOBBY ──────────────────────────────────────────
async function createLobby() {
  const nameInput = document.getElementById('input-name').value.trim();
  if (!nameInput) { toast('Bitte Namen eingeben'); return; }
  myName = nameInput;

  if (!fbReady) {
    toast('⏳ Verbindung wird noch hergestellt...');
    return;
  }
  localStorage.setItem('bf_name', myName);
  isHost = true;

  lobbyId = genCode();
  localStorage.setItem('bf_lobbyId', lobbyId);

  const lobbyRef = ref(db, `lobbies/${lobbyId}`);
  await set(lobbyRef, {
    host: myId,
    status: 'waiting',
    gameType: selectedGameMode,
    pyramidSize: 10,
    players: {
      [myId]: { name: myName, id: myId, host: true, joinedAt: Date.now() }
    }
  });

  // Host markiert sich bei Abbruch als offline, löscht aber NICHT die Lobby
  onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).update({ disconnected: true, lastSeen: getServerNow() });

  enterLobbyScreen();
}

// ── JOIN LOBBY ─────────────────────────────────────────────
async function joinLobby(reconnectCode = null) {
  // Falls durch Button-Klick aufgerufen, ist reconnectCode ein Event-Objekt -> ignorieren
  const isAutoJoin = (typeof reconnectCode === 'string');
  
  const nameInput = isAutoJoin ? localStorage.getItem('bf_name') : document.getElementById('input-name').value.trim();
  const code = isAutoJoin ? reconnectCode : document.getElementById('input-code').value.trim().toUpperCase();

  if (!nameInput) { toast('Bitte Namen eingeben'); return; }
  if (!code || code.length !== 6) { toast('Bitte gültigen Code eingeben'); return; }

  if (!fbReady) {
    toast('⏳ Verbindung wird noch hergestellt...');
    return;
  }

  myName = nameInput;
  localStorage.setItem('bf_name', myName);

  const snap = await get(ref(db, `lobbies/${code}`));
  if (!snap.exists()) { 
    localStorage.removeItem('bf_lobbyId');
    toast('Lobby nicht gefunden ❌'); return; 
  }
  const lobby = snap.val();
  const isAlreadyIn = lobby.players && lobby.players[myId];
  if (lobby.status !== 'waiting' && !isAlreadyIn) { toast('Spiel läuft bereits'); return; }

  selectedGameMode = lobby.gameType || 'busfahrer';
  isHost = (lobby.host === myId);
  lobbyId = code;
  localStorage.setItem('bf_lobbyId', lobbyId);
  await set(ref(db, `lobbies/${lobbyId}/players/${myId}`), {
    name: myName, id: myId, host: false, joinedAt: Date.now(), disconnected: false, lastSeen: getServerNow()
  });

  // Spieler markiert sich bei Abbruch als offline
  onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).update({ disconnected: true, lastSeen: getServerNow() });

  pyramidSize = lobby.pyramidSize || 10;
  enterLobbyScreen();
}

function showQRCode() {
  if (!lobbyId) return;
  const joinUrl = `${window.location.origin}${window.location.pathname}?join=${lobbyId}`;
  const qrImg = document.getElementById('qr-code-img');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(joinUrl)}&bgcolor=ffffff&color=000000`;
  document.getElementById('qr-modal').classList.add('active');
}

// ── LOBBY SCREEN ──────────────────────────────────────────
function enterLobbyScreen() {
  showScreen('lobby');
  document.getElementById('lobby-code-display').textContent = lobbyId;

  // Icons initialisieren (für den Zurück-Button und QR-Button)
  if (window.lucide) window.lucide.createIcons();

  // Sicherstellen, dass man als online markiert ist
  update(ref(db, `lobbies/${lobbyId}/players/${myId}`), { disconnected: false, lastSeen: getServerNow() });

  // Modus-Wechsler für Host aktivieren, für andere sperren
  const modeContainer = document.getElementById('mode-select-lobby');
  if (modeContainer) modeContainer.classList.toggle('disabled', !isHost);
  updateCustomSelectUI(selectedGameMode);

  // Copy code on click
  document.getElementById('lobby-code-display').onclick = () => {
    navigator.clipboard?.writeText(lobbyId).then(() => toast('Code kopiert! ' + lobbyId));
  };

  // Leave
  document.getElementById('btn-leave-lobby').onclick = leaveLobby;

  // Listen for mode changes in Lobby
  const typeRef = ref(db, `lobbies/${lobbyId}/gameType`);
  const unsubType = onValue(typeRef, snap => {
    if (snap.exists()) {
      selectedGameMode = snap.val();
      updateCustomSelectUI(selectedGameMode);

      // Pyramidenselektor Sichtbarkeit live anpassen
      const pyramidSel = document.getElementById('pyramid-selector');
      if (pyramidSel) {
        pyramidSel.style.display = (isHost && selectedGameMode === 'busfahrer') ? '' : 'none';
      }

      // UI Update für Start-Button
      const startBtn = document.getElementById('btn-start-game');
      if (isHost && startBtn) {
        startBtn.textContent = selectedGameMode === 'busfahrer' ? 'Spiel starten 🚌' : 'Spiel starten 🃏';
      }
    }
  });
  unsubFns.push(unsubType);

  // Pyramid selector (host only)
  const pyramidSel = document.getElementById('pyramid-selector');
  if (isHost) {
    pyramidSel.style.display = '';
    document.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pyramidSize = parseInt(btn.dataset.size);
        update(ref(db, `lobbies/${lobbyId}`), { pyramidSize });
      });
    });
  }
  // Initiale Sichtbarkeit setzen
  if (pyramidSel) pyramidSel.style.display = (isHost && selectedGameMode === 'busfahrer') ? '' : 'none';

  // Start button
  const startBtn = document.getElementById('btn-start-game');
  const waitingMsg = document.getElementById('waiting-msg');
  if (isHost) {
    startBtn.style.display = '';
    startBtn.textContent = selectedGameMode === 'busfahrer' ? 'Spiel starten 🚌' : 'Spiel starten 🃏';
    startBtn.addEventListener('click', startGame);
  } else {
    startBtn.style.display = 'none';
    waitingMsg.style.display = '';
  }

  // Listen to players
  const playersRef = ref(db, `lobbies/${lobbyId}/players`);
  const unsub1 = onValue(playersRef, snap => {
    if (!snap.exists()) {
      if (lobbyId && !isHost) toast('Lobby wurde geschlossen');
      if (lobbyId) leaveLobby();
      return;
    }
    const players = snap.val() || {};
    renderPlayerList(players);
  });

  // Listen for game start
  const gameRef = ref(db, `lobbies/${lobbyId}/game`);
  const unsub2 = onValue(gameRef, snap => {
    if (snap.exists()) {
      const game = snap.val();
      lastGameState = game;
    
    // Host check: Timer für Pyramiden-Karten abgelaufen?
    if (isHost && (game.phase === 'round2' || game.phase === 'tiebreaker') && 
        game.matchEndTime && getServerNow() > game.matchEndTime) {
      autoLockMissedCards(game);
    }

      // Wenn wir beitreten und das Spiel ist schon in irgendeiner Phase (außer waiting)
      if (game.phase && game.phase !== 'waiting') {
        unsubFns.forEach(f => f());
        unsubFns = [];
        enterGameScreen();
      }
    }
  });

  // Listen for pyramid size changes (non-host)
  if (!isHost) {
    const psRef = ref(db, `lobbies/${lobbyId}/pyramidSize`);
    const unsub3 = onValue(psRef, snap => {
      if (snap.exists()) {
        pyramidSize = snap.val();
        const pills = document.querySelectorAll('.pill');
        pills.forEach(p => {
          p.classList.toggle('active', parseInt(p.dataset.size) === pyramidSize);
        });
      }
    });
    unsubFns.push(unsub3);
  }

  unsubFns.push(unsub1, unsub2);
}

function renderPlayerList(players) {
  const list = document.getElementById('player-list');
  const sorted = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt);
  list.innerHTML = sorted.map((p, idx) => {
    const isMe = p.id === myId;
    const isH = p.host;
    const isOffline = p.disconnected;
    const emoji = ['⭐', '🌟', '✨', '⚡', '🔥', '💎'][idx % 6]; // Avatare bleiben Symbole oder Text
    return `<div class="player-card ${isH ? 'player-host' : ''} ${isMe ? 'player-me' : ''} ${isOffline ? 'player-disconnected' : ''}">
      <div class="player-avatar">${emoji}</div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.name)}</div>
        <div class="player-role">${isH ? '👑 Host' : 'Spieler'} ${isOffline ? '(Offline)' : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function leaveLobby() {
  unsubFns.forEach(f => f()); unsubFns = [];
  if (gameListener) { gameListener(); gameListener = null; }
  if (window._matchTicker) clearInterval(window._matchTicker);
  if (hostTimerInterval) clearTimeout(hostTimerInterval);
  if (hostCleanupInterval) clearInterval(hostCleanupInterval);
  hostCleanupInterval = null;

  localStorage.removeItem('bf_lobbyId');
  if (lobbyId) {
    const snap = await get(ref(db, `lobbies/${lobbyId}/players`));
    const players = snap.val() || {};
    const pids = Object.keys(players);

    // onDisconnect entfernen, da wir die Lobby manuell verlassen
    onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).cancel();

    if (pids.length <= 1) {
      // Letzter Spieler löscht die ganze Lobby
      await remove(ref(db, `lobbies/${lobbyId}`));
    } else {
      // Nur eigenen Eintrag entfernen. Die Migration triggert für andere automatisch.
      await remove(ref(db, `lobbies/${lobbyId}/players/${myId}`));
    }
  }
  lobbyId = null; isHost = false;
  showScreen('home');
}

// ── START GAME (host only) ─────────────────────────────────
async function startGame() {
  const snap = await get(ref(db, `lobbies/${lobbyId}/players`));
  const playersObj = snap.val() || {};
  const players = Object.values(playersObj).sort((a, b) => a.joinedAt - b.joinedAt);
  if (players.length < 2) { toast('Mindestens 2 Spieler benötigt'); return; }

  const deck = makeDeck();
  // Deal 4 cards per player
  const playerStates = {};
  for (const p of players) {
    playerStates[p.id] = {
      id: p.id,
      name: p.name,
      hand: [], 
      drawnCards: [],
      readyForRound2: false,
      sipPool: 0, 
      sipsToDrink: 0,
      sipsTotal: 0
    };
  }

  if (selectedGameMode === 'drunterdrueber') {
    const ddState = await initDDGame(players, deck);
    await set(ref(db, `lobbies/${lobbyId}/game`), ddState);
    return;
  }

  // Lobby-Status auf 'playing' setzen, um weitere Beitritte zu verhindern
  const lobbyUpdate = {};
  lobbyUpdate[`lobbies/${lobbyId}/status`] = 'playing';
  await update(ref(db), lobbyUpdate);

  // Build pyramid with unique values
  const pyrCards = [];
  const usedValues = new Set();
  const remainingDeck = [];

  for (const card of deck) {
    if (pyrCards.length < pyramidSize && !usedValues.has(card.value)) {
      pyrCards.push(card);
      usedValues.add(card.value);
    } else {
      remainingDeck.push(card);
    }
  }

  const gameState = {
    gameType: 'busfahrer',
    phase: 'round1',
    pyramidSize,
    deck: remainingDeck,
    pyramid: pyrCards.map(c => ({ ...c, revealed: false })),
    players: playerStates,
    playerOrder: players.map(p => p.id),
    currentPlayerIndex: 0,
    currentRoundCard: 0, 
    matchingActive: false,
    drawnForCurrentPlayer: [],
    round1Done: false,
    pyramidIndex: 0,
    distributionActive: false,
    distributionGiverIndex: 0, 
    drinkingActive: false,
    confirmedDrinkers: {},
    drinkingStartTime: 0,
    busfahrerId: null,
    busStep: 0,
    busCards: [],
    busRestarts: 0,
    busActive: false,
  };

  await set(ref(db, `lobbies/${lobbyId}/game`), gameState);
}

// ── GAME SCREEN ────────────────────────────────────────────
let gameListener = null;
let lastGameState = null;

function enterGameScreen() {
  showScreen('game');

  // Während des Spiels den Modus-Wechsler für alle deaktivieren
  const modeContainer = document.getElementById('mode-select-game');
  if (modeContainer) modeContainer.classList.add('disabled');

  // Zurück-Button Logik im Spiel
  document.getElementById('btn-back-game').onclick = async () => {
    if (isHost) {
      if (confirm("Spiel abbrechen und zur Lobby zurückkehren?")) {
        await remove(ref(db, `lobbies/${lobbyId}/game`));
      }
    } else {
      leaveLobby();
    }
  };

  gameListener = onValue(ref(db, `lobbies/${lobbyId}/game`), snap => {
    if (!snap.exists()) {
      if (lobbyId) {
        if (gameListener) { gameListener(); gameListener = null; }
        enterLobbyScreen();
      }
      return;
    }
    const gs = snap.val();
    lastGameState = gs;

    // Host-Wiederherstellung: Falls der Timer nach einem Refresh fehlt
    if (isHost && (gs.phase === 'round2' || gs.phase === 'tiebreaker')) {
      const now = getServerNow();
      if (gs.matchEndTime && now < gs.matchEndTime && !hostTimerInterval) {
        const delay = (gs.matchEndTime - now) + 500;
        hostTimerInterval = setTimeout(() => autoLockMissedCards(lastGameState), delay);
      }
    }

    renderGame(gs);
    
    // Initialisiere Icons nach jedem globalen State-Update
    if (window.lucide) window.lucide.createIcons();
  });
}

// ── DRUNTER & DRÜBER ACTIONS ─────────────────────────────
function animateSipsToPool(count) {
  const sourceEl = document.querySelector('.choice-buttons');
  const targetEl = document.getElementById('sip-pool-target') || document.querySelector('.current-player-badge');
  if (!sourceEl || !targetEl) return;

  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  for (let i = 0; i < count; i++) {
    const sip = document.createElement('div');
    sip.className = 'flying-sip';
    sip.innerHTML = '<i data-lucide="beer" style="color:var(--accent)"></i>';
    sip.style.left = `${sourceRect.left + sourceRect.width / 2 - 15}px`;
    sip.style.top = `${sourceRect.top}px`;
    document.body.appendChild(sip);

    setTimeout(() => {
      sip.style.left = `${targetRect.left}px`;
      sip.style.top = `${targetRect.top}px`;
      sip.style.transform = 'scale(0.4) rotate(720deg)';
      sip.style.opacity = '0';
    }, 50 + i * 150);

    setTimeout(() => sip.remove(), 1000 + i * 150);
  }

  // Wichtig: Da die Icons dynamisch zum Body hinzugefügt wurden, müssen sie initialisiert werden
  if (window.lucide) window.lucide.createIcons();
}

window.selectDDRow = (idx) => {
  update(ref(db, `lobbies/${lobbyId}/game`), { selectedRowIndex: idx, selectedSide: null });
};

window.selectDDSide = (side) => {
  update(ref(db, `lobbies/${lobbyId}/game`), { selectedSide: side });
};

window.handleDDChoice = async (choice) => {
  if (isProcessing || !lastGameState) return;
  isProcessing = true;
  try {
    const gs = lastGameState;
    const rowIdx = gs.selectedRowIndex;
    const side = gs.selectedSide;
    const deck = [...gs.deck];
    const drawnCard = deck.shift();
    const row = { ...gs.rows[rowIdx] };
    if (!row.left) row.left = [];
    if (!row.right) row.right = [];
    
    const compareCard = (side === 'left') 
      ? (row.left.length > 0 ? row.left[row.left.length - 1] : row.pivot)
      : (row.right.length > 0 ? row.right[row.right.length - 1] : row.pivot);
      
    const correct = checkDDCorrect(choice, compareCard, drawnCard);
    
    if (side === 'left') row.left = [...row.left, drawnCard];
    else row.right = [...row.right, drawnCard];
    
    const updates = {};
    updates[`lobbies/${lobbyId}/game/deck`] = deck;
    updates[`lobbies/${lobbyId}/game/rows/${rowIdx}`] = row;
    updates[`lobbies/${lobbyId}/game/turnStarted`] = true;
    updates[`lobbies/${lobbyId}/game/selectedSide`] = null; // Zwingt zur Neuwahl der Seite nach JEDEM Tipp

    if (correct) {
      const newStreak = gs.currentStreak + 1;
      updates[`lobbies/${lobbyId}/game/currentStreak`] = newStreak;
      toast("✅ Richtig!");
      
      if (newStreak >= 4) {
        const bonus = newStreak - 3;
        animateSipsToPool(bonus);
        updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = (gs.players[myId].sipPool || 0) + bonus;
        toast(`✅ Richtig! +${bonus} zum Verteilen`);
      }
    } else {
      const penalty = (row.left?.length || 0) + 1 + (row.right?.length || 0);
      toast(`❌ Falsch!`);
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = (gs.players[myId].sipsToDrink || 0) + penalty;
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`] = (gs.players[myId].sipsTotal || 0) + penalty;
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
      updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
      
      // Zug beenden
      updates[`lobbies/${lobbyId}/game/rows/${rowIdx}`] = { pivot: drawnCard, left: [], right: [] };
      const nextIdx = (gs.currentPlayerIndex + 1) % gs.playerOrder.length;
      updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = nextIdx;
      updates[`lobbies/${lobbyId}/game/currentStreak`] = 0;
      updates[`lobbies/${lobbyId}/game/turnStarted`] = false;
      updates[`lobbies/${lobbyId}/game/selectedRowIndex`] = -1;
      updates[`lobbies/${lobbyId}/game/selectedSide`] = null;
      
      const confirmed = {};
      gs.playerOrder.forEach(pid => { if(pid !== myId) confirmed[pid] = true; });
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = confirmed;
    }

    await update(ref(db), updates);
  } catch (e) {
    console.error("Error in handleDDChoice:", e);
    toast("Ein Fehler ist aufgetreten 🤯");
  } finally {
    isProcessing = false;
  }
};

window.passDDTurn = async () => {
  if (isProcessing || !lastGameState) return;
  isProcessing = true;
  try {
    const gs = lastGameState;
    const updates = {};

    if ((gs.players[myId]?.sipPool || 0) > 0) {
      // Wenn Schlucke im Pool sind, starte die Verteilung
      updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
      updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = gs.currentPlayerIndex;
    } else {
      // Keine Schlucke zu verteilen, gehe zum nächsten Spieler
      const nextIdx = (gs.currentPlayerIndex + 1) % gs.playerOrder.length;
      updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = nextIdx;
    }
    // Allgemeine Resets für den Zug
    updates[`lobbies/${lobbyId}/game/currentStreak`] = 0;
    updates[`lobbies/${lobbyId}/game/turnStarted`] = false;
    updates[`lobbies/${lobbyId}/game/selectedRowIndex`] = -1;
    updates[`lobbies/${lobbyId}/game/selectedSide`] = null;
    
    await update(ref(db), updates);
    toast("💰 Zug sicher beendet.");
  } catch (e) {
    console.error("Error in passDDTurn:", e);
    toast("Fehler beim Beenden des Zuges ❌");
  } finally {
    isProcessing = false;
  }
}

function renderGame(gs) {
  const area = document.getElementById('game-area');
  const phaseBadge = document.getElementById('phase-badge');
  const cpBadge = document.getElementById('current-player-badge');
  const progress = document.getElementById('round-progress');

  // Handle drinking popup für alle Spielmodi (muss vor dem return stehen!)
  manageDrinkingPopup(gs);

  // Sicherheitscheck falls phase-badge fehlt (verhindert dark screen)
  if (!phaseBadge) return; 

  if (gs.gameType === 'drunterdrueber' || gs.phase === 'playing') {
    phaseBadge.textContent = 'Drunter & Drüber';
    try {
      renderDrunterDrueber(gs, area, myId);
    } catch (error) {
      console.error("Error rendering Drunter & Drüber:", error);
      area.innerHTML = `<div class="info-box highlight-border">Ein Fehler ist aufgetreten: ${error.message}. Bitte Konsole prüfen.</div>`;
    }
    return;
  }

  // Check if everyone is ready for Round 2
  if (gs.phase === 'round2' && !gs.matchingActive && !gs.distributionActive && !gs.drinkingActive) {
    const allReady = gs.playerOrder.every(pid => gs.players[pid].readyForRound2);
    if (allReady && isHost && gs.pyramidIndex === 0) {
      // Auto-start first card reveal possible
    }
  }

  if (gs.phase === 'round1') {
    phaseBadge.textContent = 'Runde 1 – Kartenziehen';
    const order = gs.playerOrder;
    const currentId = order[gs.currentPlayerIndex];
    const currentPlayer = gs.players[currentId];
    const isMyTurn = currentId === myId;
    
    if (gs.distributionActive) {
      const giverId = order[gs.distributionGiverIndex];
      cpBadge.innerHTML = `Verteilen: <strong>${escHtml(gs.players[giverId].name)}</strong>`;
    } else {
      cpBadge.innerHTML = `Dran: <strong>${escHtml(currentPlayer.name)}</strong>`;
    }
    
    progress.textContent = `Karte ${gs.currentRoundCard + 1}/4`;
    renderRound1(gs, isMyTurn, currentPlayer, area);
  } else if (gs.phase === 'round2') {
    phaseBadge.textContent = 'Runde 2 – Pyramide';
    cpBadge.innerHTML = '';
    progress.textContent = `${gs.pyramidIndex}/${gs.pyramidSize} aufgedeckt`;
    renderRound2(gs, area);
  } else if (gs.phase === 'tiebreaker') {
    renderTiebreaker(gs, area);
  } else if (gs.phase === 'round3') {
    phaseBadge.textContent = '🚌 Der Busfahrer';
    const bus = gs.players[gs.busfahrerId];
    cpBadge.innerHTML = `Busfahrer: <strong>${escHtml(bus?.name || '?')}</strong>`;
    progress.textContent = `${gs.busStep}/4 richtig`;
    renderRound3(gs, area);
  } else if (gs.phase === 'end') {
    phaseBadge.textContent = 'Spiel vorbei';
    cpBadge.innerHTML = '';
    progress.textContent = '';
    renderEnd(gs, area);
  }
}

// ─ ROUND 1 ──────────────────────────────────────────────
function renderRound1(gs, isMyTurn, currentPlayer, area) {
  const stepLabels = ['Rot oder Schwarz?', 'Höher oder Tiefer?', 'Innen oder Außen?', 'Welches Symbol?'];
  const step = gs.currentRoundCard;
  const giverId = gs.playerOrder[gs.distributionGiverIndex];

  let html = '';

  // Distribution phase
  if (gs.distributionActive) {
    if (giverId === myId) {
      const pool = gs.players[myId].sipPool || 0;
      html += `<div class="choice-section highlight-border">
        <div class="choice-title">Schlucke verteilen! <i data-lucide="beer" class="icon-sm"></i></div>
        <div class="choice-question">Du hast noch ${pool} Schlucke</div>
        <div class="distribute-ui">
          <select id="distribute-amount" class="sip-select">
            ${Array.from({length: pool}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}
          </select>
          <div class="distribute-grid">
            ${gs.playerOrder.filter(id => id !== myId).map(id => `
              <button class="btn btn-secondary distribute-btn" data-target="${id}">${escHtml(gs.players[id].name)}</button>
            `).join('')}
          </div>
          ${pool > 0 ? `<button class="btn btn-link" onclick="skipDistribution()">Rest verfallen lassen</button>` : ''}
        </div>
      </div>`;
    } else {
      html += `<div class="info-box"><strong>${escHtml(gs.players[giverId].name)}</strong> verteilt gerade Schlucke...</div>`;
    }
  }

  // Show currently drawn cards for the player whose turn it is
  const hand = currentPlayer.hand || [];
  if (hand.length > 0 && !gs.distributionActive && !gs.drinkingActive) {
    html += `<div class="choice-section">
      <div class="choice-title">Bisherige Karten von ${escHtml(currentPlayer.name)}</div>
      <div class="cards-row">${hand.map(c => cardHTML(c)).join('')}</div>
    </div>`;
  }

  if (!gs.distributionActive && !gs.drinkingActive) {
    if (isMyTurn) {
      html += `<div class="choice-section">
        <div class="choice-title">Karte ${step + 1} von 4</div>
        <div class="choice-question">${stepLabels[step]}</div>
        <div class="choice-buttons">
          ${getChoiceButtons(step, currentPlayer.hand || [])}
        </div>
      </div>`;
    } else {
      html += `<div class="spectator-msg">
        <strong>${escHtml(currentPlayer.name)}</strong> ist dran...<br>
        <em>${stepLabels[step]}</em>
      </div>`;
    }
  }

  // Show all players hands
  html += renderAllHands(gs);

  area.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();

  if (isMyTurn && !gs.distributionActive && !gs.drinkingActive) {
    area.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => handleRound1Choice(btn.dataset.choice, gs));
    });
  }
  if (giverId === myId && gs.distributionActive) {
    area.querySelectorAll('.distribute-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amt = parseInt(document.getElementById('distribute-amount').value);
        distributeSips(btn.dataset.target, amt, gs);
      });
    });
  }
}

function getChoiceButtons(step, drawn, disabled = false) {
  const d = disabled ? 'disabled' : '';
  if (step === 0) {
    return `<button class="choice-btn" data-choice="red" ${d}><i data-lucide="circle" style="color:var(--red);fill:var(--red);"></i>Rot</button>
            <button class="choice-btn" data-choice="black" ${d}><i data-lucide="circle" style="color:#fff;fill:#000;"></i>Schwarz</button>`;
  }
  if (step === 1) {
    return `<button class="choice-btn" data-choice="higher" ${d}><i data-lucide="chevron-up"></i>Höher</button>
            <button class="choice-btn" data-choice="lower" ${d}><i data-lucide="chevron-down"></i>Tiefer</button>`;
  } else if (step === 2) {
    const lo = VALUE_ORDER[drawn[0].value];
    const hi = VALUE_ORDER[drawn[1].value];
    const [min, max] = [Math.min(lo, hi), Math.max(lo, hi)];
    return `<button class="choice-btn" data-choice="inside" ${d}><i data-lucide="minimize-2"></i>Innen</button>
            <button class="choice-btn" data-choice="outside" ${d}><i data-lucide="maximize-2"></i>Außen</button>`;
  }
  else if (step === 3) {
    return SUITS.map(s => `<button class="choice-btn" data-choice="${s}" ${d} style="flex-direction: column; gap: 4px;">
      <span style="font-size:24px; margin-bottom:4px;">${s}</span>${SUIT_NAMES[s]}
    </button>`).join('');
  }
}

async function handleRound1Choice(choice, gs) {
  if (!fbReady || isProcessing) return;
  isProcessing = true;
  try {
    const deckCopy = [...gs.deck];
    const drawnCard = deckCopy.shift();
    const player = gs.players[myId];
    if (!player) throw new Error("Spieler nicht gefunden");
    const hand = [...(player.hand || [])];
    const step = gs.currentRoundCard;
    let correct = false;

    if (step === 0) {
      correct = (choice === 'red') === isRed(drawnCard.suit);
    } else if (step === 1) {
      const prev = VALUE_ORDER[hand[0].value];
      const cur = VALUE_ORDER[drawnCard.value];
      correct = (choice === 'higher' && cur > prev) || (choice === 'lower' && cur < prev);
    } else if (step === 2) {
      const vals = hand.map(c => VALUE_ORDER[c.value]);
      const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
      const cur = VALUE_ORDER[drawnCard.value];
      if (choice === 'inside') correct = cur > lo && cur < hi;
      else correct = cur < lo || cur > hi;
    } else if (step === 3) {
      correct = choice === drawnCard.suit;
    }

    const sips = correct ? 0 : (step + 1);
    const sipPoolBonus = correct ? (step + 1) : 0;
    const newHand = [...hand, drawnCard];

    const updates = {};
    updates[`lobbies/${lobbyId}/game/deck`] = deckCopy || [];
    updates[`lobbies/${lobbyId}/game/players/${myId}/hand`] = newHand;
    
    if (!correct) {
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = (gs.players[myId].sipsToDrink || 0) + sips;
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`] = (gs.players[myId].sipsTotal || 0) + sips;
      toast(`❌ Falsch!`);
    } else {
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = (gs.players[myId].sipPool || 0) + sipPoolBonus;
      toast('✅ Richtig!');
    }

    const nextPlayerIdx = gs.currentPlayerIndex + 1;
    if (nextPlayerIdx >= gs.playerOrder.length) {
      let firstGiverIdx = -1;
      for (let i = 0; i < gs.playerOrder.length; i++) {
        const pid = gs.playerOrder[i];
        let pool = gs.players[pid].sipPool || 0;
        if (pid === myId && correct) pool += (step + 1);
        if (pool > 0) {
          firstGiverIdx = i;
          break;
        }
      }

      if (firstGiverIdx !== -1) {
        updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
        updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = firstGiverIdx;
        updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
      } else {
        // Niemand hat Schlucke zum Verteilen -> Prüfen ob jemand trinken muss
        let needsToDrink = false;
        const order = gs.playerOrder || [];
        for (const pid of order) {
          const toDrink = (gs.players[pid].sipsToDrink || 0) + (pid === myId && !correct ? (step + 1) : 0);
          if (toDrink > 0) { needsToDrink = true; break; }
        }

        if (needsToDrink) {
          updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
          updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
          
          const confirmed = {};
          order.forEach(pid => {
            const sips = (updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] !== undefined)
              ? updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`]
              : (gs.players[pid].sipsToDrink || 0);
            if (sips === 0) confirmed[pid] = true;
          });
          updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = confirmed;
        } else {
          // Keiner verteilt, keiner trinkt -> Direkt zur nächsten Karte
          const nextCard = gs.currentRoundCard + 1;
          if (nextCard >= 4) updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
          else {
            updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextCard;
            updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
          }
        }
      }
    } else {
      updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = nextPlayerIdx;
    }
    await update(ref(db), updates);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function distributeSips(targetId, amount, gs) {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const updates = {};
    const giver = gs.players[myId];
    const newPool = (giver.sipPool || 0) - amount;
    
    updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = newPool;
    updates[`lobbies/${lobbyId}/game/players/${targetId}/sipsToDrink`] = (gs.players[targetId].sipsToDrink || 0) + amount;
    updates[`lobbies/${lobbyId}/game/players/${targetId}/sipsTotal`] = (gs.players[targetId].sipsTotal || 0) + amount;

    if (newPool <= 0) {
      await checkNextDistributor(gs, updates);
    } else {
      await update(ref(db), updates);
    }
    toast(`${amount} Schlucke an ${gs.players[targetId].name} verteilt!`);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function skipDistribution() {
  if (isProcessing || !lastGameState) return;
  isProcessing = true;
  try {
    const updates = {};
    updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = 0;
    await checkNextDistributor(lastGameState, updates);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function checkNextDistributor(gs, updates) {
  let nextGiverIdx = gs.distributionGiverIndex + 1;
  while (nextGiverIdx < gs.playerOrder.length) {
    const nextPid = gs.playerOrder[nextGiverIdx];
    if ((gs.players[nextPid].sipPool || 0) > 0) {
      updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = nextGiverIdx;
      await update(ref(db), updates);
      return;
    }
    nextGiverIdx++;
  }

  // No more pool to distribute. Anyone needs to drink?
  let anyoneNeedsToDrink = false;
  for (const pid of gs.playerOrder) {
    const toDrink = updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] !== undefined 
      ? updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] 
      : (gs.players[pid].sipsToDrink || 0);
    if (toDrink > 0) { anyoneNeedsToDrink = true; break; }
  }

  updates[`lobbies/${lobbyId}/game/distributionActive`] = false;

  // Drunter & Drüber: Der Zug endet IMMER nach der Verteilung
  if (gs.gameType === 'drunterdrueber') {
    const nextIdx = (gs.currentPlayerIndex + 1) % gs.playerOrder.length;
    updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = nextIdx;
  }

  if (anyoneNeedsToDrink) {
    updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
    updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
    const confirmed = {};
    gs.playerOrder.forEach(pid => {
      const sips = updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] !== undefined 
        ? updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] 
        : (gs.players[pid].sipsToDrink || 0);
      if (sips === 0) confirmed[pid] = true;
    });
    updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = confirmed;
  } else {
    // Skip drinking phase
    if (gs.gameType !== 'drunterdrueber' && gs.phase === 'round1') {
      const nextRoundCard = gs.currentRoundCard + 1;
      if (nextRoundCard >= 4) updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
      else {
        updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextRoundCard;
        updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
      }
    } else if (gs.phase === 'round2' && gs.pyramidIndex >= gs.pyramid.length) {
      await finishRound2(gs, updates);
      return;
    }
  }
  await update(ref(db), updates);
}

async function confirmSips() {
  if (isProcessing || !lastGameState || !lobbyId) return;
  const confirmedObj = lastGameState.confirmedDrinkers || {};
  if (confirmedObj[myId]) return;

  isProcessing = true;
  try {
    const totalPlayers = lastGameState.playerOrder.length;
    
    // Wir nutzen ein lokales Objekt für die Updates, um Race Conditions zu minimieren
    const updates = {};
    updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = 0;

    // Prüfen, ob ich der Letzte bin, der bestätigt
    const currentConfirmedKeys = Object.keys(confirmedObj);
    const isLastOne = (currentConfirmedKeys.length + 1 >= totalPlayers);

    if (isLastOne) {
      // Phase beenden
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = false;
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = null; // Node löschen statt leeres Objekt
      
      if (lastGameState.phase === 'round1') {
        const nextRoundCard = lastGameState.currentRoundCard + 1;
        if (nextRoundCard >= 4) {
          updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
        } else {
          updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextRoundCard;
        }
        updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
      } else if (lastGameState.phase === 'round2' && lastGameState.pyramidIndex >= lastGameState.pyramidSize) {
        await finishRound2(lastGameState, updates);
        return;
      } else if (lastGameState.phase === 'round3') {
        updates[`lobbies/${lobbyId}/game/busCards`] = [];
        updates[`lobbies/${lobbyId}/game/busStep`] = 0;
      }

      // Führt das Update für alle Phasen aus (Runde 1, Runde 2 Zwischenschritte und Runde 3)
      await update(ref(db), updates);
    } else {
      // Nur meinen eigenen Status bestätigen
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers/${myId}`] = true;
      await update(ref(db), updates);
    }
  } catch (e) {
    console.error("ConfirmSips Error:", e);
    toast("Fehler bei der Bestätigung ❌");
  } finally {
    isProcessing = false;
  }
}
function manageDrinkingPopup(gs) {
  const modal = document.getElementById('drinking-modal');
  const mySips = gs.players[myId].sipsToDrink || 0;
  if (gs.drinkingActive && mySips > 0) {
    modal.classList.add('active');
    document.getElementById('drinking-count').textContent = mySips;
    const hasConfirmed = gs.confirmedDrinkers && gs.confirmedDrinkers[myId];
    document.getElementById('btn-confirm-drinking').style.display = hasConfirmed ? 'none' : 'block';
    document.getElementById('drinking-status-text').textContent = hasConfirmed ? 'Warte auf andere...' : 'Trink deine Schlucke!';
  } else {
    modal.classList.remove('active');
  }
}

// Hilfsfunktion zum Attachen der Handkarten-Listener
function attachHandCardListeners(gs) {
  document.querySelectorAll('.hand-card').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) matchHandCard(idx, gs);
    };
  });
}

// ─ ROUND 2 ──────────────────────────────────────────────
function renderRound2(gs, area) {
  const pyramid = gs.pyramid;
  const size = gs.pyramidSize;
  const pidx = gs.pyramidIndex;
  const matchEndTime = gs.matchEndTime || 0;
  const timeLeft = Math.max(0, Math.ceil((matchEndTime - getServerNow()) / 1000));

  // Step 1: Prep phase - players must flip cards
  if (!gs.players[myId].readyForRound2) {
    area.innerHTML = `
      <div class="choice-section">
        <div class="choice-title">Runde 2: Vorbereitung</div>
        <div class="choice-question">Präge dir deine Karten gut ein!</div>
        <div class="cards-row" style="margin-bottom: 20px">
          ${(gs.players[myId].hand || []).map(c => cardHTML(c)).join('')}
        </div>
        <button class="btn btn-primary btn-large" onclick="readyUpRound2()">Karten umdrehen & bereit</button>
      </div>
      ${renderAllHands(gs)}`;
    attachHandCardListeners(gs);
    return;
  }

  const allReady = gs.playerOrder.every(pid => gs.players[pid].readyForRound2);
  const giverId = gs.playerOrder[gs.distributionGiverIndex];

  // Build pyramid rows: 6 cards = rows of 3,2,1; 10 cards = rows of 4,3,2,1
  const rows = buildPyramidRows(size);
  let flatIdx = 0;
  let html = '';

  html += `<div class="pyramid-section">
    <div class="pyramid-title">Pyramide</div>
    <div class="pyramid-grid">`;

  let rowIndex = 0;
  for (const rowSize of rows) {
    const sips = rowIndex + 1;
    html += `<div class="sip-row-label">${sips} Schluck${sips > 1 ? 'e' : ''}</div>`;
    html += `<div class="pyramid-row">`;
    for (let i = 0; i < rowSize; i++) {
      const card = pyramid[flatIdx];
      // Schimmer auf der zuletzt aufgedeckten Karte
      const isCurrent = (flatIdx === pidx - 1 && (timeLeft > 0 || gs.distributionActive || gs.drinkingActive || (gs.matchEndTime && getServerNow() < gs.matchEndTime + 500)));
      const isDone = card.revealed || flatIdx < pidx;
      if (card.revealed) {
        html += `<div class="pyramid-card revealed ${cardColor(card.suit)} ${isCurrent ? 'current-reveal' : ''} ${flatIdx < pidx - 1 ? 'done' : ''}" data-idx="${flatIdx}">
          <span class="card-value">${card.value}</span>
          <span class="card-suit">${card.suit}</span>
          <div class="sip-badge">${sips}</div>
        </div>`;
      } else {
        html += `<div class="pyramid-card face-down" data-idx="${flatIdx}"></div>`;
      }
      flatIdx++;
    }
    html += `</div>`;
    rowIndex++;
  }
  html += `</div></div>`;

  // Distribution phase (same as R1)
  if (gs.distributionActive) {
    if (giverId === myId) {
      const pool = gs.players[myId].sipPool || 0;
      html += `<div class="choice-section highlight-border">
        <div class="choice-title">Schlucke verteilen! <i data-lucide="beer" class="icon-sm"></i></div>
        <div class="choice-question">Reihe ${getSipsForRow(pidx-1, size)}: Du hast ${pool} Schlucke</div>
        <div class="distribute-ui">
          <select id="distribute-amount" class="sip-select">
            ${Array.from({length: pool}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}
          </select>
          <div class="distribute-grid">
            ${gs.playerOrder.filter(id => id !== myId).map(id => `
              <button class="btn btn-secondary distribute-btn" data-target="${id}">${escHtml(gs.players[id].name)}</button>
            `).join('')}
          </div>
        </div>
      </div>`;
    } else {
      html += `<div class="info-box"><strong>${escHtml(gs.players[giverId].name)}</strong> verteilt gerade Schlucke...</div>`;
    }
  }

  // Current card reveal
  if (!gs.distributionActive && !gs.drinkingActive) {
    const currentCard = pyramid[pidx];
    const activeCard = pyramid[pidx - 1];
    const anyoneHasSips = Object.values(gs.players).some(p => (p.sipPool || 0) > 0);

    if (activeCard && timeLeft > 0) {
      html += `<div class="info-box highlight-border">
        Wert <strong>${activeCard.value}</strong>! Schnell antippen!<br>
        <span style="font-size:24px; color:var(--accent); font-weight:bold;" id="match-timer">${timeLeft}s</span>
      </div>`;
    } else if (activeCard && timeLeft <= 0 && anyoneHasSips) {
      if (isHost) {
        html += `<div class="choice-section">
          <div class="choice-title">Zeit abgelaufen</div>
          <div class="choice-question">Es gibt Schlucke zu verteilen!</div>
          <button class="btn btn-secondary btn-large" onclick="startPyramidDistribution()">Verteilen starten ➔</button>
        </div>`;
      } else {
        html += `<div class="info-box">Warte auf Verteilung durch Host...</div>`;
      }
    } else if (pidx < size && allReady) {
      if (isHost) {
        html += `<div class="choice-section">
          <div class="choice-title">Nächste Pyramidenkarte aufdecken</div>
          <div class="choice-question">Reihe ${getSipsForRow(pidx, size)} (${getSipsForRow(pidx, size)} Schlucke)</div>
          <div class="choice-buttons">
            <button class="btn btn-primary btn-large" id="btn-reveal-pyramid">
              <i data-lucide="eye" style="margin-right:8px"></i>Aufdecken
            </button>
          </div>
        </div>`;
      } else {
        html += `<div class="info-box">Warte auf den Host...<br><div class="loading-dots" style="margin-top:8px"><span></span><span></span><span></span></div></div>`;
      }
    } else if (pidx >= size) {
      if (isHost && gs.phase === 'round2' && timeLeft <= 0 && !anyoneHasSips) {
        html += `<div class="choice-section">
          <div class="choice-title">Pyramide beendet</div>
          <button class="btn btn-secondary btn-large" onclick="startPyramidDistribution()">Fortfahren ➔</button>
        </div>`;
      } else {
        html += `<div class="info-box">Alle Karten aufgedeckt!</div>`;
      }
    }
  }

  // All players hands
  html += renderAllHands(gs);

  area.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
  
  // Lokaler UI-Ticker
  const activeCard = pyramid[pidx - 1];
  const isTimerVisible = activeCard && timeLeft > 0 && !gs.distributionActive && !gs.drinkingActive;
  if (isTimerVisible) {
    if (matchEndTime !== window._lastMatchEndTime) {
      window._lastMatchEndTime = matchEndTime;
      if (window._matchTicker) clearInterval(window._matchTicker);
      window._matchTicker = setInterval(() => {
        const nowLeft = Math.max(0, Math.ceil((matchEndTime - getServerNow()) / 1000));
        const tEl = document.getElementById('match-timer');
        if (tEl) tEl.textContent = nowLeft + "s";
        if (nowLeft <= 0) {
          clearInterval(window._matchTicker);
          window._matchTicker = null;
          renderGame(lastGameState);
        }
      }, 250);
    }
  } else if (window._matchTicker) {
    clearInterval(window._matchTicker);
    window._matchTicker = null;
    window._lastMatchEndTime = null;
  }

  attachHandCardListeners(gs);

  if (isHost) {
    const revBtn = document.getElementById('btn-reveal-pyramid');
    if (revBtn) revBtn.addEventListener('click', () => revealPyramidCard(gs));
  }

  if (giverId === myId && gs.distributionActive) {
    setupDistributeListeners(gs);
  }
}

function renderTiebreaker(gs, area) {
  const card = gs.tiebreakerCard;
  const matchEndTime = gs.matchEndTime || 0;
  const timeLeft = Math.max(0, Math.ceil((matchEndTime - getServerNow()) / 1000));
  
  let html = `<div class="pyramid-section">
    <div class="pyramid-title">🔥 STECHEN (PHASE 2.5)</div>
    <div class="info-box" style="margin-bottom:15px">Gleichstand! Wer zuerst eine Karte loswird, rettet sich.</div>
    <div class="bus-revealed-cards">
      ${card ? cardHTML(card, false, 'revealed current-reveal') : '<div class="card face-down"></div>'}
    </div>
  </div>`;

  if (isHost && !gs.matchEndTime && !gs.distributionActive && !gs.drinkingActive) {
    html += `<div class="choice-section">
      <button class="btn btn-primary btn-large" onclick="revealTiebreakerCard()">Nächste Karte aufdecken</button>
    </div>`;
  } else if (card && timeLeft > 0 && !gs.distributionActive && !gs.drinkingActive) {
    html += `<div class="info-box highlight-border">
      Wert <strong>${card.value}</strong>! Schnell tippen!<br>
      <span style="font-size:24px; color:var(--accent); font-weight:bold;" id="match-timer">${timeLeft}s</span>
    </div>`;
  }

  html += renderAllHands(gs);
  area.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();

  // Ticker-Logik (identisch zu R2)
  if (card && timeLeft > 0 && !gs.distributionActive && !gs.drinkingActive) {
    if (matchEndTime !== window._lastMatchEndTime) {
      window._lastMatchEndTime = matchEndTime;
      if (window._matchTicker) clearInterval(window._matchTicker);
      window._matchTicker = setInterval(() => {
        const nowLeft = Math.max(0, Math.ceil((matchEndTime - getServerNow()) / 1000));
        const tEl = document.getElementById('match-timer');
        if (tEl) tEl.textContent = nowLeft + "s";
        if (nowLeft <= 0) { clearInterval(window._matchTicker); window._matchTicker = null; renderGame(lastGameState); }
      }, 250);
    }
  }

  attachHandCardListeners(gs);
}

function setupDistributeListeners(gs) {
  document.querySelectorAll('.distribute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = parseInt(document.getElementById('distribute-amount').value);
      distributeSips(btn.dataset.target, amt, gs);
    });
  });
}

function buildPyramidRows(size) {
  if (size === 6) return [3, 2, 1];
  if (size === 10) return [4, 3, 2, 1];
  return [3, 2, 1];
}

function getSipsForRow(pidx, size) {
  const rows = buildPyramidRows(size);
  let count = 0;
  for (let r = 0; r < rows.length; r++) {
    count += rows[r];
    if (pidx < count) return r + 1;
  }
  return 1;
}

async function readyUpRound2() {
  if (isProcessing) return;
  isProcessing = true;
  await update(ref(db, `lobbies/${lobbyId}/game/players/${myId}`), { readyForRound2: true });
  isProcessing = false;
}

async function matchHandCard(cardIdx, gs) {
  if ((gs.phase !== 'round2' && gs.phase !== 'tiebreaker') || isProcessing || gs.distributionActive || gs.drinkingActive) {
    return;
  }

  if (gs.matchEndTime && getServerNow() > gs.matchEndTime) {
    toast("⌛ Zu spät!");
    return;
  }

  let targetCard;
  if (gs.phase === 'round2') {
    const pidx = gs.pyramidIndex - 1;
    if (pidx < 0) return;
    targetCard = gs.pyramid[pidx];
  } else {
    targetCard = gs.tiebreakerCard;
  }
  if (!targetCard) return;

  const hand = [...(gs.players[myId].hand || [])];
  const card = hand[cardIdx];
  
  if (!card || card.locked || card.matched) return;

  isProcessing = true;
  try {
    const updates = {};
    if (card.value === targetCard.value || (card.value === '10' && targetCard.value === '10')) {
      toast("✅ Treffer! Du darfst verteilen.");
      card.matched = true;
      const sips = gs.phase === 'round2' ? getSipsForRow(gs.pyramidIndex - 1, gs.pyramidSize) : 1;
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = (gs.players[myId].sipPool || 0) + sips;
    } else {
      toast("❌ Falsch! Karte gesperrt.");
      card.locked = true;
      if (gs.phase === 'round2') {
        const sips = getSipsForRow(gs.pyramidIndex - 1, gs.pyramidSize);
        updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = (gs.players[myId].sipsToDrink || 0) + sips;
        updates[`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`] = (gs.players[myId].sipsTotal || 0) + sips;
      }
    }
    
    updates[`lobbies/${lobbyId}/game/players/${myId}/hand`] = hand;
    
    if (gs.phase === 'tiebreaker') {
      await finishRound2(gs, updates);
      return;
    }
    await update(ref(db), updates);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function startPyramidDistribution() {
  if (isProcessing || !isHost) return;
  isProcessing = true;
  try {
    const gs = lastGameState;
    const updates = {};
    
    // Prüfen, ob überhaupt jemand Schlucke zum Verteilen hat
    let firstGiverIdx = -1;
    for (let i = 0; i < gs.playerOrder.length; i++) {
      const pid = gs.playerOrder[i];
      if ((gs.players[pid].sipPool || 0) > 0) {
        firstGiverIdx = i;
        break;
      }
    }

    if (firstGiverIdx !== -1) {
      // Jemand muss verteilen -> Phase aktivieren
      updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
      updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = firstGiverIdx;
      await update(ref(db), updates);
    } else {
      await checkNextDistributor({ ...gs, distributionGiverIndex: -1 }, updates);
    }
  } catch (e) {
    console.error("Fehler beim Starten der Verteilung:", e);
  } finally {
    isProcessing = false;
  }
}

async function autoLockMissedCards(gs) {
  if (!isHost) return;
  if (hostTimerInterval) { clearTimeout(hostTimerInterval); hostTimerInterval = null; }
  
  isProcessing = true;
  try {
    const targetCard = gs.phase === 'round2' ? gs.pyramid[gs.pyramidIndex - 1] : gs.tiebreakerCard;
    const updates = {};
    updates[`lobbies/${lobbyId}/game/matchEndTime`] = null; // Timer sofort stoppen
    if (!targetCard) { isProcessing = false; return; }

    for (const pid of gs.playerOrder) {
      const hand = [...(gs.players[pid].hand || [])];
      let playerChanged = false;
      hand.forEach(card => {
        if (!card.matched && !card.locked && (card.value === targetCard.value || (card.value === '10' && targetCard.value === '10'))) {
          card.locked = true;
          playerChanged = true;
        }
      });
      if (playerChanged) {
        updates[`lobbies/${lobbyId}/game/players/${pid}/hand`] = hand;
      }
    }

    // Check if anyone has sips to distribute
    let firstGiverIdx = -1;
    for (let i = 0; i < gs.playerOrder.length; i++) {
      if ((gs.players[gs.playerOrder[i]].sipPool || 0) > 0) {
        firstGiverIdx = i; break;
      }
    }

    // Calculate sips for newly locked cards and add to updates
    for (const pid of gs.playerOrder) {
      const playerHandInUpdates = updates[`lobbies/${lobbyId}/game/players/${pid}/hand`];
      if (playerHandInUpdates) {
        // Count cards that are now locked in playerHandInUpdates but were not locked in gs.players[pid].hand
        const newlyLockedCount = playerHandInUpdates.filter(c => c.locked && !(gs.players[pid].hand || []).some(origC => origC.value === c.value && origC.suit === c.suit && origC.locked)).length;
        if (newlyLockedCount > 0) {
          const sipsPerRow = gs.phase === 'round2' ? getSipsForRow(gs.pyramidIndex - 1, gs.pyramidSize) : 1;
          const totalSips = newlyLockedCount * sipsPerRow;
          updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] = (gs.players[pid].sipsToDrink || 0) + totalSips;
          updates[`lobbies/${lobbyId}/game/players/${pid}/sipsTotal`] = (gs.players[pid].sipsTotal || 0) + totalSips;
        }
      }
    }

    if (firstGiverIdx !== -1) {
      updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
      updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = firstGiverIdx;
    } else {
      // Check if anyone needs to drink (from being locked/incorrect)
      let anyoneNeedsToDrink = gs.playerOrder.some(pid => (gs.players[pid].sipsToDrink || 0) > 0);
      if (anyoneNeedsToDrink) {
        updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
        updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
        const confirmed = {};
        gs.playerOrder.forEach(pid => {
          const sips = (updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] !== undefined)
            ? updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`]
            : (gs.players[pid].sipsToDrink || 0);
          if (sips === 0) confirmed[pid] = true;
        });
        updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = confirmed;
      } else if (gs.phase === 'tiebreaker' || gs.pyramidIndex >= gs.pyramid.length) {
        // No distribution, no drinking -> Check if round ends
        await finishRound2(gs, updates);
        return;
      }
    }
    
    await update(ref(db), updates);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function revealPyramidCard(gs) {
  const pidx = gs.pyramidIndex;
  if (pidx >= gs.pyramidSize || isProcessing || !isHost) return;
  
  isProcessing = true;
  const updates = {};

  updates[`lobbies/${lobbyId}/game/pyramid/${pidx}/revealed`] = true;
  updates[`lobbies/${lobbyId}/game/pyramidIndex`] = pidx + 1;
  updates[`lobbies/${lobbyId}/game/matchEndTime`] = getServerNow() + 10000;

  try {
    if (hostTimerInterval) clearTimeout(hostTimerInterval);
    hostTimerInterval = setTimeout(() => {
      autoLockMissedCards(lastGameState);
    }, 10000); // Exakt 10 Sekunden warten

    await update(ref(db), updates);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function revealTiebreakerCard() {
  if (!isHost || isProcessing) return;
  isProcessing = true;
  const deck = [...lastGameState.deck];
  const card = deck.shift();
  const updates = {
    [`lobbies/${lobbyId}/game/deck`]: deck,
    [`lobbies/${lobbyId}/game/tiebreakerCard`]: card,
    [`lobbies/${lobbyId}/game/matchEndTime`]: getServerNow() + 10000
  };
  
  if (hostTimerInterval) clearTimeout(hostTimerInterval);
  hostTimerInterval = setTimeout(() => autoLockMissedCards(lastGameState), 10000);
  
  await update(ref(db), updates);
  isProcessing = false;
}

async function finishRound2(gs, updates = {}) {
  const results = gs.playerOrder.map(pid => {
    const hand = updates[`lobbies/${lobbyId}/game/players/${pid}/hand`] || gs.players[pid].hand || [];
    return {
      pid,
      total: hand.filter(c => !c.matched).length,
      active: hand.filter(c => !c.matched && !c.locked).length,
      sipsTotal: updates[`lobbies/${lobbyId}/game/players/${pid}/sipsTotal`] || gs.players[pid].sipsTotal || 0
    };
  });

  const maxCards = Math.max(...results.map(r => r.total));
  const candidates = results.filter(r => r.total === maxCards);

  if (candidates.length === 1 || maxCards === 0) {
    let busfahrerId;
    if (maxCards === 0) {
      busfahrerId = results.reduce((a, b) => b.sipsTotal > a.sipsTotal ? b : a).pid;
    } else {
      busfahrerId = candidates[0].pid;
    }
    updates[`lobbies/${lobbyId}/game/busfahrerId`] = busfahrerId;
    updates[`lobbies/${lobbyId}/game/phase`] = 'round3';
    updates[`lobbies/${lobbyId}/game/busStep`] = 0;
    updates[`lobbies/${lobbyId}/game/busCards`] = [];
    updates[`lobbies/${lobbyId}/game/busRestarts`] = 0;
    updates[`lobbies/${lobbyId}/game/deck`] = makeDeck();
    
    toast(`🚌 ${gs.players[busfahrerId].name} ist der Busfahrer!`, 5000);
    await update(ref(db), updates);
  } else {
    // TIE! Check for auto-loser (max cards but 0 active cards)
    const autoLoser = candidates.find(c => c.active === 0);
    if (autoLoser) {
      updates[`lobbies/${lobbyId}/game/busfahrerId`] = autoLoser.pid;
      updates[`lobbies/${lobbyId}/game/phase`] = 'round3';
      await update(ref(db), updates);
    } else if (gs.phase !== 'tiebreaker') {
      updates[`lobbies/${lobbyId}/game/phase`] = 'tiebreaker';
      updates[`lobbies/${lobbyId}/game/tiebreakerCard`] = null;
      updates[`lobbies/${lobbyId}/game/matchEndTime`] = null;
      await update(ref(db), updates);
    } else {
      // Already in tiebreaker, just sync updates
      await update(ref(db), updates);
    }
  }
}

// ─ ROUND 3 (Busfahrer) ──────────────────────────────────
function renderRound3(gs, area) {
  const isMainBus = gs.busfahrerId === myId;
  const guestId = gs.guestDriverId;
  const isGuestBus = guestId === myId;
  const isDriving = isGuestBus || (isMainBus && !guestId);

  const busPlayer = gs.players[gs.busfahrerId];
  const busCards = gs.busCards || [];
  const busStep = gs.busStep;

  const stepLabels = ['Rot oder Schwarz?', 'Höher oder Tiefer?', 'Innen oder Außen?', '♥♦♠♣ Welches Symbol?'];
  const stepIcons = ['palette', 'bar-chart-2', 'arrows-up-from-line', 'spade'];

  let html = `<div class="bus-section">
    <div class="bus-title">🚌 BUSFAHRER</div>
    <div class="bus-subtitle">${escHtml(busPlayer.name)} muss 4 Karten in Folge richtig erraten!</div>
    <div class="bus-progress">`;

  for (let i = 0; i < 4; i++) {
    let cls = '';
    if (i < busStep) cls = 'done';
    else if (i === busStep) cls = 'current';
    html += `<div class="bus-step ${cls}">${i < busStep ? '<i data-lucide="check" style="width:18px;height:18px;"></i>' : `<i data-lucide="${stepIcons[i]}" style="width:18px;height:18px;"></i>`}</div>`;
  }
  html += `</div>`;

  // Revealed cards
  html += `<div class="bus-revealed-cards">`;
  if (busCards.length === 0) {
    html += `<div style="color:var(--text-dim);font-size:14px">Noch keine Karten aufgedeckt</div>`;
  } else {
    html += busCards.map(c => cardHTML(c)).join('');
  }
  html += `</div>`;

  if (busStep < 4) {
    // Anfrage-Logik anzeigen
    if (gs.takeOverRequest && isMainBus && !gs.guestDriverId && !gs.pendingGuestDriverId) {
      const requester = gs.players[gs.takeOverRequest];
      html += `<div class="choice-section highlight-border" style="margin-bottom:15px">
        <div class="choice-title"><i data-lucide="handshake" style="margin-right:8px;"></i>Anfrage erhalten</div>
        <div class="choice-question" style="font-size:18px">${escHtml(requester.name)} möchte eine Runde für dich fahren!</div>
        <div class="choice-buttons">
          <button class="btn btn-primary btn-with-icon" onclick="respondToBusTakeOver(true)">Annehmen <i data-lucide="check"></i></button>
          <button class="btn btn-secondary" onclick="respondToBusTakeOver(false)">Ablehnen</button>
        </div>
      </div>`;
    } else if (gs.takeOverRequest && !isMainBus && !gs.guestDriverId && !gs.pendingGuestDriverId) {
      html += `<div class="info-box" style="margin-bottom:15px">Anfrage gesendet. Warte auf Bestätigung...</div>`;
    } else if (gs.pendingGuestDriverId) {
      const pPlayer = gs.players[gs.pendingGuestDriverId];
      html += `<div class="info-box" style="margin-bottom:15px"><i data-lucide="timer"></i> <strong>${escHtml(pPlayer.name)}</strong> übernimmt nach dem nächsten Fehler!</div>`;
    } else if (guestId) {
      const gPlayer = gs.players[guestId];
      html += `<div class="info-box highlight-border" style="margin-bottom:15px"><i data-lucide="star" style="color:var(--accent);"></i> <strong>${escHtml(gPlayer.name)}</strong> fährt diese Runde!</div>`;
    } else if (!isMainBus && !gs.takeOverRequest && !gs.guestDriverId && !gs.pendingGuestDriverId && !gs.drinkingActive) {
      html += `<button class="btn btn-secondary btn-large btn-with-icon" style="margin-bottom:15px" onclick="requestBusTakeOver()"><i data-lucide="hand" style="margin-right:8px;"></i>Steuer für eine Runde übernehmen</button>`;
    }

    html += `<div class="choice-title">${stepLabels[busStep]}</div>
      <div class="choice-buttons" style="margin-top:12px">
        ${getBusChoiceButtons(busStep, busCards, !isDriving || gs.drinkingActive)}
      </div>`;

    if (!isDriving && !gs.drinkingActive) {
      const activeName = guestId ? gs.players[guestId].name : busPlayer.name;
      html += `<div class="spectator-msg">
        <strong>${escHtml(activeName)}</strong> ist am Steuer...
        <div style="margin-top:16px"><div class="loading-dots"><span></span><span></span><span></span></div></div>
      </div>`;
    }
  }

  if (gs.busRestarts > 0) {
    html += `<div class="info-box" style="margin-top:12px">Neustart #${gs.busRestarts} <i data-lucide="rotate-ccw"></i></div>`;
  }

  html += `</div>`;

  area.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();

  if (isDriving && busStep < 4 && !gs.drinkingActive) {
    area.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => handleBusChoice(btn.dataset.choice, gs));
    });
  }
}

function getBusChoiceButtons(step, drawn, disabled = false) {
  return getChoiceButtons(step, drawn, disabled);
}

async function requestBusTakeOver() {
  if (!fbReady || isProcessing) return;
  isProcessing = true;
  try {
    await update(ref(db, `lobbies/${lobbyId}/game`), { takeOverRequest: myId });
  } catch (e) {
    console.error("Fehler bei Übernahme-Anfrage:", e);
  } finally {
    isProcessing = false;
  }
}

async function respondToBusTakeOver(accepted) {
  if (!fbReady || isProcessing) return;
  isProcessing = true;
  try {
    const requesterId = lastGameState?.takeOverRequest;
    const updates = {
      [`lobbies/${lobbyId}/game/takeOverRequest`]: null
    };
    if (accepted && requesterId) {
      // In die Warteschlange setzen
      updates[`lobbies/${lobbyId}/game/pendingGuestDriverId`] = requesterId;
      const nextName = lastGameState.players[requesterId]?.name || 'Jemand';
      toast(`🤝 ${nextName} übernimmt nach dem nächsten Fehler!`);
    }
    await update(ref(db), updates);
    if (!accepted) toast("Anfrage abgelehnt ✋");
  } catch (e) {
    console.error("Fehler bei Übernahme-Antwort:", e);
  } finally {
    isProcessing = false;
  }
}


async function handleBusChoice(choice, gs) {
  if (!fbReady || isProcessing) return;

  const isMainBus = gs.busfahrerId === myId;
  const isGuestBus = gs.guestDriverId === myId;
  const isDriving = isGuestBus || (isMainBus && !gs.guestDriverId);
  if (!isDriving) return;

  isProcessing = true;
  try {
    const busCards = [...(gs.busCards || [])];
    let deckCopy = gs.deck ? [...gs.deck] : [];

    if (deckCopy.length === 0) deckCopy = makeDeck();
    const drawnCard = deckCopy.shift();

    const step = gs.busStep;
    let correct = false;

    if (step === 0) {
      correct = (choice === 'red') === isRed(drawnCard.suit);
    } else if (step === 1) {
      const prev = VALUE_ORDER[busCards[0].value];
      const cur = VALUE_ORDER[drawnCard.value];
      correct = (choice === 'higher' && cur > prev) || (choice === 'lower' && cur < prev);
    } else if (step === 2) {
      const vals = busCards.map(c => VALUE_ORDER[c.value]);
      const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
      const cur = VALUE_ORDER[drawnCard.value];
      if (choice === 'inside') correct = cur > lo && cur < hi;
      else correct = cur < lo || cur > hi;
    } else if (step === 3) {
      correct = choice === drawnCard.suit;
    }

    const newBusCards = [...busCards, drawnCard];
    const sips = step + 1;

    if (correct) {
      if (step === 3) {
        // Sieg!
        await update(ref(db), {
          [`lobbies/${lobbyId}/game/deck`]: deckCopy,
          [`lobbies/${lobbyId}/game/busCards`]: newBusCards,
          [`lobbies/${lobbyId}/game/busStep`]: 4,
          [`lobbies/${lobbyId}/game/phase`]: 'end',
          [`lobbies/${lobbyId}/game/guestDriverId`]: null,
          [`lobbies/${lobbyId}/game/pendingGuestDriverId`]: null,
          [`lobbies/${lobbyId}/game/takeOverRequest`]: null
        });
        toast('🎉 Busfahrer geschafft! Spiel beendet!', 4000);
      } else {
        const updates = {
          [`lobbies/${lobbyId}/game/deck`]: deckCopy,
          [`lobbies/${lobbyId}/game/busCards`]: newBusCards,
          [`lobbies/${lobbyId}/game/busStep`]: step + 1,
          [`lobbies/${lobbyId}/game/takeOverRequest`]: null,
          // Gastfahrer-Zustand bleibt wie er ist (Gast fährt weiter oder Hauptfahrer fährt weiter)
        };
        await update(ref(db), updates);
        toast('✅ Richtig! Weiter...');
      }
    } else {
      // 1. Erstmal nur die Karte aufdecken, damit alle sie sehen
      await update(ref(db), {
        [`lobbies/${lobbyId}/game/deck`]: deckCopy,
        [`lobbies/${lobbyId}/game/busCards`]: newBusCards
      });

      // 2. Kurze Pause (1.5 Sekunden)
      await new Promise(r => setTimeout(r, 1000));

      // 3. Jetzt erst das Trinken und den Rest triggern
      const sipsToDrink = (gs.players[myId]?.sipsToDrink || 0) + sips;
      const sipsTotal = (gs.players[myId]?.sipsTotal || 0) + sips;
      const confirmed = {};
      Object.keys(gs.players || {}).forEach(pid => { if(pid !== myId) confirmed[pid] = true; });

      const updates = {
        [`lobbies/${lobbyId}/game/busRestarts`]: (gs.busRestarts || 0) + 1,
        [`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`]: sipsToDrink,
        [`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`]: sipsTotal,
        [`lobbies/${lobbyId}/game/drinkingActive`]: true,
        [`lobbies/${lobbyId}/game/drinkingStartTime`]: getServerNow(),
        [`lobbies/${lobbyId}/game/confirmedDrinkers`]: confirmed,
        [`lobbies/${lobbyId}/game/takeOverRequest`]: null,
        [`lobbies/${lobbyId}/game/guestDriverId`]: null 
      };

      // Logik für den Wechsel:
      if (gs.pendingGuestDriverId) {
        // Wenn jemand gewartet hat, übernimmt er JETZT für den Neustart
        updates[`lobbies/${lobbyId}/game/guestDriverId`] = gs.pendingGuestDriverId;
        updates[`lobbies/${lobbyId}/game/pendingGuestDriverId`] = null;
        const nextName = gs.players[gs.pendingGuestDriverId]?.name || 'Jemand';
        toast(`🤝 ${nextName} übernimmt jetzt das Steuer!`);
      }
      
      toast(`❌ Falsch!`, 4000);
      await update(ref(db), updates);
    }
  } catch (e) {
    console.error("Fehler in handleBusChoice:", e);
    toast("Da ist etwas schiefgelaufen 🤯");
  } finally {
    isProcessing = false;
  }
}


// ─ END SCREEN ──────────────────────────────────────────────
function renderEnd(gs, area) {
  const players = gs.playerOrder.map(pid => ({
    ...gs.players[pid],
    sips: gs.players[pid].sipsTotal || 0
  })).sort((a, b) => a.sips - b.sips);

  const busPlayer = gs.players[gs.busfahrerId];
  let html = `<div class="end-section">
    <div class="end-title">FERTIG!</div>
    <div class="end-subtitle">🚌 ${escHtml(busPlayer?.name || '?')} hat den Bus erfolgreich gefahren!</div>
    <div class="end-rankings">`;

  players.forEach((p, i) => {
    html += `<div class="rank-row">
      <div class="rank-num ${i === 0 ? 'first' : ''}">${i === 0 ? '<i data-lucide="trophy"></i>' : i + 1}</div>
      <div class="rank-name">${escHtml(p.name)} ${p.id === myId ? '<em style="color:var(--text-muted);font-size:13px">(du)</em>' : ''}</div>
      <div class="rank-info">${p.sips} Schlucke getrunken</div>
    </div>`;
  });

  html += `</div>`;

  if (isHost) {
    html += `<button class="btn btn-primary btn-large" id="btn-play-again">Nochmal spielen 🔄</button>`;
    html += `<br><br>`;
  }
  html += `<button class="btn btn-secondary btn-large" id="btn-back-home" style="margin-top:10px">Zurück zur Lobby</button>`;
  html += `</div>`;

  area.innerHTML = html;

  if (isHost) {
    document.getElementById('btn-play-again')?.addEventListener('click', async () => {
      await remove(ref(db, `lobbies/${lobbyId}/game`));
      await update(ref(db, `lobbies/${lobbyId}`), { status: 'waiting' });
      if (gameListener) { gameListener(); gameListener = null; }
      enterLobbyScreen();
    });
  }

  document.getElementById('btn-back-home')?.addEventListener('click', async () => {
    if (gameListener) { gameListener(); gameListener = null; }
    await leaveLobby();
  });
}

// ─ HELPERS ─────────────────────────────────────────────────
function renderAllHands(gs) {
  // Hide hands in Round 1 until someone actually has a hand
  const handsStarted = Object.values(gs.players).some(p => p.hand && p.hand.length > 0);
  if (!handsStarted && gs.phase === 'round1') return '';

  let html = `<div class="players-hands">
    <div class="section-title">Karten auf der Hand</div>`;
  
  // Eigene ID an den Anfang der Liste setzen
  const sortedPlayerOrder = [...gs.playerOrder].sort((a, b) => {
    if (a === myId) return -1;
    if (b === myId) return 1;
    return 0;
  });

  for (const pid of sortedPlayerOrder) {
    const p = gs.players[pid];
    const hand = p.hand || [];
    const isMe = pid === myId;
    const toDrink = p.sipsToDrink || 0;

    html += `<div class="player-hand-row">
      <div class="player-hand-name">${escHtml(p.name)}${isMe ? ' <i data-lucide="user" class="icon-sm" style="opacity:0.5"></i>' : ''}</div>
      <div class="player-hand-cards">
        ${
          hand.length === 0
            ? `<span style="font-size:13px;color:var(--text-dim)">keine</span>`
            : hand
                .map((c, idx) => {
                  const isFaceDown = gs.phase === 'round2' && p.readyForRound2;
                  let extra = isMe ? 'hand-card' : '';
                  if (c.matched) extra += ' matched';
                  if (c.locked) extra += ' locked';
                  const displayCard = isFaceDown && !c.matched && !c.locked ? null : c;
                  return cardHTML(displayCard, true, extra, idx);
                })
                .join('')
        }
      </div><div class="player-sip-status">
        ${toDrink > 0 ? `<div class="sip-count-badge"><i data-lucide="beer" style="width:12px;height:12px;margin-right:2px;"></i> ${toDrink}</div>` : ''}
      </div>
    </div>`;
  }
  html += `</div>`;
  return html;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─ Pyramid size sync for non-host ──────────────────────────
// Already handled in enterLobbyScreen

window.confirmSips = confirmSips;
window.leaveLobby = leaveLobby;
window.skipDistribution = skipDistribution;
window.readyUpRound2 = readyUpRound2;
window.startPyramidDistribution = startPyramidDistribution;
window.revealPyramidCard = revealPyramidCard;
window.revealTiebreakerCard = revealTiebreakerCard;
window.requestBusTakeOver = requestBusTakeOver;
window.respondToBusTakeOver = respondToBusTakeOver;
window.distributeSips = distributeSips;
window.showQRCode = showQRCode;
