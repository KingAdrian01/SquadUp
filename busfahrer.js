import { state } from './state.js';
import { getServerNow, renderGame, matchHandCard, handleBusChoice, lastGameState, gameListener, distributeSips } from './app.js';

// ── Deck Sachen ──────────────────────────────────────
export const SUITS = ['♥', '♦', '♠', '♣'];
export const SUIT_NAMES = { '♥': 'Herz', '♦': 'Karo', '♠': 'Pik', '♣': 'Kreuz' };
export const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const VALUE_ORDER = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

export function isRed(suit) { return suit === '♥' || suit === '♦'; }

export function cardColor(suit) { return isRed(suit) ? 'red' : 'black'; }

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ suit: s, value: v });
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Card HTML ──────────────────────────────────────────────
export function cardHTML(card, small = false, extra = '', idx = null) {
  const dataIdx = idx !== null ? `data-idx="${idx}"` : '';
  if (!card) return `<div class="card${small ? '-sm' : ''} face-down ${extra}" ${dataIdx}></div>`;
  const cls = `${small ? 'card-sm' : 'card'} ${cardColor(card.suit)} ${extra}`;
  return `<div class="${cls}" ${dataIdx}>
    <span class="card-value">${card.value}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

// ─ ROUND 1 ──────────────────────────────────────────────
export function renderRound1(gs, isMyTurn, currentPlayer, area) {
  const stepLabels = ['Rot oder Schwarz?', 'Höher oder Tiefer?', 'Innen oder Außen?', 'Welches Symbol?'];
  const step = gs.currentRoundCard;
  const myHand = gs.players[state.myId]?.hand || [];
  const myPool = gs.players[state.myId]?.sipPool || 0;
  const myResponse = gs.round1Responses?.[state.myId];
  const pendingDistribution = gs.distributionPendingPlayers || [];

  let html = '';
  const pendingCount = (gs.distributionPendingPlayers || []).length;
  const pendingMessage = pendingCount > 0
    ? `Noch ${pendingCount} ${pendingCount === 1 ? 'Spieler' : 'Spieler'} müssen ihre Schlucke verteilen, bevor es weitergeht.`
    : 'Alle Schlucke sind verteilt. Es geht gleich weiter.';

  if (gs.distributionActive) {
    html += `<div class="choice-section highlight-border">
      <div class="choice-title">Schlucke verteilen</div>
      <div class="choice-question">${myPool > 0 ? `Du hast noch ${myPool} Schluck${myPool === 1 ? '' : 'e'}` : 'Du hast keine Schlucke mehr zum Verteilen.'}</div>`;

    if (pendingDistribution.includes(state.myId) && myPool > 0) {
      html += `<div class="distribute-ui">
        <div class="distribute-grid">
          ${gs.playerOrder.filter(id => id !== state.myId).map(id => `
            <button class="btn btn-secondary distribute-btn" data-target="${id}">${escHtml(gs.players[id].name)}</button>
          `).join('')}
        </div>
      </div>`;
    } else {
      html += `<div class="info-box">${pendingMessage}</div>`;
    }

    html += `</div>`;
  }

  if (!gs.drinkingActive) {
    if (!gs.distributionActive) {
      if (myHand.length > 0) {
        html += `<div class="choice-section">
          <div class="choice-title">Deine bisherigen Karten</div>
          <div class="cards-row">${myHand.map(c => cardHTML(c)).join('')}</div>
        </div>`;
      }

      html += `<div class="choice-section">
        <div class="choice-title">Karte ${step + 1} von 4</div>
        <div class="choice-question">${stepLabels[step]}</div>`;

      if (myResponse) {
        html += `<div class="spectator-msg"><strong>Antwort gespeichert.</strong><br><em>Warte auf die Auswertung.</em></div>`;
      } else {
        html += `<div class="choice-buttons">
          ${getChoiceButtons(step, myHand)}
        </div>`;
      }

      html += `</div>`;
    }

    html += renderOtherHands(gs);
  }

  area.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();

  if (!gs.distributionActive && !gs.drinkingActive) {
    area.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => handleRound1Choice(btn.dataset.choice, gs));
    });
  }
  if (gs.distributionActive && pendingDistribution.includes(state.myId) && myPool > 0) {
    area.querySelectorAll('.distribute-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        distributeSips(btn.dataset.target, 1, gs);
      });
    });
  }
}

export function getChoiceButtons(step, drawn, disabled = false) {
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

export function evaluateRound1Choice(choice, card, hand, step) {
  if (!card) {
    return { correct: false, sips: step + 1, sipPoolBonus: 0 };
  }

  let correct = false;
  if (step === 0) {
    correct = (choice === 'red') === isRed(card.suit);
  } else if (step === 1) {
    const prev = VALUE_ORDER[hand[0]?.value];
    const cur = VALUE_ORDER[card.value];
    correct = (choice === 'higher' && cur > prev) || (choice === 'lower' && cur < prev);
  } else if (step === 2) {
    const vals = hand.map(c => VALUE_ORDER[c.value]);
    const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
    const cur = VALUE_ORDER[card.value];
    if (choice === 'inside') correct = cur > lo && cur < hi;
    else correct = cur < lo || cur > hi;
  } else if (step === 3) {
    correct = choice === card.suit;
  }

  return {
    correct,
    sips: correct ? 0 : (step + 1),
    sipPoolBonus: correct ? (step + 1) : 0,
  };
}

export function manageDrinkingPopup(gs) {
  if ((gs?.gameType === 'pferderennen' || gs?.phase === 'pferderennen') && !gs?.drinkingActive) return;
  const modal = document.getElementById('drinking-modal');
  if (!modal) return;

  // ── FTD Mode ──────────────────────────────────────────
  if (gs?.gameType === 'ftd' || gs?.phase === 'ftd') {
    const dEvent = gs.drinkingEvent;
    const isMe = dEvent && state.myId === dEvent.drinkerId;

    if (gs.drinkingActive && isMe) {
      modal.classList.add('active');
      modal.style.display = 'flex';

      const countEl = document.getElementById('drinking-count');
      const titleEl = document.getElementById('drinking-title-text');
      const statusEl = document.getElementById('drinking-status-text');
      const btn = document.getElementById('btn-confirm-drinking');

      if (countEl) countEl.textContent = dEvent.sips ?? 1;
      if (titleEl) titleEl.textContent = 'Schlucke für dich';
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.style.display = 'none';
      }
      if (btn) {
        btn.style.display = 'block';
        btn.textContent = 'Ich habe getrunken';
      }
      return;
    } else {
      modal.classList.remove('active');
      modal.style.display = 'none';
      return;
    }
  }

  // ── Busfahrer / Default Mode ─────────────────────────
  const mySips = gs?.players?.[state.myId]?.sipsToDrink || 0;
  const myDrinker = gs?.activeDrinkers?.[state.myId];
  const isDone = myDrinker ? myDrinker.done : (gs?.confirmedDrinkers?.[state.myId] || mySips === 0);
  const sipsToShow = myDrinker ? (myDrinker.sips || mySips) : mySips;

  if (gs?.drinkingActive && !isDone && sipsToShow > 0) {
    modal.classList.add('active');
    modal.style.display = 'flex';
    const countEl = document.getElementById('drinking-count');
    if (countEl) countEl.textContent = sipsToShow;
    const titleEl = document.getElementById('drinking-title-text');
    if (titleEl) titleEl.textContent = 'Schlucke für dich';
    const btn = document.getElementById('btn-confirm-drinking');
    if (btn) {
      btn.style.display = 'block';
      btn.textContent = 'Ich habe getrunken';
    }
    const statusEl = document.getElementById('drinking-status-text');
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
    }
  } else {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

// Hilfsfunktion zum Attachen der Handkarten-Listener
export function attachHandCardListeners(gs) {
  document.querySelectorAll('.hand-card').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      if (!isNaN(idx)) matchHandCard(idx, gs);
    };
  });
}

// ─ ROUND 2 ──────────────────────────────────────────────
export function renderRound2(gs, area) {
  const pyramid = gs.pyramid;
  const size = gs.pyramidSize;
  const pidx = gs.pyramidIndex;
  const matchEndTime = gs.matchEndTime || 0;
  const timeLeft = Math.max(0, Math.ceil((matchEndTime - getServerNow()) / 1000));

  // Step 1
  if (!gs.players[state.myId]?.readyForRound2) {
    area.innerHTML = `
      <div class="choice-section">
        <div class="choice-title">Runde 2: Vorbereitung</div>
        <div class="choice-question">Präge dir deine Karten gut ein!</div>
        <div class="cards-row" style="margin-bottom: 20px">
          ${(gs.players[state.myId]?.hand || []).map(c => cardHTML(c)).join('')}
        </div>
        <button class="btn btn-primary btn-large" onclick="readyUpRound2()">Karten umdrehen & bereit</button>
      </div>
      ${renderAllHands(gs)}`;
    attachHandCardListeners(gs);
    return;
  }

  const allReady = gs.playerOrder.every(pid => gs.players[pid].readyForRound2);
  const giverId = gs.playerOrder[gs.distributionGiverIndex];

  // Build pyramid rows
  const rows = buildPyramidRows(size);
  let flatIdx = 0;
  let html = '';

  html += `<div class="pyramid-section">
    <div class="pyramid-title">Pyramide</div>
    <div class="pyramid-grid">`;

  let rowIndex = 0;
  for (const rowSize of rows) {
    const sips = rowIndex + 1;
    const beers = '🍺'.repeat(sips);
    html += `<div class="pyramid-row-wrap">
      <div class="pyramid-beer-indicator" title="${sips} Schluck${sips > 1 ? 'e' : ''}">${beers}</div>
      <div class="pyramid-row">`;
    for (let i = 0; i < rowSize; i++) {
      const card = pyramid[flatIdx];
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
    html += `</div>
    </div>`;
    rowIndex++;
  }
  html += `</div></div>`;

  // Distribution phase
  if (gs.distributionActive) {
    if (giverId === state.myId) {
      const pool = gs.players[state.myId]?.sipPool || 0;
      html += `<div class="choice-section highlight-border">
        <div class="choice-title">Schlucke verteilen</div>
        <div class="choice-question">${pool > 0 ? `Du hast noch ${pool} Schluck${pool === 1 ? '' : 'e'}` : 'Du hast keine Schlucke mehr zum Verteilen.'}</div>
        <div class="distribute-ui">
          <div class="distribute-grid">
            ${gs.playerOrder.filter(id => id !== state.myId).map(id => `
              <button class="btn btn-secondary distribute-btn" data-target="${id}">${escHtml(gs.players[id].name)}</button>
            `).join('')}
          </div>
        </div>
      </div>`;
    } else {
      const giverName = gs.players?.[giverId]?.name || 'Jemand';
      html += `<div class="info-box"><strong>${escHtml(giverName)}</strong> verteilt gerade Schlucke...</div>`;
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
      if (state.isHost) {
        html += `<div class="choice-section">
          <div class="choice-title">Zeit abgelaufen</div>
          <div class="choice-question">Es gibt Schlucke zu verteilen!</div>
          <button class="btn btn-secondary btn-large" onclick="startPyramidDistribution()">Verteilen starten ➔</button>
        </div>`;
      } else {
        html += `<div class="info-box">Warte auf Verteilung durch Host...</div>`;
      }
    } else if (pidx < size && allReady) {
      if (state.isHost) {
        html += `<div class="choice-section">
          <div class="choice-title">Nächste Pyramidenkarte aufdecken</div>
          <div class="choice-buttons">
            <button class="btn btn-primary btn-large" id="btn-reveal-pyramid">
              <i data-lucide="eye" style="margin-right:8px"></i>Aufdecken
            </button>
          </div>
        </div>`;
      } else {
        html += `<div class="info-box waiting-box-inline"><span>Warte auf die nächste Karte</span><span class="loading-dots"><span></span><span></span><span></span></span></div>`;
      }
    } else if (pidx >= size) {
      if (state.isHost && gs.phase === 'round2' && timeLeft <= 0 && !anyoneHasSips) {
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

  if (state.isHost) {
    const revBtn = document.getElementById('btn-reveal-pyramid');
    if (revBtn) revBtn.addEventListener('click', () => revealPyramidCard(gs));
  }

  if (giverId === state.myId && gs.distributionActive) {
    setupDistributeListeners(gs);
  }
}

export function renderTiebreaker(gs, area) {
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

  if (state.isHost && !gs.matchEndTime && !gs.distributionActive && !gs.drinkingActive) {
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

export function setupDistributeListeners(gs) {
  document.querySelectorAll('.distribute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      distributeSips(btn.dataset.target, 1, gs);
    });
  });
}

export function buildPyramidRows(size) {
  if (size === 6) return [3, 2, 1];
  if (size === 10) return [4, 3, 2, 1];
  return [3, 2, 1];
}

export function getSipsForRow(pidx, size) {
  const rows = buildPyramidRows(size);
  let count = 0;
  for (let r = 0; r < rows.length; r++) {
    count += rows[r];
    if (pidx < count) return r + 1;
  }
  return 1;
}

// ─ ROUND 3 (Busfahrer) ──────────────────────────────────
export function renderRound3(gs, area) {
  const isMainBus = gs.busfahrerId === state.myId;
  const guestId = gs.guestDriverId;
  const isGuestBus = guestId === state.myId;
  const isDriving = isGuestBus || (isMainBus && !guestId);

  const busPlayer = gs.players[gs.busfahrerId];
  const busCards = gs.busCards || [];
  const busStep = gs.busStep;

  const stepLabels = ['Rot oder Schwarz?', 'Höher oder Tiefer?', 'Innen oder Außen?', '♥♦♠♣ Welches Symbol?'];
  const stepIcons = ['palette', 'bar-chart-2', 'arrows-up-from-line', 'spade'];

  let html = `<div class="bus-section">
    <div class="bus-title">🚌 BUSFAHRER</div>
    <div class="bus-subtitle">${guestId ? `<strong>${escHtml(gs.players?.[guestId]?.name || 'Gast')}</strong> springt für ${escHtml(busPlayer?.name || 'den Busfahrer')} ein!` : `${escHtml(busPlayer?.name || 'Busfahrer')} muss 4 Karten in Folge richtig erraten!`}</div>
    <div class="bus-progress">`;

  for (let i = 0; i < 4; i++) {
    let cls = '';
    if (i < busStep) cls = 'done';
    else if (i === busStep) cls = 'current';
    html += `<div class="bus-step ${cls}">${i < busStep ? '<i data-lucide="check" style="width:18px;height:18px;"></i>' : `<i data-lucide="${stepIcons[i]}" style="width:18px;height:18px;"></i>`}</div>`;
  }
  html += `</div>`;

  html += `<div class="bus-revealed-cards">`;
  if (busCards.length === 0) {
    html += `<div style="color:var(--text-dim);font-size:14px">Noch keine Karten aufgedeckt</div>`;
  } else {
    html += busCards.map(c => cardHTML(c)).join('');
  }
  html += `</div>`;

  if (busStep < 4) {
    if (gs.takeOverRequest && isMainBus && !gs.guestDriverId && !gs.pendingGuestDriverId) {
      const reqName = gs.players?.[gs.takeOverRequest]?.name || 'Ein Mitspieler';
      const isUntouched = (busStep === 0 && busCards.length === 0);
      const questionText = isUntouched
        ? `${escHtml(reqName)} möchte sofort das Steuer für dich übernehmen!`
        : `${escHtml(reqName)} möchte nach deinem nächsten Fehler für dich einspringen!`;

      html += `<div class="choice-section highlight-border" style="margin-bottom:15px">
        <div class="choice-title"><i data-lucide="handshake" style="margin-right:8px;"></i>Anfrage erhalten</div>
        <div class="choice-question" style="font-size:18px">${questionText}</div>
        <div class="choice-buttons">
          <button class="btn btn-primary btn-with-icon" onclick="respondToBusTakeOver(true)">Annehmen <i data-lucide="check"></i></button>
          <button class="btn btn-secondary" onclick="respondToBusTakeOver(false)">Ablehnen</button>
        </div>
      </div>`;
    } else if (gs.takeOverRequest && !isMainBus && !gs.guestDriverId && !gs.pendingGuestDriverId) {
      const isRequester = gs.takeOverRequest === state.myId;
      if (isRequester) {
        html += `<div class="info-box" style="margin-bottom:15px"><i data-lucide="timer"></i> Deine Mitfahr-Anfrage wurde gesendet. Warte auf Antwort...</div>`;
      } else {
        const reqName = gs.players?.[gs.takeOverRequest]?.name || 'Jemand';
        html += `<div class="info-box" style="margin-bottom:15px"><i data-lucide="handshake"></i> ${escHtml(reqName)} möchte das Steuer übernehmen...</div>`;
      }
    } else if (gs.pendingGuestDriverId) {
      const pPlayer = gs.players?.[gs.pendingGuestDriverId];
      const pName = pPlayer?.name || 'Jemand';
      const isMe = gs.pendingGuestDriverId === state.myId;
      html += `<div class="info-box" style="margin-bottom:15px"><i data-lucide="timer"></i> <strong>${isMe ? 'Du übernimmst' : escHtml(pName) + ' übernimmt'}</strong> nach dem nächsten Fehler das Steuer!</div>`;
    } else if (guestId) {
      const gPlayer = gs.players?.[guestId];
      const gName = gPlayer?.name || 'Gast';
      const isMe = guestId === state.myId;
      html += `<div class="info-box highlight-border" style="margin-bottom:15px"><i data-lucide="star" style="color:var(--accent);"></i> <strong>${isMe ? 'Du fährst diese Runde (am Steuer)' : escHtml(gName) + ' fährt diese Runde!'}</strong></div>`;
    } else if (!isMainBus && !gs.takeOverRequest && !gs.guestDriverId && !gs.pendingGuestDriverId && !gs.drinkingActive) {
      html += `<button class="btn btn-secondary btn-large btn-with-icon" style="margin-bottom:15px" onclick="requestBusTakeOver()"><i data-lucide="hand" style="margin-right:8px;"></i>Steuer für eine Runde übernehmen</button>`;
    }

    html += `<div class="choice-title">${stepLabels[busStep]}</div>
      <div class="choice-buttons" style="margin-top:12px">
        ${getBusChoiceButtons(busStep, busCards, !isDriving || gs.drinkingActive)}
      </div>`;

    if (!isDriving && !gs.drinkingActive) {
      const activeName = guestId ? (gs.players?.[guestId]?.name || 'Gast') : (busPlayer?.name || 'Busfahrer');
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

export function getBusChoiceButtons(step, drawn, disabled = false) {
  return getChoiceButtons(step, drawn, disabled);
}

// ─ END SCREEN ──────────────────────────────────────────────
export function renderEnd(gs, area) {
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
      <div class="rank-name">${escHtml(p.name)} ${p.id === state.myId ? '<em style="color:var(--text-muted);font-size:13px">(du)</em>' : ''}</div>
      <div class="rank-info">${p.sips} Schlucke getrunken</div>
    </div>`;
  });

  html += `</div>`;

  // Hier rufen wir jetzt die globalen Fenster-Funktionen auf:
  if (state.isHost) {
    html += `<button class="btn btn-primary btn-large" onclick="window.restartGame()" id="btn-play-again">Nochmal spielen 🔄</button>`;
    html += `<br><br>`;
  }
  html += `<button class="btn btn-secondary btn-large" onclick="window.exitToLobby()" id="btn-back-home" style="margin-top:10px">Zurück zur Lobby</button>`;
  html += `</div>`;

  area.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

// ─ HELPERS ─────────────────────────────────────────────────
export function renderAllHands(gs) {
  const handsStarted = Object.values(gs.players).some(p => p.hand && p.hand.length > 0);
  if (!handsStarted && gs.phase === 'round1') return '';

  let html = `<div class="players-hands">
    <div class="section-title">Karten auf der Hand</div>`;

  const sortedPlayerOrder = [...gs.playerOrder].sort((a, b) => {
    if (a === state.myId) return -1;
    if (b === state.myId) return 1;
    return 0;
  });

  for (const pid of sortedPlayerOrder) {
    const p = gs.players[pid];
    const hand = p.hand || [];
    const isMe = pid === state.myId;
    const toDrink = p.sipsToDrink || 0;

    html += `<div class="player-hand-row">
      <div class="player-hand-name">${escHtml(p.name)}${isMe ? ' <i data-lucide="user" class="icon-sm" style="opacity:0.5"></i>' : ''}</div>
      <div class="player-hand-cards">
        ${hand.length === 0
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

export function renderOtherHands(gs) {
  const handsStarted = Object.values(gs.players).some(p => p.hand && p.hand.length > 0);
  if (!handsStarted && gs.phase === 'round1') return '';

  const orderedPlayers = [...(gs.playerOrder || [])];
  const myIndex = orderedPlayers.indexOf(state.myId);
  if (myIndex > -1) {
    orderedPlayers.splice(myIndex, 1);
    orderedPlayers.unshift(state.myId);
  }
  if (orderedPlayers.length === 0) return '';

  let html = `<div class="players-hands">
    <div class="section-title">Karten auf der Hand</div>`;

  for (const pid of orderedPlayers) {
    const p = gs.players[pid];
    const hand = p.hand || [];
    const isMe = pid === state.myId;
    const toDrink = p.sipsToDrink || 0;

    html += `<div class="player-hand-row">
      <div class="player-hand-name">${escHtml(p.name)}${isMe ? ' <i data-lucide="user" class="icon-sm" style="opacity:0.5"></i>' : ''}</div>
      <div class="player-hand-cards">
        ${hand.length === 0
        ? `<span style="font-size:13px;color:var(--text-dim)">keine</span>`
        : hand.map(c => cardHTML(c, true)).join('')
      }
      </div>
      <div class="player-sip-status">
        ${toDrink > 0 ? `<div class="sip-count-badge"><i data-lucide="beer" style="width:12px;height:12px;margin-right:2px;"></i> ${toDrink}</div>` : ''}
      </div>
    </div>`;
  }

  html += `</div>`;
  return html;
}

export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}