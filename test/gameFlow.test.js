// 集成测试：三个玩家通过真实 WebSocket 打完整局，验证发牌/轮转/出牌合法性/名次
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { detectCombo, canBeat, singleCardRank } = require('../cardLogic');

const PORT = 3517;
let passed = 0, failed = 0;

function check(name, fn) {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

function connect(name) {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${PORT}?name=${encodeURIComponent(name)}`);
        const st = { ws, name, cards: [], id: null, state: null, queue: [], waiters: [] };
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.type === 'joined_room') st.id = msg.playerId;
            if (msg.type === 'your_cards') st.cards = msg.cards;
            if (msg.type === 'room_state') st.state = msg.state;
            // 单独记一份，避免被 Promise.race 的等待器取走后就找不到了
            if (msg.type === 'game_over') st.gameOver = msg;
            const w = st.waiters.find(x => x.type === msg.type);
            if (w) {
                st.waiters = st.waiters.filter(x => x !== w);
                clearTimeout(w.timer);
                w.resolve(msg);
            } else {
                st.queue.push(msg);
            }
        });
        ws.on('open', () => resolve(st));
    });
}

function waitFor(st, type, ms = 4000) {
    const i = st.queue.findIndex(m => m.type === type);
    if (i >= 0) return Promise.resolve(st.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), ms);
        st.waiters.push({ type, resolve, timer });
    });
}

function send(st, type, payload = {}) {
    st.ws.send(JSON.stringify({ type, ...payload }));
}

// 清空消息队列时，必须把 Promise.race 留下的、没人再 await 的等待器也清掉，
// 否则后面到达的同类型消息会被这些"僵尸"等待器取走，新的 waitFor 永远等不到
function reset(st) {
    st.queue.length = 0;
    st.waiters.forEach(w => clearTimeout(w.timer));
    st.waiters = [];
    st.gameOver = null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 简易AI：能出就出最小的合法牌，否则不要
function chooseMove(cards, level, lastCombo) {
    const sorted = [...cards].sort((a, b) => singleCardRank(a, level) - singleCardRank(b, level));
    if (!lastCombo) return [sorted[0]];

    const len = lastCombo.length;
    if (len === 1) {
        for (const card of sorted) {
            const combo = detectCombo([card], level);
            if (combo && canBeat(combo, lastCombo)) return [card];
        }
    } else {
        const byRank = new Map();
        for (const card of sorted) {
            if (!byRank.has(card.rank)) byRank.set(card.rank, []);
            byRank.get(card.rank).push(card);
        }
        for (const g of byRank.values()) {
            if (g.length >= len) {
                const combo = detectCombo(g.slice(0, len), level);
                if (combo && canBeat(combo, lastCombo)) return g.slice(0, len);
            }
        }
    }
    // 试炸弹
    const byRank = new Map();
    for (const card of sorted) {
        if (!byRank.has(card.rank)) byRank.set(card.rank, []);
        byRank.get(card.rank).push(card);
    }
    for (const g of byRank.values()) {
        for (let s = 4; s <= g.length; s++) {
            const combo = detectCombo(g.slice(0, s), level);
            if (combo && canBeat(combo, lastCombo)) return g.slice(0, s);
        }
    }
    return null;
}

async function playOneGame(ps, byId, label) {
    let guard = 0;
    let gameOver = null;
    const seenPlays = [];

    while (guard++ < 2000 && !gameOver) {
        const done = ps.map(p => p.gameOver).find(Boolean);
        if (done) { gameOver = done; break; }

        const anyState = ps.find(p => p.state)?.state;
        if (!anyState || anyState.status !== 'playing') {
            await sleep(5);
            continue;
        }

        const curId = anyState.currentPlayerId;
        const p = byId[curId];
        if (!p) break;

        const lastCombo = anyState.lastCombo ? detectCombo(anyState.lastCombo.cards, anyState.level) : null;
        const move = chooseMove(p.cards, anyState.level, lastCombo);

        if (move) {
            send(p, 'play_cards', { cards: move });
            seenPlays.push({ who: p.name, n: move.length });
        } else {
            send(p, 'pass');
        }

        // 等待任一状态推进
        const res = await Promise.race([
            waitFor(p, 'room_state', 3000).catch(() => null),
            waitFor(p, 'error', 3000).catch(() => null),
            waitFor(p, 'game_over', 3000).catch(() => null),
        ]);
        if (res && res.type === 'error' && process.env.DEBUG_FLOW) {
            console.log(`      [debug] ${p.name} 被拒: ${res.message} (move=${move ? move.map(m => m.rank).join(',') : 'pass'})`);
        }
        await sleep(4);

        const over = ps.map(x => x.gameOver).find(Boolean);
        if (over) { gameOver = over; break; }
    }
    return { gameOver, seenPlays, guard };
}

(async () => {
    const server = spawn('node', ['server.js'], {
        cwd: `${__dirname}/..`,
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'ignore',
    });
    await sleep(700);

    try {
        console.log('\n对局流程');

        const p1 = await connect('爸爸');
        const p2 = await connect('妈妈');
        const p3 = await connect('孩子');
        const ps = [p1, p2, p3];
        for (const p of ps) await waitFor(p, 'login_success');

        send(p1, 'create_room');
        const created = await waitFor(p1, 'joined_room');
        const roomId = created.roomId;

        send(p2, 'join_room', { roomId });
        await waitFor(p2, 'joined_room');
        send(p3, 'join_room', { roomId });
        await waitFor(p3, 'joined_room');
        await sleep(100);

        const byId = {};
        ps.forEach(p => { byId[p.id] = p; });

        check('三人分别拿到不同的座位号', () => {
            assert.strictEqual(new Set(ps.map(p => p.id)).size, 3);
        });

        // 非房主不能开始
        ps.forEach(reset);
        send(p2, 'start_game');
        const err = await waitFor(p2, 'error', 2000);
        check('非房主不能开始游戏', () => assert.match(err.message, /房主/));

        ps.forEach(reset);
        send(p1, 'start_game');
        await Promise.all(ps.map(p => waitFor(p, 'game_started')));
        await Promise.all(ps.map(p => waitFor(p, 'your_cards')));
        await sleep(120);

        check('每人发到36张牌', () => {
            ps.forEach(p => assert.strictEqual(p.cards.length, 36, `${p.name} 拿到 ${p.cards.length} 张`));
        });
        check('三人手牌合计108张且无重复牌', () => {
            const all = ps.flatMap(p => p.cards.map(c => `${c.suit}${c.rank}`));
            assert.strictEqual(all.length, 108);
            const counts = {};
            all.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
            // 两副牌，每张牌最多出现2次
            Object.entries(counts).forEach(([k, v]) => {
                assert.ok(v <= 2, `${k} 出现了 ${v} 次`);
            });
        });
        check('开局有明确的当前出牌人', () => {
            const st = ps.find(p => p.state).state;
            assert.ok(st.currentPlayerId, '没有设置当前出牌人');
        });

        // 非当前玩家出牌应被拒绝
        const st0 = ps.find(p => p.state).state;
        const notTurn = ps.find(p => p.id !== st0.currentPlayerId);
        reset(notTurn);
        send(notTurn, 'play_cards', { cards: [notTurn.cards[0]] });
        const turnErr = await waitFor(notTurn, 'error', 2000);
        check('不是自己回合时出牌被拒绝', () => assert.match(turnErr.message, /轮到/));

        // 伪造不在手上的牌
        const curP = byId[st0.currentPlayerId];
        reset(curP);
        send(curP, 'play_cards', { cards: [{ suit: '♠', rank: '不存在' }] });
        const fakeErr = await waitFor(curP, 'error', 2000);
        check('出手里没有的牌被拒绝', () => assert.ok(fakeErr.message.length > 0));

        console.log('\n完整对局');
        const { gameOver, guard } = await playOneGame(ps, byId, '第一局');

        check('对局能正常结束(未死循环)', () => {
            assert.ok(gameOver, `没有产生结束消息 (循环${guard}次)`);
        });
        check('结束时产生完整的三人名次', () => {
            assert.ok(gameOver, '无结果');
            assert.strictEqual(gameOver.result.order.length, 3);
        });
        check('结束后级牌升级', () => {
            assert.ok(gameOver, '无结果');
            assert.notStrictEqual(gameOver.result.fromLevel, gameOver.result.toLevel);
        });
        check('头游是最先出完的人', () => {
            assert.ok(gameOver.result.winnerName, '没有头游');
            assert.strictEqual(gameOver.result.order[0], gameOver.result.winnerName);
        });

        console.log('\n安全性：伪造的牌 / 畸形 Host 头');
        {
            const { GameRoom } = require('../server.js');
            const cc = (x) => { const a = Array.from(x); return { suit: a[0], rank: a.slice(1).join('') }; };
            const hh = (...x) => x.map(cc);
            const fake = (n) => ({ name: n, ws: { readyState: 3 }, send() {}, cards: [], playerId: null, finished: false });
            const room = new GameRoom('SEC');
            const A = fake('A'), B = fake('B'), C = fake('C');
            [A, B, C].forEach(x => room.addPlayer(x));
            room.startGame(); room.level = '2';
            A.cards = hh('♠3', '♠3'); B.cards = hh('♣A'); C.cards = hh('♥K');
            room.currentIndex = 0; room.lastCombo = null; room.passCount = 0;

            check('拆错花色的伪造牌被拒（否则点数算成 undefined，谁也压不过）', () => {
                const r = room.playCards(A.playerId, [{ suit: '', rank: '♠3' }, { suit: '', rank: '♠3' }]);
                assert.ok(r.error, '伪造牌被接受了');
                assert.strictEqual(A.cards.length, 2, '手牌不该被扣掉');
            });
            check('伪造花色/点数被拒', () => {
                assert.ok(room.playCards(A.playerId, [{ suit: '♠1', rank: '0' }]).error);
                assert.ok(room.playCards(A.playerId, [{ suit: '♠', rank: '大王' }]).error);
            });
            check('真牌不受影响', () =>
                assert.ok(!room.playCards(A.playerId, hh('♠3', '♠3')).error));
        }

        // 畸形 Host 头以前能让整个服务进程退出
        {
            const net = require('net');
            const badHosts = ['[', 'a]b', '%', '@', 'a@b'];
            for (const host of badHosts) {
                await new Promise(res => {
                    const sock = net.connect(PORT, 'localhost', () => {
                        sock.write(`GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
                    });
                    sock.on('data', () => {}); sock.on('error', () => res()); sock.on('close', () => res());
                    setTimeout(() => { sock.destroy(); res(); }, 250);
                });
            }
            await sleep(300);
            reset(p1);
            send(p1, 'get_rooms');
            const stillAlive = await waitFor(p1, 'room_list', 2000).catch(() => null);
            check('畸形 Host 头不会把服务器搞挂', () =>
                assert.ok(stillAlive, '服务器没响应，可能已经崩溃'));
        }

        console.log('\n接风（头游走后下家直接领出）');
        {
            const { GameRoom } = require('../server.js');
            const cc = (x) => { const a = Array.from(x); return { suit: a[0], rank: a.slice(1).join('') }; };
            const hh = (...x) => x.map(cc);
            const fake = (n) => ({ name: n, ws: { readyState: 3 }, send() {}, cards: [], playerId: null, finished: false });

            const room = new GameRoom('JF');
            const A = fake('A'), B = fake('B'), C = fake('C');
            [A, B, C].forEach(x => room.addPlayer(x));
            room.startGame();
            room.level = '2';
            // A 只剩一张大王，打出去就走人；谁也压不过大王
            A.cards = hh('🃏大王');
            B.cards = hh('♠3', '♠4');
            C.cards = hh('♦5', '♦6');
            room.currentIndex = 0;
            room.lastCombo = null; room.lastPlayerId = null; room.passCount = 0;

            const played = room.playCards(A.playerId, hh('🃏大王'));
            check('头游出完牌后牌桌清空（不用再去压离场玩家的牌）', () => {
                assert.ok(!played.error, played.error);
                assert.strictEqual(room.lastCombo, null, '牌桌应该清空');
            });
            check('接风的是头游的下家', () => {
                assert.strictEqual(played.jiefengBy, room.currentPlayer().playerId);
                assert.strictEqual(room.currentPlayer().name, 'B');
            });
            check('下家可以直接自由领出，不必先过牌', () => {
                const r = room.playCards(B.playerId, hh('♠3'));
                assert.ok(!r.error, `本该能直接出牌，却报: ${r.error}`);
            });
            check('接风后仍是正常轮转（C 需要压 B 的牌）', () => {
                const r = room.playCards(C.playerId, hh('♦5'));
                assert.ok(!r.error, r.error);
            });
        }

        console.log('\n开局中不能重新发牌');
        // 再开一局，然后在对局进行中尝试 next_round
        ps.forEach(reset);
        send(p1, 'next_round');
        await Promise.all(ps.map(p => waitFor(p, 'game_started', 3000)));
        await Promise.all(ps.map(p => waitFor(p, 'your_cards', 3000)));
        await sleep(150);
        const handBefore = ps[0].cards.map(c => `${c.suit}${c.rank}`).join(',');
        reset(p1);
        send(p1, 'next_round');
        const midErr = await waitFor(p1, 'error', 2000).catch(() => null);
        await sleep(200);
        const handAfter = ps[0].cards.map(c => `${c.suit}${c.rank}`).join(',');
        check('对局进行中房主不能重新发牌', () => {
            assert.ok(midErr, '应该返回错误，实际没有');
            assert.strictEqual(handBefore, handAfter, '手牌被重新发了');
        });

        console.log('\n断线处理');
        ps.forEach(reset);
        p3.ws.close();
        await sleep(300);
        check('有人离开后房间状态回到等待', () => {
            const st = p1.state;
            assert.notStrictEqual(st.status, 'playing');
            assert.strictEqual(st.players.length, 2);
        });

        p1.ws.close();
        p2.ws.close();
    } catch (e) {
        failed++;
        console.log(`\n测试异常: ${e.message}\n${e.stack}`);
    } finally {
        server.kill();
        await sleep(200);
    }

    console.log(`\n${'='.repeat(40)}`);
    console.log(`通过: ${passed}  失败: ${failed}`);
    console.log('='.repeat(40));
    process.exit(failed > 0 ? 1 : 0);
})();
