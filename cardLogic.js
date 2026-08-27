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

// 炸弹体系强弱：4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < 8炸 < 四王炸
const TIER = {
    bomb4: 100, bomb5: 101, straightFlush: 102, bomb6: 103, bomb7: 104, bomb8: 105,
    jokerBomb: 999,
};

function createDoubleDeck() {
    const deck = [];
    for (let d = 0; d < 2; d++) {
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

// N 张同点数（可用万能牌补齐），用于对子/三张/炸弹
function detectNOfKind(cards, level, n) {
    if (cards.length !== n) return null;
    const { wildCount, rankCount } = analyzeCards(cards, level);
    const distinctRanks = [...rankCount.keys()];
    if (distinctRanks.length > 1) return null;
    const rank = distinctRanks.length === 1 ? distinctRanks[0] : level;
    if ((rank === '小王' || rank === '大王') && wildCount > 0) return null;
    const have = rankCount.get(rank) || 0;
    if (have + wildCount !== n) return null;
    return { rank };
}

// 三带一 / 三带二
function detectTripleAttached(cards, level, attachLen) {
    if (cards.length !== 3 + attachLen) return null;
    const { wildCount, rankCount } = analyzeCards(cards, level);
    for (const R of rankCount.keys()) {
        const haveR = rankCount.get(R);
        if (haveR > 3) continue;
        const usedWild = 3 - haveR;
        if (usedWild < 0 || usedWild > wildCount) continue;
        const remainingWild = wildCount - usedWild;
        if (R === level && remainingWild > 0) continue;

        const attachPoolRanks = [];
        for (const [rk, cnt] of rankCount.entries()) {
            if (rk === R) continue;
            for (let i = 0; i < cnt; i++) attachPoolRanks.push(rk);
        }
        for (let i = 0; i < remainingWild; i++) attachPoolRanks.push(level);

        if (attachPoolRanks.length !== attachLen) continue;
        if (attachLen === 2 && attachPoolRanks[0] !== attachPoolRanks[1]) continue;
        return { rank: R };
    }
    return null;
}

// 顺子：5张及以上连续单张（3~A之间，不含2和王），可用万能牌补空缺
function detectStraight(cards, level, minLen = 5) {
    const len = cards.length;
    if (len < minLen) return null;
    const { wildCount, rankCount } = analyzeCards(cards, level);
    for (const [rk, cnt] of rankCount) {
        if (cnt > 1) return null;
        if (rk === '小王' || rk === '大王') return null;
    }
    const distinctRanks = [...rankCount.keys()];
    if (distinctRanks.length + wildCount !== len) return null;

    for (let start = 0; start + len <= RANK_ORDER.length; start++) {
        const window = RANK_ORDER.slice(start, start + len);
        const windowSet = new Set(window);
        if (!distinctRanks.every(r => windowSet.has(r))) continue;
        return { rank: PLAIN_RANK_VALUE[window[0]] };
    }
    return null;
}

// 连对（木板）：3对及以上连续对子，可用万能牌补空缺
function detectPairStraight(cards, level, minPairs = 3) {
    const len = cards.length;
    if (len % 2 !== 0) return null;
    const numPairs = len / 2;
    if (numPairs < minPairs) return null;

    const { wildCount, rankCount } = analyzeCards(cards, level);
    for (const [rk, cnt] of rankCount) {
        if (cnt > 2) return null;
        if (rk === '小王' || rk === '大王') return null;
    }
    const distinctRanks = [...rankCount.keys()];

    for (let start = 0; start + numPairs <= RANK_ORDER.length; start++) {
        const window = RANK_ORDER.slice(start, start + numPairs);
        const windowSet = new Set(window);
        if (!distinctRanks.every(r => windowSet.has(r))) continue;
        let neededWild = 0;
        for (const rk of window) neededWild += 2 - (rankCount.get(rk) || 0);
        if (neededWild !== wildCount) continue;
        return { rank: PLAIN_RANK_VALUE[window[0]] };
    }
    return null;
}

function detectStraightFlush(cards, level) {
    if (cards.length !== 5) return null;
    const straight = detectStraight(cards, level, 5);
    if (!straight) return null;
    const normalSuits = new Set(cards.filter(c => !isWildCard(c, level)).map(c => c.suit));
    if (normalSuits.size !== 1) return null;
    return straight;
}

function detectJokerBomb(cards) {
    if (cards.length !== 4) return null;
    const small = cards.filter(c => c.rank === '小王').length;
    const big = cards.filter(c => c.rank === '大王').length;
    if (small === 2 && big === 2) return { rank: 9999 };
    return null;
}

const BOMB_TIER_BY_LEN = { 4: TIER.bomb4, 5: TIER.bomb5, 6: TIER.bomb6, 7: TIER.bomb7, 8: TIER.bomb8 };

// 返回 { shapeType, length, rank, tier } 或 null（非法牌型）
function detectCombo(cards, level) {
    if (!cards || cards.length === 0) return null;
    const len = cards.length;

    if (len === 1) {
        return { shapeType: 'single', length: 1, rank: singleCardRank(cards[0], level), tier: 0 };
    }

    const jokerBomb = detectJokerBomb(cards);
    if (jokerBomb) return { shapeType: 'joker_bomb', length: 4, rank: jokerBomb.rank, tier: TIER.jokerBomb };

    if (len === 2) {
        const pair = detectNOfKind(cards, level, 2);
        if (pair) return { shapeType: 'pair', length: 2, rank: levelAwareRank(pair.rank, level), tier: 0 };
        return null;
    }

    if (len === 3) {
        const triple = detectNOfKind(cards, level, 3);
        if (triple) return { shapeType: 'triple', length: 3, rank: levelAwareRank(triple.rank, level), tier: 0 };
        return null;
    }

    if (len >= 4 && len <= 8) {
        const bomb = detectNOfKind(cards, level, len);
        if (bomb && bomb.rank !== '小王' && bomb.rank !== '大王') {
            return { shapeType: 'bomb', length: len, rank: levelAwareRank(bomb.rank, level), tier: BOMB_TIER_BY_LEN[len] };
        }
    }

    if (len === 4) {
        const tripleSingle = detectTripleAttached(cards, level, 1);
        if (tripleSingle) return { shapeType: 'triple_single', length: 4, rank: levelAwareRank(tripleSingle.rank, level), tier: 0 };
        return null;
    }

    if (len === 5) {
        const triplePair = detectTripleAttached(cards, level, 2);
        if (triplePair) return { shapeType: 'triple_pair', length: 5, rank: levelAwareRank(triplePair.rank, level), tier: 0 };
        const straightFlush = detectStraightFlush(cards, level);
        if (straightFlush) return { shapeType: 'straight_flush', length: 5, rank: straightFlush.rank, tier: TIER.straightFlush };
        const straight = detectStraight(cards, level, 5);
        if (straight) return { shapeType: 'straight', length: 5, rank: straight.rank, tier: 0 };
        return null;
    }

    // len >= 6
    if (len % 2 === 0) {
        const pairStraight = detectPairStraight(cards, level, 3);
        if (pairStraight) return { shapeType: 'pair_straight', length: len, rank: pairStraight.rank, tier: 0 };
    }
    const straight = detectStraight(cards, level, 5);
    if (straight) return { shapeType: 'straight', length: len, rank: straight.rank, tier: 0 };

    return null;
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

const SHAPE_NAMES = {
    single: '单张', pair: '对子', triple: '三张', triple_single: '三带一', triple_pair: '三带二',
    straight: '顺子', pair_straight: '连对', bomb: '炸弹', straight_flush: '同花顺', joker_bomb: '四王炸',
};

const CardLogic = {
    SUITS, RANK_ORDER, LEVEL_ORDER, PLAIN_RANK_VALUE, TIER, SHAPE_NAMES,
    createDoubleDeck, shuffle, isWildCard, singleCardRank, levelAwareRank,
    detectCombo, canBeat,
};

// 同时支持 Node (服务器) 和浏览器 (前端) 引入
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CardLogic;
} else {
    globalThis.CardLogic = CardLogic;
}
