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
        for (const p of ps) p.queue.length = 0;
        send(p2, 'start_game');
        const err = await waitFor(p2, 'error', 2000);
        check('非房主不能开始游戏', () => assert.match(err.message, /房主/));

        for (const p of ps) p.queue.length = 0;
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
        notTurn.queue.length = 0;
        send(notTurn, 'play_cards', { cards: [notTurn.cards[0]] });
        const turnErr = await waitFor(notTurn, 'error', 2000);
        check('不是自己回合时出牌被拒绝', () => assert.match(turnErr.message, /轮到/));

        // 伪造不在手上的牌
        const curP = byId[st0.currentPlayerId];
        curP.queue.length = 0;
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

        console.log('\n断线处理');
        for (const p of ps) p.queue.length = 0;
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
