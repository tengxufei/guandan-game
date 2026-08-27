// 包一层 IIFE：cardLogic.js 在全局定义了 detectCombo 等函数，
// 这里如果直接在全局解构同名变量会和它们冲突（Identifier has already been declared）。
(function () {
'use strict';

const { detectCombo, canBeat, singleCardRank, isWildCard, SHAPE_NAMES } = window.CardLogic;

let ws = null;
let myName = '';
let myId = null;
let roomState = null;
let myCards = [];
let selected = new Set(); // 选中的手牌下标
let toastTimer = null;

const $ = (id) => document.getElementById(id);

function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
}

document.addEventListener('DOMContentLoaded', () => {
    $('login-btn').addEventListener('click', doLogin);
    $('player-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

    $('create-room-btn').addEventListener('click', () => send('create_room'));
    $('join-room-btn').addEventListener('click', doJoin);
    $('room-id-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

    $('leave-room-btn').addEventListener('click', () => {
        if (confirm('确定要退出房间吗？')) send('leave_room');
    });
    $('start-game-btn').addEventListener('click', () => send('start_game'));
    $('next-round-btn').addEventListener('click', () => send('next_round'));
    $('play-btn').addEventListener('click', doPlay);
    $('pass-btn').addEventListener('click', () => { selected.clear(); send('pass'); });
    $('hint-btn').addEventListener('click', doHint);
    $('result-close').addEventListener('click', () => $('result-modal').classList.add('hidden'));
});

function doLogin() {
    const name = $('player-name').value.trim();
    if (!name) return toast('请先输入名字');
    myName = name;
    connect();
}

function doJoin() {
    const id = $('room-id-input').value.trim().toUpperCase();
    if (!id) return toast('请输入房间号');
    send('join_room', { roomId: id });
}

function connect() {
    ws = new WebSocket(`${wsUrl()}?name=${encodeURIComponent(myName)}`);
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onerror = () => toast('连接失败，确认和主机在同一个WiFi下');
    ws.onclose = () => {
        toast('与服务器断开了连接');
        $('status-bar').textContent = '连接已断开，请刷新页面';
    };
}

function send(type, payload = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return toast('还没连上服务器');
    ws.send(JSON.stringify({ type, ...payload }));
}

function handle(msg) {
    switch (msg.type) {
        case 'login_success':
            myName = msg.playerName;
            $('lobby-player-name').textContent = myName;
            showScreen('lobby-screen');
            send('get_rooms');
            break;
        case 'room_list':
            renderRoomList(msg.rooms);
            break;
        case 'joined_room':
            myId = msg.playerId;
            selected.clear();
            myCards = [];
            $('room-code').textContent = msg.roomId;
            showScreen('game-screen');
            break;
        case 'left_room':
            myId = null;
            roomState = null;
            myCards = [];
            selected.clear();
            showScreen('lobby-screen');
            send('get_rooms');
            break;
        case 'room_state':
            myId = msg.you;
            roomState = msg.state;
            render();
            break;
        case 'your_cards':
            myCards = msg.cards;
            selected.clear();
            renderMyCards();
            updateButtons();
            break;
        case 'game_started':
            $('played-cards').innerHTML = '';
            $('table-label').textContent = '';
            $('table-hint').textContent = '';
            $('result-modal').classList.add('hidden');
            toast(`游戏开始！本局打 ${msg.level}`);
            break;
        case 'played':
            renderPlayed(msg);
            break;
        case 'passed':
            if (msg.playerId !== myId) toast(`${msg.playerName} 不要`);
            break;
        case 'notice':
            toast(msg.message);
            break;
        case 'game_aborted':
            toast(msg.message);
            $('played-cards').innerHTML = '';
            break;
        case 'game_over':
            showResult(msg.result);
            break;
        case 'error':
            toast(msg.message);
            break;
    }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $(id).classList.remove('hidden');
}

function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function renderRoomList(rooms) {
    const ul = $('rooms');
    ul.innerHTML = '';
    $('no-rooms').style.display = rooms.length ? 'none' : 'block';
    rooms.forEach(r => {
        const li = document.createElement('li');
        const status = r.status === 'playing' ? '游戏中' : `${r.playerCount}/3`;
        li.innerHTML = `<span class="room-code">${r.roomId}</span>
            <span class="room-names">${r.names.join('、') || '空房间'}</span>
            <span class="room-status">${status}</span>`;
        li.addEventListener('click', () => {
            $('room-id-input').value = r.roomId;
            if (r.status !== 'playing' && r.playerCount < 3) send('join_room', { roomId: r.roomId });
        });
        ul.appendChild(li);
    });
}

// 把其他两位玩家按出牌顺序（我的下家、下下家）放到左右两侧
function opponentsInOrder() {
    if (!roomState) return [];
    const list = roomState.players;
    const myIdx = list.findIndex(p => p.playerId === myId);
    if (myIdx < 0) return list.filter(p => p.playerId !== myId);
    const out = [];
    for (let i = 1; i < list.length; i++) out.push(list[(myIdx + i) % list.length]);
    return out;
}

function render() {
    if (!roomState) return;
    $('level-badge').textContent = roomState.level;

    const me = roomState.players.find(p => p.playerId === myId);
    $('my-name-label').textContent = (me ? me.name : myName) + (me && me.isHost ? '（房主）' : '');
    $('my-count').textContent = me ? me.cardCount : 0;

    const opps = opponentsInOrder();
    ['opp-left', 'opp-right'].forEach((elId, i) => {
        const el = $(elId);
        const p = opps[i];
        if (!p) {
            el.querySelector('.opp-name').textContent = '等待中…';
            el.querySelector('.opp-count').textContent = '0';
            el.querySelector('.opp-tag').textContent = '';
            el.classList.remove('active', 'done');
            return;
        }
        el.querySelector('.opp-name').textContent = p.name + (p.isHost ? ' 👑' : '');
        el.querySelector('.opp-count').textContent = p.cardCount;
        el.classList.toggle('active', roomState.currentPlayerId === p.playerId);
        el.classList.toggle('done', p.finished);
        const place = roomState.finishOrder.indexOf(p.playerId);
        el.querySelector('.opp-tag').textContent = place >= 0 ? ['头游', '二游', '末游'][place] : '';
    });

    updateStatusBar();
    updateButtons();
}

function updateStatusBar() {
    const bar = $('status-bar');
    if (roomState.status === 'waiting') {
        const n = roomState.players.length;
        bar.textContent = n < 3
            ? `等待玩家加入… (${n}/3)　房间号 ${roomState.roomId}`
            : (myId === roomState.hostId ? '人齐了，点「开始游戏」' : '人齐了，等房主开始');
        bar.className = 'status-bar';
        return;
    }
    if (roomState.status === 'finished') {
        bar.textContent = '本局结束';
        bar.className = 'status-bar';
        return;
    }
    const cur = roomState.players.find(p => p.playerId === roomState.currentPlayerId);
    if (roomState.currentPlayerId === myId) {
        bar.textContent = roomState.lastCombo ? '轮到你了 — 出牌或不要' : '轮到你了 — 本轮你先出';
        bar.className = 'status-bar my-turn';
    } else {
        bar.textContent = `等 ${cur ? cur.name : '…'} 出牌`;
        bar.className = 'status-bar';
    }
}

function updateButtons() {
    const waiting = roomState && roomState.status === 'waiting';
    const playing = roomState && roomState.status === 'playing';
    const finished = roomState && roomState.status === 'finished';
    const isHost = roomState && myId === roomState.hostId;
    const full = roomState && roomState.players.length === 3;
    const myTurn = playing && roomState.currentPlayerId === myId;

    show($('start-game-btn'), waiting && isHost && full);
    show($('next-round-btn'), finished && isHost && full);
    show($('play-btn'), playing);
    show($('pass-btn'), playing);
    show($('hint-btn'), playing);

    const combo = currentSelectionCombo();
    $('play-btn').disabled = !myTurn || !combo || !canBeat(combo, lastComboForCompare());
    $('pass-btn').disabled = !myTurn || !roomState.lastCombo;

    const hint = $('table-hint');
    if (playing && selected.size > 0) {
        if (!combo) {
            hint.textContent = '选中的牌不是有效牌型';
            hint.className = 'table-hint bad';
        } else if (!canBeat(combo, lastComboForCompare())) {
            hint.textContent = `${SHAPE_NAMES[combo.shapeType]} — 压不过上家`;
            hint.className = 'table-hint bad';
        } else {
            hint.textContent = `${SHAPE_NAMES[combo.shapeType]} — 可以出`;
            hint.className = 'table-hint good';
        }
    } else if (hint.className.indexOf('table-hint') === 0) {
        hint.textContent = '';
        hint.className = 'table-hint';
    }
}

function show(el, visible) {
    el.classList.toggle('hidden', !visible);
}

function lastComboForCompare() {
    if (!roomState || !roomState.lastCombo) return null;
    return detectCombo(roomState.lastCombo.cards, roomState.level);
}

function currentSelectionCombo() {
    if (selected.size === 0) return null;
    const cards = [...selected].map(i => myCards[i]).filter(Boolean);
    if (cards.length !== selected.size) return null;
    return detectCombo(cards, roomState ? roomState.level : '2');
}

function renderMyCards() {
    const wrap = $('my-cards');
    wrap.innerHTML = '';
    myCards.forEach((card, i) => {
        wrap.appendChild(cardEl(card, i));
    });
}

function cardEl(card, index) {
    const el = document.createElement('div');
    const red = card.suit === '♥' || card.suit === '♦';
    el.className = `card ${red ? 'red' : 'black'}`;
    if (roomState && isWildCard(card, roomState.level)) el.classList.add('wild');
    if (selected.has(index)) el.classList.add('selected');
    el.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>`;
    el.addEventListener('click', () => {
        if (selected.has(index)) selected.delete(index); else selected.add(index);
        el.classList.toggle('selected');
        updateButtons();
    });
    return el;
}

function renderPlayed(msg) {
    const wrap = $('played-cards');
    wrap.innerHTML = '';
    msg.cards.forEach(card => {
        const red = card.suit === '♥' || card.suit === '♦';
        const el = document.createElement('div');
        el.className = `card small ${red ? 'red' : 'black'}`;
        el.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>`;
        wrap.appendChild(el);
    });
    const who = msg.playerId === myId ? '我' : msg.playerName;
    $('table-label').textContent = `${who} 出了 ${msg.shapeName}`;
}

function doPlay() {
    const cards = [...selected].map(i => myCards[i]).filter(Boolean);
    if (!cards.length) return toast('请先选牌');
    send('play_cards', { cards });
}

// 提示：找一手能压过上家的牌（够用就好，不追求最优）
function doHint() {
    const last = lastComboForCompare();
    const level = roomState.level;
    const found = findPlayable(myCards, level, last);
    if (!found) {
        toast(last ? '没有能压过上家的牌' : '没有可出的牌');
        return;
    }
    selected = new Set(found.map(card => myCards.indexOf(card)));
    renderMyCards();
    updateButtons();
}

// 按上家牌型有针对性地找，而不是盲目枚举组合——36张牌全排列会卡死浏览器
function findPlayable(cards, level, last) {
    const tryCombo = (subset) => {
        if (!subset || subset.some(x => !x)) return null;
        const combo = detectCombo(subset, level);
        return combo && canBeat(combo, last) ? subset : null;
    };

    // 按点数分组（万能牌单独放，作百搭用）
    const groups = new Map();
    const wilds = [];
    for (const card of cards) {
        if (isWildCard(card, level)) { wilds.push(card); continue; }
        if (!groups.has(card.rank)) groups.set(card.rank, []);
        groups.get(card.rank).push(card);
    }
    const RANKS = window.CardLogic.RANK_ORDER;

    if (!last) {
        let min = cards[0];
        for (const card of cards) {
            if (singleCardRank(card, level) < singleCardRank(min, level)) min = card;
        }
        return [min];
    }

    const len = last.length;
    const shape = last.shapeType;

    // 同型同长：先按牌型分别找
    if (shape === 'single') {
        const sorted = [...cards].sort((a, b) => singleCardRank(a, level) - singleCardRank(b, level));
        for (const card of sorted) {
            const r = tryCombo([card]);
            if (r) return r;
        }
    } else if (shape === 'pair' || shape === 'triple') {
        const need = shape === 'pair' ? 2 : 3;
        for (const g of groups.values()) {
            for (let useWild = 0; useWild <= Math.min(wilds.length, need - 1); useWild++) {
                if (g.length + useWild < need) continue;
                const r = tryCombo([...g.slice(0, need - useWild), ...wilds.slice(0, useWild)]);
                if (r) return r;
            }
        }
    } else if (shape === 'triple_single' || shape === 'triple_pair') {
        const attach = shape === 'triple_single' ? 1 : 2;
        for (const [rank, g] of groups) {
            for (let useWild = 0; useWild <= Math.min(wilds.length, 2); useWild++) {
                if (g.length + useWild < 3) continue;
                const triple = [...g.slice(0, 3 - useWild), ...wilds.slice(0, useWild)];
                const restWilds = wilds.slice(useWild);
                for (const [rank2, g2] of groups) {
                    if (rank2 === rank) continue;
                    if (g2.length >= attach) {
                        const r = tryCombo([...triple, ...g2.slice(0, attach)]);
                        if (r) return r;
                    }
                    if (attach === 2 && g2.length === 1 && restWilds.length >= 1) {
                        const r = tryCombo([...triple, g2[0], restWilds[0]]);
                        if (r) return r;
                    }
                }
            }
        }
    } else if (shape === 'straight' || shape === 'pair_straight') {
        const per = shape === 'straight' ? 1 : 2;
        const count = len / per;
        for (let start = 0; start + count <= RANKS.length; start++) {
            const window = RANKS.slice(start, start + count);
            const picked = [];
            let wildNeed = 0;
            for (const rank of window) {
                const have = groups.get(rank) || [];
                if (have.length >= per) {
                    picked.push(...have.slice(0, per));
                } else {
                    picked.push(...have);
                    wildNeed += per - have.length;
                }
            }
            if (wildNeed > wilds.length) continue;
            const r = tryCombo([...picked, ...wilds.slice(0, wildNeed)]);
            if (r) return r;
        }
    }

    // 都不行就找炸弹（从小到大，别浪费大炸）
    const bombCandidates = [];
    for (const g of groups.values()) {
        for (let useWild = 0; useWild <= wilds.length; useWild++) {
            const size = Math.min(g.length, 8 - useWild) + useWild;
            if (size < 4) continue;
            bombCandidates.push([...g.slice(0, size - useWild), ...wilds.slice(0, useWild)]);
        }
    }
    bombCandidates.sort((a, b) => a.length - b.length);
    for (const cand of bombCandidates) {
        const r = tryCombo(cand);
        if (r) return r;
    }

    // 四王炸
    const jokers = cards.filter(card => card.rank === '小王' || card.rank === '大王');
    if (jokers.length === 4) {
        const r = tryCombo(jokers);
        if (r) return r;
    }
    return null;
}

function showResult(result) {
    $('result-title').textContent = result.matchOver ? '🎉 打到A，整场结束！' : '本局结束';
    const ol = $('result-order');
    ol.innerHTML = '';
    const places = ['头游', '二游', '末游'];
    result.order.forEach((name, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="place">${places[i] || ''}</span><span>${name}</span>`;
        ol.appendChild(li);
    });
    $('result-level').textContent = result.matchOver
        ? `${result.winnerName} 赢下了整场！`
        : `级牌 ${result.fromLevel} → ${result.toLevel}`;
    $('result-modal').classList.remove('hidden');
}

})();
