import { injectSpeedInsights } from '@vercel/speed-insights';
import { inject } from '@vercel/analytics';

// ===================================================
//  BUSFAHRER – app.js
//  Full multiplayer via Firebase Realtime Database
// ===================================================

const APP_VERSION = '1.0.11'; // Muss mit der Version in version.json übereinstimmen

// ── Deck Utilities ──────────────────────────────────────
const SUITS = ['♥','♦','♠','♣'];
const SUIT_NAMES = { '♥': 'Herz', '♦': 'Karo', '♠': 'Pik', '♣': 'Kreuz' };
const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VALUE_ORDER = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

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
  const m = window._firebaseModules;
  const app = m.initializeApp(config); 
  db = m.getDatabase(app);
  ref = m.ref; set = m.set; get = m.get; push = m.push;
  onValue = m.onValue; update = m.update; remove = m.remove;
  onDisconnect = m.onDisconnect;
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
let hostTimerInterval = null;
let isProcessing = false; 
let pyramidSize = 10;

// ── Screens ──────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
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
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await checkVersion(); 
    await initFirebase(myConfig);
    const modal = document.getElementById('firebase-modal');
    if (modal) modal.classList.remove('active');
    setupHomeUI();
    injectSpeedInsights(); 
    inject(); 
    console.log("Firebase automatisch verbunden! 🔥");
  } catch (e) {
    console.error("Firebase Fehler:", e);
    toast('❌ Verbindung fehlgeschlagen');
  }
});

async function checkVersion() {
  try {
    const response = await fetch(`version.json?t=${Date.now()}`);
    const data = await response.json();
    if (data.version && data.version !== APP_VERSION) {
      console.log(`Version Mismatch: Lokal ${APP_VERSION} vs Server ${data.version}`);
      setTimeout(() => {
        window.location.reload(true); 
      }, 500);
    }
  } catch (e) {
    console.warn("Versions-Check fehlgeschlagen (evtl. offline)");
  }
}

function showFirebaseModal() {
  document.getElementById('firebase-modal').classList.add('active');
}

function setupHomeUI() {
  showScreen('home');

  // Restore name
  const savedName = localStorage.getItem('bf_name');
  if (savedName) document.getElementById('input-name').value = savedName;

  document.getElementById('btn-create').addEventListener('click', createLobby);
  document.getElementById('btn-join').addEventListener('click', joinLobby);
  document.getElementById('input-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinLobby();
  });
  document.getElementById('input-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('input-code').focus();
  });
  const confirmBtn = document.getElementById('btn-confirm-drinking');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmSips);
}

// ── CREATE LOBBY ──────────────────────────────────────────
async function createLobby() {
  await checkVersion(); 
  const nameInput = document.getElementById('input-name').value.trim();
  if (!nameInput) { toast('Bitte Namen eingeben'); return; }
  myName = nameInput;
  localStorage.setItem('bf_name', myName);
  isHost = true;

  lobbyId = genCode();

  const lobbyRef = ref(db, `lobbies/${lobbyId}`);
  await set(lobbyRef, {
    host: myId,
    status: 'waiting',
    pyramidSize: 10,
    players: {
      [myId]: { name: myName, id: myId, host: true, joinedAt: Date.now() }
    }
  });

  onDisconnect(ref(db, `lobbies/${lobbyId}`)).remove();

  enterLobbyScreen();
}

// ── JOIN LOBBY ─────────────────────────────────────────────
async function joinLobby() {
  await checkVersion(); 
  const nameInput = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!nameInput) { toast('Bitte Namen eingeben'); return; }
  if (!code || code.length !== 6) { toast('Bitte gültigen Code eingeben'); return; }

  myName = nameInput;
  localStorage.setItem('bf_name', myName);

  const snap = await get(ref(db, `lobbies/${code}`));
  if (!snap.exists()) { toast('Lobby nicht gefunden ❌'); return; }
  const lobby = snap.val();
  if (lobby.status !== 'waiting') { toast('Spiel läuft bereits'); return; }

  isHost = false;
  lobbyId = code;
  await set(ref(db, `lobbies/${lobbyId}/players/${myId}`), {
    name: myName, id: myId, host: false, joinedAt: Date.now()
  });

  onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).remove();

  pyramidSize = lobby.pyramidSize || 10;
  enterLobbyScreen();
}

// ── LOBBY SCREEN ──────────────────────────────────────────
function enterLobbyScreen() {
  showScreen('lobby');
  document.getElementById('lobby-code-display').textContent = lobbyId;

  // Copy button
  document.getElementById('btn-copy-code').onclick = () => {
    navigator.clipboard?.writeText(lobbyId).then(() => toast('Code kopiert! ' + lobbyId));
  };

  // Leave
  document.getElementById('btn-leave-lobby').onclick = leaveLobby;

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
  } else {
    pyramidSel.style.display = 'none';
  }

  // Start button
  const startBtn = document.getElementById('btn-start-game');
  const waitingMsg = document.getElementById('waiting-msg');
  if (isHost) {
    startBtn.style.display = '';
    waitingMsg.style.display = 'none';
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
        game.matchEndTime && Date.now() > game.matchEndTime) {
      autoLockMissedCards(game);
    }

      if (game.phase === 'round1') {
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
  list.innerHTML = sorted.map(p => {
    const isMe = p.id === myId;
    const isH = p.host;
    const emoji = ['👑', '🎩', '🎲', '🎭', '🍀', '💎'][sorted.indexOf(p) % 6];
    return `<div class="player-card ${isH ? 'player-host' : ''} ${isMe ? 'player-me' : ''}">
      <div class="player-avatar">${emoji}</div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.name)}</div>
        <div class="player-role">${isH ? '👑 Host' : 'Spieler'}</div>
      </div>
    </div>`;
  }).join('');
}

async function leaveLobby() {
  unsubFns.forEach(f => f()); unsubFns = [];
  if (gameListener) { gameListener(); gameListener = null; }
  if (window._matchTicker) clearInterval(window._matchTicker);
  if (hostTimerInterval) clearTimeout(hostTimerInterval);
  if (lobbyId) {
    if (isHost) {
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
  gameListener = onValue(ref(db, `lobbies/${lobbyId}/game`), snap => {
    if (!snap.exists()) {
      if (lobbyId) leaveLobby();
      return;
    }
    const gs = snap.val();
    lastGameState = gs;

    // Host-Wiederherstellung: Falls der Timer nach einem Refresh fehlt
    if (isHost && (gs.phase === 'round2' || gs.phase === 'tiebreaker')) {
      const now = Date.now();
      if (gs.matchEndTime && now < gs.matchEndTime && !hostTimerInterval) {
        const delay = (gs.matchEndTime - now) + 500;
        hostTimerInterval = setTimeout(() => autoLockMissedCards(lastGameState), delay);
      }
    }

    renderGame(gs);
  });
}

function renderGame(gs) {
  const area = document.getElementById('game-area');
  const phaseBadge = document.getElementById('phase-badge');
  const cpBadge = document.getElementById('current-player-badge');
  const progress = document.getElementById('round-progress');

  // Check if everyone is ready for Round 2
  if (gs.phase === 'round2' && !gs.matchingActive && !gs.distributionActive && !gs.drinkingActive) {
    const allReady = gs.playerOrder.every(pid => gs.players[pid].readyForRound2);
    if (allReady && isHost && gs.pyramidIndex === 0) {
      // Auto-start first card reveal possible
    }
  }

  // Handle drinking popup
  manageDrinkingPopup(gs);

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
        <div class="choice-title">Schlucke verteilen! 🍺</div>
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
    return `<button class="choice-btn" data-choice="red" ${d}><span class="choice-emoji">🔴</span>Rot</button>
            <button class="choice-btn" data-choice="black" ${d}><span class="choice-emoji">⚫</span>Schwarz</button>`;
  }
  if (step === 1) {
    return `<button class="choice-btn" data-choice="higher" ${d}><span class="choice-emoji">⬆️</span>Höher</button>
            <button class="choice-btn" data-choice="lower" ${d}><span class="choice-emoji">⬇️</span>Tiefer</button>`;
  } else if (step === 2) {
    const lo = VALUE_ORDER[drawn[0].value];
    const hi = VALUE_ORDER[drawn[1].value];
    const [min, max] = [Math.min(lo, hi), Math.max(lo, hi)];
    return `<button class="choice-btn" data-choice="inside" ${d}><span class="choice-emoji">🔲</span>Innen (${drawn.map(c=>c.value).join('-')})</button>
            <button class="choice-btn" data-choice="outside" ${d}><span class="choice-emoji">📤</span>Außen</button>`;
  }
  else if (step === 3) {
    return SUITS.map(s => `<button class="choice-btn" data-choice="${s}" ${d}>
      <span class="choice-emoji">${s}</span>${SUIT_NAMES[s]}
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
      toast(`❌ Falsch! ${sips} Schluck${sips > 1 ? 'e' : ''} trinken 🍺`);
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
          updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = Date.now();
          
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
  if (anyoneNeedsToDrink) {
  updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
  updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = Date.now();
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
    if (gs.phase === 'round1') {
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
        await update(ref(db), updates);
      } else if (lastGameState.phase === 'round2') {
        // Wenn Pyramide fertig, direkt finishRound2 mit den bestehenden updates aufrufen
        await finishRound2(lastGameState, updates);
      }
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
  const timeLeft = Math.max(0, Math.ceil((matchEndTime - Date.now()) / 1000));

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
      const isCurrent = (flatIdx === pidx - 1 && (timeLeft > 0 || gs.distributionActive || gs.drinkingActive || (gs.matchEndTime && Date.now() < gs.matchEndTime + 500)));
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
        <div class="choice-title">Schlucke verteilen! 🍺</div>
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
              <span class="choice-emoji">🃏</span>Aufdecken
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
  
  // Lokaler UI-Ticker
  const activeCard = pyramid[pidx - 1];
  const isTimerVisible = activeCard && timeLeft > 0 && !gs.distributionActive && !gs.drinkingActive;
  if (isTimerVisible) {
    if (matchEndTime !== window._lastMatchEndTime) {
      window._lastMatchEndTime = matchEndTime;
      if (window._matchTicker) clearInterval(window._matchTicker);
      window._matchTicker = setInterval(() => {
        const nowLeft = Math.max(0, Math.ceil((matchEndTime - Date.now()) / 1000));
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
  const timeLeft = Math.max(0, Math.ceil((matchEndTime - Date.now()) / 1000));
  
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

  // Ticker-Logik (identisch zu R2)
  if (card && timeLeft > 0 && !gs.distributionActive && !gs.drinkingActive) {
    if (matchEndTime !== window._lastMatchEndTime) {
      window._lastMatchEndTime = matchEndTime;
      if (window._matchTicker) clearInterval(window._matchTicker);
      window._matchTicker = setInterval(() => {
        const nowLeft = Math.max(0, Math.ceil((matchEndTime - Date.now()) / 1000));
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

  if (gs.matchEndTime && Date.now() > gs.matchEndTime) {
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
    if (!targetCard) return;

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
        if (newlyLockedCount > 0) updates[`lobbies/${lobbyId}/game/players/${pid}/sipsToDrink`] = (gs.players[pid].sipsToDrink || 0) + newlyLockedCount;
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
        updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = Date.now();
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
  updates[`lobbies/${lobbyId}/game/matchEndTime`] = Date.now() + 10000;

  try {
    if (hostTimerInterval) clearTimeout(hostTimerInterval);
    hostTimerInterval = setTimeout(() => {
      autoLockMissedCards(lastGameState);
    }, 10500);

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
    [`lobbies/${lobbyId}/game/matchEndTime`]: Date.now() + 10000
  };
  
  if (hostTimerInterval) clearTimeout(hostTimerInterval);
  hostTimerInterval = setTimeout(() => autoLockMissedCards(lastGameState), 10500);
  
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

  const stepLabels = ['🔴⚫ Rot oder Schwarz?', '⬆️⬇️ Höher oder Tiefer?', '🔲 Innen oder Außen?', '♥♦♠♣ Welches Symbol?'];
  const stepEmojis = ['🎨', '📊', '↔️', '♠'];

  let html = `<div class="bus-section">
    <div class="bus-title">🚌 BUSFAHRER</div>
    <div class="bus-subtitle">${escHtml(busPlayer.name)} muss 4 Karten in Folge richtig erraten!</div>
    <div class="bus-progress">`;

  for (let i = 0; i < 4; i++) {
    let cls = '';
    if (i < busStep) cls = 'done';
    else if (i === busStep) cls = 'current';
    html += `<div class="bus-step ${cls}">${i < busStep ? '✓' : stepEmojis[i]}</div>`;
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
        <div class="choice-title">🤝 Anfrage erhalten</div>
        <div class="choice-question" style="font-size:18px">${escHtml(requester.name)} möchte eine Runde für dich fahren!</div>
        <div class="choice-buttons">
          <button class="btn btn-primary" onclick="respondToBusTakeOver(true)">Annehmen</button>
          <button class="btn btn-secondary" onclick="respondToBusTakeOver(false)">Ablehnen</button>
        </div>
      </div>`;
    } else if (gs.takeOverRequest && !isMainBus && !gs.guestDriverId && !gs.pendingGuestDriverId) {
      html += `<div class="info-box" style="margin-bottom:15px">Anfrage gesendet. Warte auf Bestätigung...</div>`;
    } else if (gs.pendingGuestDriverId) {
      const pPlayer = gs.players[gs.pendingGuestDriverId];
      html += `<div class="info-box" style="margin-bottom:15px">⏳ <strong>${escHtml(pPlayer.name)}</strong> übernimmt nach dem nächsten Fehler!</div>`;
    } else if (guestId) {
      const gPlayer = gs.players[guestId];
      html += `<div class="info-box highlight-border" style="margin-bottom:15px">🌟 <strong>${escHtml(gPlayer.name)}</strong> hat das Steuer für diese Runde übernommen!</div>`;
    } else if (!isMainBus && !gs.takeOverRequest && !gs.guestDriverId && !gs.pendingGuestDriverId && !gs.drinkingActive) {
      html += `<button class="btn btn-secondary btn-large" style="margin-bottom:15px" onclick="requestBusTakeOver()">🙋‍♂️ Steuer für eine Runde übernehmen</button>`;
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
    html += `<div class="info-box" style="margin-top:12px">Neustart #${gs.busRestarts} 🔄</div>`;
  }

  html += `</div>`;

  area.innerHTML = html;

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
      // FALSCH: Der aktuelle Fahrer muss trinken
      const sipsToDrink = (gs.players[myId]?.sipsToDrink || 0) + sips;
      const sipsTotal = (gs.players[myId]?.sipsTotal || 0) + sips;

      const confirmed = {};
      Object.keys(gs.players || {}).forEach(pid => { 
        if(pid !== myId) confirmed[pid] = true; 
      });

      const updates = {
        [`lobbies/${lobbyId}/game/deck`]: deckCopy,
        [`lobbies/${lobbyId}/game/busRestarts`]: (gs.busRestarts || 0) + 1,
        [`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`]: sipsToDrink,
        [`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`]: sipsTotal,
        [`lobbies/${lobbyId}/game/drinkingActive`]: true,
        [`lobbies/${lobbyId}/game/drinkingStartTime`]: Date.now(),
        [`lobbies/${lobbyId}/game/confirmedDrinkers`]: confirmed,
        [`lobbies/${lobbyId}/game/busCards`]: [],
        [`lobbies/${lobbyId}/game/busStep`]: 0,
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
      
      toast(`❌ Falsch! ${sips} Schluck${sips > 1 ? 'e' : ''} trinken 🍺`, 4000);
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
      <div class="rank-num ${i === 0 ? 'first' : ''}">${i === 0 ? '🏆' : i + 1}</div>
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
  for (const pid of gs.playerOrder) {
    const p = gs.players[pid];
    const hand = p.hand || [];
    const isMe = pid === myId;
    const toDrink = p.sipsToDrink || 0;
    const total = p.sipsTotal || 0;

    html += `<div class="player-hand-row">
      <div class="player-hand-name">${escHtml(p.name)}${isMe ? ' 👤' : ''}</div>
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
        ${toDrink > 0 ? `<div class="sip-count-badge">🍺 ${toDrink}</div>` : ''}
        <div style="font-size:12px;color:var(--text-dim);margin-left:8px">Gesamt: ${total}</div>
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
