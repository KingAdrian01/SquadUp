import { VALUE_ORDER, escHtml, cardHTML, toast } from './app.js';

export function renderDrunterDrueber(gs, area, myId, handleChoice, selectRow, passTurn) {
  const currentId = gs.playerOrder[gs.currentPlayerIndex];
  const isMyTurn = currentId === myId;
  const player = gs.players[currentId];

  // Längste Reihe ermitteln
  const rowLengths = (gs.rows || []).map(r => (r.left?.length || 0) + 1 + (r.right?.length || 0));
  const maxLen = Math.max(...rowLengths);
  const longestIndices = rowLengths.map((len, i) => len === maxLen ? i : -1).filter(i => i !== -1);

  let html = `<div class="dd-grid">
    <div class="current-player-badge">
      Dran: <strong>${escHtml(player.name)}</strong> (Serie: ${gs.currentStreak})
      ${player.sipPool > 0 ? `<span class="sip-pool-badge" id="sip-pool-target"><i data-lucide="beer" style="width:14px;height:14px;margin-right:4px;"></i> ${player.sipPool}</span>` : ''}
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
          <span>Reihe ${idx + 1} ${isLongest ? '<i data-lucide="flame" style="color:var(--accent);width:12px;height:12px;"></i>' : ''}</span>
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

  // UI Verteilen von Schlucken
  if (gs.distributionActive) {
    const giverId = gs.playerOrder[gs.distributionGiverIndex];
    if (giverId === myId) {
      const pool = gs.players[myId].sipPool || 0;
      html += `
        <div class="choice-section highlight-border">
          <div class="choice-title">Schlucke verteilen! <i data-lucide="beer" class="icon-sm"></i></div>
          <div class="choice-question">Du hast ${pool} Schluck${pool === 1 ? '' : 'e'}</div>
          <div class="distribute-ui">
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

  if (isMyTurn && !gs.drinkingActive && !gs.distributionActive) {
    if (gs.selectedRowIndex === undefined || gs.selectedRowIndex === -1) {
      html += `<div class="info-box highlight-border">Wähle eine Reihe zum Anlegen! ${!gs.turnStarted ? '<br>(Du musst an einer der längsten Reihen starten)' : ''}</div>`;
    } else {
      // Auswahl der Seite (Links oder Rechts)
      if (!gs.selectedSide) {
        html += `
          <div class="choice-section">
            <div class="choice-title">Reihe ${gs.selectedRowIndex + 1} gewählt</div>
            <div class="choice-question">Welche Seite?</div>
            <div class="choice-buttons">
              <button class="choice-btn" onclick="window.selectDDSide('left')"><i data-lucide="arrow-left"></i>Links</button>
              <button class="choice-btn" onclick="window.selectDDSide('right')"><i data-lucide="arrow-right"></i>Rechts</button>
            </div>
            ${gs.currentStreak >= 3 ? `<button class="btn btn-secondary btn-large btn-with-icon" style="margin-top:10px;" onclick="window.passDDTurn()"><i data-lucide="shield-check" style="margin-right:8px;"></i>Zug sicher beenden</button>` : ''}
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
          <div class="choice-title">Seite: ${gs.selectedSide === 'left' ? 'Links' : 'Rechts'} (Basis: ${compareCard.value})</div>
          <div class="choice-question">Drunter oder Drüber?</div>
          <div class="choice-buttons">
            <button class="choice-btn" onclick="window.handleDDChoice('over')"><i data-lucide="chevron-up"></i>Drüber</button>
            <button class="choice-btn" onclick="window.handleDDChoice('under')"><i data-lucide="chevron-down"></i>Drunter</button>
          </div>
          <button class="btn btn-link btn-with-icon" onclick="window.selectDDSide(null)" style="margin-top:10px"><i data-lucide="undo-2" style="width:14px;height:14px;margin-right:4px;"></i>Seite ändern</button>
        </div>`;
      }
    }
  }

  html += `</div>`;
  area.innerHTML = html;

  // Icons initialisieren nach dem Rendern
  if (window.lucide) window.lucide.createIcons();

  // Listener für Verteil-Buttons anhängen
  if (gs.distributionActive && gs.playerOrder[gs.distributionGiverIndex] === myId) {
    area.querySelectorAll('.distribute-btn').forEach(btn => {
      btn.onclick = () => {
        window.distributeSips(btn.dataset.target, 1, gs); // Immer fester Wert 1
      };
    });
  }
}

export async function initDDGame(players, deck) {
  // 3 Reihen mit je einer Karte
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
