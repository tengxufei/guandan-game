const WebSocket = require('ws');
const http = require('http');

const suits = ['♠', '♥', '♣', '♦'];
const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const rankValues = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, '小王': 16, '大王': 17
};

class GameRoom {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.gameState = null;
        this.currentPlayer = 0;
        this.lastPlayedCards = null;
        this.lastPlayer = null;
        this.passCount = 0;
    }

    addPlayer(player) {
        if (this.players.length >= 3) return false;
        this.players.push(player);
        player.roomId = this.roomId;
        player.playerId = this.players.length;
        return true;
    }

    removePlayer(player) {
        const index = this.players.indexOf(player);
        if (index > -1) {
            this.players.splice(index, 1);
            this.reassignPlayerIds();
        }
    }

    reassignPlayerIds() {
        this.players.forEach((player, index) => {
            player.playerId = index + 1;
        });
    }

    isFull() {
        return this.players.length === 3;
    }

    startGame() {
        const deck = this.createDeck();
        this.dealCards(deck);
        this.currentPlayer = 0;
        this.lastPlayedCards = null;
        this.lastPlayer = null;
        this.passCount = 0;
        this.gameState = {
            status: 'playing',
            players: this.players.map(p => ({
                playerId: p.playerId,
                name: p.name,
                cardCount: p.cards.length
            }))
        };
        return this.gameState;
    }

    createDeck() {
        const deck = [];
        for (const suit of suits) {
            for (const rank of ranks) {
                deck.push({ suit, rank });
            }
        }
        deck.push({ suit: '🃏', rank: '小王' });
        deck.push({ suit: '🃏', rank: '大王' });
        return this.shuffle(deck);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    dealCards(deck) {
        const cardsPerPlayer = Math.floor(deck.length / 3);
        this.players.forEach((player, index) => {
            player.cards = deck.slice(index * cardsPerPlayer, (index + 1) * cardsPerPlayer);
            this.sortCards(player.cards);
        });
    }

    sortCards(cards) {
        cards.sort((a, b) => rankValues[b.rank] - rankValues[a.rank]);
    }

    playCards(playerId, cards) {
        const player = this.players.find(p => p.playerId === playerId);
        if (!player || playerId !== this.currentPlayer + 1) {
            return { success: false, message: '不是你的回合' };
        }

        if (!this.isValidPlay(cards)) {
            return { success: false, message: '无效的出牌' };
        }

        if (!this.canPlayCards(cards)) {
            return { success: false, message: '你的牌不能大过上家' };
        }

        player.cards = player.cards.filter(c => 
            !cards.some(played => played.suit === c.suit && played.rank === c.rank)
        );

        this.lastPlayedCards = cards;
        this.lastPlayer = playerId;
        this.passCount = 0;
        this.nextTurn();

        this.updateGameState();

        if (player.cards.length === 0) {
            return { success: true, winner: player.name, gameEnded: true };
        }

        return { success: true };
    }

    pass(playerId) {
        if (playerId !== this.currentPlayer + 1) {
            return { success: false, message: '不是你的回合' };
        }

        if (!this.lastPlayedCards) {
            return { success: false, message: '你是首家，不能不出' };
        }

        this.passCount++;
        this.nextTurn();

        if (this.passCount >= 2) {
            this.lastPlayedCards = null;
            this.lastPlayer = null;
            this.passCount = 0;
        }

        return { success: true };
    }

    isValidPlay(cards) {
        if (cards.length === 0) return false;

        const cardRanks = cards.map(c => rankValues[c.rank]);
        cardRanks.sort((a, b) => a - b);

        const isSingle = cards.length === 1;
        const isPair = cards.length === 2 && cardRanks[0] === cardRanks[1];
        const isTriple = cards.length === 3 && cardRanks[0] === cardRanks[2];
        const isTripleWithSingle = cards.length === 4 && 
            (cardRanks[0] === cardRanks[2] || cardRanks[1] === cardRanks[3]);
        const isTripleWithPair = cards.length === 5 && 
            ((cardRanks[0] === cardRanks[2] && cardRanks[3] === cardRanks[4]) ||
             (cardRanks[0] === cardRanks[1] && cardRanks[2] === cardRanks[4]));
        const isStraight = cards.length >= 5 && this.isStraight(cardRanks);
        const isBomb = cards.length === 4 && cardRanks[0] === cardRanks[3];
        const isRocket = cards.length === 2 && 
            cards.some(c => c.rank === '小王') && cards.some(c => c.rank === '大王');

        return isSingle || isPair || isTriple || isTripleWithSingle || 
               isTripleWithPair || isStraight || isBomb || isRocket;
    }

    isStraight(ranks) {
        for (let i = 1; i < ranks.length; i++) {
            if (ranks[i] - ranks[i-1] !== 1) return false;
        }
        return ranks[0] <= 10 && ranks[ranks.length - 1] <= 14;
    }

    canPlayCards(cards) {
        if (!this.lastPlayedCards) return true;

        const lastRanks = this.lastPlayedCards.map(c => rankValues[c.rank]);
        const currentRanks = cards.map(c => rankValues[c.rank]);

        const isBomb = cards.length === 4 && currentRanks[0] === currentRanks[3];
        const isRocket = cards.length === 2 && 
            cards.some(c => c.rank === '小王') && cards.some(c => c.rank === '大王');

        const lastIsBomb = this.lastPlayedCards.length === 4 && 
            lastRanks[0] === lastRanks[3];
        const lastIsRocket = this.lastPlayedCards.length === 2 && 
            this.lastPlayedCards.some(c => c.rank === '小王') && 
            this.lastPlayedCards.some(c => c.rank === '大王');

        if (isRocket) return true;
        if (isBomb && !lastIsBomb && !lastIsRocket) return true;
        if (isBomb && lastIsBomb) return currentRanks[0] > lastRanks[0];

        if (cards.length !== this.lastPlayedCards.length) return false;

        const cardType = this.getCardType(cards);
        const lastType = this.getCardType(this.lastPlayedCards);

        if (cardType !== lastType) return false;

        return currentRanks[0] > lastRanks[0];
    }

    getCardType(cards) {
        const ranks = cards.map(c => rankValues[c.rank]).sort((a, b) => a - b);
        
        if (cards.length === 1) return 'single';
        if (cards.length === 2 && ranks[0] === ranks[1]) return 'pair';
        if (cards.length === 2 && ranks.includes(16) && ranks.includes(17)) return 'rocket';
        if (cards.length === 3 && ranks[0] === ranks[2]) return 'triple';
        if (cards.length === 4 && ranks[0] === ranks[3]) return 'bomb';
        if (cards.length === 4 && (ranks[0] === ranks[2] || ranks[1] === ranks[3])) return 'triple_single';
        if (cards.length === 5 && this.isStraight(ranks)) return 'straight';
        if (cards.length === 5 && ((ranks[0] === ranks[2] && ranks[3] === ranks[4]) || 
            (ranks[0] === ranks[1] && ranks[2] === ranks[4]))) return 'triple_pair';
        
        return 'unknown';
    }

    nextTurn() {
        this.currentPlayer = (this.currentPlayer + 1) % 3;
    }

    updateGameState() {
        this.gameState.players = this.players.map(p => ({
            playerId: p.playerId,
            name: p.name,
            cardCount: p.cards.length
        }));
    }
}

class Player {
    constructor(ws, name) {
        this.ws = ws;
        this.name = name;
        this.playerId = null;
        this.roomId = null;
        this.cards = [];
    }

    send(data) {
        if (this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(data));
        }
    }
}

const rooms = new Map();
const players = new Map();

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const playerName = url.searchParams.get('name') || 'Anonymous';

    const player = new Player(ws, playerName);
    players.set(ws, player);
    console.log('新玩家连接:', playerName, '当前玩家数:', players.size);

    player.send({ type: 'login_success', playerName: player.name });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(player, data);
        } catch (error) {
            console.error('Error handling message:', error);
            player.send({ type: 'error', message: '处理消息时出错' });
        }
    });

    ws.on('close', () => {
        handlePlayerDisconnect(player);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleMessage(player, data) {
    console.log('收到消息:', data.type, data);
    switch (data.type) {
        case 'create_room':
            handleCreateRoom(player);
            break;
        case 'join_room':
            handleJoinRoom(player, data.roomId);
            break;
        case 'leave_room':
            handleLeaveRoom(player);
            break;
        case 'get_rooms':
            handleGetRooms(player);
            break;
        case 'start_game':
            handleStartGame(player);
            break;
        case 'play_cards':
            handlePlayCards(player, data.cards);
            break;
        case 'pass':
            handlePass(player);
            break;
        default:
            console.log('未知消息类型:', data.type);
            player.send({ type: 'error', message: '未知的消息类型' });
    }
}

function handleCreateRoom(player) {
    console.log('处理创建房间请求');
    if (player.roomId) {
        console.log('玩家已在房间中:', player.roomId);
        player.send({ type: 'error', message: '你已经在房间中' });
        return;
    }

    const roomId = generateRoomId();
    console.log('创建新房间:', roomId);
    const room = new GameRoom(roomId);
    room.addPlayer(player);
    rooms.set(roomId, room);

    player.send({ type: 'room_created', roomId });
    console.log('发送房间创建成功消息:', roomId);
    broadcastRoomList();
}

function handleJoinRoom(player, roomId) {
    console.log('处理加入房间请求:', roomId, '当前房间数:', rooms.size);
    console.log('所有房间:', Array.from(rooms.keys()));
    
    if (player.roomId) {
        console.log('玩家已在房间中:', player.roomId);
        player.send({ type: 'error', message: '你已经在房间中' });
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        console.log('房间不存在:', roomId);
        player.send({ type: 'error', message: '房间不存在' });
        return;
    }

    console.log('房间当前玩家数:', room.players.length);
    if (!room.addPlayer(player)) {
        console.log('房间已满');
        player.send({ type: 'error', message: '房间已满' });
        return;
    }

    console.log('玩家加入成功, playerId:', player.playerId);
    player.send({ type: 'room_joined', roomId, playerId: player.playerId });
    broadcastToRoom(room, { type: 'player_joined', player: { playerId: player.playerId, name: player.name } });

    if (room.isFull()) {
        console.log('房间已满，开始游戏');
        startGame(room);
    }

    broadcastRoomList();
}

function handleLeaveRoom(player) {
    if (!player.roomId) return;

    const room = rooms.get(player.roomId);
    if (room) {
        room.removePlayer(player);
        broadcastToRoom(room, { type: 'player_left', playerName: player.name });

        if (room.players.length === 0) {
            console.log('房间为空，删除房间:', player.roomId);
            rooms.delete(player.roomId);
        }
    }

    player.roomId = null;
    player.playerId = null;
    player.cards = [];

    broadcastRoomList();
}

function handleGetRooms(player) {
    const roomList = [];
    rooms.forEach((room, roomId) => {
        roomList.push({
            roomId,
            players: room.players.map(p => ({ name: p.name }))
        });
    });
    player.send({ type: 'room_list', rooms: roomList });
}

function handleStartGame(player) {
    if (!player.roomId) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }

    const room = rooms.get(player.roomId);
    if (!room || !room.isFull()) {
        player.send({ type: 'error', message: '房间未满，无法开始游戏' });
        return;
    }

    startGame(room);
}

function startGame(room) {
    const gameState = room.startGame();
    broadcastToRoom(room, { type: 'game_started', gameState });

    room.players.forEach(player => {
        player.send({ type: 'cards_dealt', cards: player.cards });
    });

    broadcastToRoom(room, { type: 'turn_changed', currentPlayer: room.players[room.currentPlayer].playerId });
}

function handlePlayCards(player, cards) {
    if (!player.roomId) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }

    const room = rooms.get(player.roomId);
    if (!room) {
        player.send({ type: 'error', message: '房间不存在' });
        return;
    }

    const result = room.playCards(player.playerId, cards);
    
    if (result.success) {
        broadcastToRoom(room, { 
            type: 'player_played', 
            playerId: player.playerId, 
            cards 
        });

        if (result.gameEnded) {
            broadcastToRoom(room, { type: 'game_ended', winner: result.winner });
        } else {
            broadcastToRoom(room, { 
                type: 'turn_changed', 
                currentPlayer: room.players[room.currentPlayer].playerId 
            });
        }
    } else {
        player.send({ type: 'error', message: result.message });
    }
}

function handlePass(player) {
    if (!player.roomId) {
        player.send({ type: 'error', message: '你不在房间中' });
        return;
    }

    const room = rooms.get(player.roomId);
    if (!room) {
        player.send({ type: 'error', message: '房间不存在' });
        return;
    }

    const result = room.pass(player.playerId);
    
    if (result.success) {
        broadcastToRoom(room, { type: 'player_passed', playerName: player.name });
        broadcastToRoom(room, { 
            type: 'turn_changed', 
            currentPlayer: room.players[room.currentPlayer].playerId 
        });
    } else {
        player.send({ type: 'error', message: result.message });
    }
}

function handlePlayerDisconnect(player) {
    console.log('玩家断开连接:', player.name);
    players.delete(player.ws);

    if (player.roomId) {
        const room = rooms.get(player.roomId);
        if (room) {
            room.removePlayer(player);
            broadcastToRoom(room, { type: 'player_left', playerName: player.name });

            if (room.players.length === 0) {
                console.log('房间为空，删除房间:', player.roomId);
                rooms.delete(player.roomId);
            }
        }
        broadcastRoomList();
    }
}

function broadcastToRoom(room, data) {
    console.log('广播到房间:', room.roomId, '数据:', data);
    room.players.forEach(player => {
        console.log('发送给玩家:', player.name, 'playerId:', player.playerId);
        player.send(data);
    });
}

function broadcastRoomList() {
    const roomList = [];
    rooms.forEach((room, roomId) => {
        roomList.push({
            roomId,
            players: room.players.map(p => ({ name: p.name }))
        });
    });

    console.log('广播房间列表:', roomList);
    players.forEach(player => {
        player.send({ type: 'room_list', rooms: roomList });
    });
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`游戏服务器运行在端口 ${PORT}`);
});