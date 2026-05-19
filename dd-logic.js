import { VALUE_ORDER, escHtml, cardHTML, toast } from './app.js';

export function renderDrunterDrueber(gs, area, myId, handleChoice, selectRow, passTurn) {
  const currentId = gs.playerOrder[gs.currentPlayerIndex];
  const isMyTurn = currentId === myId;
  const player = gs.players[currentId];

  // Längste Reihe(n) ermitteln
  const rowLengths = (gs.rows || []).map(r => (r.left?.length || 0) + 1 + (r.right?.length || 0));
  const maxLen = Math.max(...rowLengths);
  const longestIndices = rowLengths.map((len, i) => len === maxLen ? i : -1).filter(i => i !== -1);

  let html = `<div class="dd-grid">
    <div class="current-player-badge">
      Dran: <strong>${escHtml(player.name)}</strong> (Serie: ${gs.currentStreak})
      ${player.sipPool > 0 ? `<span class="sip-pool-badge" id="sip-pool-target">🍺 ${player.sipPool}</span>` : ''}
    </div>`;

  (gs.rows || []).forEach((row, idx) => {
    const isLongest = longestIndices.includes(idx);
    const isSelectable = isMyTurn && (!gs.turnStarted ? isLongest : true) && !gs.drinkingActive && !gs.distributionActive;
    const isActive = gs.selectedRowIndex === idx;
    const leftCards = row.left || [];
    const rightCards = row.right || [];
    const rowLen = leftCards.length + 1 + rightCards.length;

    html += `
      <div class="dd-row ${isSelectable ? 'selectable' : ''} ${isActive ? 'active-selection' : ''}" 
           onclick="${isSelectable ? `window.selectDDRow(${idx})` : ''}">
        <div class="dd-row-header">
          <span>Reihe ${idx + 1} ${isLongest ? '🔥' : ''}</span>
          <span>${rowLen} Karten</span>
        </div>
        <div class="dd-row-cards">
          <div class="dd-side-left">
            ${leftCards.slice().reverse().map(c => cardHTML(c, true)).join('')}
          </div>
          <div class="dd-pivot-card">
            ${cardHTML(row.pivot, true)}
          </div>
          <div class="dd-side-right">
            ${rightCards.map(c => cardHTML(c, true)).join('')}
          </div>
        </div>
      </div>`;
  });

  // UI für das Verteilen von Schlucken
  if (gs.distributionActive) {
    const giverId = gs.playerOrder[gs.distributionGiverIndex];
    if (giverId === myId) {
      const pool = gs.players[myId].sipPool || 0;
      html += `
        <div class="choice-section highlight-border">
          <div class="choice-title">Schlucke verteilen! 🍺</div>
          <div class="choice-question">Du hast ${pool} Schlucke</div>
          <div class="distribute-ui">
            <select id="distribute-amount" class="sip-select">
              ${Array.from({length: pool}, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}
            </select>
            <div class="distribute-grid">
              ${gs.playerOrder.filter(id => id !== myId).map(id => `
                <button class="btn btn-secondary distribute-btn" data-target="${id}">${escHtml(gs.players[id].name)}</button>
              `).join('')}
            </div>
            <button class="btn btn-link" onclick="window.skipDistribution()">Rest verfallen lassen</button>
          </div>
        </div>`;
    } else {
      html += `<div class="info-box"><strong>${escHtml(gs.players[giverId].name)}</strong> verteilt gerade Schlucke...</div>`;
    }
  }

  if (isMyTurn && !gs.drinkingActive && !gs.distributionActive) {
    if (gs.selectedRowIndex === undefined || gs.selectedRowIndex === -1) {
      html += `<div class="info-box highlight-border">Wähle eine Reihe zum Anlegen! ${!gs.turnStarted ? '<br>(Du musst an einer der längsten Reihen starten)' : ''}</div>`;
    } else {
      // Auswahl der Seite (Links oder Rechts)
      if (!gs.selectedSide) {
        html += `
          <div class="choice-section">
            <div class="choice-title">Reihe ${gs.selectedRowIndex + 1} gewählt</div>
            <div class="choice-question">Wo möchtest du anlegen?</div>
            <div class="choice-buttons">
              <button class="choice-btn" onclick="window.selectDDSide('left')"><span class="choice-emoji">⬅️</span>Links</button>
              <button class="choice-btn" onclick="window.selectDDSide('right')"><span class="choice-emoji">➡️</span>Rechts</button>
            </div>
          </div>`;
      } else {
        const row = gs.rows[gs.selectedRowIndex];
        const leftCards = row.left || [];
        const rightCards = row.right || [];
        const compareCard = gs.selectedSide === 'left' 
          ? (leftCards.length > 0 ? leftCards[leftCards.length - 1] : row.pivot)
          : (rightCards.length > 0 ? rightCards[rightCards.length - 1] : row.pivot);
        
      html += `
        <div class="choice-section">
          <div class="choice-title">Seite: ${gs.selectedSide === 'left' ? 'Links ⬅️' : 'Rechts ➡️'} (Basis: ${compareCard.value})</div>
          <div class="choice-question">Drunter oder Drüber?</div>
          <div class="choice-buttons">
            <button class="choice-btn" onclick="window.handleDDChoice('over')"><span class="choice-emoji">⬆️</span>Drüber</button>
            <button class="choice-btn" onclick="window.handleDDChoice('under')"><span class="choice-emoji">⬇️</span>Drunter</button>
          </div>
          <button class="btn btn-link" onclick="window.selectDDSide(null)" style="margin-top:10px">🔙 Seite ändern</button>
          ${gs.currentStreak >= 3 ? `<button class="btn btn-secondary btn-large" style="margin-top:15px;" onclick="window.passDDTurn()">💰 Zug sicher beenden</button>` : ''}
        </div>`;
      }
    }
  }

  html += `</div>`;
  area.innerHTML = html;

  // Listener für Verteil-Buttons anhängen
  if (gs.distributionActive && gs.playerOrder[gs.distributionGiverIndex] === myId) {
    area.querySelectorAll('.distribute-btn').forEach(btn => {
      btn.onclick = () => {
        const amt = parseInt(document.getElementById('distribute-amount').value);
        window.distributeSips(btn.dataset.target, amt, gs);
      };
    });
  }
}

export async function initDDGame(players, deck) {
  // 3 Reihen mit je einer Karte starten
  const rows = [
    { pivot: deck.shift(), left: [], right: [] },
    { pivot: deck.shift(), left: [], right: [] },
    { pivot: deck.shift(), left: [], right: [] }
  ];
  const playerStates = {};
  players.forEach(p => {
    playerStates[p.id] = { id: p.id, name: p.name, sipsTotal: 0, sipsToDrink: 0, sipPool: 0 };
  });

  return {
    gameType: 'drunterdrueber',
    phase: 'playing',
    deck,
    rows,
    players: playerStates,
    playerOrder: players.map(p => p.id),
    currentPlayerIndex: 0,
    currentStreak: 0,
    turnStarted: false,
    selectedRowIndex: -1,
    selectedSide: null,
    distributionActive: false,
    drinkingActive: false
  };
}

export function checkDDCorrect(choice, lastCard, drawnCard) {
  const vOld = VALUE_ORDER[lastCard.value];
  const vNew = VALUE_ORDER[drawnCard.value];
  if (vOld === vNew) return false; // Identisch = Verloren
  return (choice === 'over') ? (vNew > vOld) : (vNew < vOld);
}