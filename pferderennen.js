import { state } from './state.js';
import { getServerNow } from './app.js';
import { escHtml } from './busfahrer.js';

let selectedSymbolForBet = null;
let hasAutoSubmitted = false;
let localHasBet = false;
let activeBetInterval = null;
let lastSeenBetStartTime = null;

export function cleanupPferderennen() {
  if (activeBetInterval) {
    clearInterval(activeBetInterval);
    activeBetInterval = null;
  }
}

export function renderPferderennen(gs, area) {
  cleanupPferderennen();

  let container = area.querySelector('.pferderennen-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'pferderennen-container';
    area.innerHTML = '';
    area.appendChild(container);
  }

  const horses = ['♥', '♦', '♠', '♣'];
  const bets = gs.bets || {};
  const serverBet = bets[state.myId]?.symbol;

  // Modul-State nur zurücksetzen, wenn eine NEUE Wettphase gestartet wurde (neuer Timestamp)
  if (gs.betStartTime && gs.betStartTime !== lastSeenBetStartTime) {
    lastSeenBetStartTime = gs.betStartTime;
    localHasBet = false;
    selectedSymbolForBet = null;
    hasAutoSubmitted = false;
  }

  const myBet = serverBet || (localHasBet ? (selectedSymbolForBet || '♥') : null);

  const progress = document.getElementById('round-progress');
  if (progress) {
    if (!myBet) {
      progress.textContent = 'Wett-Phase';
    } else {
      progress.textContent = '';
    }
  }

  if (!myBet) {
    if (!gs.betStartTime && state.isHost && window.setHorseBetStartTime) {
      window.setHorseBetStartTime();
      return;
    }

    const startTime = gs.betStartTime || getServerNow();
    const elapsedSeconds = Math.floor((getServerNow() - startTime) / 1000);
    const initialRemaining = Math.max(0, 30 - elapsedSeconds);

    container.innerHTML = `
      <div style="width: 100%; max-width: 450px; margin: 30px auto; display: flex; flex-direction: column; gap: 15px; position: relative;">
        
        <!-- Timer Badge -->
        <div id="bet-timer-badge" style="position: absolute; top: -45px; right: 0; display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; padding: 5px 12px; border-radius: 20px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); transition: all 0.3s ease; z-index: 10; ${initialRemaining <= 10 ? 'color: #ff3b30; border-color: rgba(255, 59, 48, 0.4); background: rgba(255, 59, 48, 0.08);' : ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.8;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span id="bet-timer-text">${initialRemaining}s</span>
        </div>

        <!-- Kästchen 1: Symbole -->
        <div class="choice-section" style="text-align: center; padding: 20px;">
          <div class="choice-title" style="font-size: 20px; margin-bottom: 6px;">🐎 Wähle dein Pferd</div>
          <div class="choice-question" style="margin-bottom: 15px; color: var(--text-muted); font-size: 13px;">Auf welches Symbol möchtest du setzen?</div>
          
          <div style="display: flex; gap: 12px; justify-content: center; align-items: center; width: 100%; flex-wrap: wrap;">
            ${horses.map(h => `
              <button type="button" class="btn btn-secondary horse-select-btn" data-horse="${h}" style="font-size: 28px; width: 60px; height: 60px; border-radius: 14px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; ${selectedSymbolForBet === h ? 'border: 2px solid var(--accent); background: var(--surface); box-shadow: 0 0 20px rgba(255,255,255,0.4); transform: scale(1.05);' : 'opacity: 0.7;'}">${h}</button>
            `).join('')}
          </div>
        </div>

        <!-- Kästchen 2: Schieberegler -->
        <div class="choice-section" style="text-align: center; padding: 20px;">
          <div class="choice-title" style="font-size: 20px; margin-bottom: 6px;">🍻 Schlucke festlegen</div>
          <div class="choice-question" style="margin-bottom: 15px; color: var(--text-muted); font-size: 13px;">Wie viel riskierst du direkt?</div>
          
          <div class="sip-slider-wrapper" style="display: flex; flex-direction: column; align-items: center; gap: 10px; background: rgba(255,255,255,0.03); padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
            <label style="font-size: 14px; color: var(--text-muted);">Einsatz: <span id="sip-value-display" style="font-weight: bold; color: #fff; font-size: 20px;">3</span> Schlucke</label>
            <input type="range" id="horse-sip-slider" min="1" max="20" value="3" style="width: 100%; max-width: 260px; accent-color: var(--accent); cursor: pointer; height: 6px;" />
          </div>
        </div>

        <button type="button" class="btn btn-primary" id="confirm-bet-btn" style="padding: 16px 0; font-size: 18px; font-weight: bold; border-radius: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 5px;">
          Wette bestätigen ✓
        </button>

      </div>
    `;

    if (initialRemaining <= 0 && !hasAutoSubmitted) {
      hasAutoSubmitted = true;
      localHasBet = true;
      const finalSymbol = selectedSymbolForBet || horses[0];
      selectedSymbolForBet = finalSymbol;
      const finalSips = parseInt(document.getElementById('horse-sip-slider')?.value || '3', 10);
      if (window.betHorseWithSips) window.betHorseWithSips(finalSymbol, finalSips);
      setTimeout(() => renderPferderennen(gs, area), 0);
      return;
    }

    setTimeout(() => {
      const timerText = document.getElementById('bet-timer-text');
      const timerBadge = document.getElementById('bet-timer-badge');
      const slider = document.getElementById('horse-sip-slider');
      const display = document.getElementById('sip-value-display');
      const confirmBtn = document.getElementById('confirm-bet-btn');

      activeBetInterval = setInterval(() => {
        const currentElapsed = Math.floor((getServerNow() - startTime) / 1000);
        const left = Math.max(0, 30 - currentElapsed);

        if (timerText) timerText.textContent = `${left}s`;

        if (left <= 10 && timerBadge) {
          timerBadge.style.color = '#ff3b30';
          timerBadge.style.borderColor = 'rgba(255, 59, 48, 0.4)';
          timerBadge.style.background = 'rgba(255, 59, 48, 0.08)';
        }

        if (left <= 0 && !hasAutoSubmitted) {
          hasAutoSubmitted = true;
          if (activeBetInterval) { clearInterval(activeBetInterval); activeBetInterval = null; }
          localHasBet = true;
          const finalSymbol = selectedSymbolForBet || horses[0];
          selectedSymbolForBet = finalSymbol;
          const finalSips = parseInt(slider ? slider.value : 3, 10);

          // Sicherheits-Check: Befinden wir uns noch im Pferderennen?
          const container = document.getElementById('app')?.querySelector('.pferderennen-container');
          if (!container) return; // Wir sind in der Lobby oder einem anderen View!

          if (window.betHorseWithSips) {
            window.betHorseWithSips(finalSymbol, finalSips);
          }
          setTimeout(() => renderPferderennen(gs, area), 0);
        }
      }, 1000);

      container.querySelectorAll('.horse-select-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          if (activeBetInterval) { clearInterval(activeBetInterval); activeBetInterval = null; }
          selectedSymbolForBet = btn.dataset.horse;
          renderPferderennen(gs, area);
        };
      });

      if (slider && display) {
        slider.oninput = () => {
          display.textContent = slider.value;
        };
      }

      if (confirmBtn) {
        confirmBtn.onclick = (e) => {
          e.preventDefault();
          if (activeBetInterval) { clearInterval(activeBetInterval); activeBetInterval = null; }
          hasAutoSubmitted = true;
          localHasBet = true;

          const chosenSymbol = selectedSymbolForBet || horses[0];
          selectedSymbolForBet = chosenSymbol;
          const chosenSips = parseInt(slider ? slider.value : 3, 10);

          if (window.betHorseWithSips) {
            window.betHorseWithSips(chosenSymbol, chosenSips);
          }
          renderPferderennen(gs, area);
        };
      }
    }, 50);

    return;
  }

  // =========================================================================
  // AB HIER WIRD DAS ECHTE SPIELFELD GEZEIGT (NUR WENN MAN GEWETTET HAT):
  // =========================================================================

  const raceWrapper = document.createElement('div');
  raceWrapper.className = 'pferderennen-track-container';

  // Alte Wett-Sektion entfernen falls noch da
  const betPhase = container.querySelector(':scope > div:not(.pferderennen-track-container)');
  if (betPhase) betPhase.remove();

  let existingRaceWrapper = container.querySelector('.pferderennen-track-container');
  let isNewRaceWrapper = false;
  if (!existingRaceWrapper) {
    existingRaceWrapper = document.createElement('div');
    existingRaceWrapper.className = 'pferderennen-track-container';
    isNewRaceWrapper = true;
  }

  // 1. OBERE RENNBAHN (Rennticker)
  let track = existingRaceWrapper.querySelector('.rennticker-row');
  if (!track) {
    track = document.createElement('div');
    track.className = 'rennticker-row';

    // "GO" Field
    const goField = document.createElement('div');
    goField.className = 'rennticker-field';
    goField.style.border = 'none';
    goField.style.background = 'transparent';
    goField.textContent = 'GO';
    goField.style.fontSize = '12px';
    track.appendChild(goField);

    for (let i = 2; i <= 8; i++) {
      const field = document.createElement('div');
      field.className = 'rennticker-field';
      field.id = `rennticker-field-${i}`;
      track.appendChild(field);
    }
    existingRaceWrapper.appendChild(track);
  }

  // Update Rennticker cards
  for (let i = 2; i <= 8; i++) {
    const field = track.querySelector(`#rennticker-field-${i}`);
    if (field) {
      const obs = gs.obstacles?.[i];
      if (obs && obs.revealed) {
        field.innerHTML = `<span style="font-size:13px; font-weight:bold; line-height:1">${obs.card.value}</span><span style="font-size:16px; line-height:1; margin-top:2px;">${obs.card.suit}</span>`;
        if (obs.card.suit === '♥' || obs.card.suit === '♦') {
          field.style.color = 'var(--red, #ff3b30)';
        } else {
          field.style.color = '#ffffff';
        }
      } else {
        field.textContent = i - 1;
        field.style.color = 'var(--text-muted)';
      }
    }
  }

  // 2. UNTERE PFERDE-SPUREN
  let horseContainer = existingRaceWrapper.querySelector('.lanes-wrapper');
  if (!horseContainer) {
    horseContainer = document.createElement('div');
    horseContainer.className = 'lanes-wrapper';

    horses.forEach((horse) => {
      const lane = document.createElement('div');
      lane.className = 'lane-row';
      lane.dataset.horse = horse;

      const trackArea = document.createElement('div');
      trackArea.className = 'track-area';

      // Watermark symbol on position 1
      const watermark = document.createElement('div');
      watermark.className = 'watermark-symbol';
      watermark.dataset.horse = horse;
      watermark.textContent = horse;
      trackArea.appendChild(watermark);

      // Track Grid (8 segments visually)
      const trackGrid = document.createElement('div');
      trackGrid.className = 'track-grid';
      for (let c = 0; c < 8; c++) {
        const col = document.createElement('div');
        col.className = 'track-grid-col';
        trackGrid.appendChild(col);
      }
      trackArea.appendChild(trackGrid);

      // Horse Figure
      const horseFig = document.createElement('div');
      horseFig.className = 'horse-figure';
      horseFig.id = `horse-figure-${horse === '♥' ? 'herz' : horse === '♦' ? 'karo' : horse === '♠' ? 'pik' : 'kreuz'}`;
      horseFig.dataset.horse = horse;

      horseFig.innerHTML = `
        <svg class="horse-svg" viewBox="0 0 219.175 219.175" fill="currentColor"><path d="M196.904,41.306c0.665-0.744,1.361-1.681,2.225-2.435c0.751-0.66,1.111-1.741,1.858-2.401c0.173,0.129,0.34,0.259,0.513,0.391c-0.208,0.988-0.422,1.97-0.63,2.958c0.117,0.036,0.239,0.074,0.355,0.109c0.828-1.072,1.65-2.143,2.479-3.209c0.137,0.053,0.269,0.099,0.405,0.152c-0.086,0.78-0.045,1.605-0.299,2.333c-0.595,1.77-1.331,3.483-1.991,5.228c-0.142,0.368-0.192,0.77-0.289,1.153l1.6,4.544c0.99,2.107,2.112,4.067,3.747,5.825c0.996,1.072,1.402,2.772,2.215,4.154c2.138,3.621,4.661,6.975,6.854,10.537c1.396,2.27,2.326,4.783,2.804,7.434c0.07,0.376,0.335,0.714,0.426,0.894c-0.584,1.508-1.32,2.927-1.655,4.441c-0.238,1.081-0.614,1.582-1.681,1.846c-0.935,0.229-1.752,0.937-2.691,1.17c-2.285,0.561-5.225-0.942-5.723-3.448c-0.386-1.96-1.514-2.392-2.94-2.895c-0.37-0.132-0.873-0.147-1.092-0.406c-1.244-1.43-2.925-2.074-4.59-2.809c-0.808-0.357-1.503-0.972-2.265-1.449c-0.59-0.371-1.148-0.854-1.793-1.052c-4.423-1.368-4.423-1.345-6.86-3.775c-1.112-0.063-2.204-0.073-3.442,0.462c-0.98,0.421-1.504,0.754-2.164,1.686c-3.209,4.466-5.331,9.483-7.789,14.33c-0.482,0.952-0.944,2.049-0.965,3.085c-0.081,3.747-1.168,7.434-0.67,11.204c0.102,0.774,0.518,1.514,0.599,2.288c0.417,3.801-1.493,6.776-3.58,9.655c-0.37,0.511-0.889,0.912-1.437,1.455c1.34,0.949,2.863,1.706,3.94,2.874c2.133,2.29,4.854,3.605,7.454,5.149c0.168,0.102,0.441,0.091,0.538,0.224c1.687,2.457,4.012,4.59,3.94,7.926c-0.02,1.275-0.137,2.57,0.025,3.824c0.508,3.971,0.178,8.104,2.311,11.786c0.427,0.736,0.336,1.64-0.233,2.595c-1.513,2.539-2.041,5.418-2.092,8.358c-0.021,0.741-0.284,1.325-0.574,2.001c-0.726,1.711-1.087,3.574-1.6,5.397c-1.544-0.843-4.794-3.804-5.474-5.088c-0.803-1.509-1.757-3.012-1.168-5.002c0.812-1.33,2.381-0.579,3.544-0.812c0.427-1.646,0.193-3.047-0.649-4.25c-0.488-0.696-0.722-1.376-0.244-1.95c1.234-1.508,1.107-3.229,1.016-5.256c-1.858,1.011-2.579,2.879-3.722,4.256c-2.036,2.468-3.636,5.291-5.546,7.87c-0.934,1.26-2.29,2.082-3.971,1.879c-2.336-0.279-4.362,0.614-6.383,1.528c-1.828,0.828-3.91,0.655-5.708,1.631c-0.589,0.319-2.539-1.438-2.655-2.336c-0.107-0.823-0.025-1.666-0.025-2.062c1.025-1.162,2.041-1.909,2.473-2.914c0.422-0.985,0.777-1.625,1.904-1.579c0.183,0.005,0.441-0.046,0.559-0.163c0.67-0.686,1.351-1.482,2.407-1.081c1.29,0.482,2.823,0.497,3.869,2.006c0.437-0.731,0.701-1.519,1.239-1.971c0.578-0.478,1.462-0.563,2.138-0.954c2.646-1.539,4.646-3.764,6.454-6.19c0.66-0.889,1.463-1.731,1.869-2.732c0.477-1.193,0.599-2.528,0.862-3.747c-2.843-1.736-5.87-2.26-8.815-3.098c-2.234-0.635-4.326-1.909-6.316-3.158c-1.076-0.681-2.052-1.168-3.331-1.26c-1.188-0.081-2.347-0.467-4.032-0.838c-0.721-0.889-1.747-2.158-2.737-3.392c-3.315,0.827-6.372,2.549-10.039,2.452c-2.234-0.065-4.56,0.625-6.733,1.33c-1.554,0.508-2.854,0.727-4.356-0.051c-0.589-0.299-1.463-0.183-2.184-0.081c-2.834,0.392-5.54-0.741-8.343-0.654c-1.377-1.407-3.307-0.203-4.957-1.163c-1.384-0.798-3.344-0.589-5.045-0.863c-0.17-0.03-0.3-0.289-0.696-0.681c-0.724,1.686-1.894,3.25-1.955,4.85c-0.083,2.077-0.541,4.088-0.848,6.089c-0.597,3.94-0.676,8.018-2.361,11.745c-0.041,0.086-0.109,0.192-0.094,0.279c0.708,3.225-0.005,6.733,1.915,9.719c0.328,0.519,0.655,1.158,1.155,1.412c1.82,0.924,3.031,2.509,4.446,3.869c1.924,1.854,3.811,3.666,6.18,5.058c1.478,0.873,2.366,2.763,3.504,4.205c0.31,0.391,0.457,1.021,0.853,1.219c2.676,1.381,4.245,3.691,5.596,6.251c0.417,0.787,1.696,1.117,0.965,2.64c-0.731,0.828-2.021,0.899-3.361,0.828c-4.052-0.219-5.972-0.817-7.353-1.914c-0.279-1.65,2.057-3.204-0.143-5.022c-0.935,0-1.983,0-3.194,0c-1.071-1.29-2.138-2.65-3.285-3.931c-1.191-1.33-2.465-2.584-3.72-3.89c-1.731,2.402-0.67,4.997-1.112,7.516c-1.102,0.98-2.024-0.254-2.907-0.64c-1.356-0.584-2.546-1.554-3.775-2.417c-2.031-1.422-2.567-3.489-1.498-6.094c-1.409-0.203-2.905-0.441-2.562-2.422c-1.315-1.95-3.031-3.54-4.997-4.748c-4.217-2.58-8.295-5.424-12.865-7.394c-0.541-0.233-0.998-0.676-1.549-0.873c-0.838-0.305-1.82-0.305-2.554-0.742c-0.794-0.467-1.378-1.3-2.115-2.041c-0.49-1.508,0.102-2.849,0.769-4.266c1.709-3.656,3.062-7.459,4.118-11.344c0.285-1.052,0.518-2.448-0.437-3.605c-0.322-0.396-0.119-1.219-0.173-2.194c-0.889-0.578-1.919-1.391-3.067-1.975c-3.293-1.671-6.746-3.062-9.422-5.743c-0.089-0.082-0.391,0.035-0.759,0.076c-0.323,1.822,0.394,3.904-1.102,5.732c-1.249-0.599-2.549-1.229-3.933-1.898c-0.322,0.934-0.67,1.955-1.028,2.995c-1.325-0.518-0.769-1.655-0.629-2.482c0.16-0.939,0.701-1.823,1.071-2.707c-2.003-1.655-4.4-2.803-3.994-5.84c-0.703-0.355-1.399-0.703-2.1-1.056c-0.282,0.243-0.569,0.408-0.734,0.654c-1.577,2.377-3.608,4.921-6.652,5.998c-0.368,0.132-0.736,0.426-1.097,0.406c-3.43-0.122-6.129,1.274-8.288,3.869c-0.183,0.219-0.426,0.391-1.16,1.046c0.363-0.995,0.406-1.503,0.681-1.787c0.49-0.508,1.114-0.874,1.681-1.3c-0.129-0.188-0.254-0.381-0.386-0.569c-0.744,0.229-1.485,0.457-2.62,0.808c1.175-1.731,2.678-1.92,4.019-2.407c-2.392-0.522-4.108,0.265-4.971,2.666c-0.374,1.274,0.629,2.925-1.003,4.032c-0.208-0.178-0.427-0.366-0.609-0.519c-0.597,1.193-1.211,2.397-1.938,3.839c-0.495-0.695-0.917-1.3-1.358-1.919c-0.368,0.355-0.805,0.771-1.241,1.178c-0.104-0.167-0.335-0.437-0.292-0.487c0.998-1.26,1.444-2.646,1.3-4.275c-0.036-0.376,0.467-0.803,0.868-1.438c-1.554,0.168-2.422,1.377-3.806,1.153c-1.425-0.233-2.679,1.03-4.197,0.619c-1.241-0.335-2.521-0.548-3.864-0.822c0.345-0.376,0.556-0.6,0.886-0.95c-0.198-0.31-0.33-0.787-0.63-0.929c-1.84-0.894-3.016-2.529-4.456-3.859c-0.158-0.147-0.427-0.295-0.432-0.452c-0.063-1.646-1.468-2.25-2.486-3.042c-1.082-0.838-2.381-1.394-3.595-2.066c-0.868-0.462-1.742-0.929-2.651-1.424c0.317-0.358,0.521-0.582,0.708-0.794c-0.074-0.328-0.838-0.386-0.178-1.092c0.982,0.571,2.001,1.17,3.151,1.841c0.208-0.084,0.729-0.506,1.036-0.386c1.292,0.51,2.709,0.464,3.981,1.166c2.768,1.523,5.621,1.612,8.43-0.051c0.5-0.297,1.082-0.465,1.83-0.772c0.468-0.764,0.884-2.006,1.742-2.707c1.175-0.97,1.325-2.341,1.632-3.496c0.843-3.161,1.955-6.183,3.151-9.219c0.868-2.204,2.163-4.174,2.956-6.436c0.861-2.481,2.811-4.354,5.86-4.738c1.574-0.198,2.958-0.952,4.621-0.005c0.787,0.457,2.044,0.084,3.141-0.302c-0.368-0.084-0.744-0.244-1.112-0.234c-0.66,0.015-1.16-0.125-1.686-0.609c-0.27-0.249-0.96-0.045-1.45-0.259c1.762-0.868,3.433-0.172,4.961,0.551c2.407,1.14,4.705,2.501,7.031,3.801c1.127,0.629,2.158,1.453,3.321,1.991c1.333,0.619,2.757,1.036,4.156,1.513c1.112,0.386,2.234,0.729,3.732,1.213c0.396-0.386,1.056-1.03,1.706-1.681c4.387-4.377,8.191-6.515,14.678-9.188c2.107-0.868,4.286-1.445,6.391-2.272c0.645-0.249,1.437-0.145,2.158-0.18c4.375-0.218,8.815-0.023,13.104-0.744c5.253-0.884,10.468-0.328,15.69-0.495c2.804-0.089,5.505-1.138,8.339-0.681c3.147-1.379,6.702-1.795,9.414-3.832c-0.233-1.109-0.427-2.049-0.619-2.986c-0.66,0.173-1.371,0.353-2.153,0.551c0-0.337-0.021-0.619,0.005-0.624c1.143-0.165,1.798-1.014,2.311-1.877c0.854-1.455,1.94-2.536,3.428-3.374c1.833-1.036,3.153-2.653,4.032-4.575c0.096-0.203-0.219-0.589-0.351-0.901c0.924-0.432,2.103-0.114,2.59-1.688c0.365-1.176,1.777-2.023,2.295-2.56c1.27-0.521,1.996-0.814,2.834-1.16c-0.366-0.421-0.559-0.64-0.752-0.863c0.193-0.213,0.392-0.437,0.64-0.716c-0.396-0.142-0.767-0.267-1.386-0.485c0.746-0.754,1.427-1.435,2.193-2.199c-0.319-0.442-0.554-0.765-0.827-1.15c0.254-0.076,0.635-0.314,0.771-0.213c0.894,0.667,1.838,0.812,2.691,0.53c0.137-1.028,0.254-1.965,0.386-2.948c-0.752-0.114-1.336-0.208-2.219-0.343c0.705-0.337,1.127-0.536,1.69-0.805c-0.254-0.455-0.487-0.874-0.711-1.29c0.132-0.074,0.355-0.297,0.468-0.252c0.807,0.348,1.599,0.749,2.076,0.978c2.728-0.535,5.256-1.028,7.896-1.549c0.279,0.173,0.69,0.432,1.26,0.795c0.192-0.551,0.314-0.909,0.437-1.272c0.122-0.01,0.314-0.089,0.416-0.028c1.046,0.63,2.082,1.176,3.393,1.089c0.995-0.068,2.016-0.208,2.965,0.562c0.361,0.289,1.27,0.149,1.818-0.074c1.452-0.599,2.62-1.876,4.357-1.788c0.178-1.749,2.021-1.229,2.935-2.123c1.33-1.305,3.179-1.31,5.108-0.759c3.204,0.919,6.454,1.841,9.861,1.592c0.579-0.043,1.152-0.449,1.717-0.421C194.882,40.801,195.726,41.065,196.904,41.306z M85.813,133.108c-1.95,3.509-3.087,7.114-2.823,11.034c0.073,1.082,0.198,2.275,0.718,3.179c0.399,0.696,1.102,1.331,2.105,1.696c1.409,0.519,2.59,1.641,4.253,2.763c-0.442-3.773,0.952-6.941,0.599-10.299c-0.167-1.624-0.635-3.147-1.062-4.666C89.083,134.962,87.514,133.905,85.813,133.108z"/></svg>
      `;

      if (myBet === horse) {
        const star = document.createElement('div');
        star.className = 'horse-star';
        star.textContent = '★';
        horseFig.appendChild(star);
      }

      trackArea.appendChild(horseFig);
      lane.appendChild(trackArea);

      // Finish line
      const finish = document.createElement('div');
      finish.className = 'finish-line';
      lane.appendChild(finish);

      horseContainer.appendChild(lane);
    });
    existingRaceWrapper.appendChild(horseContainer);
  }

  // Update Horse Positions
  horses.forEach((horse) => {
    const horseFigId = `horse-figure-${horse === '♥' ? 'herz' : horse === '♦' ? 'karo' : horse === '♠' ? 'pik' : 'kreuz'}`;
    const horseFig = horseContainer.querySelector(`#${horseFigId}`);
    if (horseFig) {
      const currentPosition = gs.horses?.[horse] || 1;
      const leftPercent = ((currentPosition - 1) / 8) * 100;

      const lane = horseFig.closest('.lane-row');
      if (currentPosition === 1) {
        lane.classList.add('is-at-start');
      } else {
        lane.classList.remove('is-at-start');
      }
      if (currentPosition >= 9) {
        horseFig.dataset.finished = "true";
      } else {
        delete horseFig.dataset.finished;
        const currentLeft = horseFig.style.left;
        if (currentLeft && currentLeft !== `${leftPercent}%`) {
          horseFig.classList.remove('jump');
          void horseFig.offsetWidth; // Trigger reflow
          horseFig.classList.add('jump');
        }
        horseFig.style.left = `${leftPercent}%`;
      }
    }
  });

  if (isNewRaceWrapper) {
    container.appendChild(existingRaceWrapper);
  }

  // --- ZULETZT GEZOGENE KARTEN (HISTORIE) ---
  let lastCardSection = existingRaceWrapper.querySelector('.pferderennen-last-card-container');
  if (!lastCardSection) {
    lastCardSection = document.createElement('div');
    lastCardSection.className = 'pferderennen-last-card-container';
    // Feste Reihenfolge: IN die Hauptbox am Ende einfügen!
    existingRaceWrapper.appendChild(lastCardSection);
  }

  if (gs.drawnCardsHistory && gs.drawnCardsHistory.length > 0) {
    let historyEl = lastCardSection.querySelector('#drawn-cards-history');
    if (!historyEl) {
      historyEl = document.createElement('div');
      historyEl.id = 'drawn-cards-history';
      historyEl.className = 'drawn-cards-history';
      lastCardSection.innerHTML = '';
      lastCardSection.appendChild(historyEl);
    }

    const existingCards = historyEl.querySelectorAll('.drawn-card:not(.card-placeholder)');
    const existingCount = existingCards.length;
    const historyCount = gs.drawnCardsHistory.length;

    if (existingCount !== historyCount) {
      if (existingCount === historyCount - 1 && existingCount > 0) {
        // Nur die neue Karte anhängen und vordere abdunkeln
        const prevCard = existingCards[existingCount - 1];
        if (prevCard) {
          prevCard.style.opacity = '0.55';
          prevCard.style.transform = 'scale(0.95)';
          prevCard.style.boxShadow = 'none';
        }

        const card = gs.drawnCardsHistory[historyCount - 1];
        const isRed = card.suit === '♥' || card.suit === '♦';
        const newCard = document.createElement('div');
        newCard.className = `drawn-card ${isRed ? 'card-red' : 'card-black'}`;
        newCard.style.opacity = '1';
        newCard.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
        newCard.style.transform = 'scale(1)';
        newCard.style.flexShrink = '0';
        newCard.innerHTML = `<span class="card-rank">${card.value}</span><span class="card-suit">${card.suit}</span>`;
        historyEl.appendChild(newCard);

        requestAnimationFrame(() => {
          historyEl.scrollTo({ left: historyEl.scrollWidth, behavior: 'smooth' });
        });
      } else {
        // Komplettes Neu-Rendern (z.B. beim ersten Aufruf)
        let cardsHTML = '';
        gs.drawnCardsHistory.forEach((card, index) => {
          const isNewest = index === historyCount - 1;
          const isRed = card.suit === '♥' || card.suit === '♦';
          const opacity = isNewest ? '1' : '0.55';
          const shadow = isNewest ? '0 2px 6px rgba(0,0,0,0.4)' : 'none';
          const transform = isNewest ? 'scale(1)' : 'scale(0.95)';
          cardsHTML += `
            <div class="drawn-card ${isRed ? 'card-red' : 'card-black'}" style="opacity: ${opacity}; box-shadow: ${shadow}; transform: ${transform}; flex-shrink: 0;">
              <span class="card-rank">${card.value}</span>
              <span class="card-suit">${card.suit}</span>
            </div>
          `;
        });
        historyEl.innerHTML = cardsHTML;

        requestAnimationFrame(() => {
          historyEl.scrollTo({ left: historyEl.scrollWidth, behavior: 'auto' });
        });
      }
    }
  } else if (gs.lastDrawnCard) {
    // Fallback für alte States, die noch keine History haben
    const { value, suit } = gs.lastDrawnCard;
    const isRed = suit === '♥' || suit === '♦';
    lastCardSection.innerHTML = `
      <div class="drawn-cards-history" id="drawn-cards-history">
        <div class="drawn-card ${isRed ? 'card-red' : 'card-black'}" style="flex-shrink: 0;">
          <span class="card-rank">${value}</span>
          <span class="card-suit">${suit}</span>
        </div>
      </div>
    `;
  } else {
    lastCardSection.innerHTML = `
      <div class="drawn-cards-history" id="drawn-cards-history">
        <div class="drawn-card card-placeholder" style="flex-shrink: 0;">
          <span class="card-logo">?</span>
        </div>
      </div>
    `;
  }

  // 4. Steuerungs- & Warte-Sektion ganz unten
  let controlSection = container.querySelector('.pferderennen-controls');
  if (!controlSection) {
    controlSection = document.createElement('div');
    controlSection.className = 'pferderennen-controls floating-control-bar';
    // Feste Reihenfolge: Direkt hinter der Hauptbox einfügen!
    existingRaceWrapper.after(controlSection);
  } else {
    controlSection.innerHTML = '';
  }

  const players = gs.players || {};
  const playerIds = Object.keys(players);

  const pendingPlayers = playerIds
    .filter(id => !bets[id] || !players[id]?.confirmedDrinker)
    .map(id => players[id]?.name || 'Unbekannt');

  const allReady = pendingPlayers.length === 0 && playerIds.length > 0;
  const winner = horses.find(h => (gs.horses?.[h] || 1) >= 9);

  if (winner) {
    const pendingDistribution = gs.distributionPendingPlayers || [];
    const myPool = gs.players?.[state.myId]?.sipPool || 0;

    if (gs.distributionActive) {
      if (pendingDistribution.includes(state.myId) && myPool > 0) {
        controlSection.innerHTML = `
          <div class="choice-section highlight-border">
            <div class="choice-title" style="font-size: 24px; color: var(--accent);">🎉 Pferd ${winner} hat gewonnen!</div>
            <div class="choice-question" style="font-size: 16px; margin: 10px 0;">
              Du hast richtig gewettet! Du hast noch <strong style="color: var(--accent); font-size: 20px;">${myPool}</strong> Schluck${myPool === 1 ? '' : 'e'} zum Verteilen.
            </div>
            <div class="distribute-ui" style="margin-top: 15px;">
              <div class="distribute-grid" style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                ${gs.playerOrder.filter(id => id !== state.myId).map(id => `
                  <button type="button" class="btn btn-secondary distribute-btn" data-target="${id}" style="padding: 10px 18px; font-weight: 600;">
                    ${escHtml(gs.players[id]?.name || 'Spieler')}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        `;

        setTimeout(() => {
          container.querySelectorAll('.distribute-btn').forEach(btn => {
            btn.onclick = (e) => {
              e.preventDefault();
              if (window.distributeSips) {
                window.distributeSips(btn.dataset.target, 1, gs);
              }
            };
          });
        }, 50);

      } else {
        const givers = pendingDistribution.map(pid => gs.players[pid]?.name || 'Gewinner').join(', ');
        controlSection.innerHTML = `
          <div class="choice-section">
            <div class="choice-title" style="font-size: 24px; color: var(--accent);">🎉 Pferd ${winner} hat gewonnen!</div>
            <div class="info-box" style="color: var(--text-muted); margin-top: 10px;">
              Warte darauf, dass <strong>${givers || 'die Gewinner'}</strong> die Schlucke verteilen...
            </div>
          </div>
        `;
      }
    } else {
      const stillDrinkingPlayers = playerIds
        .filter(id => (players[id]?.sipsToDrink || 0) > 0)
        .map(id => players[id]?.name || 'Spieler');
      const isDrinkingFinished = stillDrinkingPlayers.length === 0;

      if (!isDrinkingFinished) {
        controlSection.innerHTML = `
          <div class="choice-section">
            <div class="choice-title" style="font-size: 24px; color: var(--accent);">🎉 Pferd ${winner} hat gewonnen!</div>
            <div class="info-box" style="color: var(--accent); margin-top: 10px;">
              🍻 Schlucke wurden verteilt! Warte auf: <strong>${stillDrinkingPlayers.join(', ')}</strong>...
            </div>
            ${state.isHost ? `
              <button type="button" class="btn btn-primary btn-large" id="btn-restart-pferderennen" style="margin-top: 15px; width: 100%; max-width: 300px;">
                Noch eine Runde 🐎
              </button>
            ` : ''}
          </div>
        `;
      } else {
        controlSection.innerHTML = `
          <div class="choice-section">
            <div class="choice-title" style="font-size: 24px; color: var(--accent);">🎉 Pferd ${winner} hat gewonnen!</div>
            <div class="choice-question" style="margin-top: 8px;">Das Rennen ist beendet. Alle Schlucke wurden getrunken! 🍻</div>
            ${state.isHost ? `
              <button type="button" class="btn btn-primary btn-large" id="btn-restart-pferderennen" style="margin-top: 15px; width: 100%; max-width: 300px;">
                Noch eine Runde 🐎
              </button>
            ` : `
              <div class="info-box" style="color: var(--text-muted); margin-top: 10px;">
                Warte auf den Host für die nächste Runde...
              </div>
            `}
          </div>
        `;
      }

      if (state.isHost) {
        setTimeout(() => {
          const restartBtn = document.getElementById('btn-restart-pferderennen');
          if (restartBtn) {
            restartBtn.onclick = () => {
              if (window.startPferderennen) window.startPferderennen();
            };
          }
        }, 50);
      }
    }
  } else {
    if (!allReady) {
      if (state.isHost) {
        controlSection.innerHTML = `
          <div class="info-box" style="border-color: var(--border-bright);">
            <strong>Warte darauf, dass alle Spieler wetten...</strong><br>
            <span style="font-size: 13px; color: var(--text-muted); margin-top: 6px; display: block;">
              Fehlt noch: <strong>${pendingPlayers.join(', ')}</strong>
            </span>
          </div>
          <button class="btn btn-secondary" id="btn-force-draw" style="margin-top: 10px; width: 100%;">
            Rennen erzwingen 🏁
          </button>
        `;

        setTimeout(() => {
          const forceBtn = document.getElementById('btn-force-draw');
          if (forceBtn) {
            forceBtn.onclick = () => {
              if (window.drawHorseCard) window.drawHorseCard();
            };
          }
        }, 50);
      } else {
        controlSection.innerHTML = `
          <div class="info-box" style="color: var(--text-muted);">
            Warte auf die anderen Spieler... (${pendingPlayers.length} ${pendingPlayers.length === 1 ? 'Person fehlt' : 'Personen fehlen'})
          </div>
        `;
      }
    } else {
      const hostId = gs?.hostId;
      const hostPlayer = gs?.players?.[hostId];
      const hostName = hostPlayer?.name || "der Host";
      const isStarted = !!gs.lastDrawnCard;

      if (state.isHost) {
        controlSection.innerHTML = `
          <button class="btn btn-primary btn-large" id="btn-draw-horse-card" style="width: 100%;">
            Karte ziehen 🃏
          </button>
        `;

        setTimeout(() => {
          const btn = document.getElementById('btn-draw-horse-card');
          if (btn) {
            btn.onclick = () => {
              if (window.drawHorseCard) window.drawHorseCard();
            };
          }
        }, 50);

      } else {
        const msg = isStarted
          ? `Warte, bis <strong style="font-family: inherit; font-weight: 600; color: inherit;">${hostName}</strong> die nächste Karte zieht...`
          : `Alle haben gewettet! Warte auf den Host...`;
        controlSection.innerHTML = `<div class="info-box" style="color: var(--accent); margin: 0;">${msg}</div>`;
      }
    }
  }
}