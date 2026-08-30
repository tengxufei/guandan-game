// 掼蛋核心规则：两副牌(108张)，3人局，级牌（红桃当前级数）为万能牌。
// 本文件只做纯函数的牌型判定与比牌，不涉及网络/房间状态，方便单独测试。

const SUITS = ['♠', '♥', '♣', '♦'];
// 用于生成顺子/连对的顺序（不含2和王，掼蛋顺子固定为 3~A）
const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// 打级顺序：从2打到A算一轮
const LEVEL_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 普通点数序（不考虑万能牌加成），2 比 A 大，王最大
const PLAIN_RANK_VALUE = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, '小王': 16, '大王': 17,
};

// 炸弹体系强弱：4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < 8炸 < …（张数越多越大）< 王炸
const TIER = { straightFlush: 102, jokerBomb: 999 };

// 炸弹按张数定强弱，不写死上限：两副牌8张同点数再加万能牌能凑到10张，
// 三副牌更多，写死上限会导致手里一大把同点数的牌反而打不出去。
function bombTier(len) {
    return len < 6 ? 96 + len : 97 + len; // 4→100, 5→101, (同花顺102), 6→103, 7→104 …
}

// decks = 用几副牌。1副54张、2副108张、3副162张，都能被3整除，正好平分
function createDeck(decks = 2) {
    const deck = [];
    for (let d = 0; d < decks; d++) {
        for (const suit of SUITS) {
            for (const rank of RANK_ORDER.concat(['2'])) {
                deck.push({ suit, rank });
            }
        }
        deck.push({ suit: '🃏', rank: '小王' });
        deck.push({ suit: '🃏', rank: '大王' });
    }
    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

const ALL_RANKS = RANK_ORDER.concat(['2', '小王', '大王']);
const SUIT_SET = new Set(SUITS);

// 出牌数据是客户端发来的，必须确认花色和点数真的存在。
// 否则可以把 {suit:'', rank:'♠3'} 这种拼出来的"牌"混进去：
// cardKey 拼回来正好等于真牌，能通过手牌核销，但点数算出来是 undefined，
// 结果谁也压不过它。
function isValidCard(card) {
    if (!card || typeof card.suit !== 'string' || typeof card.rank !== 'string') return false;
    if (card.rank === '小王' || card.rank === '大王') return card.suit === '🃏';
    return SUIT_SET.has(card.suit) && ALL_RANKS.includes(card.rank) && card.rank !== '小王' && card.rank !== '大王';
}

function isWildCard(card, level) {
    return card.suit === '♥' && card.rank === level;
}

// 掼蛋大小序：3..A < 2 < 级牌(任意花色) < 小王 < 大王
// 级牌在顺子/连对里仍按本来的点数用（比如打7时，5-6-7-8-9 仍是普通顺子），
// 所以只有单张/对子/三张/炸弹等"比点数"的场合才用这个提升后的值。
function levelAwareRank(rank, level) {
    if (rank === '小王') return 17;
    if (rank === '大王') return 18;
    if (rank === level) return 16;
    return PLAIN_RANK_VALUE[rank];
}

function singleCardRank(card, level) {
    return levelAwareRank(card.rank, level);
}

function analyzeCards(cards, level) {
    let wildCount = 0;
    const rankCount = new Map();
    for (const c of cards) {
        if (isWildCard(c, level)) {
            wildCount++;
        } else {
            rankCount.set(c.rank, (rankCount.get(c.rank) || 0) + 1);
        }
    }
    return { wildCount, rankCount };
}

// 以下检测函数都返回"所有可能的解读"数组，而不是碰到第一个就返回。
// 因为万能牌可以当任意牌，同一手牌往往有多种读法（比如 4-5-6-7-万 既能当
// 3~7 也能当 4~8），只取第一个会把牌读小，导致明明压得过却被判压不过。

function isJokerRank(rank) {
    return rank === '小王' || rank === '大王';
}

// N 张同点数（可用万能牌补齐），用于对子/三张/炸弹
function detectNOfKind(cards, level, n) {
    if (cards.length !== n) return [];
    const { wildCount, rankCount } = analyzeCards(cards, level);
    const distinctRanks = [...rankCount.keys()];
    if (distinctRanks.length > 1) return [];

    if (distinctRanks.length === 0) {
        // 全是万能牌：可以当任意点数，取最大的级牌
        return wildCount === n ? [{ rank: levelAwareRank(level, level) }] : [];
    }
    const rank = distinctRanks[0];
    // 万能牌不能当王
    if (isJokerRank(rank) && wildCount > 0) return [];
    if ((rankCount.get(rank) || 0) + wildCount !== n) return [];
    return [{ rank: levelAwareRank(rank, level) }];
}

// 判断剩下的牌能不能凑成"带"的那一对
function attachmentIsPair(naturalRanks, wildsLeft) {
    if (naturalRanks.length + wildsLeft !== 2) return false;
    if (naturalRanks.length === 2) return naturalRanks[0] === naturalRanks[1];
    // 一张真牌 + 一张万能牌：万能牌不能当王
    if (naturalRanks.length === 1) return !isJokerRank(naturalRanks[0]);
    return true; // 两张万能牌，当任意一对
}

// 三带一 / 三带二
function detectTripleAttached(cards, level, attachLen) {
    if (cards.length !== 3 + attachLen) return [];
    const { wildCount, rankCount } = analyzeCards(cards, level);
    const results = [];
    const candidates = new Set(rankCount.keys());
    if (wildCount >= 3) candidates.add(level); // 三张全用万能牌凑

    for (const R of candidates) {
        const haveR = rankCount.get(R) || 0;
        const usedNatural = Math.min(haveR, 3);
        const usedWild = 3 - usedNatural;
        if (usedWild < 0 || usedWild > wildCount) continue;
        // 万能牌不能冒充王，所以王的三张必须是货真价实的三张王（不存在）
        if (isJokerRank(R) && usedWild > 0) continue;

        const remainingWild = wildCount - usedWild;
        const leftover = [];
        for (const [rk, cnt] of rankCount.entries()) {
            const used = rk === R ? usedNatural : 0;
            for (let i = 0; i < cnt - used; i++) leftover.push(rk);
        }

        // 带的牌如果和三张同点数，那实际上是四张/五张，应该按炸弹算，不是三带
        if (leftover.some(rk => rk === R)) continue;

        if (attachLen === 1) {
            if (leftover.length + remainingWild !== 1) continue;
        } else if (!attachmentIsPair(leftover, remainingWild)) {
            continue;
        }
        results.push({ rank: levelAwareRank(R, level) });
    }
    return results;
}

// 顺子：5张及以上连续单张（3~A之间，不含2和王），可用万能牌补空缺
function detectStraight(cards, level, minLen = 5) {
    const len = cards.length;
    if (len < minLen) return [];
    const { wildCount, rankCount } = analyzeCards(cards, level);
    for (const [rk, cnt] of rankCount) {
        if (cnt > 1) return [];
        if (isJokerRank(rk)) return [];
    }
    const distinctRanks = [...rankCount.keys()];
    if (distinctRanks.length + wildCount !== len) return [];

    const results = [];
    for (let start = 0; start + len <= RANK_ORDER.length; start++) {
        const window = RANK_ORDER.slice(start, start + len);
        const windowSet = new Set(window);
        if (!distinctRanks.every(r => windowSet.has(r))) continue;
        results.push({ rank: PLAIN_RANK_VALUE[window[0]] });
    }
    return results;
}

// 连对（木板）：3对及以上连续对子，可用万能牌补空缺
function detectPairStraight(cards, level, minPairs = 3) {
    const len = cards.length;
    if (len % 2 !== 0) return [];
    const numPairs = len / 2;
    if (numPairs < minPairs) return [];

    const { wildCount, rankCount } = analyzeCards(cards, level);
    for (const [rk, cnt] of rankCount) {
        if (cnt > 2) return [];
        if (isJokerRank(rk)) return [];
    }
    const distinctRanks = [...rankCount.keys()];

    const results = [];
    for (let start = 0; start + numPairs <= RANK_ORDER.length; start++) {
        const window = RANK_ORDER.slice(start, start + numPairs);
        const windowSet = new Set(window);
        if (!distinctRanks.every(r => windowSet.has(r))) continue;
        let neededWild = 0;
        for (const rk of window) neededWild += 2 - (rankCount.get(rk) || 0);
        if (neededWild !== wildCount) continue;
        results.push({ rank: PLAIN_RANK_VALUE[window[0]] });
    }
    return results;
}

function detectStraightFlush(cards, level) {
    if (cards.length !== 5) return [];
    const straights = detectStraight(cards, level, 5);
    if (!straights.length) return [];
    const normalSuits = new Set(cards.filter(c => !isWildCard(c, level)).map(c => c.suit));
    if (normalSuits.size !== 1) return [];
    return straights;
}

// 王炸 = 场上全部的王。用几副牌就有几张大王、几张小王，
// 所以2副牌是四王炸(2大2小)，1副牌是双王炸(1大1小)，3副牌是六王炸。
function detectJokerBomb(cards, decks) {
    if (cards.length !== decks * 2) return null;
    const small = cards.filter(c => c.rank === '小王').length;
    const big = cards.filter(c => c.rank === '大王').length;
    if (small === decks && big === decks) return { rank: 9999 };
    return null;
}

// 列出这手牌所有合法的解读
function detectCombos(cards, level, decks = 2) {
    const out = [];
    if (!cards || cards.length === 0) return out;
    const len = cards.length;
    const add = (shapeType, tier, list) => {
        for (const r of list) out.push({ shapeType, length: len, rank: r.rank, tier });
    };

    if (len === 1) {
        out.push({ shapeType: 'single', length: 1, rank: singleCardRank(cards[0], level), tier: 0 });
        return out;
    }

    const jokerBomb = detectJokerBomb(cards, decks);
    if (jokerBomb) out.push({ shapeType: 'joker_bomb', length: len, rank: jokerBomb.rank, tier: TIER.jokerBomb });

    if (len === 2) add('pair', 0, detectNOfKind(cards, level, 2));
    if (len === 3) add('triple', 0, detectNOfKind(cards, level, 3));
    if (len >= 4) add('bomb', bombTier(len), detectNOfKind(cards, level, len));
    if (len === 4) add('triple_single', 0, detectTripleAttached(cards, level, 1));
    if (len === 5) {
        add('triple_pair', 0, detectTripleAttached(cards, level, 2));
        add('straight_flush', TIER.straightFlush, detectStraightFlush(cards, level));
    }
    if (len >= 5) add('straight', 0, detectStraight(cards, level, 5));
    if (len >= 6 && len % 2 === 0) add('pair_straight', 0, detectPairStraight(cards, level, 3));

    return out;
}

function betterCombo(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.tier !== b.tier) return a.tier > b.tier ? a : b;
    return a.rank >= b.rank ? a : b;
}

// 返回最有利的那种解读（牌型等级最高、点数最大），无解则 null
function detectCombo(cards, level, decks = 2) {
    const all = detectCombos(cards, level, decks);
    let best = null;
    for (const c of all) best = betterCombo(best, c);
    return best;
}

// 在所有解读里找一种能压过 lastCombo 的（同样取最有利的），没有则 null
function findBeatingCombo(cards, level, lastCombo, decks = 2) {
    const all = detectCombos(cards, level, decks);
    let best = null;
    for (const c of all) {
        if (canBeat(c, lastCombo)) best = betterCombo(best, c);
    }
    return best;
}

function canBeat(newCombo, lastCombo) {
    if (!lastCombo) return true;
    if (newCombo.tier > 0) {
        if (lastCombo.tier === 0) return true;
        if (newCombo.tier !== lastCombo.tier) return newCombo.tier > lastCombo.tier;
        return newCombo.rank > lastCombo.rank;
    }
    if (lastCombo.tier > 0) return false;
    return newCombo.shapeType === lastCombo.shapeType &&
        newCombo.length === lastCombo.length &&
        newCombo.rank > lastCombo.rank;
}

// 提示功能：按上家牌型有针对性地找一手能压过的牌。
// 不能盲目枚举组合——36张牌的全子集会卡死浏览器，所以按牌型定向搜索。
function suggestPlay(cards, level, last, decks = 2) {
    const tryCombo = (subset) => {
        if (!subset || subset.some(x => !x)) return null;
        return findBeatingCombo(subset, level, last, decks) ? subset : null;
    };

    // 按点数分组（万能牌单独放，作百搭用）
    const groups = new Map();
    const wilds = [];
    for (const card of cards) {
        if (isWildCard(card, level)) { wilds.push(card); continue; }
        if (!groups.has(card.rank)) groups.set(card.rank, []);
        groups.get(card.rank).push(card);
    }
    const RANKS = RANK_ORDER;

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
            for (let useWild = 0; useWild <= Math.min(wilds.length, need); useWild++) {
                if (g.length + useWild < need) continue;
                const r = tryCombo([...g.slice(0, need - useWild), ...wilds.slice(0, useWild)]);
                if (r) return r;
            }
        }
        // 纯万能牌凑的对子/三张（比如打7时两张♥7当一对级牌，最大的对子）
        if (wilds.length >= need) {
            const r = tryCombo(wilds.slice(0, need));
            if (r) return r;
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

    // 同花顺（5张同花色顺子）也算炸弹体系，之前完全漏掉了
    const bySuit = new Map();
    for (const card of cards) {
        if (isWildCard(card, level)) continue;
        if (card.rank === '小王' || card.rank === '大王') continue;
        if (!bySuit.has(card.suit)) bySuit.set(card.suit, new Map());
        const m = bySuit.get(card.suit);
        if (!m.has(card.rank)) m.set(card.rank, card);
    }
    for (const [, byRankOfSuit] of bySuit) {
        for (let start = 0; start + 5 <= RANKS.length; start++) {
            const window = RANKS.slice(start, start + 5);
            const picked = [];
            let need = 0;
            for (const rank of window) {
                const card = byRankOfSuit.get(rank);
                if (card) picked.push(card); else need++;
            }
            if (need > wilds.length) continue;
            const r = tryCombo([...picked, ...wilds.slice(0, need)]);
            if (r) return r;
        }
    }

    // 都不行就找炸弹（从小到大，别浪费大炸）
    const bombCandidates = [];
    for (const g of groups.values()) {
        for (let useWild = 0; useWild <= wilds.length; useWild++) {
            const size = g.length + useWild; // 炸弹不再限8张，这里以前卡着上限，9张以上的炸弹永远提示不出来
            if (size < 4) continue;
            bombCandidates.push([...g.slice(0, size - useWild), ...wilds.slice(0, useWild)]);
        }
    }
    bombCandidates.sort((a, b) => a.length - b.length);
    for (const cand of bombCandidates) {
        const r = tryCombo(cand);
        if (r) return r;
    }

    // 王炸（张数随副数变化：1副=2张，2副=4张，3副=6张）
    const jokers = cards.filter(card => card.rank === '小王' || card.rank === '大王');
    if (jokers.length >= decks * 2) {
        const r = tryCombo(jokers.slice(0, decks * 2));
        if (r) return r;
    }
    return null;
}

const SHAPE_NAMES = {
    single: '单张', pair: '对子', triple: '三张', triple_single: '三带一', triple_pair: '三带二',
    straight: '顺子', pair_straight: '连对', bomb: '炸弹', straight_flush: '同花顺', joker_bomb: '王炸',
};

// 王炸的叫法跟副数走
function shapeLabel(shapeType, decks = 2) {
    if (shapeType === 'joker_bomb') return `${['', '双', '四', '六'][decks] || ''}王炸`;
    return SHAPE_NAMES[shapeType] || shapeType;
}

const CardLogic = {
    SUITS, RANK_ORDER, LEVEL_ORDER, PLAIN_RANK_VALUE, TIER, SHAPE_NAMES,
    createDeck, shuffle, isWildCard, isValidCard, shapeLabel, singleCardRank, levelAwareRank,
    detectCombo, detectCombos, findBeatingCombo, suggestPlay, canBeat,
};

// 同时支持 Node (服务器) 和浏览器 (前端) 引入
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CardLogic;
} else {
    globalThis.CardLogic = CardLogic;
}
