function getWsUrl() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return `${protocol}${location.host}`;
}

let ws = null;
let playerName = '';
let roomId = null;
let myPlayerId = null;
let myCards = [];
let selectedCards = [];
let currentTurnPlayerId = null;

// playerId -> { name, cardCount }
let seatData = {};

const suits = ['♠', '♥', '♣', '♦'];
const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const rankValues = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, '小王': 16, '大王': 17
};

function init() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('create-room-btn').addEventListener('click', handleCreateRoom);
    document.getElementById('join-room-btn').addEventListener('click', handleJoinRoom);
    document.getElementById('leave-room-btn').addEventListener('click', handleLeaveRoom);
    document.getElementById('play-cards-btn').addEventListener('click', handlePlayCards);
    document.getElementById('pass-btn').addEventListener('click', handlePass);
    document.getElementById('sort-cards-btn').addEventListener('click', handleSortCards);
}

function connectWebSocket() {
    ws = new WebSocket(`${getWsUrl()}?name=${encodeURIComponent(playerName)}`);

    ws.onopen = () => {
        console.log('WebSocket连接成功');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
        showMessage('连接服务器失败，请确认和主机在同一WiFi下，然后刷新页面重试');
    };

    ws.onclose = () => {
        console.log('WebSocket连接关闭');
        if (roomId) {
            showMessage('与服务器的连接已断开');
        }
    };
}

function sendMessage(type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type, ...data });
        console.log('发送消息:', message);
        ws.send(message);
    } else {
        console.error('WebSocket 未连接，无法发送消息');
        showMessage('与服务器断开连接，请刷新页面');
    }
}

function handleMessage(data) {
    console.log('收到消息:', data);
    switch (data.type) {
        case 'login_success':
            playerName = data.playerName;
            showScreen('lobby-screen');
            requestRoomList();
            break;
        case 'room_list':
            displayRoomList(data.rooms);
            break;
        case 'room_created':
            roomId = data.roomId;
            myPlayerId = 1;
            resetGameScreen();
            document.getElementById('current-room-id').textContent = `房间号: ${roomId}`;
            showScreen('game-screen');
            updateGameStatus('等待其他玩家加入...（把房间号告诉家人）');
            break;
        case 'room_joined':
            roomId = data.roomId;
            myPlayerId = data.playerId;
            resetGameScreen();
            document.getElementById('current-room-id').textContent = `房间号: ${roomId}`;
            showScreen('game-screen');
            updateGameStatus('等待其他玩家加入...');
            break;
        case 'player_joined':
            if (data.player.playerId !== myPlayerId) {
                seatData[data.player.playerId] = seatData[data.player.playerId] || { cardCount: 0 };
                seatData[data.player.playerId].name = data.player.name;
                renderSeats();
            }
            break;
        case 'game_started':
            seatData = {};
            data.gameState.players.forEach(p => {
                seatData[p.playerId] = { name: p.name, cardCount: p.cardCount };
            });
            renderSeats();
            document.getElementById('played-cards').innerHTML = '';
            document.getElementById('last-play-info').textContent = '';
            updateGameStatus('游戏开始！');
            break;
        case 'cards_dealt':
            myCards = data.cards;
            sortMyCards();
            displayMyCards();
            if (seatData[myPlayerId]) {
                seatData[myPlayerId].cardCount = myCards.length;
                renderSeats();
            }
            break;
        case 'player_played':
            if (seatData[data.playerId]) {
                seatData[data.playerId].cardCount = Math.max(0, seatData[data.playerId].cardCount - data.cards.length);
            }
            displayPlayedCards(data.playerId, data.cards);
            renderSeats();
            break;
        case 'player_passed':
            showMessage(`${data.playerName} 不出`);
            break;
        case 'turn_changed':
            currentTurnPlayerId = data.currentPlayer;
            updateTurn(currentTurnPlayerId);
            break;
        case 'game_ended':
            updateGameStatus(`游戏结束！${data.winner} 获胜！`);
            document.getElementById('play-cards-btn').disabled = true;
            document.getElementById('pass-btn').disabled = true;
            break;
        case 'game_aborted':
            updateGameStatus(data.message || '游戏已中止');
            document.getElementById('play-cards-btn').disabled = true;
            document.getElementById('pass-btn').disabled = true;
            break;
        case 'error':
            showMessage(data.message);
            break;
        case 'player_left':
            showMessage(`${data.playerName} 离开了房间`);
            break;
    }
}

function handleLogin() {
    playerName = document.getElementById('player-name').value.trim();
    if (!playerName) {
        showMessage('请输入你的名字');
        return;
    }
    console.log('正在连接 WebSocket，玩家名:', playerName);
    connectWebSocket();
}

function handleCreateRoom() {
    sendMessage('create_room');
}

function handleJoinRoom() {
    const roomIdInput = document.getElementById('room-id-input').value.trim();
    if (!roomIdInput) {
        showMessage('请输入房间号');
        return;
    }
    console.log('尝试加入房间:', roomIdInput);
    sendMessage('join_room', { roomId: roomIdInput.toUpperCase() });
}

function handleLeaveRoom() {
    sendMessage('leave_room');
    roomId = null;
    myPlayerId = null;
    myCards = [];
    selectedCards = [];
    seatData = {};
    currentTurnPlayerId = null;
    showScreen('lobby-screen');
    requestRoomList();
}

function handlePlayCards() {
    if (selectedCards.length === 0) {
        showMessage('请选择要出的牌');
        return;
    }

    const cardData = selectedCards.map(index => myCards[index]);
    sendMessage('play_cards', { cards: cardData });
    selectedCards = [];
    updateSelectedCards();
}

function handlePass() {
    sendMessage('pass');
}

function sortMyCards() {
    myCards.sort((a, b) => rankValues[b.rank] - rankValues[a.rank]);
}

function handleSortCards() {
    sortMyCards();
    displayMyCards();
}

function requestRoomList() {
    sendMessage('get_rooms');
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

function resetGameScreen() {
    myCards = [];
    selectedCards = [];
    seatData = {};
    currentTurnPlayerId = null;
    document.getElementById('my-cards-area').innerHTML = '';
    document.getElementById('played-cards').innerHTML = '';
    document.getElementById('last-play-info').textContent = '';
    renderSeats();
}

function showMessage(message) {
    const messageEl = document.getElementById('game-message');
    messageEl.textContent = message;
    setTimeout(() => {
        messageEl.textContent = '';
    }, 3000);
}

function displayRoomList(rooms) {
    console.log('显示房间列表:', rooms);
    const roomsList = document.getElementById('rooms');
    roomsList.innerHTML = '';

    rooms.forEach(room => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>房间号: ${room.roomId}</span>
            <span>${room.players.length}/3 玩家</span>
        `;
        li.addEventListener('click', () => {
            document.getElementById('room-id-input').value = room.roomId;
        });
        roomsList.appendChild(li);
    });
}

// 根据自己的 playerId 算出另外两位玩家分别坐在"左边"还是"右边"（按出牌顺序：我 -> 左 -> 右 -> 我）
function seatFor(playerId) {
    if (playerId === myPlayerId) return 'me';
    const left = (myPlayerId % 3) + 1;
    return playerId === left ? 'left' : 'right';
}

function renderSeats() {
    ['left', 'right'].forEach(seat => {
        const entry = Object.entries(seatData).find(([pid]) => seatFor(Number(pid)) === seat);
        const nameEl = document.getElementById(`seat-${seat}-name`);
        const countEl = document.getElementById(`seat-${seat}-count`);
        const cardsEl = document.getElementById(`seat-${seat}-cards`);

        if (entry) {
            const [, info] = entry;
            nameEl.textContent = info.name || '玩家';
            countEl.textContent = `${info.cardCount}张`;
            cardsEl.innerHTML = '';
            for (let i = 0; i < info.cardCount; i++) {
                const back = document.createElement('div');
                back.className = 'opponent-card';
                cardsEl.appendChild(back);
            }
        } else {
            nameEl.textContent = '等待玩家...';
            countEl.textContent = '0张';
            cardsEl.innerHTML = '';
        }
    });

    const meInfo = seatData[myPlayerId];
    document.getElementById('me-name').textContent = (meInfo && meInfo.name) || playerName || '我';
    document.getElementById('me-count').textContent = `${(meInfo && meInfo.cardCount) || myCards.length}张`;
}

function displayMyCards() {
    const cardsArea = document.getElementById('my-cards-area');
    cardsArea.innerHTML = '';

    myCards.forEach((card, index) => {
        const cardEl = createCardElement(card, false);
        cardEl.addEventListener('click', () => toggleCardSelection(index));
        cardsArea.appendChild(cardEl);
    });
}

function createCardElement(card, isBack = false) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';

    if (isBack) {
        cardEl.classList.add('card-back');
    } else {
        const isRed = card.suit === '♥' || card.suit === '♦';
        cardEl.classList.add(isRed ? 'red' : 'black');
        cardEl.innerHTML = `
            <span>${card.suit}</span>
            <span>${card.rank}</span>
        `;
    }

    return cardEl;
}

function toggleCardSelection(index) {
    const cardIndex = selectedCards.indexOf(index);
    if (cardIndex > -1) {
        selectedCards.splice(cardIndex, 1);
    } else {
        selectedCards.push(index);
    }
    updateSelectedCards();
}

function updateSelectedCards() {
    const cardElements = document.querySelectorAll('#my-cards-area .card');
    cardElements.forEach((el, index) => {
        if (selectedCards.includes(index)) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });

    const playBtn = document.getElementById('play-cards-btn');
    playBtn.disabled = selectedCards.length === 0 || currentTurnPlayerId !== myPlayerId;
}

function displayPlayedCards(playerId, cards) {
    const playedCardsArea = document.getElementById('played-cards');
    playedCardsArea.innerHTML = '';

    cards.forEach(card => {
        const cardEl = createCardElement(card);
        playedCardsArea.appendChild(cardEl);
    });

    const info = seatData[playerId];
    const who = playerId === myPlayerId ? '我' : (info && info.name) || '玩家';
    document.getElementById('last-play-info').textContent = `${who} 出了 ${cards.length} 张牌`;
}

function updateTurn(currentPlayerId) {
    const playBtn = document.getElementById('play-cards-btn');
    const passBtn = document.getElementById('pass-btn');

    const isMyTurn = currentPlayerId === myPlayerId;
    playBtn.disabled = !isMyTurn || selectedCards.length === 0;
    passBtn.disabled = !isMyTurn;

    if (isMyTurn) {
        updateGameStatus('轮到你了！');
    } else {
        const info = seatData[currentPlayerId];
        updateGameStatus(`等待 ${(info && info.name) || '其他玩家'} 出牌...`);
    }
}

function updateGameStatus(status) {
    document.getElementById('game-status').textContent = status;
}

document.addEventListener('DOMContentLoaded', init);
