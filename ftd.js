/**
 * ftd.js – "Fuck the Dealer" render module
 *
 * Exports: renderFtd(gs, area), cleanupFtd()
 * All Firebase write actions live in app.js as window.ftd*
 */
import { state } from './state.js';
import { escHtml, VALUES, SUITS, VALUE_ORDER } from './busfahrer.js';

// ── Module cleanup (reserved for future timers) ────────────
export function cleanupFtd() {
  // no-op for now
}

// ── Main render entry point ────────────────────────────────
export function renderFtd(gs, area) {
  let container = area.querySelector('.ftd-container');
  const isFirstLoad = !container;
  if (isFirstLoad) {
    container = document.createElement('div');
    container.className = 'ftd-container';
    area.innerHTML = '';
    area.appendChild(container);

    // Sicherstellen, dass der Screen beim Laden immer direkt ganz oben startet
    const screen = document.getElementById('screen-game');
    if (screen) screen.scrollTop = 0;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      if (screen) screen.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    setTimeout(() => {
      if (screen) screen.scrollTop = 0;
      window.scrollTo(0, 0);
    }, 40);
  }

  const myId = state.myId;
  const order = gs.playerOrder || [];
  const dealerIdx = gs.dealerIndex ?? 0;
  const raterIdx = gs.raterIndex ?? 1;
  const dealerId = order[dealerIdx];
  const raterId = order[raterIdx];
  const isDealer = myId === dealerId;
  const isRater = myId === raterId;

  container.innerHTML =
    _header(gs) +
    _graveyard(gs) +
    _actionSheet(gs, isDealer, isRater);
}

// ── Header Card ────────────────────────────────────────────
function _header(gs) {
  const order = gs.playerOrder || [];
  const dealerName = gs.players?.[order[gs.dealerIndex ?? 0]]?.name ?? '?';
  const raterName = gs.players?.[order[gs.raterIndex ?? 1]]?.name ?? '?';
  const deckLeft = (gs.deck || []).length;
  const fail = gs.failStreak || 0;

  const dots = [0, 1, 2].map(i =>
    `<div class="ftd-dot${i < fail ? ' ftd-dot--on' : ''}"></div>`
  ).join('');

  return `
<div class="ftd-header-card">
  <div class="ftd-roles-row">
    <div class="ftd-role">
      <span class="ftd-role-badge ftd-role-badge--dealer">DEALER</span>
      <span class="ftd-role-name">${escHtml(dealerName)}</span>
    </div>
    <span class="ftd-vs-sep">vs</span>
    <div class="ftd-role ftd-role--right">
      <span class="ftd-role-badge ftd-role-badge--rater">RATER</span>
      <span class="ftd-role-name">${escHtml(raterName)}</span>
    </div>
  </div>
  <div class="ftd-meta-row">
    <span class="ftd-deck-pill">🂠 ${deckLeft} Karten</span>
    <div class="ftd-fail-track">
      <span class="ftd-fail-lbl">Fails</span>
      <div class="ftd-dots">${dots}</div>
    </div>
  </div>
</div>`;
}

// ── Graveyard Grid (13 ranks x 4 suits tracked individually) ──
function _graveyard(gs) {
  const gy = gs.graveyard || {};

  const boxes = VALUES.map(rank => {
    const usedSuits = gy[rank] || [];
    const allGone = usedSuits.length === 4;

    const suits = SUITS.map(s => {
      const gone = usedSuits.includes(s);
      const red = s === '♥' || s === '♦';
      return `<span class="ftd-gs${gone ? ' ftd-gs--gone' : ''}${red ? ' ftd-gs--red' : ''}">${s}</span>`;
    }).join('');

    return `<div class="ftd-gcard${allGone ? ' ftd-gcard--done' : ''}">
  <span class="ftd-grank">${rank}</span>
  <div class="ftd-gsuits">${suits}</div>
</div>`;
  }).join('');

  return `<div class="ftd-grave-section">
  <div class="ftd-section-lbl">TISCHMITTE</div>
  <div class="ftd-gy-grid">${boxes}</div>
</div>`;
}

// ── Action Sheet (role-aware) ──────────────────────────────
function _actionSheet(gs, isDealer, isRater) {
  if (gs.drinkingActive) {
    const dEvent = gs.drinkingEvent;
    const isMe = dEvent && state.myId === dEvent.drinkerId;
    if (isMe) return ''; // Drinker has the full-screen modal active

    const drinkerName = dEvent?.drinkerName || 'Spieler';
    const sips = dEvent?.sips ?? 1;
    const sipsLabel = `${sips} Schluck${sips === 1 ? '' : 'e'}`;
    return `<div class="ftd-action-sheet ftd-action-sheet--spec">
  <p class="ftd-spectator-msg">Warten auf ${escHtml(drinkerName)} (${sipsLabel})…</p>
</div>`;
  }

  if (gs.roundResult) return '';

  const order = gs.playerOrder || [];
  const dealerIdx = gs.dealerIndex ?? 0;
  const raterIdx = gs.raterIndex ?? 1;
  const attempt = gs.attempt || 1;
  const hint = gs.hint;

  // ── Pre-draw phase ──────────────────────────────────────
  if (!gs.cardDrawn) {
    if (isDealer) {
      return `<div class="ftd-action-sheet">
  <p class="ftd-action-lbl">Du bist Dealer</p>
  <p class="ftd-action-hint">Ziehe eine Karte — nur du siehst sie.</p>
  <button class="ftd-draw-btn" onclick="window.ftdDrawCard()">🂠&nbsp;&nbsp;Karte ziehen</button>
</div>`;
    }
    if (isRater) {
      return _spectator('Du bist Rater', 'Warte, bis der Dealer zieht…');
    }
    const dn = escHtml(gs.players?.[order[dealerIdx]]?.name ?? '?');
    return _spectator('Zuschauer', `<em>${dn}</em> zieht gleich eine Karte…`);
  }

  // ── Attempt 1 — Rater guesses exact rank ────────────────
  if (attempt === 1) {
    if (isDealer) return _dealerWait(gs, 'Rater tippt Versuch&nbsp;1…');
    if (isRater) return _rankGrid('Versuch 1 – Welcher Rang?', null);
    const rn = escHtml(gs.players?.[order[raterIdx]]?.name ?? '?');
    return _spectator('Zuschauer', `<em>${rn}</em> tippt…`);
  }

  // ── Attempt 2, waiting for dealer hint ──────────────────
  if (!hint) {
    const guessedRank = gs.lastRaterGuess;
    const raterName = gs.lastRaterName || (gs.players?.[order[raterIdx]]?.name ?? 'Rater');

    if (isDealer) {
      let correctDir = null;
      if (gs.currentCard && guessedRank && VALUE_ORDER[gs.currentCard.value] && VALUE_ORDER[guessedRank]) {
        const targetVal = VALUE_ORDER[gs.currentCard.value];
        const guessVal = VALUE_ORDER[guessedRank];
        if (targetVal > guessVal) correctDir = 'higher';
        else if (targetVal < guessVal) correctDir = 'lower';
      }

      const lowDisabled = correctDir === 'higher';
      const highDisabled = correctDir === 'lower';
      const lowSuggested = correctDir === 'lower';
      const highSuggested = correctDir === 'higher';

      const guessInfoText = guessedRank
        ? `<p class="ftd-action-lbl"><span class="ftd-rater-name">${escHtml(raterName)}</span> hat <span class="ftd-guess-badge">${escHtml(guessedRank)}</span> getippt — deine Karte ist:</p>`
        : `<p class="ftd-action-lbl">Versuch 1 daneben — gib einen Hinweis:</p>`;

      return `<div class="ftd-action-sheet">
  ${guessInfoText}
  <div class="ftd-dealer-action-split">
    ${_dealerCardElement(gs.currentCard)}
    <div class="ftd-dealer-hint-col">
      <button class="ftd-hint-btn ftd-hint-btn--high ${highSuggested ? 'ftd-hint-btn--suggested' : ''} ${highDisabled ? 'ftd-hint-btn--wrong' : ''}"
        onclick="window.ftdGiveHint('higher')" ${highDisabled ? 'disabled' : ''}>
        <span class="ftd-hint-btn-label">▲&nbsp;HÖHER</span>
        ${highSuggested ? '<span class="ftd-hint-correct-indicator">✓ Richtige Wahl</span>' : ''}
      </button>
      <button class="ftd-hint-btn ftd-hint-btn--low ${lowSuggested ? 'ftd-hint-btn--suggested' : ''} ${lowDisabled ? 'ftd-hint-btn--wrong' : ''}"
        onclick="window.ftdGiveHint('lower')" ${lowDisabled ? 'disabled' : ''}>
        <span class="ftd-hint-btn-label">▼&nbsp;NIEDRIGER</span>
        ${lowSuggested ? '<span class="ftd-hint-correct-indicator">✓ Richtige Wahl</span>' : ''}
      </button>
    </div>
  </div>
</div>`;
    }

    if (isRater) {
      const waitMsg = guessedRank
        ? `Du hast <span class="ftd-guess-badge">${escHtml(guessedRank)}</span> getippt. Warte auf den Hinweis des Dealers…`
        : 'Dealer gibt einen Hinweis…';
      return _spectator('Versuch 1 daneben', waitMsg);
    }

    const specMsg = guessedRank
      ? `<em>${escHtml(raterName)}</em> hat <span class="ftd-guess-badge">${escHtml(guessedRank)}</span> getippt — Dealer gibt Hinweis…`
      : 'Dealer überlegt…';
    return _spectator('Zuschauer', specMsg);
  }

  // ── Attempt 2, hint given — Rater guesses again ─────────
  const hLabel = hint === 'higher' ? '▲&nbsp;HÖHER' : '▼&nbsp;NIEDRIGER';
  const hMod = hint === 'higher' ? 'ftd-hint-pill--high' : 'ftd-hint-pill--low';

  if (isRater) return _rankGrid('Versuch 2 – Welcher Rang?', { label: hLabel, mod: hMod });

  if (isDealer) {
    return `<div class="ftd-action-sheet">
  <div class="ftd-hint-pill ${hMod}">${hLabel}</div>
  ${_dealerCardHtml(gs)}
  <p class="ftd-action-hint">Rater tippt Versuch&nbsp;2…</p>
</div>`;
  }

  return `<div class="ftd-action-sheet ftd-action-sheet--spec">
  <div class="ftd-hint-pill ${hMod}">${hLabel}</div>
  <p class="ftd-spectator-msg">Rater tippt erneut…</p>
</div>`;
}

// ── Shared sub-renderers ───────────────────────────────────
function _dealerCardElement(c) {
  if (!c) return '';
  const red = c.suit === '♥' || c.suit === '♦';
  return `<div class="ftd-dealer-card${red ? ' ftd-card--red' : ''}">
    <span class="ftd-dc-val">${c.value}</span>
    <span class="ftd-dc-suit">${c.suit}</span>
  </div>`;
}

function _dealerCardHtml(gs) {
  const c = gs.currentCard;
  if (!c) return '';
  return `<div class="ftd-dealer-card-wrap">${_dealerCardElement(c)}</div>`;
}

function _rankGrid(title, hint) {
  const pill = hint
    ? `<div class="ftd-hint-pill ${hint.mod}">${hint.label}</div>`
    : '';
  const btns = VALUES.map(v =>
    `<button class="ftd-rank-btn" onclick="window.ftdGuess('${v}')">${v}</button>`
  ).join('');
  return `<div class="ftd-action-sheet">
  ${pill}
  <p class="ftd-action-lbl">${title}</p>
  <div class="ftd-rank-grid">${btns}</div>
</div>`;
}

function _dealerWait(gs, msg) {
  return `<div class="ftd-action-sheet">
  ${_dealerCardHtml(gs)}
  <p class="ftd-action-hint">${msg}</p>
</div>`;
}

function _spectator(role, msg) {
  return `<div class="ftd-action-sheet ftd-action-sheet--spec">
  <p class="ftd-spec-role">${role}</p>
  <p class="ftd-spectator-msg">${msg}</p>
</div>`;
}
