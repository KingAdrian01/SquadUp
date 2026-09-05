import { renderDrunterDrueber, initDDGame, checkDDCorrect } from './dd-logic.js';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { inject } from '@vercel/analytics';
import {
  SUITS, SUIT_NAMES, VALUES, VALUE_ORDER,
  isRed, cardColor, makeDeck, shuffle, cardHTML,
  evaluateRound1Choice, getChoiceButtons, manageDrinkingPopup,
  attachHandCardListeners, renderRound2, renderTiebreaker, setupDistributeListeners,
  buildPyramidRows, getSipsForRow, renderRound3, getBusChoiceButtons, renderEnd,
  renderAllHands, renderOtherHands, escHtml, renderRound1
} from './busfahrer.js';
import { state } from './state.js';
import { renderPferderennen, cleanupPferderennen } from './pferderennen.js';
import { renderFtd, cleanupFtd } from './ftd.js';

const PLAYER_DISCONNECT_TIMEOUT_MS = 120 * 1000;
const APP_VERSION = '2.2.5';


// ── Firebase Zeug ──────────────────────────────────────────
let db, ref, set, get, push, onValue, update, remove, onDisconnect;
let fbReady = false;

// Zeit-Synchronisation
let serverOffset = 0;
export function getServerNow() {
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
  let m = window._firebaseModules;
  let retries = 0;
  while (!m && retries < 50) {
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
state.myId = myId;

let lobbyId = null;

// Automatische Kopplung für isHost
let _isHost = false;
Object.defineProperty(window, 'isHost', {
  get() { return _isHost; },
  set(val) {
    _isHost = val;
    state.isHost = val; // Synchronisiert sich sofort automatisch!
  }
});

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

  if (target.classList.contains('active')) {
    hideAllModals();
    target.scrollTop = 0;
    window.scrollTo(0, 0);
    return;
  }

  hideAllModals();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');

  // Stets direkt ganz oben am Anfang der Seite landen
  target.scrollTop = 0;
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;

  if (id !== 'game') {
    cleanupPferderennen();
    cleanupFtd();
  }
}

// ── Toast ─────────────────────────────────────────────────
export function toast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Lobby Code Gen ────────────────────────────────────────
function genCode() {
  const chars = '1234567890';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── INIT ──────────────────────────────────────────────────
async function initApp() {
  const updateTriggered = await checkVersion();
  if (updateTriggered) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) statusEl.textContent = "Update wird geladen...";
    return;
  }

  try {
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
    initFirebase(myConfig).then(() => {
      const modal = document.getElementById('firebase-modal');
      if (modal) modal.classList.remove('active');

      if (statusEl) {
        statusEl.textContent = "Bereit";
        statusEl.classList.remove('connecting');
        statusEl.classList.add('ready');

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
      if (versionInUrl !== data.version) {
        console.log(`Update gefunden: ${APP_VERSION} -> ${data.version}`);
        window.location.replace(window.location.pathname + '?v=' + data.version);
        return true;
      }
    }

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
  if (document.body.dataset.uiReady === 'true') return;

  showScreen('home');

  const savedName = localStorage.getItem('bf_name');
  if (savedName) document.getElementById('input-name').value = savedName;

  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get('join');
  if (joinCode) {
    const codeInput = document.getElementById('input-code');
    const nameInput = document.getElementById('input-name');
    const createBtn = document.getElementById('btn-create');
    const divider = document.querySelector('.divider');
    const joinBtn = document.getElementById('btn-join');

    codeInput.value = joinCode.toUpperCase();

    if (createBtn) createBtn.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (codeInput) codeInput.style.display = 'none';
    if (joinBtn) {
      joinBtn.textContent = "Lobby beitreten";
      joinBtn.classList.add('btn-primary', 'btn-large');
    }

    window.history.replaceState({}, document.title, window.location.pathname);

    if (nameInput.value) {
      const checkReady = setInterval(() => {
        if (fbReady) { clearInterval(checkReady); joinLobby(); }
      }, 100);
    } else {
      nameInput.focus();
      toast("Gib deinen Namen ein, um beizutreten! 👋");
    }
  }

  // --- Custom Mode Switcher Logicks ---
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

  document.querySelectorAll('#mode-segmented-lobby .segment-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (lobbyId && !isHost) {
        toast("Nur der Host kann den Modus ändern 👑");
        return;
      }
      const mode = btn.dataset.mode;
      if (lobbyId && isHost) {
        await update(ref(db, `lobbies/${lobbyId}`), { gameType: mode });
      } else {
        selectedGameMode = mode;
        updateModeSwitcherUI(mode);
      }
    });
  });

  initModeCarousel();

  initCustomSelect('mode-select-game');

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

export function updateModeCarouselMask() {
  const container = document.getElementById('mode-segmented-lobby');
  const dots = document.querySelectorAll('#mode-pagination-dots .mode-dot');
  if (!container) return;

  // Wenn der Container noch nicht gerendert ist (z. B. screen noch versteckt):
  // Behalte Standard-Maske (nur rechts Fade, links 100% deckend) bei
  if (container.clientWidth === 0) {
    container.classList.remove('mask-none', 'mask-left', 'mask-both');
    container.classList.add('mask-right');
    const mask = 'linear-gradient(to right, black calc(100% - 32px), transparent 100%)';
    container.style.maskImage = mask;
    container.style.webkitMaskImage = mask;
    return;
  }

  const maxScroll = container.scrollWidth - container.clientWidth;
  if (maxScroll <= 5) {
    if (dots.length) dots.forEach((d, i) => d.classList.toggle('active', i === 0));
    container.classList.remove('mask-right', 'mask-left', 'mask-both');
    container.classList.add('mask-none');
    container.style.maskImage = 'none';
    container.style.webkitMaskImage = 'none';
    return;
  }

  const sl = container.scrollLeft;
  // Bei 2 Dots: Dot 0 (Seite 1: Busfahrer / Drunter/Drüber), Dot 1 (Seite 2: Pferderennen / FTD)
  if (dots.length) {
    const activeIndex = (sl < maxScroll / 2) ? 0 : 1;
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeIndex);
    });
  }

  // Dynamische Kanten-Maske (mask-image) je nach Scroll-Position
  container.classList.remove('mask-none', 'mask-right', 'mask-left', 'mask-both');
  if (sl <= 5) {
    // Seite 1 (ganz links / scrollLeft <= 5): Links absolut KEIN Fade (100% sichtbar), Fade nur rechts
    container.classList.add('mask-right');
    const mask = 'linear-gradient(to right, black calc(100% - 32px), transparent 100%)';
    container.style.maskImage = mask;
    container.style.webkitMaskImage = mask;
  } else if (sl >= maxScroll - 5) {
    // Seite 2 (ganz rechts / am Ende angekommen): Rechts kein Fade, Fade nur links
    container.classList.add('mask-left');
    const mask = 'linear-gradient(to right, transparent 0%, black 32px)';
    container.style.maskImage = mask;
    container.style.webkitMaskImage = mask;
  } else {
    // Dazwischen (während des Scrollens): Beidseitiger Fade
    container.classList.add('mask-both');
    const mask = 'linear-gradient(to right, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)';
    container.style.maskImage = mask;
    container.style.webkitMaskImage = mask;
  }
}

function initModeCarousel() {
  const container = document.getElementById('mode-segmented-lobby');
  const dots = document.querySelectorAll('#mode-pagination-dots .mode-dot');
  if (!container) return;

  container.addEventListener('scroll', updateModeCarouselMask, { passive: true });
  window.addEventListener('resize', updateModeCarouselMask);

  dots.forEach((dot, idx) => {
    dot.addEventListener('click', () => {
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll <= 0) return;
      const targetScroll = idx === 0 ? 0 : maxScroll;
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    });
  });

  // Masken-Update direkt nach der Initialisierung aufrufen
  updateModeCarouselMask();
  setTimeout(updateModeCarouselMask, 50);
}

function updateModeSwitcherUI(mode) {
  const container = document.getElementById('mode-segmented-lobby');
  const buttons = document.querySelectorAll('#mode-segmented-lobby .segment-btn');
  buttons.forEach((btn, idx) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    if (isActive && container && container.clientWidth > 0) {
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll > 0) {
        if (idx === 0) {
          container.scrollTo({ left: 0, behavior: 'smooth' });
        } else if (idx === buttons.length - 1) {
          container.scrollTo({ left: maxScroll, behavior: 'smooth' });
        } else {
          const btnLeft = btn.offsetLeft;
          const btnWidth = btn.offsetWidth;
          const containerWidth = container.clientWidth;
          const targetLeft = btnLeft - (containerWidth / 2) + (btnWidth / 2);
          container.scrollTo({ left: Math.max(0, Math.min(maxScroll, targetLeft)), behavior: 'smooth' });
        }
      }
    }
  });
  updateModeCarouselMask();
}

function updateCustomSelectUI(mode) {
  const containers = ['mode-select-lobby', 'mode-select-game'];
  const labelMap = { busfahrer: 'Busfahrer', drunterdrueber: 'Drunter/Drüber', pferderennen: '🐎 Pferderennen', ftd: 'FckTheD' };
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const label = labelMap[mode] || mode;
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

  onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).update({ disconnected: true, lastSeen: getServerNow() });

  enterLobbyScreen();
}

// ── JOIN LOBBY ─────────────────────────────────────────────
async function joinLobby(reconnectCode = null) {
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

function updateStartGameButtonUI(btn, mode) {
  if (!btn) return;
  if (mode === 'drunterdrueber') {
    btn.innerHTML = `Spiel starten <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-up" style="vertical-align: middle; margin-right: 6px;"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>`;
  } else if (mode === 'ftd') {
    btn.innerHTML = `Spiel starten <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-playing-cards-fan" style="vertical-align: middle; margin-right: 6px;"><path d="M12.65 7.65a2 2 0 012.629-1.046l5.51 2.374a2 2 0 011.046 2.628l-3.957 9.184a2 2 0 01-2.628 1.046l-5.51-2.374a2 2 0 01-1.046-2.628z"/><path d="M18 7.777V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v10a2 2 0 001.137 1.805"/><path d="m8 4.389-4.364.809a2 2 0 00-1.602 2.33l1.822 9.833a2 2 0 002.331 1.602l2.542-.47"/></svg>`;
  } else {
    const _e = { busfahrer: '🚌', pferderennen: '🐎' };
    btn.textContent = `Spiel starten ${_e[mode] || '🎮'}`;
  }
}

// ── LOBBY SCREEN ──────────────────────────────────────────
function enterLobbyScreen() {
  showScreen('lobby');
  document.getElementById('lobby-code-display').textContent = lobbyId;
  if (window.lucide) window.lucide.createIcons();
  update(ref(db, `lobbies/${lobbyId}/players/${myId}`), { disconnected: false, lastSeen: getServerNow() });

  const modeSegmented = document.getElementById('mode-segmented-lobby');
  if (modeSegmented) modeSegmented.classList.toggle('disabled', !isHost);
  updateModeSwitcherUI(selectedGameMode);
  updateModeCarouselMask();
  setTimeout(() => {
    updateModeSwitcherUI(selectedGameMode);
    updateModeCarouselMask();
  }, 60);

  document.getElementById('lobby-code-display').onclick = () => {
    navigator.clipboard?.writeText(lobbyId).then(() => toast('Code kopiert! ' + lobbyId));
  };

  document.getElementById('btn-leave-lobby').onclick = leaveLobby;

  // Listen for mode changes in Lobby
  const typeRef = ref(db, `lobbies/${lobbyId}/gameType`);
  const unsubType = onValue(typeRef, snap => {
    if (snap.exists()) {
      selectedGameMode = snap.val();
      updateModeSwitcherUI(selectedGameMode);

      const pyramidSel = document.getElementById('pyramid-selector');
      if (pyramidSel) {
        pyramidSel.style.display = (isHost && selectedGameMode === 'busfahrer') ? '' : 'none';
      }

      // UI Update für Start-Button
      const startBtn = document.getElementById('btn-start-game');
      if (isHost && startBtn) {
        updateStartGameButtonUI(startBtn, selectedGameMode);
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

  // Entferne alte Event-Listener sicherheitshalber (durch Klonen), um doppelte Klicks zu vermeiden
  const newStartBtn = startBtn.cloneNode(true);
  startBtn.parentNode.replaceChild(newStartBtn, startBtn);

  if (isHost) {
    newStartBtn.style.display = ''; // Zeige Button
    waitingMsg.style.display = 'none';
    updateStartGameButtonUI(newStartBtn, selectedGameMode);
    newStartBtn.addEventListener('click', startGame);
  } else {
    newStartBtn.style.display = 'none'; // Zwingend verstecken
    waitingMsg.style.display = '';
    waitingMsg.textContent = 'Warte, bis der Host das Spiel startet...';
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

      if (isHost && (game.phase === 'round2' || game.phase === 'tiebreaker') &&
        game.matchEndTime && getServerNow() > game.matchEndTime) {
        autoLockMissedCards(game);
      }

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
  const countEl = document.getElementById('player-count-display');
  if (countEl) countEl.textContent = Object.keys(players).length;
  const list = document.getElementById('player-list');
  const sorted = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt);
  list.innerHTML = sorted.map((p, idx) => {
    const isMe = p.id === myId;
    const isH = p.host;
    const isOffline = p.disconnected;
    const emoji = ['⭐', '🌟', '✨', '⚡', '🔥', '💎'][idx % 6];
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

    onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).cancel();

    if (pids.length <= 1) {
      await remove(ref(db, `lobbies/${lobbyId}`));
    } else {
      await remove(ref(db, `lobbies/${lobbyId}/players/${myId}`));
    }
  }
  lobbyId = null; isHost = false;
  showScreen('home');
}

// ── START GAME (host only) ─────────────────────────────────
async function startGame() {
  if (!isHost) {
    toast('Nur der Host kann das Spiel starten.');
    return;
  }

  const snap = await get(ref(db, `lobbies/${lobbyId}/players`));
  const playersObj = snap.val() || {};
  const players = Object.values(playersObj).sort((a, b) => a.joinedAt - b.joinedAt);
  if (players.length < 2) { toast('Mindestens 2 Spieler benötigt'); return; }

  const deck = makeDeck();
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

  if (selectedGameMode === 'pferderennen') {
    const deck = makeDeck();

    // 5 Hinderniskarten für die Felder 2 bis 7 ziehen
    const obstacles = {};
    for (let i = 2; i <= 8; i++) {
      const card = deck.shift();
      obstacles[i] = {
        card: card,
        revealed: false
      };
    }

    const pferdeState = {
      gameType: 'pferderennen',
      phase: 'pferderennen',
      hostId: myId,
      drawnCardsHistory: [],
      players: playerStates,
      playerOrder: players.map(p => p.id),
      deck: deck,
      horses: {
        '♥': 1,
        '♦': 1,
        '♠': 1,
        '♣': 1
      },
      obstacles: obstacles,
      bets: {},
      betStartTime: getServerNow()
    };
    await set(ref(db, `lobbies/${lobbyId}/game`), pferdeState);
    return;
  }

  if (selectedGameMode === 'ftd') {
    const ftdDeck = makeDeck();
    const ftdState = initFtdGame(players, ftdDeck);
    await set(ref(db, `lobbies/${lobbyId}/game`), ftdState);
    return;
  }

  const lobbyUpdate = {};
  lobbyUpdate[`lobbies/${lobbyId}/status`] = 'playing';
  await update(ref(db), lobbyUpdate);

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
    round1Responses: {},
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
export let gameListener = null;
export let lastGameState = null;

function enterGameScreen() {
  showScreen('game');

  const screen = document.getElementById('screen-game');
  if (screen) screen.scrollTop = 0;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    if (screen) screen.scrollTop = 0;
    window.scrollTo(0, 0);
  });

  const modeContainer = document.getElementById('mode-select-game');
  if (modeContainer) modeContainer.classList.add('disabled');

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

    if (isHost && (gs.phase === 'round2' || gs.phase === 'tiebreaker')) {
      const now = getServerNow();
      if (gs.matchEndTime && now < gs.matchEndTime && !hostTimerInterval) {
        const delay = (gs.matchEndTime - now) + 500;
        hostTimerInterval = setTimeout(() => autoLockMissedCards(lastGameState), delay);
      }
    }

    renderGame(gs);

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

    // Sicherstellen, dass das Deck existiert und nicht leer ist
    let deck = [...(gs.deck || [])];
    if (deck.length === 0) {
      deck = makeDeck(); // Generiert ein neues Deck, falls keines mehr da ist
    }

    const drawnCard = deck.shift();
    if (!drawnCard) {
      toast("Keine Karten mehr im Deck! ❌");
      isProcessing = false;
      return;
    }

    const row = { ...(gs.rows[rowIdx] || { left: [], right: [], pivot: null }) };
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
    updates[`lobbies/${lobbyId}/game/selectedSide`] = null;

    // ... (dein restlicher Code für richtig/falsch bleibt exakt gleich unten drunter)

    if (correct) {
      const newStreak = gs.currentStreak + 1;
      updates[`lobbies/${lobbyId}/game/currentStreak`] = newStreak;

      if (newStreak >= 4) {
        animateSipsToPool(1);
        updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = (gs.players[myId].sipPool || 0) + 1;
      }
    } else {
      const penalty = (row.left?.length || 0) + 1 + (row.right?.length || 0);
      toast(`❌ Falsch!`);
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = (gs.players[myId].sipsToDrink || 0) + penalty;
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`] = (gs.players[myId].sipsTotal || 0) + penalty;
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
      updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();

      // Reihe zurücksetzen, Streak zurücksetzen & Strafe verteilen, aber Spieler NICHT wechseln
      updates[`lobbies/${lobbyId}/game/rows/${rowIdx}`] = { pivot: drawnCard, left: [], right: [] };
      updates[`lobbies/${lobbyId}/game/currentStreak`] = 0;
      updates[`lobbies/${lobbyId}/game/turnStarted`] = false;
      updates[`lobbies/${lobbyId}/game/selectedRowIndex`] = -1;
      updates[`lobbies/${lobbyId}/game/selectedSide`] = null;
      updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = 0;

      const confirmed = {};
      gs.playerOrder.forEach(pid => { if (pid !== myId) confirmed[pid] = true; });
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

      updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
      updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = gs.currentPlayerIndex;
    } else {
      const nextIdx = (gs.currentPlayerIndex + 1) % gs.playerOrder.length;
      updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = nextIdx;
    }
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

export function renderGame(gs) {
  const area = document.getElementById('game-area');
  const phaseBadge = document.getElementById('phase-badge');
  const cpBadge = document.getElementById('current-player-badge');
  const progress = document.getElementById('round-progress');

  manageDrinkingPopup(gs, myId);

  if (!phaseBadge) return;
  // Header in der Busfahrer-Phase (round3) komplett verstecken
  document.getElementById('screen-game')?.classList.toggle('hide-game-header', gs.phase === 'round3');

  if (gs.gameType === 'drunterdrueber' || gs.phase === 'playing') {
    phaseBadge.textContent = 'Drunter/Drüber';
    try {
      renderDrunterDrueber(gs, area);
    } catch (error) {
      console.error("Error rendering Drunter & Drüber:", error);
      area.innerHTML = `<div class="info-box highlight-border">Ein Fehler ist aufgetreten: ${error.message}. Bitte Konsole prüfen.</div>`;
    }
    return;
  }

  if (gs.gameType === 'ftd' || gs.phase === 'ftd') {
    phaseBadge.textContent = '🍺 Fuck the Dealer';
    if (cpBadge) cpBadge.innerHTML = '';
    if (progress) { progress.textContent = ''; progress.style.display = ''; }
    if (area) area.style.marginTop = '';
    try {
      renderFtd(gs, area);
    } catch (error) {
      console.error('Error rendering FTD:', error);
      area.innerHTML = `<div class="info-box highlight-border">FTD Fehler: ${error.message}</div>`;
    }
    return;
  }

  if (gs.gameType === 'pferderennen' || gs.phase === 'pferderennen') {
    phaseBadge.textContent = '🐎 Pferderennen';
    if (cpBadge) cpBadge.innerHTML = '';
    try {
      renderPferderennen(gs, area);
    } catch (error) {
      console.error("Error rendering Pferderennen:", error);
      area.innerHTML = `<div class="info-box highlight-border">Ein Fehler ist aufgetreten: ${error.message}</div>`;
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
      cpBadge.innerHTML = '';
    } else {
      cpBadge.innerHTML = '';
    }

    progress.textContent = `Karte ${gs.currentRoundCard + 1}/4`;
    renderRound1(gs, isMyTurn, currentPlayer, area, myId);
  } else if (gs.phase === 'round2') {
    phaseBadge.textContent = 'Runde 2 – Pyramide';
    cpBadge.innerHTML = '';
    progress.style.display = 'none'; // Versteckt das Element, damit der Platz frei wird
    if (area) area.style.marginTop = '-20px';
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


async function handleRound1Choice(choice, gs) {
  if (!fbReady || isProcessing || !lobbyId || !gs || gs.phase !== 'round1') return;

  isProcessing = true;
  try {
    const latestSnap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const latestGs = latestSnap.val();
    if (!latestGs || latestGs.phase !== 'round1') return;
    if (latestGs.round1Responses?.[myId]) return;

    const player = latestGs.players[myId];
    if (!player) throw new Error("Spieler nicht gefunden");

    const currentStep = latestGs.currentRoundCard;
    const deckCopy = [...(latestGs.deck || [])];
    const drawnCard = deckCopy.shift();
    const hand = [...(player.hand || [])];
    const result = evaluateRound1Choice(choice, drawnCard, hand, currentStep);
    const newHand = [...hand, drawnCard];

    const updates = {};
    const response = {
      choice,
      correct: result.correct,
      sips: result.sips,
      sipPoolBonus: result.sipPoolBonus,
    };

    const responses = { ...(latestGs.round1Responses || {}), [myId]: response };
    updates[`lobbies/${lobbyId}/game/round1Responses`] = responses;

    if (Object.keys(responses).length < latestGs.playerOrder.length) {
      await update(ref(db), updates);
      toast('Antwort gespeichert');
      return;
    }

    const allPlayers = latestGs.playerOrder || [];
    const statePlayers = JSON.parse(JSON.stringify(latestGs.players || {}));
    const resolvedDeck = [...deckCopy];
    const processedPlayers = {};

    for (const pid of allPlayers) {
      const responseData = responses[pid];
      const playerState = statePlayers[pid];
      if (!playerState || !responseData) continue;
      const playerHand = [...(playerState.hand || [])];
      const roundCard = resolvedDeck.shift();
      if (!roundCard) continue;
      const evalResult = evaluateRound1Choice(responseData.choice, roundCard, playerHand, currentStep);
      playerHand.push(roundCard);
      processedPlayers[pid] = { ...playerState, hand: playerHand };
      if (evalResult.correct) {
        processedPlayers[pid].sipPool = (playerState.sipPool || 0) + evalResult.sipPoolBonus;
      } else {
        processedPlayers[pid].sipsToDrink = (playerState.sipsToDrink || 0) + evalResult.sips;
        processedPlayers[pid].sipsTotal = (playerState.sipsTotal || 0) + evalResult.sips;
      }
      statePlayers[pid] = processedPlayers[pid];
    }

    allPlayers.forEach(pid => {
      const playerState = statePlayers[pid];
      if (!playerState) return;
      updates[`lobbies/${lobbyId}/game/players/${pid}/hand`] = playerState.hand || [];
      updates[`lobbies/${lobbyId}/game/players/${pid}/sipPool`] = playerState.sipPool || 0;
      updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] = playerState.sipsToDrink || 0;
      updates[`lobbies/${lobbyId}/game/players/${pid}/sipsTotal`] = playerState.sipsTotal || 0;
    });

    updates[`lobbies/${lobbyId}/game/deck`] = resolvedDeck;
    updates[`lobbies/${lobbyId}/game/round1Responses`] = {};

    const pools = allPlayers.map(pid => ({ pid, pool: statePlayers[pid]?.sipPool || 0 }));
    const firstGiverIdx = pools.findIndex(item => item.pool > 0);
    const needsToDrink = allPlayers.some(pid => (statePlayers[pid]?.sipsToDrink || 0) > 0);

    if (firstGiverIdx !== -1) {
      updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
      updates[`lobbies/${lobbyId}/game/distributionPendingPlayers`] = pools.filter(item => item.pool > 0).map(item => item.pid);
      updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = firstGiverIdx;
      updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
    } else if (needsToDrink) {
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
      updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
      const activeDrinkers = {};
      allPlayers.forEach(pid => {
        const sips = statePlayers[pid]?.sipsToDrink || 0;
        if (sips > 0) {
          activeDrinkers[pid] = { sips, done: false };
        }
      });
      updates[`lobbies/${lobbyId}/game/activeDrinkers`] = activeDrinkers;
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = null;
    } else {
      const nextCard = latestGs.currentRoundCard + 1;
      if (nextCard >= 4) updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
      else {
        updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextCard;
        updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
      }
    }

    await update(ref(db), updates);
    toast('Antworten ausgewertet');
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function finishDistributionPhase(gs, updates = {}) {
  const players = gs.players || {};
  const order = gs.playerOrder || [];
  const pending = order.filter(pid => (players[pid]?.sipPool || 0) > 0);

  if (pending.length > 0) {
    const currentIndex = Number.isInteger(gs.distributionGiverIndex) ? gs.distributionGiverIndex : 0;
    const currentGiverId = order[currentIndex];
    const stillActive = currentGiverId && (players[currentGiverId]?.sipPool || 0) > 0;
    const nextGiverIndex = stillActive
      ? currentIndex
      : order.findIndex(pid => (players[pid]?.sipPool || 0) > 0);

    updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
    updates[`lobbies/${lobbyId}/game/distributionPendingPlayers`] = pending;
    updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = nextGiverIndex >= 0 ? nextGiverIndex : 0;
    await update(ref(db), updates);
    return;
  }

  updates[`lobbies/${lobbyId}/game/distributionActive`] = false;
  updates[`lobbies/${lobbyId}/game/distributionPendingPlayers`] = null;
  updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = 0;

  let anyoneNeedsToDrink = false;
  for (const pid of gs.playerOrder || []) {
    const toDrink = players[pid]?.sipsToDrink || 0;
    if (toDrink > 0) { anyoneNeedsToDrink = true; break; }
  }

  if (gs.gameType === 'drunterdrueber') {
    const nextIdx = (gs.currentPlayerIndex + 1) % (gs.playerOrder || []).length;
    updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = nextIdx;
  }

  if (anyoneNeedsToDrink) {
    updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
    updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
    const activeDrinkers = {};
    (gs.playerOrder || []).forEach(pid => {
      const sips = players[pid]?.sipsToDrink || 0;
      if (sips > 0) {
        activeDrinkers[pid] = { sips, done: false };
      }
    });
    updates[`lobbies/${lobbyId}/game/activeDrinkers`] = activeDrinkers;
    updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = null;
  } else if (gs.gameType !== 'drunterdrueber' && gs.phase === 'round1') {
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

  await update(ref(db), updates);
}

export async function distributeSips(targetId, amount, gs) {
  if (isProcessing || !gs) return;
  isProcessing = true;
  try {
    const latestSnap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const latestGs = latestSnap.val();
    if (!latestGs || !latestGs.distributionActive) return;

    const updates = {};
    const giver = latestGs.players[myId];
    const target = latestGs.players[targetId];
    const newPool = (giver.sipPool || 0) - amount;
    const pending = (latestGs.distributionPendingPlayers || []).filter(pid => pid !== myId);

    updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = newPool;
    updates[`lobbies/${lobbyId}/game/players/${targetId}/sipsToDrink`] = (target.sipsToDrink || 0) + amount;
    updates[`lobbies/${lobbyId}/game/players/${targetId}/sipsTotal`] = (target.sipsTotal || 0) + amount;

    const updatedGs = {
      ...latestGs,
      players: {
        ...latestGs.players,
        [myId]: { ...giver, sipPool: newPool },
        [targetId]: { ...target, sipsToDrink: (target.sipsToDrink || 0) + amount, sipsTotal: (target.sipsTotal || 0) + amount }
      }
    };

    await finishDistributionPhase(updatedGs, updates);
    const targetName = latestGs.players[targetId]?.name || 'Spieler';
    toast(amount === 1 ? `1 Schluck an ${targetName} verteilt!` : `${amount} Schlucke an ${targetName} verteilt!`);
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
    const latestSnap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const latestGs = latestSnap.val();
    if (!latestGs || !latestGs.distributionActive) return;

    const updates = {};
    const pending = (latestGs.distributionPendingPlayers || []).filter(pid => pid !== myId);
    updates[`lobbies/${lobbyId}/game/players/${myId}/sipPool`] = 0;

    const updatedGs = {
      ...latestGs,
      players: {
        ...latestGs.players,
        [myId]: { ...latestGs.players[myId], sipPool: 0 }
      }
    };

    await finishDistributionPhase(updatedGs, updates);
  } catch (e) {
    console.error(e);
  } finally {
    isProcessing = false;
  }
}

async function confirmSips() {
  if (isProcessing || !lastGameState || !lobbyId) return;

  // ── FTD Mode ──────────────────────────────────────────
  if (lastGameState.gameType === 'ftd' || lastGameState.phase === 'ftd') {
    if (!lastGameState.drinkingActive || !lastGameState.drinkingEvent) return;
    const dEvent = lastGameState.drinkingEvent;

    // Nur der Spieler, der trinken muss, darf bestätigen
    if (myId !== dEvent.drinkerId) return;

    isProcessing = true;
    try {
      const updates = {};
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = false;
      updates[`lobbies/${lobbyId}/game/drinkingEvent`] = null;

      // Nächste Runde starten
      updates[`lobbies/${lobbyId}/game/dealerIndex`] = dEvent.nextDealerIndex;
      updates[`lobbies/${lobbyId}/game/raterIndex`] = dEvent.nextRaterIndex;
      updates[`lobbies/${lobbyId}/game/failStreak`] = dEvent.nextFailStreak;
      updates[`lobbies/${lobbyId}/game/currentCard`] = null;
      updates[`lobbies/${lobbyId}/game/cardDrawn`] = false;
      updates[`lobbies/${lobbyId}/game/attempt`] = 1;
      updates[`lobbies/${lobbyId}/game/hint`] = null;
      updates[`lobbies/${lobbyId}/game/lastRaterGuess`] = null;
      updates[`lobbies/${lobbyId}/game/lastRaterName`] = null;
      updates[`lobbies/${lobbyId}/game/roundResult`] = null;

      await update(ref(db), updates);

      const m = document.getElementById('drinking-modal');
      if (m) {
        m.style.display = 'none';
        m.classList.remove('active');
      }
    } catch (e) {
      console.error('FTD confirmSips error:', e);
      toast('Fehler beim Bestätigen ❌');
    } finally {
      isProcessing = false;
    }
    return;
  }

  isProcessing = true;
  try {
    // Frischen State direkt aus Firebase abfragen, um Race Conditions zu vermeiden
    const gameSnap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const gs = gameSnap.val();
    if (!gs) return;

    // Falls gar kein Trinken aktiv ist, Modal sofort lokal schließen
    if (!gs.drinkingActive) {
      const m = document.getElementById('drinking-modal');
      if (m) {
        m.style.display = 'none';
        m.classList.remove('active');
      }
      return;
    }

    const activeDrinkers = gs.activeDrinkers || {};
    const myDrinker = activeDrinkers[myId];

    // Hat dieser Spieler bereits bestätigt?
    if (myDrinker?.done) {
      const m = document.getElementById('drinking-modal');
      if (m) {
        m.style.display = 'none';
        m.classList.remove('active');
      }
      return;
    }

    // Spielerliste laden, um getrennte / inaktive Spieler zu berücksichtigen
    const pSnap = await get(ref(db, `lobbies/${lobbyId}/players`));
    const pData = pSnap.val() || {};

    // Finde alle anderen Spieler, die noch trinken müssen und online sind
    let otherPendingDrinkers = [];
    if (Object.keys(activeDrinkers).length > 0) {
      otherPendingDrinkers = Object.keys(activeDrinkers).filter(pid =>
        pid !== myId &&
        !activeDrinkers[pid]?.done &&
        pData[pid] &&
        !pData[pid].disconnected
      );
    } else {
      // Fallback für Phasen ohne activeDrinkers Map
      otherPendingDrinkers = (gs.playerOrder || []).filter(pid =>
        pid !== myId &&
        (gs.players?.[pid]?.sipsToDrink || 0) > 0 &&
        !(gs.confirmedDrinkers && gs.confirmedDrinkers[pid]) &&
        pData[pid] &&
        !pData[pid].disconnected
      );
    }

    const isLastOne = (otherPendingDrinkers.length === 0);
    const updates = {};

    // 1. Eigenen Spieler-Status zwingend auf 0 & confirmedDrinker setzen
    updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = 0;
    updates[`lobbies/${lobbyId}/game/players/${myId}/confirmedDrinker`] = true;

    // Eigenes Modal sofort schließen
    const m = document.getElementById('drinking-modal');
    if (m) {
      m.style.display = 'none';
      m.classList.remove('active');
    }

    // 2. Unterscheidung: Letzter Trinker vs. noch ausstehende Trinker
    if (isLastOne) {
      // Wenn der Letzte fertig ist: Gesamte Trink-Objekte auf null setzen (KEINE Child-Pfade schreiben, sonst Firebase Ancestor-Fehler!)
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = false;
      updates[`lobbies/${lobbyId}/game/activeDrinkers`] = null;
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = null;

      if (gs.phase === 'round1') {
        const nextRoundCard = (gs.currentRoundCard ?? 0) + 1;
        if (nextRoundCard >= 4) {
          updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
        } else {
          updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextRoundCard;
        }
        updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
      } else if (gs.phase === 'round2' && (gs.pyramidIndex ?? 0) >= (gs.pyramid?.length || gs.pyramidSize || 10)) {
        await finishRound2(gs, updates);
        return;
      } else if (gs.phase === 'round3') {
        updates[`lobbies/${lobbyId}/game/busCards`] = [];
        updates[`lobbies/${lobbyId}/game/busStep`] = 0;
      }
    } else {
      // Es trinken noch andere: Nur die eigenen Child-Einträge im activeDrinkers-Objekt aktualisieren
      updates[`lobbies/${lobbyId}/game/activeDrinkers/${myId}/done`] = true;
      updates[`lobbies/${lobbyId}/game/activeDrinkers/${myId}/sips`] = 0;
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers/${myId}`] = true;
    }

    await update(ref(db), updates);
  } catch (e) {
    console.error("ConfirmSips Error:", e);
    toast("Fehler bei der Bestätigung ❌");
  } finally {
    isProcessing = false;
  }
}

async function readyUpRound2() {
  if (isProcessing) return;
  isProcessing = true;
  await update(ref(db, `lobbies/${lobbyId}/game/players/${myId}`), { readyForRound2: true });
  isProcessing = false;
}

export async function matchHandCard(cardIdx, gs) {
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

    // Prüfen, überhaupt jemand Schlucke zum Verteilen 
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

    // Check anyone sips to distribute
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
      let anyoneNeedsToDrink = gs.playerOrder.some(pid => (gs.players[pid].sipsToDrink || 0) > 0);
      if (anyoneNeedsToDrink) {
        updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
        updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = getServerNow();
        const activeDrinkers = {};
        gs.playerOrder.forEach(pid => {
          const sips = (updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] !== undefined)
            ? updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`]
            : (gs.players[pid].sipsToDrink || 0);
          if (sips > 0) {
            activeDrinkers[pid] = { sips, done: false };
          }
        });
        updates[`lobbies/${lobbyId}/game/activeDrinkers`] = activeDrinkers;
        updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = null;
      } else if (gs.phase === 'tiebreaker' || gs.pyramidIndex >= gs.pyramid.length) {
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
    }, 10000);

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
    // TIE! Check for auto-loser
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
  if (!fbReady || isProcessing || !lobbyId) return;
  isProcessing = true;
  try {
    const gameSnap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const gs = gameSnap.val() || lastGameState;
    const requesterId = gs?.takeOverRequest;

    const updates = {
      [`lobbies/${lobbyId}/game/takeOverRequest`]: null
    };

    if (accepted && requesterId) {
      const nextName = gs.players?.[requesterId]?.name || 'Jemand';
      const step = gs.busStep ?? 0;
      const cardsCount = (gs.busCards || []).length;
      const isUntouched = (step === 0 && cardsCount === 0);

      if (isUntouched) {
        // Fall 1: Runde noch unberührt (Fortschritt = 0) -> Sofortige Übergabe
        updates[`lobbies/${lobbyId}/game/guestDriverId`] = requesterId;
        updates[`lobbies/${lobbyId}/game/pendingGuestDriverId`] = null;
        toast(`🤝 ${nextName} übernimmt sofort das Steuer!`);
      } else {
        // Fall 2: Runde läuft bereits (Fortschritt > 0) -> Übergabe erst nach Fehler
        updates[`lobbies/${lobbyId}/game/pendingGuestDriverId`] = requesterId;
        toast(`🤝 ${nextName} übernimmt nach dem nächsten Fehler!`);
      }
    } else if (!accepted) {
      toast("Anfrage abgelehnt ✋");
    }

    await update(ref(db), updates);
  } catch (e) {
    console.error("Fehler bei Übernahme-Antwort:", e);
  } finally {
    isProcessing = false;
  }
}


export async function handleBusChoice(choice, gs) {
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
          // Gastfahrer-Zustand bleibt wie er ist
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

      await new Promise(r => setTimeout(r, 1000));

      const sipsToDrink = (gs.players[myId]?.sipsToDrink || 0) + sips;
      const sipsTotal = (gs.players[myId]?.sipsTotal || 0) + sips;
      const confirmed = {};
      Object.keys(gs.players || {}).forEach(pid => { if (pid !== myId) confirmed[pid] = true; });

      const updates = {
        [`lobbies/${lobbyId}/game/busRestarts`]: (gs.busRestarts || 0) + 1,
        [`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`]: sipsToDrink,
        [`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`]: sipsTotal,
        [`lobbies/${lobbyId}/game/drinkingActive`]: true,
        [`lobbies/${lobbyId}/game/drinkingStartTime`]: getServerNow(),
        [`lobbies/${lobbyId}/game/confirmedDrinkers`]: confirmed,
        [`lobbies/${lobbyId}/game/activeDrinkers`]: {
          [myId]: { sips: sipsToDrink, done: false }
        },
        [`lobbies/${lobbyId}/game/takeOverRequest`]: null,
        [`lobbies/${lobbyId}/game/guestDriverId`]: null
      };

      // Logik für den Wechsel:
      if (gs.pendingGuestDriverId) {
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
window.handleRound1Choice = handleRound1Choice;

window.restartGame = async () => {
  if (!isHost) return;
  await remove(ref(db, `lobbies/${lobbyId}/game`));
  await update(ref(db, `lobbies/${lobbyId}`), { status: 'waiting' });
  if (gameListener) { gameListener(); gameListener = null; }
  enterLobbyScreen();
};

window.exitToLobby = async () => {
  if (gameListener) { gameListener(); gameListener = null; }
  await leaveLobby();
};

window.betHorse = async (symbol) => {
  if (!lobbyId || !myId || !lastGameState) return;

  // Falls du schon gewettet hast, abbrechen
  if (lastGameState.bets && lastGameState.bets[myId]) {
    toast("Du hast bereits auf ein Pferd gesetzt! ❌");
    return;
  }

  try {
    await update(ref(db, `lobbies/${lobbyId}/game/bets/${myId}`), {
      symbol: symbol,
      name: myName
    });
    toast(`Auf Pferd ${symbol} gesetzt! 🐎`);
  } catch (e) {
    console.error("Fehler beim Wetten:", e);
    toast("Wette konnte nicht gespeichert werden ❌");
  }
};

window.drawHorseCard = async () => {
  if (!isHost || !lobbyId || !lastGameState) return;

  try {
    const gs = lastGameState;
    let deck = [...(gs.deck || [])];
    if (deck.length === 0) deck = makeDeck();

    const drawnCard = deck.shift();
    if (!drawnCard) return;

    const winningHorse = drawnCard.suit;
    const currentPos = gs.horses?.[winningHorse] || 1;
    let newPos = currentPos + 1;

    // --- PHASE 1: Vorwärtsbewegung & Kartenaufdeckung ---
    let history = [...(gs.drawnCardsHistory || [])];
    history.push(drawnCard);

    let firstUpdates = {
      deck: deck,
      [`horses/${winningHorse}`]: newPos,
      lastDrawnCard: drawnCard,
      drawnCardsHistory: history
    };

    let obstacles = JSON.parse(JSON.stringify(gs.obstacles || {}));
    let horses = { ...gs.horses, [winningHorse]: newPos };
    let triggeredPenalty = null;

    for (let fieldNum = 2; fieldNum <= 8; fieldNum++) {
      const obstacle = obstacles[fieldNum];
      if (obstacle && !obstacle.revealed) {
        const triggered = Object.values(horses).some(pos => pos >= fieldNum);
        if (triggered) {
          obstacle.revealed = true;
          firstUpdates['obstacles'] = obstacles;

          triggeredPenalty = {
            fieldNum: fieldNum,
            penaltyHorse: obstacle.card.suit,
            obstacleCardValue: obstacle.card.value
          };
          break; // Immer nur 1 Hindernis gleichzeitig auslösen
        }
      }
    }

    // Phase 1 senden (Pferd rückt vor, Karte deckt sich auf)
    await update(ref(db, `lobbies/${lobbyId}/game`), firstUpdates);

    // --- PHASE 2: Strafe (Rückschritt) & Siegesprüfung ---
    let secondUpdates = {};

    if (triggeredPenalty) {
      // Warten, damit der Vorwärtsschritt und das Hindernis sichtbar sind
      await new Promise(r => setTimeout(r, 600));

      const pHorse = triggeredPenalty.penaltyHorse;
      if (horses[pHorse] > 1) {
        horses[pHorse] -= 1;
        secondUpdates[`horses/${pHorse}`] = horses[pHorse];
      }
    }

    // Gewinner prüfen (mit dem finalen Stand nach eventueller Strafe)
    const winner = Object.keys(horses).find(h => horses[h] >= 9);

    if (winner) {
      secondUpdates['winner'] = winner;

      const bets = gs.bets || {};
      const pendingDistribution = [];
      Object.entries(bets).forEach(([pid, bet]) => {
        if (bet.symbol === winner) {
          const doubleSips = (bet.sips || 0) * 2;
          const currentPool = gs.players?.[pid]?.sipPool || 0;
          const newPool = currentPool + doubleSips;
          secondUpdates[`players/${pid}/sipPool`] = newPool;
          if (newPool > 0) {
            pendingDistribution.push(pid);
          }
        }
      });

      if (pendingDistribution.length > 0) {
        secondUpdates['distributionActive'] = true;
        secondUpdates['distributionPendingPlayers'] = pendingDistribution;
        const playerOrder = gs.playerOrder || [];
        const firstGiverIdx = playerOrder.findIndex(pid => pendingDistribution.includes(pid));
        secondUpdates['distributionGiverIndex'] = firstGiverIdx >= 0 ? firstGiverIdx : 0;
      } else {
        secondUpdates['distributionActive'] = false;
      }
    }

    // Wenn es einen Rückschritt oder Sieger gab, zweites Update feuern
    if (Object.keys(secondUpdates).length > 0) {
      await update(ref(db, `lobbies/${lobbyId}/game`), secondUpdates);
    }
  } catch (e) {
    console.error("Fehler beim Kartenziehen:", e);
    toast("Fehler beim Ziehen ❌");
  }
};

window.startPferderennen = async () => {
  if (!lobbyId || !state || !state.isHost) return;
  try {
    const latestSnap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const currentGs = latestSnap.val() || {};
    const playerIds = currentGs.playerOrder || Object.keys(currentGs.players || {});

    const deck = makeDeck();
    const obstacles = {};
    for (let i = 2; i <= 8; i++) {
      const card = deck.shift();
      obstacles[i] = {
        card: card,
        revealed: false
      };
    }

    const resetPlayers = {};
    (playerIds || []).forEach(pid => {
      resetPlayers[pid] = {
        ...(currentGs.players?.[pid] || {}),
        sipPool: 0,
        sipsToDrink: 0,
        confirmedDrinker: false
      };
    });

    const pferdeState = {
      gameType: 'pferderennen',
      phase: 'pferderennen',
      hostId: myId,
      drawnCardsHistory: [],
      players: resetPlayers,
      playerOrder: playerIds,
      deck: deck,
      horses: {
        '♥': 1,
        '♦': 1,
        '♠': 1,
        '♣': 1
      },
      obstacles: obstacles,
      bets: {},
      betStartTime: getServerNow(),
      winner: null,
      distributionActive: false,
      drinkingActive: false,
      distributionPendingPlayers: null
    };

    await set(ref(db, `lobbies/${lobbyId}/game`), pferdeState);
  } catch (e) {
    console.error("Fehler beim Starten des Pferderennens:", e);
  }
};

window.betHorseWithSips = async function (horse, sips) {
  if (!lobbyId || !state || !state.myId) {
    console.warn("State oder Lobby ID nicht bereit!");
    return;
  }

  try {
    const currentSipsTotal = lastGameState?.players?.[state.myId]?.sipsTotal || 0;
    const updates = {};
    updates[`lobbies/${lobbyId}/game/bets/${state.myId}`] = {
      symbol: horse,
      sips: sips,
      name: myName || 'Spieler'
    };
    updates[`lobbies/${lobbyId}/game/players/${state.myId}/sipsToDrink`] = sips;
    updates[`lobbies/${lobbyId}/game/players/${state.myId}/sipsTotal`] = currentSipsTotal + sips;
    updates[`lobbies/${lobbyId}/game/players/${state.myId}/confirmedDrinker`] = (sips === 0);

    await update(ref(db), updates);

    if (sips > 0) {
      // Trink-Modal NUR für DICH lokal öffnen
      const modal = document.getElementById('drinking-modal');
      const countEl = document.getElementById('drinking-count');

      if (countEl) countEl.textContent = sips;
      if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
      }
    }
  } catch (e) {
    console.error("Fehler beim Wetten mit Schlucken:", e);
    toast("Wette konnte nicht gespeichert werden ❌");
  }
};

window.setHorseBetStartTime = async function () {
  if (!lobbyId || !db) return;
  const updates = {};
  updates[`lobbies/${lobbyId}/game/betStartTime`] = getServerNow();
  await update(ref(db), updates);
};

// ── FTD HELPER ─────────────────────────────────────────────
function initFtdGame(players, ftdDeck) {
  const playerStates = {};
  for (const p of players) {
    playerStates[p.id] = { id: p.id, name: p.name };
  }
  const graveyard = {};
  VALUES.forEach(v => { graveyard[v] = []; });
  return {
    gameType: 'ftd',
    phase: 'ftd',
    hostId: myId,
    playerOrder: players.map(p => p.id),
    players: playerStates,
    deck: ftdDeck,
    graveyard,
    dealerIndex: 0,
    raterIndex: 1,
    failStreak: 0,
    currentCard: null,
    cardDrawn: false,
    attempt: 1,
    hint: null,
    lastRaterGuess: null,
    lastRaterName: null,
    drinkingActive: false,
    drinkingEvent: null,
    roundResult: null,
    roundActive: false,
  };
}

// ── FTD ACTIONS ────────────────────────────────────────────

/** Dealer draws a card (only dealer may call, host-side lock via isProcessing) */
window.ftdDrawCard = async () => {
  if (!fbReady || isProcessing || !lobbyId || !lastGameState) return;
  const gs = lastGameState;
  if (gs.gameType !== 'ftd' || gs.cardDrawn || gs.drinkingActive || gs.roundResult) return;
  const dealerId = (gs.playerOrder || [])[gs.dealerIndex ?? 0];
  if (myId !== dealerId) return;

  isProcessing = true;
  try {
    // Re-fetch to avoid race condition
    const snap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const lg = snap.val();
    if (!lg || lg.cardDrawn || lg.drinkingActive) return;

    let deck = [...(lg.deck || [])];
    if (deck.length === 0) deck = makeDeck();
    const card = deck.shift();

    await update(ref(db), {
      [`lobbies/${lobbyId}/game/deck`]: deck,
      [`lobbies/${lobbyId}/game/currentCard`]: card,
      [`lobbies/${lobbyId}/game/cardDrawn`]: true,
      [`lobbies/${lobbyId}/game/attempt`]: 1,
      [`lobbies/${lobbyId}/game/hint`]: null,
      [`lobbies/${lobbyId}/game/lastRaterGuess`]: null,
      [`lobbies/${lobbyId}/game/lastRaterName`]: null,
      [`lobbies/${lobbyId}/game/drinkingActive`]: false,
      [`lobbies/${lobbyId}/game/drinkingEvent`]: null,
      [`lobbies/${lobbyId}/game/roundResult`]: null,
    });
  } catch (e) {
    console.error('ftdDrawCard error:', e);
    toast('Fehler beim Ziehen ❌');
  } finally {
    isProcessing = false;
  }
};

/** Dealer gives higher/lower hint after attempt-1 miss */
window.ftdGiveHint = async (hintDir) => {
  if (!fbReady || isProcessing || !lobbyId || !lastGameState) return;
  const gs = lastGameState;
  if (gs.gameType !== 'ftd' || !gs.cardDrawn || gs.drinkingActive || gs.roundResult || gs.attempt !== 2 || gs.hint) return;
  const dealerId = (gs.playerOrder || [])[gs.dealerIndex ?? 0];
  if (myId !== dealerId) return;

  isProcessing = true;
  try {
    // Validate hint direction against actual card value to prevent drunk misclicks
    let finalHint = hintDir;
    if (gs.currentCard && gs.lastRaterGuess && VALUE_ORDER[gs.currentCard.value] && VALUE_ORDER[gs.lastRaterGuess]) {
      const targetVal = VALUE_ORDER[gs.currentCard.value];
      const guessVal = VALUE_ORDER[gs.lastRaterGuess];
      finalHint = targetVal > guessVal ? 'higher' : 'lower';
    }

    await update(ref(db, `lobbies/${lobbyId}/game`), { hint: finalHint });
  } catch (e) {
    console.error('ftdGiveHint error:', e);
  } finally {
    isProcessing = false;
  }
};

/** Rater submits a rank guess (attempt 1 or 2) */
window.ftdGuess = async (rank) => {
  if (!fbReady || isProcessing || !lobbyId || !lastGameState) return;
  const gs = lastGameState;
  if (gs.gameType !== 'ftd' || !gs.cardDrawn || gs.drinkingActive) return;
  const raterId = (gs.playerOrder || [])[gs.raterIndex ?? 1];
  if (myId !== raterId) return;

  isProcessing = true;
  try {
    // Re-fetch for consistency
    const snap = await get(ref(db, `lobbies/${lobbyId}/game`));
    const lg = snap.val();
    if (!lg || lg.drinkingActive) return;

    const card = lg.currentCard;
    const attempt = lg.attempt || 1;
    const correct = card.value === rank;
    const updates = {};
    const order = lg.playerOrder || [];
    const len = order.length;
    const dealerIdx = lg.dealerIndex ?? 0;
    const raterIdx = lg.raterIndex ?? 1;
    const dealerId = order[dealerIdx];
    const dealerName = lg.players?.[dealerId]?.name ?? '?';
    const raterName = lg.players?.[raterId]?.name ?? '?';
    const failStreak = lg.failStreak || 0;

    // Clone graveyard (we update it only when round concludes)
    const graveyard = JSON.parse(JSON.stringify(lg.graveyard || {}));
    VALUES.forEach(v => { if (!graveyard[v]) graveyard[v] = []; });

    if (correct) {
      // ✅ Hit 1: 4 Schlucke für Dealer | Hit 2: 2 Schlucke für Dealer
      if (!graveyard[card.value].includes(card.suit)) {
        graveyard[card.value].push(card.suit);
      }
      updates[`lobbies/${lobbyId}/game/graveyard`] = graveyard;

      const sips = attempt === 1 ? 4 : 2;

      // Dealer bleibt Dealer, nächster Spieler wird Rater (überspringt Dealer)
      let next = (raterIdx + 1) % len;
      if (next === dealerIdx) next = (next + 1) % len;
      const nextRaterIndex = next;

      updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
      updates[`lobbies/${lobbyId}/game/drinkingEvent`] = {
        drinkerId: dealerId,
        drinkerName: dealerName,
        sips,
        nextDealerIndex: dealerIdx,
        nextRaterIndex,
        nextFailStreak: failStreak,
      };
      updates[`lobbies/${lobbyId}/game/roundResult`] = null;

      const curTotal = lg.players?.[dealerId]?.sipsTotal || 0;
      updates[`lobbies/${lobbyId}/game/players/${dealerId}/sipsTotal`] = curTotal + sips;

    } else if (attempt === 1) {
      // ❌ Attempt-1 miss — advance to attempt 2, await dealer hint (kein Trinken)
      updates[`lobbies/${lobbyId}/game/attempt`] = 2;
      updates[`lobbies/${lobbyId}/game/hint`] = null;
      updates[`lobbies/${lobbyId}/game/lastRaterGuess`] = rank;
      updates[`lobbies/${lobbyId}/game/lastRaterName`] = raterName;
    } else {
      // ❌ Attempt-2 miss — Differenz als Schlucke für den Rater (|Zielkarte - Tipp 2|)
      const targetVal = VALUE_ORDER[card.value] ?? 0;
      const guessVal = VALUE_ORDER[rank] ?? 0;
      const sips = Math.abs(targetVal - guessVal);
      const newFail = failStreak + 1;

      if (!graveyard[card.value].includes(card.suit)) {
        graveyard[card.value].push(card.suit);
      }
      updates[`lobbies/${lobbyId}/game/graveyard`] = graveyard;

      let nextDealerIndex = dealerIdx;
      let nextRaterIndex;
      let nextFailStreak = newFail;

      if (newFail >= 3) {
        // 🔄 3 Fails: Dealerwechsel
        nextDealerIndex = (dealerIdx + 1) % len;
        nextRaterIndex = (nextDealerIndex + 1) % len;
        nextFailStreak = 0;
      } else {
        // Dealer bleibt, Rater rückt vor (überspringt Dealer)
        let next = (raterIdx + 1) % len;
        if (next === dealerIdx) next = (next + 1) % len;
        nextRaterIndex = next;
      }

      updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
      updates[`lobbies/${lobbyId}/game/drinkingEvent`] = {
        drinkerId: raterId,
        drinkerName: raterName,
        sips,
        nextDealerIndex,
        nextRaterIndex,
        nextFailStreak,
      };
      updates[`lobbies/${lobbyId}/game/roundResult`] = null;

      const curTotal = lg.players?.[raterId]?.sipsTotal || 0;
      updates[`lobbies/${lobbyId}/game/players/${raterId}/sipsTotal`] = curTotal + sips;
    }

    await update(ref(db), updates);
  } catch (e) {
    console.error('ftdGuess error:', e);
    toast('Fehler beim Tippen ❌');
  } finally {
    isProcessing = false;
  }
};

/** Current dealer advances to the next round (fallback) */
window.ftdNextRound = async () => {
  if (!fbReady || isProcessing || !lobbyId || !lastGameState) return;
  const gs = lastGameState;
  if (gs.gameType !== 'ftd') return;
  const dealerId = (gs.playerOrder || [])[gs.dealerIndex ?? 0];
  if (myId !== dealerId) return;

  isProcessing = true;
  try {
    const len = (gs.playerOrder || []).length;
    let next = ((gs.raterIndex ?? 1) + 1) % len;
    if (next === (gs.dealerIndex ?? 0)) next = (next + 1) % len;

    await update(ref(db), {
      [`lobbies/${lobbyId}/game/raterIndex`]: next,
      [`lobbies/${lobbyId}/game/currentCard`]: null,
      [`lobbies/${lobbyId}/game/cardDrawn`]: false,
      [`lobbies/${lobbyId}/game/attempt`]: 1,
      [`lobbies/${lobbyId}/game/hint`]: null,
      [`lobbies/${lobbyId}/game/lastRaterGuess`]: null,
      [`lobbies/${lobbyId}/game/lastRaterName`]: null,
      [`lobbies/${lobbyId}/game/drinkingActive`]: false,
      [`lobbies/${lobbyId}/game/drinkingEvent`]: null,
      [`lobbies/${lobbyId}/game/roundResult`]: null,
    });
  } catch (e) {
    console.error('ftdNextRound error:', e);
  } finally {
    isProcessing = false;
  }
};