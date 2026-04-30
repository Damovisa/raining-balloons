// ==============================
// Raining Balloons - Game Logic
// ==============================

const PLAYER_EMOJIS = ['🔴', '🔵', '🟢', '🟡'];
const PLAYER_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
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
    document.getElementById('start-game').addEventListener('click', startGame);
    document.getElementById('card-deck').addEventListener('click', drawCard);
    document.getElementById('use-card-btn').addEventListener('click', useCard);
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
            const group = btn.dataset.option;
            document.querySelectorAll(`[data-option="${group}"]`).forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });
}

function startGame() {
    state.numPlayers = parseInt(document.querySelector('[data-option="players"].selected').dataset.value);
    state.numBunkers = parseInt(document.querySelector('[data-option="bunkers"].selected').dataset.value);
    state.numBalloons = parseInt(document.querySelector('[data-option="balloons"].selected').dataset.value);

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

    state.bunkers = [];
    while (state.bunkers.length < state.numBunkers) {
        const row = Math.floor(Math.random() * 8);
        const col = Math.floor(Math.random() * 8);
        const key = `${row},${col}`;
        if (!occupied.has(key) && !state.bunkers.find(b => b.row === row && b.col === col)) {
            state.bunkers.push({ row, col, occupant: null });
            occupied.add(key);
        }
    }

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
    renderAll();
    updateDeckCount();
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

            // Check if bunker
            const bunker = state.bunkers.find(b => b.row === r && b.col === c);
            if (bunker) {
                cell.classList.add('bunker');
                if (bunker.occupant) {
                    const p = bunker.occupant.playerIndex;
                    const peepEl = document.createElement('span');
                    peepEl.className = `peep player-${p + 1}`;
                    peepEl.textContent = PLAYER_EMOJIS[p];
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
                        const peepEl = document.createElement('span');
                        peepEl.className = `peep player-${pi + 1}`;
                        if (peep.hasUmbrella) peepEl.classList.add('has-umbrella');
                        peepEl.textContent = PLAYER_EMOJIS[pi];
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
            <h4 class="player-${i + 1}">${PLAYER_EMOJIS[i]} ${PLAYER_NAMES[i]}</h4>
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
        const p = state.players[state.currentPlayerIndex];
        el.textContent = `${PLAYER_EMOJIS[state.currentPlayerIndex]} ${PLAYER_NAMES[state.currentPlayerIndex]}'s Turn`;
        if (state.selectionMode) {
            el.textContent += ` — ${getSelectionPrompt()}`;
        }
    }
}

function getSelectionPrompt() {
    switch (state.selectionMode) {
        case 'select_peep_umbrella': return 'Click one of your peeps to give the umbrella';
        case 'select_peep_steal_from': return 'Click an opponent\'s peep with an umbrella to steal';
        case 'select_peep_steal_to': return 'Click one of your peeps to receive the umbrella';
        case 'select_peep_bunker': return 'Click one of your peeps adjacent to a bunker';
        case 'select_peep_move': return 'Click a peep to move (or click a highlighted square)';
        case 'select_move_target': return 'Click a highlighted square to move there';
        default: return '';
    }
}

function renderCardArea() {
    const deck = document.getElementById('card-deck');
    const useBtn = document.getElementById('use-card-btn');
    const discardBtn = document.getElementById('discard-btn');
    const endTurnBtn = document.getElementById('end-turn-btn');
    const cardDisplay = document.getElementById('drawn-card');
    const title = document.getElementById('card-area-title');
    const deckWrapper = document.getElementById('card-deck-wrapper');
    const playerColors = ['#E74C3C', '#3498DB', '#27AE60', '#F39C12'];

    if (isRoundEndPhase() || state.gameOver) {
        if (deck) deck.classList.add('deck-disabled');
        useBtn.classList.add('hidden');
        discardBtn.classList.add('hidden');
        endTurnBtn.classList.add('hidden');
        cardDisplay.className = 'card-display empty';
        cardDisplay.innerHTML = '<p>Waiting for round end...</p>';
        cardDisplay.style.borderColor = '';
        if (title) title.textContent = 'Card Deck';
        return;
    }

    const pName = PLAYER_NAMES[state.currentPlayerIndex];
    const pColor = playerColors[state.currentPlayerIndex];
    if (title) title.textContent = `${PLAYER_EMOJIS[state.currentPlayerIndex]} ${pName}'s Turn`;

    if (state.turnPhase === 'draw') {
        if (deck) deck.classList.remove('deck-disabled');
        useBtn.classList.add('hidden');
        discardBtn.classList.add('hidden');
        endTurnBtn.classList.add('hidden');
        cardDisplay.className = 'card-display empty';
        cardDisplay.innerHTML = '<p>Click the deck to draw</p>';
        cardDisplay.style.borderColor = '';
    } else if (state.turnPhase === 'action') {
        if (deck) deck.classList.add('deck-disabled');
        useBtn.classList.remove('hidden');
        discardBtn.classList.remove('hidden');
        endTurnBtn.classList.add('hidden');
        const info = CARD_INFO[state.drawnCard];
        cardDisplay.className = 'card-display';
        cardDisplay.style.borderColor = pColor;
        cardDisplay.innerHTML = `
            <div class="card-icon">${info.icon}</div>
            <div class="card-name">${info.name}</div>
            <div class="card-desc">${info.desc}</div>
        `;
    } else if (state.turnPhase === 'done') {
        if (deck) deck.classList.add('deck-disabled');
        useBtn.classList.add('hidden');
        discardBtn.classList.add('hidden');
        endTurnBtn.classList.remove('hidden');
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
                    <strong>${PLAYER_EMOJIS[decider]} ${PLAYER_NAMES[decider]}</strong> — use your Redo card?
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
        state.drawnCard = card;
        state.turnPhase = 'action';
        renderAll();
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

function useCard() {
    if (state.turnPhase !== 'action' || !state.drawnCard) return;

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
        case CARD_TYPES.REDO:
            state.redoQueue.push(state.currentPlayerIndex);
            toast(`${PLAYER_NAMES[state.currentPlayerIndex]} holds a Redo card! 🔄`);
            state.drawnCard = null;
            state.turnPhase = 'done';
            renderAll();
            break;
    }
}

function discardCard() {
    if (state.turnPhase !== 'action') return;
    state.drawnCard = null;
    state.turnPhase = 'done';
    clearSelection();
    renderAll();
}

function endTurn() {
    if (state.turnPhase !== 'done') return;

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
            // Show valid move targets (adjacent squares)
            const peep = player.peeps[peepIdx];
            state.moveTargets = getAdjacentCells(peep.row, peep.col);
            renderAll();
        }
    } else if (state.selectionMode === 'select_move_target') {
        const target = state.moveTargets.find(t => t.row === row && t.col === col);
        if (target) {
            // Move the peep
            const peep = player.peeps[state.selectedPeepIdx];
            peep.row = row;
            peep.col = col;

            // Remove from remaining
            state.movesRemaining = state.movesRemaining.filter(i => i !== state.selectedPeepIdx);
            state.peepsMoved.push(state.selectedPeepIdx);

            if (state.movesRemaining.length === 0) {
                // All moved
                finishCardAction();
            } else {
                state.selectionMode = 'select_peep_move';
                highlightPlayerPeeps();
                renderAll();
            }
        }
    }
}

function getAdjacentCells(row, col) {
    const cells = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    dirs.forEach(([dr, dc]) => {
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
            cells.push({ row: r, col: c });
        }
    });
    return cells;
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
    // Find peeps adjacent to a bunker
    const eligible = [];

    player.peeps.forEach((peep, idx) => {
        if (!peep.alive || peep.inBunker) return;
        const adjacent = getAdjacentCells(peep.row, peep.col);
        const nearBunker = state.bunkers.find(b =>
            adjacent.some(a => a.row === b.row && a.col === b.col)
        );
        if (nearBunker) {
            eligible.push({ row: peep.row, col: peep.col, peepIdx: idx });
        }
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
        if (target) {
            const peep = player.peeps[target.peepIdx];
            // Find adjacent bunker
            const adjacent = getAdjacentCells(peep.row, peep.col);
            const bunker = state.bunkers.find(b =>
                adjacent.some(a => a.row === b.row && a.col === b.col)
            );

            if (bunker) {
                // If occupied, push out the occupant
                if (bunker.occupant) {
                    const occPlayer = state.players[bunker.occupant.playerIndex];
                    const occPeep = occPlayer.peeps[bunker.occupant.peepIndex];
                    occPeep.inBunker = false;
                    occPeep.row = peep.row;
                    occPeep.col = peep.col;
                    toast(`${PLAYER_NAMES[bunker.occupant.playerIndex]}'s peep was pushed out!`);
                }

                // Move peep into bunker
                peep.inBunker = true;
                peep.row = bunker.row;
                peep.col = bunker.col;
                bunker.occupant = { playerIndex: state.currentPlayerIndex, peepIndex: target.peepIdx, turnsLeft: 3 };
                toast(`${PLAYER_NAMES[state.currentPlayerIndex]}'s peep entered a bunker for 3 rounds! 🏠`);
                finishCardAction();
            }
        }
        return;
    }
}

function finishCardAction() {
    state.drawnCard = null;
    state.turnPhase = 'done';
    clearSelection();
    renderAll();
}

function clearSelection() {
    state.selectionMode = null;
    state.moveTargets = [];
    state.selectedPeepIdx = null;
}

// ==============================
// Balloon Drop
// ==============================
function dropBalloons() {
    // Save state before damage for redo
    state.preDrop = {
        players: JSON.parse(JSON.stringify(state.players))
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

    // Apply damage
    applyBalloonDamage();
    renderAll();
}

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

    applyBalloonDamage();
    renderAll();
}

function applyBalloonDamage() {
    state.splashedCells.forEach(({ row, col }) => {
        state.players.forEach(player => {
            player.peeps.forEach(peep => {
                if (!peep.alive || peep.row !== row || peep.col !== col) return;
                if (peep.inBunker) return;
                if (peep.hasUmbrella) {
                    peep.hasUmbrella = false;
                    toast(`An umbrella saved a peep! ☂️💧`);
                    return;
                }
                peep.alive = false;
            });
        });
    });

    // Check eliminations
    state.players.forEach((player, i) => {
        if (!player.eliminated && player.peeps.every(p => !p.alive)) {
            player.eliminated = true;
            toast(`${PLAYER_NAMES[i]} has been eliminated! 💀`);
        }
    });

    checkWinCondition();
}

function checkWinCondition() {
    const alive = state.players.filter(p => !p.eliminated);
    if (alive.length <= 1) {
        state.gameOver = true;
        setTimeout(() => {
            if (alive.length === 1) {
                showGameOver(`${PLAYER_EMOJIS[alive[0].index]} ${PLAYER_NAMES[alive[0].index]} wins! 🎉`);
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

    document.getElementById('round-num').textContent = state.round;
    clearSelection();
    renderAll();
}

// ==============================
// Utilities
// ==============================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function showGameOver(text) {
    document.getElementById('winner-text').textContent = text;
    showScreen('gameover-screen');
}

function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => el.classList.add('hidden'), 2500);
}
