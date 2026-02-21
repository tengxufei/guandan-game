const WS_URL = 'ws://localhost:3000';

let ws = null;
let playerName = '';
let roomId = null;
let myPlayerId = null;
let myCards = [];
let selectedCards = [];
let gameState = null;

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
    ws = new WebSocket(`${WS_URL}?name=${encodeURIComponent(playerName)}`);

    ws.onopen = () => {
        console.log('WebSocket连接成功');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
        showMessage('连接服务器失败，请刷新页面重试');
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
            document.getElementById('current-room-id').textContent = `房间号: ${roomId}`;
            showScreen('game-screen');
            break;
        case 'room_joined':
            roomId = data.roomId;
            myPlayerId = data.playerId;
            document.getElementById('current-room-id').textContent = `房间号: ${roomId}`;
            showScreen('game-screen');
            break;
        case 'player_joined':
            updatePlayerInfo(data.player);
            break;
        case 'game_started':
            gameState = data.gameState;
            updateGameStatus('游戏开始！');
            break;
        case 'cards_dealt':
            myCards = data.cards;
            displayMyCards();
            updateCardCounts();
            break;
        case 'player_played':
            displayPlayedCards(data.playerId, data.cards);
            updateCardCounts();
            break;
        case 'player_passed':
            showMessage(`${data.playerName} 不出`);
            break;
        case 'turn_changed':
            updateTurn(data.currentPlayer);
            break;
        case 'game_ended':
            updateGameStatus(`游戏结束！${data.winner} 获胜！`);
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
    console.log('WebSocket 状态:', ws ? ws.readyState : '未连接');
    sendMessage('join_room', { roomId: roomIdInput });
}

function handleLeaveRoom() {
    sendMessage('leave_room');
    roomId = null;
    gameState = null;
    myCards = [];
    selectedCards = [];
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

function handleSortCards() {
    myCards.sort((a, b) => rankValues[b.rank] - rankValues[a.rank]);
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

function updatePlayerInfo(player) {
    const playerNum = player.playerId === myPlayerId ? 'current' : player.playerId;
    const nameEl = document.getElementById(`player${playerNum}-name`);
    if (nameEl) {
        nameEl.textContent = player.name;
    }
}

function updateGameStatus(status) {
    document.getElementById('game-status').textContent = status;
}

function updateCardCounts() {
    if (gameState) {
        gameState.players.forEach(player => {
            const playerNum = player.playerId === myPlayerId ? 'current' : player.playerId;
            const countEl = document.getElementById(`player${playerNum}-cards`);
            if (countEl) {
                countEl.textContent = `${player.cardCount}张`;
            }
        });
    }
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
    playBtn.disabled = selectedCards.length === 0;
}

function displayPlayedCards(playerId, cards) {
    const playedCardsArea = document.getElementById('played-cards');
    playedCardsArea.innerHTML = '';
    
    cards.forEach(card => {
        const cardEl = createCardElement(card);
        playedCardsArea.appendChild(cardEl);
    });
}

function updateTurn(currentPlayer) {
    const playBtn = document.getElementById('play-cards-btn');
    const passBtn = document.getElementById('pass-btn');
    
    const isMyTurn = currentPlayer === myPlayerId;
    playBtn.disabled = !isMyTurn || selectedCards.length === 0;
    passBtn.disabled = !isMyTurn;
    
    if (isMyTurn) {
        updateGameStatus('轮到你了！');
    } else {
        const playerName = gameState.players.find(p => p.playerId === currentPlayer)?.name || '其他玩家';
        updateGameStatus(`等待 ${playerName} 出牌...`);
    }
}

document.addEventListener('DOMContentLoaded', init);