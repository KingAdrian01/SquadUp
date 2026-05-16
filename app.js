// ===================================================
//  BUSFAHRER – app.js
//  Full multiplayer via Firebase Realtime Database
// ===================================================

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
  const app = m.initializeApp(config); // Kein Zeitstempel mehr nötig
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
let isProcessing = false; // Prevents double-clicks
let pyramidSize = 6;

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
function cardHTML(card, small = false, extra = '') {
  if (!card) return `<div class="card${small ? '-sm' : ''} face-down"></div>`;
  const cls = `${small ? 'card-sm' : 'card'} ${cardColor(card.suit)} ${extra}`;
  return `<div class="${cls}">
    <span class="card-value">${card.value}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

// ── Lobby Code Gen ────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── INIT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // Startet direkt mit deiner festen Config von oben
    await initFirebase(myConfig);
    
    // Schließt das Modal sofort, falls es im HTML auf "active" steht
    const modal = document.getElementById('firebase-modal');
    if (modal) modal.classList.remove('active');
    
    // Startet die Home-Oberfläche
    setupHomeUI();
    console.log("Firebase automatisch verbunden! 🔥");
  } catch (e) {
    console.error("Firebase Fehler:", e);
    toast('❌ Verbindung fehlgeschlagen');
  }
});

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
}

// ── CREATE LOBBY ──────────────────────────────────────────
async function createLobby() {
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
    pyramidSize: 6,
    players: {
      [myId]: { name: myName, id: myId, host: true, joinedAt: Date.now() }
    }
  });

  // Auto-remove on disconnect
  onDisconnect(ref(db, `lobbies/${lobbyId}/players/${myId}`)).remove();

  enterLobbyScreen();
}

// ── JOIN LOBBY ─────────────────────────────────────────────
async function joinLobby() {
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

  pyramidSize = lobby.pyramidSize || 6;
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
    const players = snap.val() || {};
    renderPlayerList(players);
  });

  // Listen for game start
  const gameRef = ref(db, `lobbies/${lobbyId}/game`);
  const unsub2 = onValue(gameRef, snap => {
    if (snap.exists()) {
      const game = snap.val();
      lastGameState = game;
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
    const emoji = ['🎴','🃏','🂡','🂮','🂻','🂹'][sorted.indexOf(p) % 6];
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
  if (lobbyId) {
    await remove(ref(db, `lobbies/${lobbyId}/players/${myId}`));
    if (isHost) await remove(ref(db, `lobbies/${lobbyId}`));
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
  let di = 0;
  for (const p of players) {
    playerStates[p.id] = {
      id: p.id,
      name: p.name,
      hand: [], // Start empty, filled during R1
      drawnCards: [],
      sipPool: 0, // Schlucke, die man verteilen darf
      sipsToDrink: 0,
      sipsTotal: 0
    };
  }

  // Build pyramid
  const pyrCards = [];
  for (let i = 0; i < pyramidSize; i++) pyrCards.push(deck[di++]);

  // Remaining deck for bus
  const remaining = deck.slice(di);

  const gameState = {
    phase: 'round1',
    pyramidSize,
    deck: remaining,
    pyramid: pyrCards.map(c => ({ ...c, revealed: false })),
    players: playerStates,
    playerOrder: players.map(p => p.id),
    currentPlayerIndex: 0,
    currentRoundCard: 0, // 0 bis 3 (für die 4 Karten)
    drawnForCurrentPlayer: [],
    round1Done: false,
    pyramidIndex: 0,
    distributionActive: false,
    distributionGiverIndex: 0, // Wer ist gerade beim Verteilen dran
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
    if (!snap.exists()) return;
    lastGameState = snap.val();
    renderGame(lastGameState);
  });
}

function renderGame(gs) {
  const area = document.getElementById('game-area');
  const phaseBadge = document.getElementById('phase-badge');
  const cpBadge = document.getElementById('current-player-badge');
  const progress = document.getElementById('round-progress');

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
    progress.textContent = `${gs.pyramidIndex}/${gs.pyramid.length} aufgedeckt`;
    renderRound2(gs, area);
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

function getChoiceButtons(step, drawn) {
  if (step === 0) {
    return `<button class="choice-btn" data-choice="red"><span class="choice-emoji">🔴</span>Rot</button>
            <button class="choice-btn" data-choice="black"><span class="choice-emoji">⚫</span>Schwarz</button>`;
  }
  if (step === 1) {
    return `<button class="choice-btn" data-choice="higher"><span class="choice-emoji">⬆️</span>Höher</button>
            <button class="choice-btn" data-choice="same"><span class="choice-emoji">↔️</span>Gleich</button>
            <button class="choice-btn" data-choice="lower"><span class="choice-emoji">⬇️</span>Tiefer</button>`;
  }
  if (step === 2) {
    const lo = VALUE_ORDER[drawn[0].value];
    const hi = VALUE_ORDER[drawn[1].value];
    const [min, max] = [Math.min(lo, hi), Math.max(lo, hi)];
    return `<button class="choice-btn" data-choice="inside"><span class="choice-emoji">🔲</span>Innen (${drawn.map(c=>c.value).join('-')})</button>
            <button class="choice-btn" data-choice="outside"><span class="choice-emoji">📤</span>Außen</button>`;
  }
  if (step === 3) {
    return SUITS.map(s => `<button class="choice-btn" data-choice="${s}">
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
    const hand = [...(player.hand || [])];
    const step = gs.currentRoundCard;
    let correct = false;

    if (step === 0) {
      correct = (choice === 'red') === isRed(drawnCard.suit);
    } else if (step === 1) {
      const prev = VALUE_ORDER[hand[0].value];
      const cur = VALUE_ORDER[drawnCard.value];
      if (choice === 'higher') correct = cur > prev;
      else if (choice === 'lower') correct = cur < prev;
      else correct = cur === prev;
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
    updates[`lobbies/${lobbyId}/game/deck`] = deckCopy;
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
      // Alle Spieler haben die aktuelle Karte gezogen -> Ersten Verteiler suchen
      let firstGiverIdx = -1;
      for (let i = 0; i < gs.playerOrder.length; i++) {
        const pid = gs.playerOrder[i];
        let pool = gs.players[pid].sipPool || 0;
        // Wenn ich es bin, berechne den soeben gewonnenen Pool mit ein
        if (pid === myId && correct) pool += (step + 1);
        if (pool > 0) {
          firstGiverIdx = i;
          break;
        }
      }

      if (firstGiverIdx !== -1) {
        updates[`lobbies/${lobbyId}/game/distributionActive`] = true;
        updates[`lobbies/${lobbyId}/game/distributionGiverIndex`] = firstGiverIdx;
      } else {
        // Niemand hat Schlucke zum Verteilen -> Prüfen ob jemand trinken muss
        let needsToDrink = false;
        for (const pid of gs.playerOrder) {
          const toDrink = (gs.players[pid].sipsToDrink || 0) + (pid === myId && !correct ? (step + 1) : 0);
          if (toDrink > 0) { needsToDrink = true; break; }
        }

        if (needsToDrink) {
          updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
          updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = Date.now();
          updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = {};
        } else {
          // Keiner verteilt, keiner trinkt -> Direkt zur nächsten Karte
          const nextCard = gs.currentRoundCard + 1;
          if (nextCard >= 4) updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
          else updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextCard;
        }
      }
      updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
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
  if (isProcessing) return;
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
  // No more pool to distribute -> START DRINKING PHASE
  updates[`lobbies/${lobbyId}/game/distributionActive`] = false;
  updates[`lobbies/${lobbyId}/game/drinkingActive`] = true;
  updates[`lobbies/${lobbyId}/game/drinkingStartTime`] = Date.now();
  updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = {};
  await update(ref(db), updates);
}

async function confirmSips() {
  if (!lastGameState || isProcessing) return;
  // Verhindern, dass man mehrfach klickt, wenn man bereits bestätigt hat
  if (lastGameState.confirmedDrinkers && lastGameState.confirmedDrinkers[myId]) return;

  isProcessing = true;
  try {
    const updates = {};
    
    // Berechne die Anzahl der bereits bestätigten Spieler
    const confirmedObj = lastGameState.confirmedDrinkers || {};
    const currentlyConfirmedCount = Object.keys(confirmedObj).length;
    const totalPlayers = Object.keys(lastGameState.players || {}).length;

    // Schlucke für diesen Spieler auf 0 setzen
    updates[`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`] = 0;

    // Wenn ich der Letzte bin, der bestätigt: Phase beenden und Liste leeren
    if (currentlyConfirmedCount + 1 >= totalPlayers) {
      // Everyone confirmed -> Next Card or Phase
      updates[`lobbies/${lobbyId}/game/drinkingActive`] = false;
      // WICHTIG: Den gesamten Knoten auf null setzen, statt einzelne Kinder
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers`] = null;
      
      const nextRoundCard = lastGameState.currentRoundCard + 1;
      if (nextRoundCard >= 4) {
        updates[`lobbies/${lobbyId}/game/phase`] = 'round2';
      } else {
        updates[`lobbies/${lobbyId}/game/currentRoundCard`] = nextRoundCard;
        updates[`lobbies/${lobbyId}/game/currentPlayerIndex`] = 0;
      }
    } else {
      // Nur mich selbst als bestätigt markieren
      updates[`lobbies/${lobbyId}/game/confirmedDrinkers/${myId}`] = true;
    }

    await update(ref(db), updates);
  } catch (e) {
    console.error(e);
    toast("Fehler bei der Bestätigung ❌");
  } finally {
    isProcessing = false;
  }
}

function manageDrinkingPopup(gs) {
  const modal = document.getElementById('drinking-modal');
  if (gs.drinkingActive) {
    modal.classList.add('active');
    const mySips = gs.players[myId].sipsToDrink || 0;
    document.getElementById('drinking-count').textContent = mySips;
    const hasConfirmed = gs.confirmedDrinkers && gs.confirmedDrinkers[myId];
    document.getElementById('btn-confirm-drinking').style.display = hasConfirmed ? 'none' : 'block';
    document.getElementById('drinking-status-text').textContent = hasConfirmed ? 'Warte auf andere...' : 'Trink deine Schlucke!';
  } else {
    modal.classList.remove('active');
  }
}

// ─ ROUND 2 ──────────────────────────────────────────────
function renderRound2(gs, area) {
  const pyramid = gs.pyramid;
  const size = gs.pyramidSize;
  const pidx = gs.pyramidIndex;

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
      const isCurrent = flatIdx === pidx && !card.revealed;
      const isDone = card.revealed || flatIdx < pidx;
      if (card.revealed) {
        html += `<div class="pyramid-card revealed ${cardColor(card.suit)} ${flatIdx < pidx ? 'done' : ''}" data-idx="${flatIdx}">
          <span class="card-value">${card.value}</span>
          <span class="card-suit">${card.suit}</span>
          <div class="sip-badge">${sips}</div>
        </div>`;
      } else {
        html += `<div class="pyramid-card face-down ${isCurrent ? 'current-reveal' : ''}" data-idx="${flatIdx}"></div>`;
      }
      flatIdx++;
    }
    html += `</div>`;
    rowIndex++;
  }
  html += `</div></div>`;

  // Current card reveal
  if (pidx < pyramid.length) {
    const currentCard = pyramid[pidx];
    if (!currentCard.revealed) {
      if (isHost) {
        html += `<div class="choice-section">
          <div class="choice-title">Nächste Pyramidenkarte aufdecken</div>
          <div class="choice-question">Karte ${pidx + 1} von ${size}</div>
          <div class="choice-buttons">
            <button class="choice-btn" id="btn-reveal-pyramid" style="flex:1">
              <span class="choice-emoji">🃏</span>Aufdecken
            </button>
          </div>
        </div>`;
      } else {
        html += `<div class="info-box">Warte auf den Host...<br><div class="loading-dots" style="margin-top:8px"><span></span><span></span><span></span></div></div>`;
      }
    }
  } else {
    // All revealed – determine busfahrer
    if (isHost && !gs.busfahrerId) {
      determineBusfahrer(gs);
    }
    html += `<div class="info-box">Alle Karten aufgedeckt! <strong>Busfahrer wird ermittelt...</strong></div>`;
  }

  // All players hands
  html += renderAllHands(gs);

  area.innerHTML = html;

  if (isHost) {
    const revBtn = document.getElementById('btn-reveal-pyramid');
    if (revBtn) revBtn.addEventListener('click', () => revealPyramidCard(gs));
  }
}

function buildPyramidRows(size) {
  if (size === 6) return [3, 2, 1];
  if (size === 10) return [4, 3, 2, 1];
  return [3, 2, 1];
}

async function revealPyramidCard(gs) {
  const pidx = gs.pyramidIndex;
  if (pidx >= gs.pyramid.length || isProcessing) return;
  const pyramid = [...gs.pyramid];
  const card = pyramid[pidx];
  card.revealed = true;
  pyramid[pidx] = card;

  // Check matches
  const rows = buildPyramidRows(gs.pyramidSize);
  let rowIndex = 0, fi = 0;
  for (const rs of rows) {
    for (let i = 0; i < rs; i++) {
      if (fi === pidx) {
        // row rowIndex → sips = rowIndex + 1
        const sips = rowIndex + 1;
        const matchPlayers = [];
        for (const pid of gs.playerOrder) {
          const phand = gs.players[pid].hand || [];
          const matches = phand.filter(hc => hc.value === card.value);
          if (matches.length > 0) matchPlayers.push({ pid, sips, matches, pname: gs.players[pid].name });
        }
        // Show toast
        if (matchPlayers.length > 0) {
          const names = matchPlayers.map(m => m.pname).join(', ');
          toast(`${card.value}${card.suit} – ${names} trinkt ${sips} Schluck${sips > 1 ? 'e' : ''} 🍺`, 4000);
        } else {
          toast(`${card.value}${card.suit} – Keine Übereinstimmung`);
        }
        break;
      }
      fi++;
    }
    if (fi > pidx) break;
    rowIndex++;
  }

  const updates = {};
  updates[`lobbies/${lobbyId}/game/pyramid`] = pyramid;
  updates[`lobbies/${lobbyId}/game/pyramidIndex`] = pidx + 1;

  // Remove matched cards from player hands
  const sipsAdd = {};
  for (const pid of gs.playerOrder) {
    let hand = [...(gs.players[pid].hand || [])];
    const rows2 = buildPyramidRows(gs.pyramidSize);
    let ri = 0, fi2 = 0;
    let sipsForMatch = 1;
    for (const rs of rows2) {
      for (let i = 0; i < rs; i++) {
        if (fi2 === pidx) { sipsForMatch = ri + 1; break; }
        fi2++;
      }
      if (fi2 > pidx) break;
      ri++;
    }
    const before = hand.length;
    hand = hand.filter(hc => hc.value !== card.value);
    const removed = before - hand.length;
    if (removed > 0) {
      sipsAdd[pid] = (gs.players[pid].sipsTotal || 0) + sipsForMatch * removed;
      updates[`lobbies/${lobbyId}/game/players/${pid}/hand`] = hand;
      updates[`lobbies/${lobbyId}/game/players/${pid}/sipsTotal`] = sipsAdd[pid];
    }
  }

  if (pidx + 1 >= gs.pyramid.length) {
    // Move to determine busfahrer (will be done in render)
  }

  await update(ref(db), updates);
}

async function determineBusfahrer(gs) {
  // Player with most cards. Tiebreak: lowest card value
  const players = gs.playerOrder.map(pid => ({
    pid,
    hand: gs.players[pid].hand || [],
    name: gs.players[pid].name
  }));

  if (gs.phase !== 'round2') return; // Double gate
  const maxCards = Math.max(...players.map(p => p.hand.length));
  if (maxCards === 0) {
    // No cards left – use sips
    const loser = players.reduce((a, b) => (b.sipsTotal || 0) > (a.sipsTotal || 0) ? b : a);
    await update(ref(db), {
      [`lobbies/${lobbyId}/game/busfahrerId`]: loser.pid,
      [`lobbies/${lobbyId}/game/phase`]: 'round3',
      [`lobbies/${lobbyId}/game/busStep`]: 0,
      [`lobbies/${lobbyId}/game/busCards`]: [],
      [`lobbies/${lobbyId}/game/busRestarts`]: 0,
    });
    return;
  }

  const candidates = players.filter(p => p.hand.length === maxCards);
  let busfahrer;
  if (candidates.length === 1) {
    busfahrer = candidates[0];
  } else {
    // Tiebreak: lowest card
    busfahrer = candidates.reduce((a, b) => {
      const aMin = Math.min(...a.hand.map(c => VALUE_ORDER[c.value]));
      const bMin = Math.min(...b.hand.map(c => VALUE_ORDER[c.value]));
      return bMin < aMin ? b : a;
    });
  }

  toast(`🚌 ${busfahrer.name} ist der Busfahrer!`, 4000);
  await update(ref(db), {
    [`lobbies/${lobbyId}/game/busfahrerId`]: busfahrer.pid,
    [`lobbies/${lobbyId}/game/phase`]: 'round3',
    [`lobbies/${lobbyId}/game/busStep`]: 0,
    [`lobbies/${lobbyId}/game/busCards`]: [],
    [`lobbies/${lobbyId}/game/busRestarts`]: 0,
  });
}

// ─ ROUND 3 (Busfahrer) ──────────────────────────────────
function renderRound3(gs, area) {
  const isBus = gs.busfahrerId === myId;
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
    if (isBus) {
      html += `<div class="choice-title">${stepLabels[busStep]}</div>
        <div class="choice-buttons" style="margin-top:12px">
          ${getBusChoiceButtons(busStep, busCards)}
        </div>`;
    } else {
      html += `<div class="spectator-msg"><strong>${escHtml(busPlayer.name)}</strong> ist dran...<br>
        <em>${stepLabels[busStep]}</em>
        <div style="margin-top:16px"><div class="loading-dots"><span></span><span></span><span></span></div></div>
      </div>`;
    }
  }

  if (gs.busRestarts > 0) {
    html += `<div class="info-box" style="margin-top:12px">Neustart #${gs.busRestarts} 🔄</div>`;
  }

  html += `</div>`;

  area.innerHTML = html;

  if (isBus && busStep < 4) {
    area.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => handleBusChoice(btn.dataset.choice, gs));
    });
  }
}

function getBusChoiceButtons(step, drawn) {
  return getChoiceButtons(step, drawn);
}

async function handleBusChoice(choice, gs) {
  if (isProcessing) return;
  isProcessing = true;
  const busCards = [...(gs.busCards || [])];
  const deckCopy = [...gs.deck];
  const drawnCard = deckCopy.shift();
  const step = gs.busStep;
  let correct = false;

  if (step === 0) {
    correct = (choice === 'red') === isRed(drawnCard.suit);
  } else if (step === 1) {
    const prev = VALUE_ORDER[busCards[0].value];
    const cur = VALUE_ORDER[drawnCard.value];
    if (choice === 'higher') correct = cur > prev;
    else if (choice === 'lower') correct = cur < prev;
    else correct = cur === prev;
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
      // WIN!
      await update(ref(db), {
        [`lobbies/${lobbyId}/game/deck`]: deckCopy,
        [`lobbies/${lobbyId}/game/busCards`]: newBusCards,
        [`lobbies/${lobbyId}/game/busStep`]: 4,
        [`lobbies/${lobbyId}/game/phase`]: 'end',
      });
      toast('🎉 Busfahrer geschafft! Spiel beendet!', 4000);
    } else {
      await update(ref(db), {
        [`lobbies/${lobbyId}/game/deck`]: deckCopy,
        [`lobbies/${lobbyId}/game/busCards`]: newBusCards,
        [`lobbies/${lobbyId}/game/busStep`]: step + 1,
      });
      toast('✅ Richtig! Weiter...');
    }
  } else {
    // Wrong – drink and restart
    toast(`❌ Falsch! ${sips} Schluck${sips > 1 ? 'e' : ''} trinken 🍺 – Von vorne!`, 4000);
    await update(ref(db), {
      [`lobbies/${lobbyId}/game/deck`]: deckCopy,
      [`lobbies/${lobbyId}/game/busCards`]: [],
      [`lobbies/${lobbyId}/game/busStep`]: 0,
      [`lobbies/${lobbyId}/game/busRestarts`]: (gs.busRestarts || 0) + 1,
      [`lobbies/${lobbyId}/game/players/${myId}/sipsToDrink`]: (gs.players[myId]?.sipsToDrink || 0) + sips,
      [`lobbies/${lobbyId}/game/players/${myId}/sipsTotal`]: (gs.players[myId]?.sipsTotal || 0) + sips,
    });
  }
  isProcessing = false;
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
        ${hand.length === 0
          ? `<span style="font-size:13px;color:var(--text-dim)">keine</span>`
          : hand.map(c => cardHTML(c, true)).join('')}
      </div>
      <div class="player-sip-status">
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
