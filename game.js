// 包一层 IIFE：cardLogic.js 在全局定义了 detectCombo 等函数，
// 这里如果直接在全局解构同名变量会和它们冲突（Identifier has already been declared）。
(function () {
'use strict';

const { detectCombo, detectCombos, findBeatingCombo, suggestPlay,
        canBeat, singleCardRank, isWildCard, SHAPE_NAMES } = window.CardLogic;

let ws = null;
let myName = '';
let myId = null;
let roomState = null;
let myCards = [];
let selected = new Set(); // 选中的手牌下标
let toastTimer = null;
let passedThisRound = new Set(); // 本轮已经"不要"的玩家，用于在对手面板上标出来
let sortMode = 'rank'; // rank = 按大小; group = 把对子/三张聚在一起
let wasMyTurn = false;   // 上一次渲染时是不是轮到我，用来只在"刚轮到"的瞬间提醒
let titleTimer = null;
const BASE_TITLE = document.title;

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
    $('pass-btn').addEventListener('click', () => {
        selected.clear();
        renderMyCards(); // 必须重绘，否则牌上的选中高亮会留着，和实际选中状态相反
        updateButtons();
        send('pass');
    });
    $('hint-btn').addEventListener('click', doHint);
    $('sort-btn').addEventListener('click', () => {
        sortMode = sortMode === 'rank' ? 'group' : 'rank';
        applySort();
        toast(sortMode === 'group' ? '已把对子/三张排到一起' : '已按大小排序');
    });
    document.querySelectorAll('.deck-opt').forEach(btn => {
        btn.addEventListener('click', () => send('set_decks', { decks: Number(btn.dataset.decks) }));
    });
    window.addEventListener('resize', () => renderMyCards());
    $('result-close').addEventListener('click', () => $('result-modal').classList.add('hidden'));

    $('mute-btn').addEventListener('click', () => {
        const muted = Sfx.toggleMute();
        $('mute-btn').textContent = muted ? '🔇' : '🔊';
    });
    $('mute-btn').textContent = Sfx.isMuted() ? '🔇' : '🔊';

    // 浏览器要求用户先操作过才能播声音，这里在第一次点击时解锁
    document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });

    // 切回页面时把标题上的提醒清掉
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) stopTitleFlash();
    });
});

// 页面在后台时，用标题栏闪烁提醒（手机锁屏/切到别的App也能看到）
function startTitleFlash() {
    stopTitleFlash();
    let on = false;
    titleTimer = setInterval(() => {
        document.title = on ? BASE_TITLE : '🔔 轮到你出牌了！';
        on = !on;
    }, 900);
}
function stopTitleFlash() {
    if (titleTimer) { clearInterval(titleTimer); titleTimer = null; }
    document.title = BASE_TITLE;
}

// 轮到你了：声音 + 震动 + 整屏光晕 + 后台标题闪烁，四重提醒
function alertMyTurn() {
    Sfx.play('turn');
    if (navigator.vibrate) {
        try { navigator.vibrate([90, 60, 90]); } catch (e) {}
    }
    const glow = $('turn-glow');
    glow.classList.remove('flash');
    void glow.offsetWidth; // 强制重排，让动画能重复触发
    glow.classList.add('flash');
    if (document.hidden) startTitleFlash();
}

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
        $('status-text').textContent = '连接已断开，请刷新页面';
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
        case 'your_cards': {
            const isNewDeal = myCards.length === 0 && msg.cards.length > 0;
            myCards = msg.cards;
            selected.clear();
            applySort();
            if (isNewDeal) animateDeal();
            updateButtons();
            break;
        }
        case 'game_started':
            Sfx.play('deal');
            passedThisRound.clear();
            $('played-cards').innerHTML = '';
            $('table-label').textContent = '';
            $('table-hint').textContent = '';
            $('result-modal').classList.add('hidden');
            toast(`游戏开始！本局打 ${msg.level}`);
            break;
        case 'played':
            passedThisRound.clear(); // 有人出牌就是新一圈，清掉"不要"标记
            renderPlayed(msg);
            if (msg.isBomb) {
                Sfx.play('bomb');
                document.body.classList.remove('shake');
                void document.body.offsetWidth;
                document.body.classList.add('shake');
                setTimeout(() => document.body.classList.remove('shake'), 600);
            } else {
                Sfx.play('play');
            }
            break;
        case 'passed':
            Sfx.play('pass');
            passedThisRound.add(msg.playerId);
            if (msg.playerId !== myId) toast(`${msg.playerName} 不要`);
            render();
            break;
        case 'notice':
            if (msg.message.includes('加入了房间')) Sfx.play('join');
            if (msg.message.includes('出完了牌')) Sfx.play('finish');
            toast(msg.message);
            break;
        case 'jiefeng':
            // 有人出完走了，牌桌清空由下一家领出
            passedThisRound.clear();
            $('played-cards').innerHTML = '<span class="table-empty">接风 — 重新领出</span>';
            $('table-label').textContent = '';
            toast(msg.playerId === myId ? '轮到你接风，随意出牌' : msg.message);
            break;
        case 'game_aborted':
            toast(msg.message);
            $('played-cards').innerHTML = '';
            break;
        case 'game_over':
            showResult(msg.result);
            break;
        case 'error':
            Sfx.play('error');
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
        const status = r.status === 'playing' ? '游戏中' : `${r.playerCount}/3 · ${r.decks || 2}副`;
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

function currentDecks() {
    return (roomState && roomState.decks) || 2;
}

function render() {
    if (!roomState) return;
    $('level-badge').textContent = roomState.level;
    $('deck-badge').textContent = currentDecks();

    // 副数选择：只有房主、且没在对局中才能改
    const canPick = roomState.status !== 'playing' && myId === roomState.hostId;
    $('deck-picker').classList.toggle('hidden', roomState.status === 'playing');
    document.querySelectorAll('.deck-opt').forEach(btn => {
        const n = Number(btn.dataset.decks);
        btn.classList.toggle('active', n === currentDecks());
        btn.disabled = !canPick;
    });

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

        // 牌背扇形，直观看出对手手牌多少（最多画14张，再多就看数字）
        const fan = el.querySelector('.opp-fan');
        const show = Math.min(p.cardCount, 14);
        if (fan.childElementCount !== show) {
            fan.innerHTML = '';
            for (let k = 0; k < show; k++) {
                const b = document.createElement('div');
                b.className = 'card-back';
                fan.appendChild(b);
            }
        }

        const place = roomState.finishOrder.indexOf(p.playerId);
        const tag = el.querySelector('.opp-tag');
        if (place >= 0) {
            tag.textContent = ['头游', '二游', '末游'][place];
            tag.className = 'opp-tag rank';
        } else if (passedThisRound.has(p.playerId)) {
            tag.textContent = '不要';
            tag.className = 'opp-tag pass';
        } else {
            tag.textContent = '';
            tag.className = 'opp-tag';
        }
    });

    updateStatusBar();
    updateButtons();

    // 只在"从别人的回合变成我的回合"这一刻提醒，避免每次收状态都响
    const myTurn = roomState.status === 'playing' && roomState.currentPlayerId === myId;
    document.body.classList.toggle('my-turn-now', myTurn);
    if (myTurn && !wasMyTurn) alertMyTurn();
    if (!myTurn) stopTitleFlash();
    wasMyTurn = myTurn;
}

function updateStatusBar() {
    const bar = $('status-bar');
    const setBar = (text, cls) => { $('status-text').textContent = text; bar.className = cls; };
    if (roomState.status === 'waiting') {
        const n = roomState.players.length;
        setBar(n < 3
            ? `等待玩家加入… (${n}/3)　房间号 ${roomState.roomId}`
            : (myId === roomState.hostId ? '人齐了，点「开始游戏」' : '人齐了，等房主开始'), 'status-bar');
        return;
    }
    if (roomState.status === 'finished') {
        setBar('本局结束', 'status-bar');
        return;
    }
    // 新一轮开始时清空牌桌，免得旧牌一直摆在那儿让人以为还要压
    if (!roomState.lastCombo && $('played-cards').childElementCount > 0) {
        $('played-cards').innerHTML = '<span class="table-empty">新一轮，随意出牌</span>';
        $('table-label').textContent = '';
    }

    const cur = roomState.players.find(p => p.playerId === roomState.currentPlayerId);
    if (roomState.currentPlayerId === myId) {
        setBar(roomState.lastCombo ? '👉 轮到你了 — 出牌或不要' : '👉 轮到你了 — 本轮你先出', 'status-bar my-turn');
    } else {
        setBar(`等 ${cur ? cur.name : '…'} 出牌`, 'status-bar');
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
    show($('sort-btn'), playing);

    const cards = selectedCards();
    const last = lastComboForCompare();
    const beating = cards.length ? findBeatingCombo(cards, roomState.level, last, currentDecks()) : null;
    const anyShape = cards.length ? detectCombo(cards, roomState.level, currentDecks()) : null;

    $('play-btn').disabled = !myTurn || !beating;
    $('pass-btn').disabled = !myTurn || !roomState.lastCombo;

    const hint = $('table-hint');
    if (playing && selected.size > 0) {
        if (!anyShape) {
            hint.textContent = '选中的牌不是有效牌型';
            hint.className = 'table-hint bad';
        } else if (!beating) {
            hint.textContent = `${SHAPE_NAMES[anyShape.shapeType]} — 压不过上家`;
            hint.className = 'table-hint bad';
        } else {
            hint.textContent = `${SHAPE_NAMES[beating.shapeType]} — 可以出`;
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
    return detectCombo(roomState.lastCombo.cards, roomState.level, currentDecks());
}

function selectedCards() {
    const cards = [...selected].map(i => myCards[i]).filter(Boolean);
    return cards.length === selected.size ? cards : [];
}

// 手牌叠着显示：同点数的牌贴得更紧，换点数时留缝，
// 这样一眼就能看出手里有几对、几个三张
// 两种理牌方式：按大小，或把同点数多张的（对子/三张/炸弹）排到前面
function applySort() {
    const level = roomState ? roomState.level : '2';
    if (sortMode === 'group') {
        const count = new Map();
        myCards.forEach(c => count.set(c.rank, (count.get(c.rank) || 0) + 1));
        myCards.sort((a, b) => {
            const ca = count.get(a.rank), cb = count.get(b.rank);
            if (ca !== cb) return cb - ca;
            return singleCardRank(b, level) - singleCardRank(a, level);
        });
    } else {
        myCards.sort((a, b) => singleCardRank(b, level) - singleCardRank(a, level));
    }
    selected.clear();
    renderMyCards();
    updateButtons();
}

// 叠多少是按容器实际宽度算出来的：屏幕宽就少叠，窄就多叠，
// 保证任何屏幕都不横向溢出，也不浪费空间。
const MIN_STEP = 23;  // 每张至少露出这么宽，太窄手指点不准
const GROUP_GAP = 9;  // 换点数时额外留的缝

// 发牌时让手牌一张张滑进来
function animateDeal() {
    const wrap = $('my-cards');
    wrap.classList.add('dealing');
    wrap.querySelectorAll('.card').forEach((el, i) => {
        el.style.animationDelay = `${Math.min(i * 14, 700)}ms`;
    });
    setTimeout(() => {
        wrap.classList.remove('dealing');
        wrap.querySelectorAll('.card').forEach(el => { el.style.animationDelay = ''; });
    }, 1400);
}

function renderMyCards() {
    const wrap = $('my-cards');
    wrap.innerHTML = '';
    if (!myCards.length) return;

    // 先放一张进去量出实际牌宽（不同断点牌大小不一样）
    const probeRow = document.createElement('div');
    probeRow.className = 'card-row';
    const probe = cardEl(myCards[0], 0);
    probe.style.visibility = 'hidden';
    probeRow.appendChild(probe);
    wrap.appendChild(probeRow);
    const cardW = probe.offsetWidth || 46;
    const avail = Math.max(wrap.clientWidth - 6, cardW);
    wrap.innerHTML = '';

    // 在"每张至少露出 MIN_STEP"的前提下，一行最多放几张 —— 行数尽量少
    const maxPerRow = Math.max(1, Math.floor((avail - cardW) / MIN_STEP) + 1);
    const rows = Math.max(1, Math.ceil(myCards.length / maxPerRow));
    const perRow = Math.ceil(myCards.length / rows); // 每行张数尽量平均

    for (let start = 0; start < myCards.length; start += perRow) {
        const slice = myCards.slice(start, start + perRow);
        const n = slice.length;
        const row = document.createElement('div');
        row.className = 'card-row';

        // 同点数用 step，换点数多给 GROUP_GAP；空间不够就先牺牲分组的缝
        const groupStart = slice.map((card, j) => j > 0 && card.rank !== slice[j - 1].rank);
        const gaps = groupStart.filter(Boolean).length;
        let gap = GROUP_GAP;
        let step = n > 1 ? (avail - cardW - gaps * gap) / (n - 1) : 0;
        if (step < MIN_STEP) {
            gap = 0;
            step = n > 1 ? (avail - cardW) / (n - 1) : 0;
        }
        step = Math.min(step, cardW); // 最多就是不重叠

        slice.forEach((card, j) => {
            const el = cardEl(card, start + j);
            el.style.zIndex = String(j + 1);
            if (j > 0) {
                const advance = step + (groupStart[j] ? gap : 0);
                el.style.marginLeft = `${Math.round(advance - cardW)}px`;
            }
            row.appendChild(el);
        });
        wrap.appendChild(row);
    }
}

// 大小王写全名在窄的露出部分里会被截断，这里压缩成"王"+大/小
function cardFace(card) {
    if (card.rank === '大王') return { rank: '王', suit: '大', pip: '🃏', joker: 'big' };
    if (card.rank === '小王') return { rank: '王', suit: '小', pip: '🃏', joker: 'small' };
    return { rank: card.rank, suit: card.suit, pip: card.suit };
}

function cardEl(card, index) {
    const el = document.createElement('div');
    const red = card.suit === '♥' || card.suit === '♦' || card.rank === '大王';
    el.className = `card ${red ? 'red' : 'black'}`;
    if (card.rank === '大王' || card.rank === '小王') el.classList.add('joker');
    const level = roomState ? roomState.level : null;
    if (level && isWildCard(card, level)) el.classList.add('wild');
    else if (level && card.rank === level) el.classList.add('levelcard');
    if (selected.has(index)) el.classList.add('selected');
    const face = cardFace(card);
    el.innerHTML = `<span class="corner"><span class="rank">${face.rank}</span>` +
        `<span class="suit">${face.suit}</span></span><span class="pip">${face.pip}</span>`;
    el.addEventListener('click', () => {
        if (selected.has(index)) selected.delete(index); else selected.add(index);
        el.classList.toggle('selected');
        Sfx.play('tap');
        updateButtons();
    });
    return el;
}

function renderPlayed(msg) {
    const wrap = $('played-cards');
    wrap.innerHTML = '';
    msg.cards.forEach((card, i) => {
        const red = card.suit === '♥' || card.suit === '♦' || card.rank === '大王';
        const el = document.createElement('div');
        el.className = `card small ${red ? 'red' : 'black'}`;
        // 错开出场，并给每张一点不同的旋转，看起来像甩出去的
        el.style.animationDelay = `${i * 45}ms`;
        el.style.setProperty('--spin', `${-10 + (i % 4) * 6}deg`);
        const level = roomState ? roomState.level : null;
        if (level && isWildCard(card, level)) el.classList.add('wild');
        const f = cardFace(card);
        el.innerHTML = `<span class="corner"><span class="rank">${f.rank}</span>` +
            `<span class="suit">${f.suit}</span></span>`;
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
    const found = suggestPlay(myCards, level, last, currentDecks());
    if (!found) {
        toast(last ? '没有能压过上家的牌' : '没有可出的牌');
        return;
    }
    selected = new Set(found.map(card => myCards.indexOf(card)));
    renderMyCards();
    updateButtons();
    toast(`提示：${SHAPE_NAMES[detectCombo(found, roomState.level, currentDecks()).shapeType]}`);
}

function showResult(result) {
    stopTitleFlash();
    const iWon = result.order[0] === (roomState && roomState.players.find(p => p.playerId === myId) || {}).name;
    Sfx.play(iWon ? 'win' : 'lose');
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
