const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    LEVEL_ORDER, SHAPE_NAMES,
    createDeck, shuffle, isWildCard, singleCardRank,
    detectCombo, findBeatingCombo,
} = require('./cardLogic');

const PLAYERS_PER_ROOM = 3;
const ALLOWED_DECKS = [1, 2, 3];
const DEFAULT_DECKS = 2; // 掼蛋标准就是两副牌：108张，3人正好每人36张

function cardKey(card) {
    return `${card.suit}${card.rank}`;
}

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.hostId = null;
        this.decks = DEFAULT_DECKS;
        this.level = '2';
        this.status = 'waiting'; // waiting | playing | finished
        this.currentIndex = 0;
        this.lastCombo = null;
        this.lastPlayerId = null;
        this.passCount = 0;
        this.finishOrder = [];
        this.history = [];
    }

    addPlayer(player) {
        if (this.players.length >= PLAYERS_PER_ROOM) return false;
        if (this.status === 'playing') return false;
        this.players.push(player);
        player.roomId = this.roomId;
        player.playerId = this.nextPlayerId();
        player.cards = [];
        player.finished = false;
        if (this.hostId === null) this.hostId = player.playerId;
        return true;
    }

    nextPlayerId() {
        const used = new Set(this.players.map(p => p.playerId));
        for (let i = 1; i <= PLAYERS_PER_ROOM; i++) {
            if (!used.has(i)) return i;
        }
        return this.players.length;
    }

    removePlayer(player) {
        const index = this.players.indexOf(player);
        if (index > -1) this.players.splice(index, 1);
        if (player.playerId === this.hostId) {
            this.hostId = this.players.length ? this.players[0].playerId : null;
        }
    }

    isFull() {
        return this.players.length === PLAYERS_PER_ROOM;
    }

    getPlayer(playerId) {
        return this.players.find(p => p.playerId === playerId);
    }

    cardsPerPlayer() {
        return (this.decks * 54) / PLAYERS_PER_ROOM; // 54/108/162 都能被3整除
    }

    startGame() {
        const deck = shuffle(createDeck(this.decks));
        const per = this.cardsPerPlayer();
        this.players.forEach((player, i) => {
            player.cards = deck.slice(i * per, (i + 1) * per);
            sortHand(player.cards, this.level);
            player.finished = false;
        });
        this.status = 'playing';
        this.currentIndex = 0;
        this.lastCombo = null;
        this.lastPlayerId = null;
        this.passCount = 0;
        this.finishOrder = [];
        this.history = [];
    }

    currentPlayer() {
        return this.players[this.currentIndex];
    }

    publicState() {
        return {
            roomId: this.roomId,
            status: this.status,
            level: this.level,
            decks: this.decks,
            hostId: this.hostId,
            currentPlayerId: this.status === 'playing' && this.currentPlayer() ? this.currentPlayer().playerId : null,
            lastPlayerId: this.lastPlayerId,
            lastCombo: this.lastCombo ? {
                shapeName: SHAPE_NAMES[this.lastCombo.shapeType] || this.lastCombo.shapeType,
                cards: this.lastCombo.cards,
                playerId: this.lastPlayerId,
            } : null,
            finishOrder: this.finishOrder,
            players: this.players.map(p => ({
                playerId: p.playerId,
                name: p.name,
                cardCount: p.cards.length,
                finished: p.finished,
                isHost: p.playerId === this.hostId,
            })),
        };
    }

    // 找到下一位还没出完牌的玩家
    advanceTurn() {
        for (let step = 1; step <= PLAYERS_PER_ROOM; step++) {
            const idx = (this.currentIndex + step) % this.players.length;
            if (!this.players[idx].finished) {
                this.currentIndex = idx;
                return;
            }
        }
    }

    activePlayerCount() {
        return this.players.filter(p => !p.finished).length;
    }

    playCards(playerId, requestedCards) {
        if (this.status !== 'playing') {
            return { error: '游戏尚未开始' };
        }
        const player = this.getPlayer(playerId);
        if (!player) return { error: '你不在这个房间' };
        if (player.finished) return { error: '你已经出完牌了' };
        if (this.currentPlayer().playerId !== playerId) return { error: '还没轮到你出牌' };
        if (!Array.isArray(requestedCards) || requestedCards.length === 0) {
            return { error: '请选择要出的牌' };
        }

        // 校验这些牌确实在手上（按花色+点数逐张核销，防止重复使用同一张）
        const handPool = new Map();
        for (const card of player.cards) {
            const key = cardKey(card);
            handPool.set(key, (handPool.get(key) || 0) + 1);
        }
        const normalized = [];
        for (const card of requestedCards) {
            if (!card || typeof card.suit !== 'string' || typeof card.rank !== 'string') {
                return { error: '出牌数据有误' };
            }
            const key = cardKey(card);
            const available = handPool.get(key) || 0;
            if (available <= 0) return { error: '你手里没有这些牌' };
            handPool.set(key, available - 1);
            normalized.push({ suit: card.suit, rank: card.rank });
        }

        // 万能牌让同一手牌可能有多种读法，只要存在一种压得过上家的读法就算数
        const combo = findBeatingCombo(normalized, this.level, this.lastCombo, this.decks);
        if (!combo) {
            const anyShape = detectCombo(normalized, this.level, this.decks);
            return { error: anyShape ? '你的牌压不过上家' : '这不是有效的牌型' };
        }

        // 从手牌中移除（每张只移除一次）
        const toRemove = new Map();
        for (const card of normalized) {
            const key = cardKey(card);
            toRemove.set(key, (toRemove.get(key) || 0) + 1);
        }
        player.cards = player.cards.filter(card => {
            const key = cardKey(card);
            const remaining = toRemove.get(key) || 0;
            if (remaining > 0) {
                toRemove.set(key, remaining - 1);
                return false;
            }
            return true;
        });

        this.lastCombo = { ...combo, cards: normalized };
        this.lastPlayerId = playerId;
        this.passCount = 0;
        this.history.push({ playerId, cards: normalized, shapeType: combo.shapeType });

        let justFinished = false;
        if (player.cards.length === 0) {
            player.finished = true;
            this.finishOrder.push(playerId);
            justFinished = true;
        }

        if (this.activePlayerCount() <= 1) {
            this.players.forEach(p => {
                if (!p.finished) {
                    p.finished = true;
                    this.finishOrder.push(p.playerId);
                }
            });
            this.finishGame();
            return { ok: true, combo, cards: normalized, justFinished, gameOver: true };
        }

        this.advanceTurn();

        // 接风：有人出完牌走人后，牌桌清空，由下一家直接领出新一轮。
        // 否则剩下的人还得去压一个已经离场的人的牌，压不过就只能空转一圈过牌。
        let jiefengBy = null;
        if (justFinished) {
            this.lastCombo = null;
            this.lastPlayerId = null;
            this.passCount = 0;
            jiefengBy = this.currentPlayer().playerId;
        }

        return { ok: true, combo, cards: normalized, justFinished, jiefengBy };
    }

    pass(playerId) {
        if (this.status !== 'playing') return { error: '游戏尚未开始' };
        const player = this.getPlayer(playerId);
        if (!player) return { error: '你不在这个房间' };
        if (player.finished) return { error: '你已经出完牌了' };
        if (this.currentPlayer().playerId !== playerId) return { error: '还没轮到你' };
        if (!this.lastCombo) return { error: '你是本轮首家，必须出牌' };

        this.passCount++;
        this.advanceTurn();

        // 本轮还剩几个人需要表态：出牌那位如果还没走完，他自己不用应自己的牌。
        // 如果出牌那位已经出完牌走人了，剩下的人全部过牌就该开新一轮，
        // 否则轮转永远回不到他身上，会一直卡在互相过牌。
        const lastPlayer = this.lastPlayerId ? this.getPlayer(this.lastPlayerId) : null;
        const lastStillActive = !!(lastPlayer && !lastPlayer.finished);
        const needed = Math.max(1, this.activePlayerCount() - (lastStillActive ? 1 : 0));

        let newRound = false;
        if (this.passCount >= needed) {
            this.lastCombo = null;
            this.passCount = 0;
            newRound = true;
        }
        return { ok: true, newRound };
    }

    finishGame() {
        this.status = 'finished';
        this.lastCombo = null;
        // 三人局的房规：头游赢一局升一级，从 2 一路打到 A。
        // （之前一次升两级，结果 3/5/7/9/J/K 这些级永远轮不到，
        //  一半的牌当不上万能牌，打起来少了很多变化。）
        const winnerId = this.finishOrder[0];
        const winner = this.getPlayer(winnerId);
        const currentIdx = LEVEL_ORDER.indexOf(this.level);
        const nextIdx = currentIdx + 1;

        this.lastResult = {
            finishOrder: this.finishOrder.slice(),
            winnerName: winner ? winner.name : '',
            fromLevel: this.level,
        };

        if (this.level === 'A' || nextIdx >= LEVEL_ORDER.length) {
            // 打到 A 再赢一局，整场结束，下一场从 2 重新开始
            this.lastResult.matchOver = true;
            this.lastResult.toLevel = '2';
            this.level = '2';
        } else {
            this.level = LEVEL_ORDER[nextIdx];
            this.lastResult.toLevel = this.level;
        }
    }

    resetForNextRound() {
        this.status = 'waiting';
        this.lastCombo = null;
        this.lastPlayerId = null;
        this.passCount = 0;
        this.finishOrder = [];
        this.history = [];
        this.players.forEach(p => {
            p.cards = [];
            p.finished = false;
        });
    }
}

// 手牌排序：级牌和王排在最前，其余按点数从大到小
function sortHand(cards, level) {
    cards.sort((a, b) => {
        const diff = singleCardRank(b, level) - singleCardRank(a, level);
        if (diff !== 0) return diff;
        if (a.suit === b.suit) return 0;
        return a.suit < b.suit ? -1 : 1;
    });
}

class Player {
    constructor(ws, name) {
        this.ws = ws;
        this.name = name;
        this.playerId = null;
        this.roomId = null;
        this.cards = [];
        this.finished = false;
    }

    send(data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
}

const rooms = new Map();
const players = new Map();

// 只开放前端这几个文件，避免把 server.js、package.json 之类也发出去
const STATIC_FILES = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
    '/game.js': { file: 'game.js', type: 'text/javascript; charset=utf-8' },
    '/cardLogic.js': { file: 'cardLogic.js', type: 'text/javascript; charset=utf-8' },
};

function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const entry = STATIC_FILES[url.pathname];

    if (!entry) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
    }

    fs.readFile(path.join(__dirname, entry.file), (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': entry.type });
        res.end(data);
    });
}

const server = http.createServer(serveStatic);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rawName = (url.searchParams.get('name') || '').trim();
    const playerName = rawName.slice(0, 12) || '玩家';

    const player = new Player(ws, playerName);
    players.set(ws, player);
    console.log('新玩家连接:', playerName, '在线人数:', players.size);

    player.send({ type: 'login_success', playerName: player.name });

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            player.send({ type: 'error', message: '消息格式错误' });
            return;
        }
        try {
            handleMessage(player, data);
        } catch (err) {
            console.error('处理消息出错:', err);
            player.send({ type: 'error', message: '服务器处理出错' });
        }
    });

    ws.on('close', () => handlePlayerDisconnect(player));
    ws.on('error', (err) => console.error('WebSocket error:', err));
});

function handleMessage(player, data) {
    switch (data.type) {
        case 'create_room': return handleCreateRoom(player);
        case 'join_room': return handleJoinRoom(player, data.roomId);
        case 'leave_room': return handleLeaveRoom(player);
        case 'get_rooms': return sendRoomList(player);
        case 'set_decks': return handleSetDecks(player, data.decks);
        case 'start_game': return handleStartGame(player);
        case 'play_cards': return handlePlayCards(player, data.cards);
        case 'pass': return handlePass(player);
        case 'next_round': return handleNextRound(player);
        default:
            player.send({ type: 'error', message: '未知的消息类型' });
    }
}

function handleCreateRoom(player) {
    if (player.roomId) {
        player.send({ type: 'error', message: '你已经在房间中了' });
        return;
    }
    let roomId;
    do {
        roomId = generateRoomId();
    } while (rooms.has(roomId));

    const room = new GameRoom(roomId);
    room.addPlayer(player);
    rooms.set(roomId, room);

    player.send({ type: 'joined_room', roomId, playerId: player.playerId });
    broadcastRoomState(room);
    broadcastRoomList();
}

function handleJoinRoom(player, roomId) {
    if (player.roomId) {
        player.send({ type: 'error', message: '你已经在房间中了' });
        return;
    }
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room) {
        player.send({ type: 'error', message: '房间不存在，请检查房间号' });
        return;
    }
    if (room.status === 'playing') {
        player.send({ type: 'error', message: '这局已经开始了，请等下一局' });
        return;
    }
    if (!room.addPlayer(player)) {
        player.send({ type: 'error', message: '房间已满' });
        return;
    }

    player.send({ type: 'joined_room', roomId: room.roomId, playerId: player.playerId });
    broadcastToRoom(room, { type: 'notice', message: `${player.name} 加入了房间` });
    broadcastRoomState(room);
    broadcastRoomList();
}

function handleLeaveRoom(player) {
    const room = player.roomId ? rooms.get(player.roomId) : null;
    detachFromRoom(player, room, '离开了房间');
    player.send({ type: 'left_room' });
    broadcastRoomList();
}

function detachFromRoom(player, room, verb) {
    if (!room) {
        player.roomId = null;
        player.playerId = null;
        player.cards = [];
        return;
    }
    const wasPlaying = room.status === 'playing';
    const leavingName = player.name;
    room.removePlayer(player);

    player.roomId = null;
    player.playerId = null;
    player.cards = [];
    player.finished = false;

    if (room.players.length === 0) {
        rooms.delete(room.roomId);
        return;
    }

    broadcastToRoom(room, { type: 'notice', message: `${leavingName} ${verb}` });
    if (wasPlaying) {
        room.resetForNextRound();
        broadcastToRoom(room, { type: 'game_aborted', message: `${leavingName}${verb}，本局中止` });
    }
    broadcastRoomState(room);
}

function handleSetDecks(player, decks) {
    const room = player.roomId ? rooms.get(player.roomId) : null;
    if (!room) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }
    if (player.playerId !== room.hostId) {
        player.send({ type: 'error', message: '只有房主可以设置牌副数' });
        return;
    }
    if (room.status === 'playing') {
        player.send({ type: 'error', message: '这局还没打完，不能换牌副数' });
        return;
    }
    const n = Number(decks);
    if (!ALLOWED_DECKS.includes(n)) {
        player.send({ type: 'error', message: '只能选 1、2 或 3 副牌' });
        return;
    }
    if (n === room.decks) return;

    room.decks = n;
    broadcastToRoom(room, {
        type: 'notice',
        message: `房主把牌改成 ${n} 副（共 ${n * 54} 张，每人 ${room.cardsPerPlayer()} 张）`,
    });
    broadcastRoomState(room);
    broadcastRoomList();
}

function handleStartGame(player) {
    const room = player.roomId ? rooms.get(player.roomId) : null;
    if (!room) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }
    if (player.playerId !== room.hostId) {
        player.send({ type: 'error', message: '只有房主可以开始游戏' });
        return;
    }
    if (!room.isFull()) {
        player.send({ type: 'error', message: '需要3个人才能开始' });
        return;
    }
    if (room.status === 'playing') {
        player.send({ type: 'error', message: '游戏已经在进行中' });
        return;
    }
    startGame(room);
}

function handleNextRound(player) {
    const room = player.roomId ? rooms.get(player.roomId) : null;
    if (!room) return;
    if (player.playerId !== room.hostId) {
        player.send({ type: 'error', message: '只有房主可以开始下一局' });
        return;
    }
    if (!room.isFull()) {
        player.send({ type: 'error', message: '需要3个人才能开始' });
        return;
    }
    if (room.status === 'playing') {
        player.send({ type: 'error', message: '这局还没打完' });
        return;
    }
    room.resetForNextRound();
    startGame(room);
}

function startGame(room) {
    room.startGame();
    broadcastToRoom(room, { type: 'game_started', level: room.level });
    room.players.forEach(p => p.send({ type: 'your_cards', cards: p.cards }));
    broadcastRoomState(room);
}

function handlePlayCards(player, cards) {
    const room = player.roomId ? rooms.get(player.roomId) : null;
    if (!room) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }

    const result = room.playCards(player.playerId, cards);
    if (result.error) {
        player.send({ type: 'error', message: result.error });
        return;
    }

    broadcastToRoom(room, {
        type: 'played',
        playerId: player.playerId,
        playerName: player.name,
        cards: result.cards,
        shapeName: SHAPE_NAMES[result.combo.shapeType] || result.combo.shapeType,
    });

    if (result.justFinished) {
        const place = room.finishOrder.indexOf(player.playerId) + 1;
        const placeName = ['头游', '二游', '末游'][place - 1] || `第${place}名`;
        broadcastToRoom(room, { type: 'notice', message: `${player.name} 出完了牌，${placeName}！` });

        if (result.jiefengBy && !result.gameOver) {
            const next = room.getPlayer(result.jiefengBy);
            broadcastToRoom(room, {
                type: 'jiefeng',
                playerId: result.jiefengBy,
                message: `由 ${next ? next.name : '下一家'} 接风，重新领出`,
            });
        }
    }

    player.send({ type: 'your_cards', cards: player.cards });

    if (result.gameOver) {
        broadcastRoomState(room);
        broadcastToRoom(room, { type: 'game_over', result: buildResultPayload(room) });
        broadcastRoomList();
        return;
    }

    broadcastRoomState(room);
}

function handlePass(player) {
    const room = player.roomId ? rooms.get(player.roomId) : null;
    if (!room) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }
    const result = room.pass(player.playerId);
    if (result.error) {
        player.send({ type: 'error', message: result.error });
        return;
    }
    broadcastToRoom(room, { type: 'passed', playerId: player.playerId, playerName: player.name });
    if (result.newRound) {
        broadcastToRoom(room, { type: 'notice', message: '新的一轮，随意出牌' });
    }
    broadcastRoomState(room);
}

function buildResultPayload(room) {
    const r = room.lastResult || {};
    const names = (r.finishOrder || []).map(pid => {
        const p = room.getPlayer(pid);
        return p ? p.name : '（已离开）';
    });
    return {
        order: names,
        winnerName: r.winnerName,
        fromLevel: r.fromLevel,
        toLevel: r.toLevel,
        matchOver: !!r.matchOver,
    };
}

function handlePlayerDisconnect(player) {
    console.log('玩家断开:', player.name);
    players.delete(player.ws);
    const room = player.roomId ? rooms.get(player.roomId) : null;
    detachFromRoom(player, room, '断开了连接');
    broadcastRoomList();
}

function broadcastToRoom(room, data) {
    room.players.forEach(p => p.send(data));
}

function broadcastRoomState(room) {
    const state = room.publicState();
    room.players.forEach(p => p.send({ type: 'room_state', state, you: p.playerId }));
}

function roomListPayload() {
    const list = [];
    rooms.forEach((room, roomId) => {
        list.push({
            roomId,
            playerCount: room.players.length,
            status: room.status,
            decks: room.decks,
            names: room.players.map(p => p.name),
        });
    });
    return list;
}

function sendRoomList(player) {
    player.send({ type: 'room_list', rooms: roomListPayload() });
}

function broadcastRoomList() {
    const list = roomListPayload();
    players.forEach(p => {
        if (!p.roomId) p.send({ type: 'room_list', rooms: list });
    });
}

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 4; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
        }
    }
    return ips;
}

// 只有直接运行 `node server.js` 时才监听端口；被测试文件 require 时不启动，
// 否则测试进程会因为端口一直开着而退不出来。
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log('');
        console.log('========================================');
        console.log('  三人掼蛋已启动！');
        console.log('  家人连同一个WiFi，用浏览器打开：');
        const ips = getLocalIPs();
        if (ips.length === 0) {
            console.log(`    http://localhost:${PORT}`);
        } else {
            ips.forEach(ip => console.log(`    http://${ip}:${PORT}`));
        }
        console.log('========================================');
        console.log('');
    });
}

module.exports = { GameRoom, sortHand };
