// ==============================
// Raining Balloons - Game Logic
// ==============================

const PLAYER_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getPeepClassName(playerIndex, extraClass = '') {
    const classNames = ['peep', `player-${playerIndex + 1}`];
    if (extraClass) classNames.push(extraClass);
    return classNames.join(' ');
}

function getPeepIconHTML(playerIndex, extraClass = '') {
    const className = getPeepClassName(playerIndex, extraClass);
    return `<span class="${className}" aria-hidden="true"><span class="peep-head"></span><span class="peep-body"></span></span>`;
}

function createPeepIcon(playerIndex, extraClass = '') {
    const peep = document.createElement('span');
    peep.className = getPeepClassName(playerIndex, extraClass);
    peep.setAttribute('aria-hidden', 'true');

    const head = document.createElement('span');
    head.className = 'peep-head';
    peep.appendChild(head);

    const body = document.createElement('span');
    body.className = 'peep-body';
    peep.appendChild(body);

    return peep;
}

function getPlayerLabelHTML(playerIndex, label = PLAYER_NAMES[playerIndex]) {
    return `${getPeepIconHTML(playerIndex, 'peep-inline')} <span class="player-label-text">${escapeHtml(label)}</span>`;
}

const CARD_TYPES = {
    MOVE: 'move',
    UMBRELLA: 'umbrella',
    STEAL_UMBRELLA: 'steal_umbrella',
    BUNKER_KEY: 'bunker_key',
    REDO: 'redo'
};

const CARD_INFO = {
    [CARD_TYPES.MOVE]: { icon: '👟', name: 'Move', desc: 'Move all your peeps one square' },
    [CARD_TYPES.UMBRELLA]: { icon: '☂️', name: 'Paper Umbrella', desc: 'Equip one peep with an umbrella (absorbs 1 balloon)' },
    [CARD_TYPES.STEAL_UMBRELLA]: { icon: '🫳', name: 'Steal Umbrella', desc: 'Steal an umbrella from another player\'s peep' },
    [CARD_TYPES.BUNKER_KEY]: { icon: '🔑', name: 'Bunker Key', desc: 'Enter a bunker if your peep is adjacent (stay for 3 rounds)' },
    [CARD_TYPES.REDO]: { icon: '🔄', name: 'Redo', desc: 'Hold until end of round — cancel balloon drop and re-roll' }
};

// Starting positions for each player (row-based sides)
function getStartPositions(playerIndex, totalPlayers) {
    const positions = [];
    switch (totalPlayers) {
        case 2:
            // Top and bottom
            if (playerIndex === 0) positions.push([0, 2], [0, 4], [0, 6]);
            else positions.push([7, 1], [7, 3], [7, 5]);
            break;
        case 3:
            // Top, bottom-left, bottom-right
            if (playerIndex === 0) positions.push([0, 2], [0, 4], [0, 6]);
            else if (playerIndex === 1) positions.push([7, 1], [7, 3], [7, 5]);
            else positions.push([3, 0], [5, 0], [4, 0]);
            break;
        case 4:
            // All four sides
            if (playerIndex === 0) positions.push([0, 2], [0, 4], [0, 6]);
            else if (playerIndex === 1) positions.push([7, 1], [7, 3], [7, 5]);
            else if (playerIndex === 2) positions.push([2, 0], [4, 0], [6, 0]);
            else positions.push([1, 7], [3, 7], [5, 7]);
            break;
    }
    return positions;
}

// Build a deck with approximate ratios
function buildDeck() {
    const deck = [];
    // ~1/3 Move, ~1/5 Bunker, ~1/8 each for Umbrella, Steal, Redo
    // Total ~40 cards: 13 Move, 8 Bunker, 5 Umbrella, 5 Steal, 5 Redo = 36
    for (let i = 0; i < 13; i++) deck.push(CARD_TYPES.MOVE);
    for (let i = 0; i < 8; i++) deck.push(CARD_TYPES.BUNKER_KEY);
    for (let i = 0; i < 5; i++) deck.push(CARD_TYPES.UMBRELLA);
    for (let i = 0; i < 5; i++) deck.push(CARD_TYPES.STEAL_UMBRELLA);
    for (let i = 0; i < 5; i++) deck.push(CARD_TYPES.REDO);
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

// ==============================
// Game State
// ==============================
let state = {
    numPlayers: 3,
    numBunkers: 4,
    numBalloons: 5,
    round: 1,
    currentPlayerIndex: 0,
    turnPhase: 'draw', // 'draw', 'action', 'done'
    players: [],
    playerTypes: [],   // 'human' or 'computer' per player index
    bunkers: [],       // [{row, col, occupant: null | {playerIndex, peepIndex}}]
    deck: [],
    drawnCard: null,
    board: [],         // 8x8 grid tracking what's on each cell
    splashedCells: [], // cells hit this round
    redoHolders: [],   // player indices holding redo cards
    moveTargets: [],   // valid move targets for current action
    selectionMode: null, // 'select_peep', 'select_target', 'select_move', etc.
    selectionCallback: null,
    gameOver: false,
    roundStartPlayer: undefined,
    preDrop: null,
    redoQueue: [],      // ordered list of playerIndex holding redo cards
    redoQueuePos: 0     // which position in redoQueue is currently deciding
};

// ==============================
// Setup
// ==============================
document.addEventListener('DOMContentLoaded', () => {
    setupOptionButtons();
    updatePlayerTypeOptions();
    document.getElementById('start-game').addEventListener('click', startGame);
    document.getElementById('card-deck').addEventListener('click', drawCard);
    document.getElementById('use-card-btn').addEventListener('click', useCard);
    document.getElementById('done-moving-btn').addEventListener('click', finishCardAction);
    document.getElementById('discard-btn').addEventListener('click', discardCard);
    document.getElementById('end-turn-btn').addEventListener('click', endTurn);
    document.getElementById('drop-balloons-btn').addEventListener('click', dropBalloons);
    document.getElementById('redo-btn').addEventListener('click', useRedo);
    document.getElementById('accept-drop-btn').addEventListener('click', passRedo);
    document.getElementById('play-again-btn').addEventListener('click', () => location.reload());
});

function setupOptionButtons() {
    document.querySelectorAll('.opt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const group = btn.dataset.option;
            document.querySelectorAll(`[data-option="${group}"]`).forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (group === 'players') {
                updateBunkerOptions();
                updatePlayerTypeOptions();
            }
        });
    });
    updateBunkerOptions();
}

function updatePlayerTypeOptions() {
    const numPlayers = parseInt(document.querySelector('[data-option="players"].selected').dataset.value);
    const container = document.getElementById('player-types-container');
    if (!container) return;

    // Preserve existing selections before rebuilding
    const existing = {};
    container.querySelectorAll('[data-player-type].selected').forEach(btn => {
        existing[btn.dataset.playerIndex] = btn.dataset.playerType;
    });

    container.innerHTML = '';
    for (let i = 0; i < numPlayers; i++) {
        const row = document.createElement('div');
        row.className = 'player-type-row';

        const label = document.createElement('span');
        label.className = `player-type-label player-${i + 1}`;
        label.innerHTML = getPlayerLabelHTML(i);
        row.appendChild(label);

        if (i === 0) {
            const badge = document.createElement('span');
            badge.className = 'opt-btn selected';
            badge.textContent = '👤 Human';
            badge.style.cursor = 'default';
            row.appendChild(badge);
        } else {
            const group = document.createElement('div');
            group.className = 'player-type-toggle';

            const humanBtn = document.createElement('button');
            humanBtn.className = 'opt-btn';
            humanBtn.textContent = '👤 Human';
            humanBtn.dataset.playerType = 'human';
            humanBtn.dataset.playerIndex = i;

            const aiBtn = document.createElement('button');
            aiBtn.className = 'opt-btn';
            aiBtn.textContent = '🤖 Computer';
            aiBtn.dataset.playerType = 'computer';
            aiBtn.dataset.playerIndex = i;

            // Restore previous selection or default to human
            const prev = existing[i];
            if (prev === 'computer') {
                aiBtn.classList.add('selected');
            } else {
                humanBtn.classList.add('selected');
            }

            humanBtn.addEventListener('click', () => {
                humanBtn.classList.add('selected');
                aiBtn.classList.remove('selected');
            });
            aiBtn.addEventListener('click', () => {
                aiBtn.classList.add('selected');
                humanBtn.classList.remove('selected');
            });

            group.appendChild(humanBtn);
            group.appendChild(aiBtn);
            row.appendChild(group);
        }

        container.appendChild(row);
    }
}

function updateBunkerOptions() {
    const numPlayers = parseInt(document.querySelector('[data-option="players"].selected').dataset.value);
    const maxBunkers = Math.min(numPlayers * 3 - 2, 8);

    let selectedBunkerVal = parseInt(document.querySelector('[data-option="bunkers"].selected')?.dataset.value ?? 4);

    document.querySelectorAll('[data-option="bunkers"]').forEach(btn => {
        const val = parseInt(btn.dataset.value);
        const valid = val <= maxBunkers;
        btn.disabled = !valid;
        btn.classList.toggle('disabled', !valid);
        if (!valid) btn.classList.remove('selected');
    });

    // If current selection is now invalid, pick highest valid
    if (selectedBunkerVal > maxBunkers) {
        const highest = [...document.querySelectorAll('[data-option="bunkers"]:not([disabled])')].pop();
        if (highest) highest.classList.add('selected');
    }
}

function startGame() {
    state.numPlayers = parseInt(document.querySelector('[data-option="players"].selected').dataset.value);
    state.numBunkers = parseInt(document.querySelector('[data-option="bunkers"].selected').dataset.value);
    state.numBalloons = parseInt(document.querySelector('[data-option="balloons"].selected').dataset.value);

    // Read player types (player 0 is always human)
    state.playerTypes = [];
    for (let i = 0; i < state.numPlayers; i++) {
        if (i === 0) {
            state.playerTypes.push('human');
        } else {
            const sel = document.querySelector(`[data-player-index="${i}"][data-player-type].selected`);
            state.playerTypes.push(sel ? sel.dataset.playerType : 'human');
        }
    }

    // Initialize players
    state.players = [];
    for (let i = 0; i < state.numPlayers; i++) {
        const peeps = getStartPositions(i, state.numPlayers).map((pos, idx) => ({
            row: pos[0], col: pos[1], alive: true, hasUmbrella: false, inBunker: false
        }));
        state.players.push({ index: i, peeps, eliminated: false });
    }

    // Place bunkers randomly (not on starting positions)
    const occupied = new Set();
    state.players.forEach(p => p.peeps.forEach(peep => occupied.add(`${peep.row},${peep.col}`)));

    // Place bunkers randomly in the central 4x4 zone (rows 2-5, cols 2-5)
    // Cap to available central cells minus at least one gap
    const centralCells = [];
    for (let r = 2; r <= 5; r++)
        for (let c = 2; c <= 5; c++)
            if (!occupied.has(`${r},${c}`)) centralCells.push({ row: r, col: c });

    // Shuffle and take as many as requested (up to what fits)
    const shuffled = shuffle(centralCells);
    const count = Math.min(state.numBunkers, shuffled.length);
    state.bunkers = shuffled.slice(0, count).map(pos => ({ ...pos, occupant: null }));

    state.deck = buildDeck();
    state.round = 1;
    state.currentPlayerIndex = 0;
    state.turnPhase = 'draw';
    state.drawnCard = null;
    state.splashedCells = [];
    state.redoHolders = [];
    state.redoQueue = [];
    state.redoQueuePos = 0;
    state.gameOver = false;
    state.roundStartPlayer = undefined;
    state.preDrop = null;

    showScreen('game-screen');
    enforceBunkerCap();
    renderAll();
    updateDeckCount();
    maybeScheduleAI();
}

// ==============================
// Rendering
// ==============================
function renderAll() {
    renderBoard();
    renderPlayerStatus();
    renderTurnInfo();
    renderCardArea();
    renderRoundControls();
}

function renderBoard() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = r;
            cell.dataset.col = c;

            // Shade the central 4x4 zone
            if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
                cell.classList.add('central-zone');
            }

            // Check if bunker
            const bunker = state.bunkers.find(b => b.row === r && b.col === c);
            if (bunker) {
                cell.classList.add('bunker');
                if (bunker.occupant) {
                    const p = bunker.occupant.playerIndex;
                    const peepEl = createPeepIcon(p);
                    cell.appendChild(peepEl);
                    // Show turns remaining
                    const badge = document.createElement('span');
                    badge.className = 'bunker-timer';
                    badge.textContent = bunker.occupant.turnsLeft;
                    cell.appendChild(badge);
                }
            }

            // Check if splashed
            if (state.splashedCells.find(s => s.row === r && s.col === c)) {
                cell.classList.add('splashed');
            }

            // Draw peeps
            state.players.forEach((player, pi) => {
                player.peeps.forEach((peep, peepIdx) => {
                    if (peep.alive && peep.row === r && peep.col === c && !peep.inBunker) {
                        const peepEl = createPeepIcon(pi);
                        if (peep.hasUmbrella) peepEl.classList.add('has-umbrella');
                        // Dim peeps that have already moved this turn
                        if (pi === state.currentPlayerIndex &&
                            state.peepsMoved && state.peepsMoved.includes(peepIdx)) {
                            peepEl.classList.add('peep-moved');
                        }
                        cell.appendChild(peepEl);
                    }
                });
            });

            // Move targets
            if (state.moveTargets.find(t => t.row === r && t.col === c)) {
                cell.classList.add('move-target');
            }

            cell.addEventListener('click', () => onCellClick(r, c));
            boardEl.appendChild(cell);
        }
    }
}

function renderPlayerStatus() {
    const container = document.getElementById('player-status');
    container.innerHTML = '';

    state.players.forEach((player, i) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `player-card-${i}`;
        if (i === state.currentPlayerIndex && !isRoundEndPhase()) card.classList.add('active-player');
        if (player.eliminated) card.classList.add('eliminated');

        const alivePeeps = player.peeps.filter(p => p.alive);
        const umbrellas = alivePeeps.filter(p => p.hasUmbrella).length;
        const inBunkers = alivePeeps.filter(p => p.inBunker).length;

        card.innerHTML = `
            <h4 class="player-${i + 1}">${getPlayerLabelHTML(i)}${isAI(i) ? ' <span class="ai-badge">🤖</span>' : ''}</h4>
            <div class="peep-list">
                Peeps: ${alivePeeps.length}/3
                ${umbrellas ? ` | ☂️×${umbrellas}` : ''}
                ${inBunkers ? ` | 🏠×${inBunkers}` : ''}
            </div>
            ${state.redoQueue.includes(i) ? '<span class="redo-badge">🔄 Redo Ready</span>' : ''}
        `;
        container.appendChild(card);
    });
}

function renderTurnInfo() {
    const el = document.getElementById('turn-info');
    if (isRoundEndPhase()) {
        el.textContent = `End of Round ${state.round} — Drop the balloons! 💧`;
    } else if (state.gameOver) {
        el.textContent = '';
    } else {
        const aiTurn = isCurrentPlayerAI();
        const prefix = aiTurn ? '🤖 ' : '';
        el.innerHTML = `${prefix}${getPlayerLabelHTML(state.currentPlayerIndex, `${PLAYER_NAMES[state.currentPlayerIndex]}'s Turn`)}`;
        if (state.selectionMode && !aiTurn) {
            el.innerHTML += ` — ${getSelectionPrompt()}`;
        }
    }
}

function getSelectionPrompt() {
    switch (state.selectionMode) {
        case 'select_peep_umbrella': return 'Click one of your peeps to give the umbrella';
        case 'select_peep_steal_from': return 'Click an opponent\'s peep with an umbrella to steal';
        case 'select_peep_steal_to': return 'Click one of your peeps to receive the umbrella';
        case 'select_peep_bunker':      return 'Click one of your peeps adjacent to a bunker';
        case 'select_bunker_target':    return 'Click a bunker to enter it';
        case 'select_peep_move': return 'Click a peep to move (or click a highlighted square)';
        case 'select_move_target': return 'Click a highlighted square to move there';
        default: return '';
    }
}

function renderCardArea() {
    const deck = document.getElementById('card-deck');
    const useBtn = document.getElementById('use-card-btn');
    const discardBtn = document.getElementById('discard-btn');
    const doneMovingBtn = document.getElementById('done-moving-btn');
    const endTurnWrap = document.getElementById('end-turn-timer-wrap');
    const cardDisplay = document.getElementById('drawn-card');
    const title = document.getElementById('card-area-title');
    const playerColors = ['#E74C3C', '#3498DB', '#27AE60', '#F39C12'];

    const isMoving = state.selectionMode === 'select_peep_move' || state.selectionMode === 'select_move_target';

    if (isRoundEndPhase() || state.gameOver) {
        if (deck) deck.classList.add('deck-disabled');
        useBtn.classList.add('hidden');
        discardBtn.classList.add('hidden');
        doneMovingBtn.classList.add('hidden');
        if (endTurnWrap) endTurnWrap.classList.add('hidden');
        cardDisplay.className = 'card-display empty';
        cardDisplay.innerHTML = '<p>Waiting for round end...</p>';
        cardDisplay.style.borderColor = '';
        if (title) title.textContent = 'Card Deck';
        return;
    }

    const pName = PLAYER_NAMES[state.currentPlayerIndex];
    const pColor = playerColors[state.currentPlayerIndex];
    if (title) title.innerHTML = getPlayerLabelHTML(state.currentPlayerIndex, `${pName}'s Turn`);

    if (state.turnPhase === 'draw') {
        if (isCurrentPlayerAI()) {
            if (deck) deck.classList.add('deck-disabled');
            useBtn.classList.add('hidden');
            discardBtn.classList.add('hidden');
            doneMovingBtn.classList.add('hidden');
            if (endTurnWrap) endTurnWrap.classList.add('hidden');
            cardDisplay.className = 'card-display empty';
            cardDisplay.innerHTML = '<p>🤖 Computer is thinking…</p>';
            cardDisplay.style.borderColor = '';
        } else {
            if (deck) deck.classList.remove('deck-disabled');
            useBtn.classList.add('hidden');
            discardBtn.classList.add('hidden');
            doneMovingBtn.classList.add('hidden');
            if (endTurnWrap) endTurnWrap.classList.add('hidden');
            cardDisplay.className = 'card-display empty';
            cardDisplay.innerHTML = '<p>Click the deck to draw</p>';
            cardDisplay.style.borderColor = '';
        }
    } else if (state.turnPhase === 'action') {
        if (deck) deck.classList.add('deck-disabled');
        if (isCurrentPlayerAI()) {
            useBtn.classList.add('hidden');
            discardBtn.classList.add('hidden');
            doneMovingBtn.classList.add('hidden');
            if (endTurnWrap) endTurnWrap.classList.add('hidden');
            const info = state.drawnCard ? CARD_INFO[state.drawnCard] : null;
            cardDisplay.className = 'card-display';
            cardDisplay.style.borderColor = pColor;
            cardDisplay.innerHTML = info
                ? `<div class="card-icon">${info.icon}</div>
                   <div class="card-name">${info.name}</div>
                   <div class="card-desc">🤖 Computer is playing…</div>`
                : '<p>🤖 Computer is thinking…</p>';
            return;
        }
        if (endTurnWrap) endTurnWrap.classList.add('hidden');
        if (isMoving) {
            useBtn.classList.add('hidden');
            discardBtn.classList.add('hidden');
            doneMovingBtn.classList.remove('hidden');
        } else {
            useBtn.classList.remove('hidden');
            discardBtn.classList.remove('hidden');
            doneMovingBtn.classList.add('hidden');
            const usable = canUseCard(state.drawnCard);
            useBtn.disabled = !usable;
            useBtn.title = usable ? '' : getCannotUseReason(state.drawnCard);
        }
        const info = CARD_INFO[state.drawnCard];
        cardDisplay.className = 'card-display';
        cardDisplay.style.borderColor = pColor;
        cardDisplay.innerHTML = `
            <div class="card-icon">${info.icon}</div>
            <div class="card-name">${info.name}</div>
            <div class="card-desc">${info.desc}</div>
            ${!canUseCard(state.drawnCard) ? `<div class="card-blocked">⚠️ ${getCannotUseReason(state.drawnCard)}</div>` : ''}
        `;
    } else if (state.turnPhase === 'done') {
        if (deck) deck.classList.add('deck-disabled');
        useBtn.classList.add('hidden');
        discardBtn.classList.add('hidden');
        doneMovingBtn.classList.add('hidden');
        if (endTurnWrap) {
            if (isCurrentPlayerAI()) {
                endTurnWrap.classList.add('hidden');
            } else {
                endTurnWrap.classList.remove('hidden');
            }
        }
        cardDisplay.className = 'card-display empty';
        cardDisplay.innerHTML = '<p>Turn complete</p>';
        cardDisplay.style.borderColor = '';
    }
}

function renderRoundControls() {
    const roundCtrl = document.getElementById('round-controls');
    const redoCtrl = document.getElementById('redo-controls');
    const redoBtn = document.getElementById('redo-btn');
    const passBtn = document.getElementById('accept-drop-btn');

    if (isRoundEndPhase() && state.splashedCells.length === 0) {
        // Waiting to drop
        roundCtrl.classList.remove('hidden');
        redoCtrl.classList.add('hidden');
    } else if (isRoundEndPhase() && state.splashedCells.length > 0) {
        roundCtrl.classList.add('hidden');
        const decider = currentRedoDecider();
        if (decider !== null) {
            redoCtrl.classList.remove('hidden');
            const info = document.getElementById('redo-deciding-info');
            if (info) {
                const others = state.redoQueue.length - state.redoQueuePos - 1;
                info.innerHTML = `
                    <strong>${getPlayerLabelHTML(decider, PLAYER_NAMES[decider])}</strong> — use your Redo card?
                    ${others > 0 ? `<small>(${others} more player${others > 1 ? 's' : ''} to decide after you)</small>` : ''}
                `;
            }
            redoBtn.classList.remove('hidden');
            passBtn.textContent = '👍 Pass';
        } else {
            // No redo holders — just show accept
            redoCtrl.classList.remove('hidden');
            const info = document.getElementById('redo-deciding-info');
            if (info) info.innerHTML = 'Balloons have fallen!';
            redoBtn.classList.add('hidden');
            passBtn.textContent = '➡️ Next Round';
        }
    } else {
        roundCtrl.classList.add('hidden');
        redoCtrl.classList.add('hidden');
    }
}

// ==============================
// Turn Logic
// ==============================
function isRoundEndPhase() {
    // Round ends when all non-eliminated players have taken their turn
    return state.turnPhase === 'round_end';
}

function drawCard() {
    if (state.turnPhase !== 'draw') return;

    const deckEl = document.getElementById('card-deck');
    if (deckEl) deckEl.classList.add('deck-disabled');

    if (state.deck.length === 0) state.deck = buildDeck();
    const card = state.deck.pop();
    updateDeckCount();

    animateCardDeal(card, () => {
        if (card === CARD_TYPES.REDO) {
            // Auto-hold — no decision needed
            state.redoQueue.push(state.currentPlayerIndex);
            toast(`${PLAYER_NAMES[state.currentPlayerIndex]} drew Redo and is holding it! 🔄`);
            state.drawnCard = null;
            state.turnPhase = 'done';
            renderAll();
            if (isCurrentPlayerAI()) {
                maybeScheduleAI();
            } else {
                startEndTurnTimer();
            }
        } else if (card === CARD_TYPES.MOVE) {
            // Auto-start moving — skip Use/Discard prompt
            state.drawnCard = card;
            state.turnPhase = 'action';
            startMoveAction();
            maybeScheduleAI();
        } else {
            state.drawnCard = card;
            state.turnPhase = 'action';
            renderAll();
            maybeScheduleAI();
        }
    });
}

function updateDeckCount() {
    const el = document.getElementById('deck-count');
    if (el) el.textContent = state.deck.length;
}

function animateCardDeal(card, onComplete) {
    const deckEl = document.getElementById('card-deck');
    const playerCardEl = document.getElementById(`player-card-${state.currentPlayerIndex}`);
    const drawnCardEl = document.getElementById('drawn-card');
    const info = CARD_INFO[card];
    const playerColors = ['#E74C3C', '#3498DB', '#27AE60', '#F39C12'];

    if (!deckEl || !playerCardEl || !drawnCardEl) { onComplete(); return; }

    const deckRect = deckEl.getBoundingClientRect();
    const playerRect = playerCardEl.getBoundingClientRect();
    const drawnRect = drawnCardEl.getBoundingClientRect();

    // Card starts at deck size
    const cw = deckRect.width, ch = deckRect.height;

    const flying = document.createElement('div');
    flying.className = 'flying-card';
    Object.assign(flying.style, {
        left: deckRect.left + 'px',
        top: deckRect.top + 'px',
        width: cw + 'px',
        height: ch + 'px',
    });
    flying.innerHTML = '🎴';
    document.body.appendChild(flying);

    // Phase 1: Fly face-down to the player's panel
    const destX = playerRect.left + playerRect.width / 2 - cw / 2;
    const destY = playerRect.top + playerRect.height / 2 - ch / 2;

    requestAnimationFrame(() => requestAnimationFrame(() => {
        flying.classList.add('in-flight');
        flying.style.left = destX + 'px';
        flying.style.top = destY + 'px';
    }));

    // Phase 2: Flip to reveal at player position
    setTimeout(() => {
        flying.classList.remove('in-flight');
        flying.style.transition = 'transform 0.12s ease-in';
        flying.style.transform = 'scaleX(0)';

        setTimeout(() => {
            // Show card face
            const pColor = playerColors[state.currentPlayerIndex];
            flying.style.background = `linear-gradient(135deg, #ffecd2, #fcb69f)`;
            flying.style.border = `3px solid ${pColor}`;
            flying.style.color = '#333';
            flying.innerHTML = `<div class="fcard-inner"><div class="fcard-icon">${info.icon}</div><div class="fcard-name">${info.name}</div></div>`;
            flying.style.transition = 'transform 0.15s ease-out';
            flying.style.transform = 'scaleX(1)';

            // Phase 3: Slide to drawn-card display
            setTimeout(() => {
                flying.classList.add('sliding');
                flying.style.left = drawnRect.left + 'px';
                flying.style.top = drawnRect.top + 'px';
                flying.style.width = drawnRect.width + 'px';
                flying.style.height = drawnRect.height + 'px';

                setTimeout(() => {
                    flying.remove();
                    onComplete();
                }, 320);
            }, 450);
        }, 120);
    }, 500);
}

function getCannotUseReason(card) {
    switch (card) {
        case CARD_TYPES.MOVE:           return 'No peeps to move';
        case CARD_TYPES.UMBRELLA:       return 'No peeps to equip';
        case CARD_TYPES.STEAL_UMBRELLA: return 'No umbrellas to steal';
        case CARD_TYPES.BUNKER_KEY:     return 'No peep is next to a bunker';
        default: return '';
    }
}

function canUseCard(card) {
    const player = state.players[state.currentPlayerIndex];
    switch (card) {
        case CARD_TYPES.MOVE:
            return player.peeps.some(p => p.alive && !p.inBunker);

        case CARD_TYPES.UMBRELLA:
            return player.peeps.some(p => p.alive);

        case CARD_TYPES.STEAL_UMBRELLA:
            return state.players.some((p, pi) =>
                pi !== state.currentPlayerIndex && p.peeps.some(peep => peep.alive && peep.hasUmbrella)
            );

        case CARD_TYPES.BUNKER_KEY:
            return player.peeps.some(peep => {
                if (!peep.alive || peep.inBunker) return false;
                return getAdjacentCells(peep.row, peep.col).some(adj =>
                    state.bunkers.some(b => b.row === adj.row && b.col === adj.col)
                );
            });

        default:
            return true;
    }
}

function useCard() {
    if (state.turnPhase !== 'action' || !state.drawnCard) return;
    if (!canUseCard(state.drawnCard)) return;

    const card = state.drawnCard;

    switch (card) {
        case CARD_TYPES.MOVE:
            startMoveAction();
            break;
        case CARD_TYPES.UMBRELLA:
            startUmbrellaAction();
            break;
        case CARD_TYPES.STEAL_UMBRELLA:
            startStealAction();
            break;
        case CARD_TYPES.BUNKER_KEY:
            startBunkerAction();
            break;
    }
}

function discardCard() {
    if (state.turnPhase !== 'action') return;
    state.drawnCard = null;
    state.turnPhase = 'done';
    clearSelection();
    renderAll();
    if (isCurrentPlayerAI()) {
        maybeScheduleAI();
    } else {
        startEndTurnTimer();
    }
}

let endTurnTimer = null;
let endTurnTimerStart = null;

function startEndTurnTimer() {
    cancelEndTurnTimer();
    endTurnTimerStart = Date.now();
    renderTimerBar(3);

    endTurnTimer = setInterval(() => {
        const elapsed = (Date.now() - endTurnTimerStart) / 1000;
        const remaining = 3 - elapsed;
        if (remaining <= 0) {
            cancelEndTurnTimer();
            endTurn();
        } else {
            renderTimerBar(remaining);
        }
    }, 50);
}

function cancelEndTurnTimer() {
    if (endTurnTimer) {
        clearInterval(endTurnTimer);
        endTurnTimer = null;
    }
    renderTimerBar(null);
}

function renderTimerBar(secondsLeft) {
    const bar = document.getElementById('end-turn-timer-bar');
    if (!bar) return;
    if (secondsLeft === null) {
        bar.style.display = 'none';
        bar.style.width = '0%';
        return;
    }
    bar.style.display = 'block';
    bar.style.width = `${(secondsLeft / 3) * 100}%`;
}

function endTurn() {
    if (state.turnPhase !== 'done') return;
    cancelEndTurnTimer();

    // Track who started this round (first non-eliminated player)
    if (state.roundStartPlayer === undefined) {
        state.roundStartPlayer = state.players.findIndex(p => !p.eliminated);
    }

    // Find next non-eliminated player
    let next = state.currentPlayerIndex;
    let attempts = 0;
    do {
        next = (next + 1) % state.numPlayers;
        attempts++;
    } while (state.players[next].eliminated && attempts <= state.numPlayers);

    // If we've looped back to the round starter, it's round end
    if (next === state.roundStartPlayer || attempts > state.numPlayers) {
        state.turnPhase = 'round_end';
        state.roundStartPlayer = undefined;
        renderAll();
        return;
    }

    state.currentPlayerIndex = next;
    state.turnPhase = 'draw';
    state.drawnCard = null;
    clearSelection();
    renderAll();
    maybeScheduleAI();
}

// ==============================
// Card Actions
// ==============================

// --- MOVE ---
function startMoveAction() {
    const player = state.players[state.currentPlayerIndex];
    const alivePeeps = player.peeps.filter(p => p.alive && !p.inBunker);

    if (alivePeeps.length === 0) {
        toast("No peeps to move!");
        finishCardAction();
        return;
    }

    state.selectionMode = 'select_peep_move';
    state.movesRemaining = alivePeeps.map((_, i) => player.peeps.indexOf(alivePeeps[i]));
    state.peepsMoved = [];

    // Highlight all moveable peeps
    highlightPlayerPeeps();
    renderAll();

    // Hide use/discard buttons during move
    document.getElementById('use-card-btn').classList.add('hidden');
    document.getElementById('discard-btn').classList.add('hidden');
}

function highlightPlayerPeeps() {
    state.moveTargets = [];
    const player = state.players[state.currentPlayerIndex];
    state.movesRemaining.forEach(idx => {
        const peep = player.peeps[idx];
        if (peep.alive && !peep.inBunker) {
            state.moveTargets.push({ row: peep.row, col: peep.col, peepIdx: idx });
        }
    });
}

function handleMoveClick(row, col) {
    const player = state.players[state.currentPlayerIndex];

    if (state.selectionMode === 'select_peep_move') {
        // Check if clicked on one of our peeps
        const peepIdx = state.movesRemaining.find(idx => {
            const p = player.peeps[idx];
            return p.row === row && p.col === col;
        });

        if (peepIdx !== undefined) {
            state.selectedPeepIdx = peepIdx;
            state.selectionMode = 'select_move_target';
            // Show valid move targets (adjacent squares, excluding bunkers and occupied squares)
            const peep = player.peeps[peepIdx];
            state.moveTargets = getAdjacentCells(peep.row, peep.col, true)
                .filter(c => !isOccupied(c.row, c.col, state.currentPlayerIndex, peepIdx));
            renderAll();
        }
    } else if (state.selectionMode === 'select_move_target') {
        const target = state.moveTargets.find(t => t.row === row && t.col === col);
        if (target) {
            // Move the peep
            const peep = player.peeps[state.selectedPeepIdx];
            peep.row = row;
            peep.col = col;

            // Remove from remaining (each peep can only move once)
            state.movesRemaining = state.movesRemaining.filter(i => i !== state.selectedPeepIdx);
            state.peepsMoved.push(state.selectedPeepIdx);

            // Go back to peep selection — player can move another or click Done
            state.selectionMode = 'select_peep_move';
            highlightPlayerPeeps();
            renderAll();
            renderCardArea(); // keep Done Moving button visible
        }
    }
}

function getAdjacentCells(row, col, excludeBunkers = false) {
    const cells = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    dirs.forEach(([dr, dc]) => {
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
            if (excludeBunkers && state.bunkers.some(b => b.row === r && b.col === c)) return;
            cells.push({ row: r, col: c });
        }
    });
    return cells;
}

// Returns true if any alive, non-bunker peep occupies (row, col), ignoring one specific peep.
function isOccupied(row, col, exceptPlayerIndex = -1, exceptPeepIndex = -1) {
    return state.players.some((p, pi) =>
        p.peeps.some((peep, idx) => {
            if (pi === exceptPlayerIndex && idx === exceptPeepIndex) return false;
            return peep.alive && !peep.inBunker && peep.row === row && peep.col === col;
        })
    );
}

// Returns a random free adjacent non-bunker cell near a bunker for ejecting peeps.
function findFreeAdjacentCell(bunkerRow, bunkerCol) {
    const adjacent = getAdjacentCells(bunkerRow, bunkerCol, true); // exclude bunker squares
    const free = adjacent.filter(c => !isOccupied(c.row, c.col));
    const pool = free.length > 0 ? free : adjacent; // fallback: ignore occupancy
    if (pool.length === 0) return { row: bunkerRow, col: bunkerCol };
    return pool[Math.floor(Math.random() * pool.length)];
}

// --- UMBRELLA ---
function startUmbrellaAction() {
    const player = state.players[state.currentPlayerIndex];
    const alivePeeps = player.peeps.filter(p => p.alive);
    if (alivePeeps.length === 0) {
        toast("No peeps to equip!");
        return;
    }
    state.selectionMode = 'select_peep_umbrella';
    state.moveTargets = alivePeeps.map(p => ({ row: p.row, col: p.col }));
    renderAll();
    document.getElementById('use-card-btn').classList.add('hidden');
    document.getElementById('discard-btn').classList.add('hidden');
}

// --- STEAL UMBRELLA ---
function startStealAction() {
    // Find opponent peeps with umbrellas
    const targets = [];
    state.players.forEach((p, pi) => {
        if (pi === state.currentPlayerIndex) return;
        p.peeps.forEach(peep => {
            if (peep.alive && peep.hasUmbrella) {
                targets.push({ row: peep.row, col: peep.col, playerIndex: pi });
            }
        });
    });

    if (targets.length === 0) {
        toast("No umbrellas to steal!");
        return;
    }

    state.selectionMode = 'select_peep_steal_from';
    state.moveTargets = targets;
    renderAll();
    document.getElementById('use-card-btn').classList.add('hidden');
    document.getElementById('discard-btn').classList.add('hidden');
}

// --- BUNKER KEY ---
function startBunkerAction() {
    const player = state.players[state.currentPlayerIndex];
    const eligible = [];

    player.peeps.forEach((peep, idx) => {
        if (!peep.alive || peep.inBunker) return;
        const adjacent = getAdjacentCells(peep.row, peep.col);
        const hasNearBunker = state.bunkers.some(b =>
            adjacent.some(a => a.row === b.row && a.col === b.col)
        );
        if (hasNearBunker) eligible.push({ row: peep.row, col: peep.col, peepIdx: idx });
    });

    if (eligible.length === 0) {
        toast("No peeps next to a bunker!");
        return;
    }

    state.selectionMode = 'select_peep_bunker';
    state.moveTargets = eligible;
    renderAll();
    document.getElementById('use-card-btn').classList.add('hidden');
    document.getElementById('discard-btn').classList.add('hidden');
}

// ==============================
// Cell Click Handler
// ==============================
function onCellClick(row, col) {
    if (!state.selectionMode) return;
    if (isCurrentPlayerAI()) return; // AI handles its own selections

    const player = state.players[state.currentPlayerIndex];

    if (state.selectionMode === 'select_peep_move' || state.selectionMode === 'select_move_target') {
        handleMoveClick(row, col);
        return;
    }

    if (state.selectionMode === 'select_peep_umbrella') {
        const peep = player.peeps.find(p => p.alive && p.row === row && p.col === col);
        if (peep) {
            peep.hasUmbrella = true;
            toast(`${PLAYER_NAMES[state.currentPlayerIndex]}'s peep got an umbrella! ☂️`);
            finishCardAction();
        }
        return;
    }

    if (state.selectionMode === 'select_peep_steal_from') {
        // Find the target peep
        let stolen = false;
        state.players.forEach((p, pi) => {
            if (pi === state.currentPlayerIndex || stolen) return;
            p.peeps.forEach(peep => {
                if (peep.alive && peep.hasUmbrella && peep.row === row && peep.col === col) {
                    peep.hasUmbrella = false;
                    state.stolenFrom = { playerIndex: pi };
                    stolen = true;
                }
            });
        });

        if (stolen) {
            // Now pick which of your peeps gets it
            state.selectionMode = 'select_peep_steal_to';
            const alivePeeps = player.peeps.filter(p => p.alive);
            state.moveTargets = alivePeeps.map(p => ({ row: p.row, col: p.col }));
            renderAll();
        }
        return;
    }

    if (state.selectionMode === 'select_peep_steal_to') {
        const peep = player.peeps.find(p => p.alive && p.row === row && p.col === col);
        if (peep) {
            peep.hasUmbrella = true;
            toast(`${PLAYER_NAMES[state.currentPlayerIndex]} stole an umbrella! 🫳`);
            finishCardAction();
        }
        return;
    }

    if (state.selectionMode === 'select_peep_bunker') {
        const target = state.moveTargets.find(t => t.row === row && t.col === col);
        if (!target) return;

        const peep = player.peeps[target.peepIdx];
        const adjacent = getAdjacentCells(peep.row, peep.col);
        const reachableBunkers = state.bunkers.filter(b =>
            adjacent.some(a => a.row === b.row && a.col === b.col)
        );

        if (reachableBunkers.length === 1) {
            // Only one option — enter it directly
            enterBunker(target.peepIdx, reachableBunkers[0]);
        } else {
            // Multiple bunkers — ask which one
            state.selectedPeepIdx = target.peepIdx;
            state.selectionMode = 'select_bunker_target';
            state.moveTargets = reachableBunkers.map(b => ({ row: b.row, col: b.col }));
            renderAll();
        }
        return;
    }

    if (state.selectionMode === 'select_bunker_target') {
        const bunker = state.bunkers.find(b => b.row === row && b.col === col);
        if (bunker && state.moveTargets.find(t => t.row === row && t.col === col)) {
            enterBunker(state.selectedPeepIdx, bunker);
        }
        return;
    }
}

function enterBunker(peepIdx, bunker) {
    const player = state.players[state.currentPlayerIndex];
    const peep = player.peeps[peepIdx];

    // Push out existing occupant
    if (bunker.occupant) {
        const occPlayer = state.players[bunker.occupant.playerIndex];
        const occPeep = occPlayer.peeps[bunker.occupant.peepIndex];
        occPeep.inBunker = false;
        const ejectCell = findFreeAdjacentCell(bunker.row, bunker.col);
        occPeep.row = ejectCell.row;
        occPeep.col = ejectCell.col;
        toast(`${PLAYER_NAMES[bunker.occupant.playerIndex]}'s peep was pushed out!`);
    }

    peep.inBunker = true;
    peep.row = bunker.row;
    peep.col = bunker.col;
    bunker.occupant = { playerIndex: state.currentPlayerIndex, peepIndex: peepIdx, turnsLeft: 3 };
    toast(`${PLAYER_NAMES[state.currentPlayerIndex]}'s peep entered a bunker for 3 rounds! 🏠`);
    finishCardAction();
}

function finishCardAction() {
    state.drawnCard = null;
    state.turnPhase = 'done';
    clearSelection();
    renderAll();
    if (isCurrentPlayerAI()) {
        maybeScheduleAI();
    } else {
        startEndTurnTimer();
    }
}

function clearSelection() {
    state.selectionMode = null;
    state.moveTargets = [];
    state.selectedPeepIdx = null;
    state.peepsMoved = [];
}

// ==============================
// Balloon Drop
// ==============================
function dropBalloons() {
    // Save state before damage for redo
    state.preDrop = {
        players: JSON.parse(JSON.stringify(state.players)),
        bunkers: JSON.parse(JSON.stringify(state.bunkers))
    };

    const cells = [];
    const used = new Set();

    while (cells.length < state.numBalloons) {
        const row = Math.floor(Math.random() * 8);
        const col = Math.floor(Math.random() * 8);
        const key = `${row},${col}`;
        if (!used.has(key)) {
            used.add(key);
            cells.push({ row, col });
        }
    }

    state.splashedCells = cells;
    state.redoQueuePos = 0;

    // Collect hits before applying damage, so we can animate them
    const hits = collectHits();

    // Render splash cells first (peeps still shown)
    renderBoard();
    renderPlayerStatus();
    renderTurnInfo();
    renderCardArea();
    renderRoundControls();

    // Animate hits, then apply damage after animations
    if (hits.length > 0) {
        animateHits(hits, () => {
            applyBalloonDamage(hits);
            renderAll();
            maybeScheduleAI();
        });
    } else {
        applyBalloonDamage(hits);
        renderAll();
        maybeScheduleAI();
    }
}

// Figure out which peeps will be hit without killing them yet
function collectHits() {
    const hits = [];
    state.splashedCells.forEach(({ row, col }) => {
        state.players.forEach((player, pi) => {
            player.peeps.forEach((peep, peepIdx) => {
                if (!peep.alive || peep.row !== row || peep.col !== col) return;
                if (peep.inBunker) return;
                hits.push({ row, col, playerIndex: pi, peepIndex: peepIdx, absorbed: peep.hasUmbrella });
            });
        });
    });
    return hits;
}

function applyBalloonDamage(hits) {
    hits.forEach(({ playerIndex, peepIndex, absorbed }) => {
        const peep = state.players[playerIndex].peeps[peepIndex];
        if (absorbed) {
            peep.hasUmbrella = false;
        } else {
            peep.alive = false;
        }
    });

    // Check eliminations
    state.players.forEach((player, i) => {
        if (!player.eliminated && player.peeps.every(p => !p.alive)) {
            player.eliminated = true;
            toast(`${PLAYER_NAMES[i]} is eliminated! 💀`);
        }
    });

    enforceBunkerCap();
    checkWinCondition();
}

// Bunkers must always be at least 2 fewer than alive peeps.
// Remove random bunkers until the gap is restored.
function enforceBunkerCap() {
    const alivePeeps = state.players.reduce(
        (n, p) => n + p.peeps.filter(peep => peep.alive).length, 0
    );

    while (state.bunkers.length > alivePeeps - 2 && state.bunkers.length > 0) {
        const idx = Math.floor(Math.random() * state.bunkers.length);
        const bunker = state.bunkers[idx];

        // Eject occupant if present
        if (bunker.occupant) {
            const player = state.players[bunker.occupant.playerIndex];
            const peep = player.peeps[bunker.occupant.peepIndex];
            peep.inBunker = false;
            const ejectCell = findFreeAdjacentCell(bunker.row, bunker.col);
            peep.row = ejectCell.row;
            peep.col = ejectCell.col;
            toast(`A bunker was destroyed — ${PLAYER_NAMES[bunker.occupant.playerIndex]}'s peep was ejected! 💥`);
        } else {
            toast('A bunker was destroyed! 💥');
        }

        state.bunkers.splice(idx, 1);
    }
}

// Animate each hit peep: splash burst floating up, then callback
function animateHits(hits, onComplete) {
    const board = document.getElementById('board');
    if (!board) { onComplete(); return; }

    let done = 0;
    const playerColors = ['#E74C3C', '#3498DB', '#27AE60', '#F39C12'];

    hits.forEach(({ row, col, playerIndex, absorbed }, i) => {
        // Find the cell element
        const cell = board.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) { if (++done === hits.length) onComplete(); return; }

        const rect = cell.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const el = document.createElement('div');
        el.className = 'hit-burst';
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
        el.style.color = playerColors[playerIndex];

        if (absorbed) {
            el.innerHTML = `☂️<span class="hit-spray">💦</span>`;
            el.title = 'Umbrella saved!';
        } else {
            el.innerHTML = `${getPeepIconHTML(playerIndex)}<span class="hit-spray">💦</span>`;
        }

        document.body.appendChild(el);

        // Stagger each burst slightly
        setTimeout(() => {
            el.classList.add('hit-burst-go');
            setTimeout(() => {
                el.remove();
                if (++done === hits.length) onComplete();
            }, 900);
        }, i * 120);
    });
}

function checkWinCondition() {
    const alive = state.players.filter(p => !p.eliminated);
    if (alive.length <= 1) {
        state.gameOver = true;
        setTimeout(() => {
            if (alive.length === 1) {
                showGameOver(getPlayerLabelHTML(alive[0].index, `${PLAYER_NAMES[alive[0].index]} wins! 🎉`));
            } else {
                showGameOver("It's a draw! Everyone got soaked! 💧");
            }
        }, 1500);
    }
}

// Returns the player currently deciding on the redo, or null if queue is exhausted
function currentRedoDecider() {
    if (state.redoQueuePos < state.redoQueue.length) {
        return state.redoQueue[state.redoQueuePos];
    }
    return null;
}

function useRedo() {
    const holderIdx = state.redoQueue[state.redoQueuePos];
    toast(`${PLAYER_NAMES[holderIdx]} used Redo! Re-dropping balloons... 🔄`);

    // Restore pre-drop state
    if (state.preDrop) {
        state.players = JSON.parse(JSON.stringify(state.preDrop.players));
        state.bunkers = JSON.parse(JSON.stringify(state.preDrop.bunkers));
    }
    state.splashedCells = [];

    // Remove the used redo from queue; keep remaining holders for the new drop
    state.redoQueue.splice(state.redoQueuePos, 1);
    // redoQueuePos stays the same — it now points to the next undecided holder

    renderAll();
    setTimeout(() => dropBalloons(), 800);
}

function passRedo() {
    state.redoQueuePos++;
    if (currentRedoDecider() === null) {
        // All redo holders have passed — advance to next round
        advanceRound();
    } else {
        renderAll();
        maybeScheduleAI();
    }
}

function advanceRound() {
    // Decrement bunker timers and eject expired occupants
    state.bunkers.forEach(bunker => {
        if (!bunker.occupant) return;
        bunker.occupant.turnsLeft--;
        if (bunker.occupant.turnsLeft <= 0) {
            const player = state.players[bunker.occupant.playerIndex];
            const peep = player.peeps[bunker.occupant.peepIndex];
            peep.inBunker = false;
            const ejectCell = findFreeAdjacentCell(bunker.row, bunker.col);
            peep.row = ejectCell.row;
            peep.col = ejectCell.col;
            toast(`${PLAYER_NAMES[bunker.occupant.playerIndex]}'s peep was ejected from the bunker! ⏰`);
            bunker.occupant = null;
        }
    });

    state.round++;
    state.splashedCells = [];
    state.redoQueue = [];
    state.redoQueuePos = 0;
    state.preDrop = null;

    state.currentPlayerIndex = state.players.findIndex(p => !p.eliminated);
    state.turnPhase = 'draw';
    state.drawnCard = null;
    cancelEndTurnTimer();
    document.getElementById('round-num').textContent = state.round;
    clearSelection();
    renderAll();
    maybeScheduleAI();
}

// ==============================
// Utilities
// ==============================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function showGameOver(text) {
    document.getElementById('winner-text').innerHTML = text;
    showScreen('gameover-screen');
}

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ==============================
// Computer Player AI
// ==============================

function isAI(playerIndex) {
    return !!(state.playerTypes && state.playerTypes[playerIndex] === 'computer');
}

function isCurrentPlayerAI() {
    return isAI(state.currentPlayerIndex);
}

let aiActionTimeout = null;

// Called at each state transition to schedule AI actions as needed.
// Uses a timeout so rapid re-renders don't double-fire.
function maybeScheduleAI() {
    if (state.gameOver) return;

    // Clear any previously queued AI step (prevents double-scheduling)
    if (aiActionTimeout) {
        clearTimeout(aiActionTimeout);
        aiActionTimeout = null;
    }

    if (isRoundEndPhase()) {
        // Check if the current redo-queue decider is a computer
        const decider = currentRedoDecider();
        if (decider !== null && isAI(decider)) {
            aiActionTimeout = setTimeout(() => {
                aiActionTimeout = null;
                aiDecideRedo(decider);
            }, 1200);
        }
        return;
    }

    if (!isCurrentPlayerAI()) return;

    switch (state.turnPhase) {
        case 'draw':
            aiActionTimeout = setTimeout(() => {
                aiActionTimeout = null;
                if (isCurrentPlayerAI() && state.turnPhase === 'draw') drawCard();
            }, 900);
            break;

        case 'action':
            aiActionTimeout = setTimeout(() => {
                aiActionTimeout = null;
                aiDecideCard();
            }, 700);
            break;

        case 'done':
            aiActionTimeout = setTimeout(() => {
                aiActionTimeout = null;
                if (isCurrentPlayerAI() && state.turnPhase === 'done') {
                    cancelEndTurnTimer();
                    endTurn();
                }
            }, 800);
            break;
    }
}

function aiDecideCard() {
    if (!isCurrentPlayerAI() || state.turnPhase !== 'action') return;
    const card = state.drawnCard;

    if (!canUseCard(card)) {
        discardCard();
        return;
    }

    switch (card) {
        case CARD_TYPES.MOVE:           aiDoMove();         break;
        case CARD_TYPES.UMBRELLA:       aiDoUmbrella();     break;
        case CARD_TYPES.STEAL_UMBRELLA: aiDoSteal();        break;
        case CARD_TYPES.BUNKER_KEY:     aiDoBunkerKey();    break;
        default: discardCard();
    }
}

// Move: move each peep toward the nearest available bunker (or toward center)
function aiDoMove() {
    startMoveAction();
    const allIndices = [...state.movesRemaining];
    aiMovePeepSequence(allIndices, 0, () => {
        setTimeout(() => finishCardAction(), 500);
    });
}

function aiMovePeepSequence(allIndices, pos, onDone) {
    if (pos >= allIndices.length) { onDone(); return; }

    const player = state.players[state.currentPlayerIndex];
    const peepIdx = allIndices[pos];
    const peep = player.peeps[peepIdx];

    setTimeout(() => {
        if (!isCurrentPlayerAI()) return;

        const target = aiBestMoveTarget(peep, peepIdx);
        if (target) {
            peep.row = target.row;
            peep.col = target.col;
        }

        state.movesRemaining = state.movesRemaining.filter(i => i !== peepIdx);
        state.peepsMoved.push(peepIdx);
        state.selectionMode = 'select_peep_move';
        highlightPlayerPeeps();
        renderAll();

        aiMovePeepSequence(allIndices, pos + 1, onDone);
    }, 700);
}

function aiBestMoveTarget(peep, peepIdx) {
    const playerIdx = state.currentPlayerIndex;
    const adjacent = getAdjacentCells(peep.row, peep.col, true) // exclude bunkers
        .filter(c => !isOccupied(c.row, c.col, playerIdx, peepIdx)); // exclude occupied squares
    if (adjacent.length === 0) return null;

    const availBunkers = state.bunkers.filter(b => !b.occupant);

    let best = null;
    let bestScore = Infinity;

    adjacent.forEach(cell => {
        let score;
        if (availBunkers.length > 0) {
            // Move toward the nearest available bunker
            score = Math.min(...availBunkers.map(b =>
                Math.abs(b.row - cell.row) + Math.abs(b.col - cell.col)
            ));
        } else {
            // No bunkers — move toward center of board
            score = Math.abs(cell.row - 3.5) + Math.abs(cell.col - 3.5);
        }
        if (score < bestScore) {
            bestScore = score;
            best = cell;
        }
    });

    return best;
}

// Umbrella: give to an unprotected peep, preferring more central ones
function aiDoUmbrella() {
    startUmbrellaAction();

    setTimeout(() => {
        if (!isCurrentPlayerAI()) return;
        const player = state.players[state.currentPlayerIndex];

        const candidates = player.peeps.filter(p => p.alive && !p.hasUmbrella);
        const pool = candidates.length > 0 ? candidates : player.peeps.filter(p => p.alive);
        const target = pool.reduce((a, b) => aiCentrality(a) > aiCentrality(b) ? a : b, pool[0]);

        if (target) {
            target.hasUmbrella = true;
            toast(`${PLAYER_NAMES[state.currentPlayerIndex]}'s peep got an umbrella! ☂️`);
            finishCardAction();
        }
    }, 700);
}

// Steal: take an umbrella from an opponent, give to own most-central unprotected peep
function aiDoSteal() {
    startStealAction();

    setTimeout(() => {
        if (!isCurrentPlayerAI()) return;
        const player = state.players[state.currentPlayerIndex];

        // Pick first opponent umbrella
        let sourcePeep = null;
        outer:
        for (let pi = 0; pi < state.players.length; pi++) {
            if (pi === state.currentPlayerIndex) continue;
            for (const peep of state.players[pi].peeps) {
                if (peep.alive && peep.hasUmbrella) { sourcePeep = peep; break outer; }
            }
        }
        if (!sourcePeep) { discardCard(); return; }

        sourcePeep.hasUmbrella = false;

        // Briefly show own peeps as highlighted targets
        state.selectionMode = 'select_peep_steal_to';
        state.moveTargets = player.peeps.filter(p => p.alive).map(p => ({ row: p.row, col: p.col }));
        renderAll();

        setTimeout(() => {
            if (!isCurrentPlayerAI()) return;
            const noBrella = player.peeps.filter(p => p.alive && !p.hasUmbrella);
            const pool = noBrella.length > 0 ? noBrella : player.peeps.filter(p => p.alive);
            const target = pool.reduce((a, b) => aiCentrality(a) > aiCentrality(b) ? a : b, pool[0]);
            if (target) {
                target.hasUmbrella = true;
                toast(`${PLAYER_NAMES[state.currentPlayerIndex]} stole an umbrella! 🫳`);
            }
            finishCardAction();
        }, 600);
    }, 700);
}

// Bunker key: enter the first reachable bunker
function aiDoBunkerKey() {
    startBunkerAction();

    setTimeout(() => {
        if (!isCurrentPlayerAI()) return;
        const player = state.players[state.currentPlayerIndex];

        for (let pi = 0; pi < player.peeps.length; pi++) {
            const peep = player.peeps[pi];
            if (!peep.alive || peep.inBunker) continue;

            const adjacent = getAdjacentCells(peep.row, peep.col);
            const nearBunker = state.bunkers.find(b =>
                adjacent.some(a => a.row === b.row && a.col === b.col)
            );
            if (nearBunker) {
                enterBunker(pi, nearBunker); // enterBunker calls finishCardAction
                return;
            }
        }
        discardCard();
    }, 700);
}

// Redo decision: use if the drop hurt us, otherwise pass
function aiDecideRedo(deciderIndex) {
    if (currentRedoDecider() !== deciderIndex) return;
    if (!isAI(deciderIndex)) return;

    let wasHurt = false;
    if (state.preDrop) {
        const prePlayer = state.preDrop.players[deciderIndex];
        const curPlayer = state.players[deciderIndex];
        wasHurt = prePlayer.peeps.some((prePeep, i) => {
            const curPeep = curPlayer.peeps[i];
            return (prePeep.alive && !curPeep.alive) ||
                   (prePeep.hasUmbrella && !curPeep.hasUmbrella);
        });
    }

    if (wasHurt) {
        toast(`🤖 ${PLAYER_NAMES[deciderIndex]} uses Redo! 🔄`);
        setTimeout(() => useRedo(), 600);
    } else {
        setTimeout(() => passRedo(), 600);
    }
}

// Higher = more central on the board
function aiCentrality(peep) {
    return -(Math.abs(peep.row - 3.5) + Math.abs(peep.col - 3.5));
}
