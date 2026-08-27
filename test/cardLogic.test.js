const assert = require('assert');
const { detectCombo, detectCombos, findBeatingCombo, suggestPlay,
    canBeat, createDoubleDeck, SHAPE_NAMES } = require('../cardLogic');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.log(`  ✗ ${name}`);
        console.log(`      ${err.message}`);
    }
}

function group(name, fn) {
    console.log(`\n${name}`);
    fn();
}

// 简写工具: c('♠3') -> {suit:'♠', rank:'3'}
// 注意用 Array.from 取首字符，🃏 是代理对，不能用 str[0]
function c(str) {
    const chars = Array.from(str);
    return { suit: chars[0], rank: chars.slice(1).join('') };
}
function hand(...strs) {
    return strs.map(c);
}
function shape(cards, level) {
    const combo = detectCombo(cards, level);
    return combo ? combo.shapeType : null;
}

const LV = '2'; // 多数用例以打2为例，红桃2为万能牌

group('牌型识别 - 基本牌型', () => {
    test('单张', () => assert.strictEqual(shape(hand('♠5'), LV), 'single'));
    test('对子', () => assert.strictEqual(shape(hand('♠5', '♥5'), LV), 'pair'));
    test('三张', () => assert.strictEqual(shape(hand('♠5', '♥5', '♣5'), LV), 'triple'));
    test('三带一', () => assert.strictEqual(shape(hand('♠5', '♥5', '♣5', '♦9'), LV), 'triple_single'));
    test('三带二', () => assert.strictEqual(shape(hand('♠5', '♥5', '♣5', '♦9', '♠9'), LV), 'triple_pair'));
    test('顺子5张', () => assert.strictEqual(shape(hand('♠3', '♥4', '♣5', '♦6', '♠7'), LV), 'straight'));
    test('顺子含A作为最大牌 (10-J-Q-K-A)', () =>
        assert.strictEqual(shape(hand('♠10', '♥J', '♣Q', '♦K', '♠A'), LV), 'straight'));
    test('连对3对', () => assert.strictEqual(shape(hand('♠5', '♥5', '♣6', '♦6', '♠7', '♥7'), LV), 'pair_straight'));
    test('四张炸弹', () => assert.strictEqual(shape(hand('♠5', '♥5', '♣5', '♦5'), LV), 'bomb'));
    test('五张炸弹', () => assert.strictEqual(shape(hand('♠5', '♥5', '♣5', '♦5', '♠5'), LV), 'bomb'));
    test('同花顺', () => assert.strictEqual(shape(hand('♠3', '♠4', '♠5', '♠6', '♠7'), LV), 'straight_flush'));
    test('四王炸', () => assert.strictEqual(shape(hand('🃏小王', '🃏小王', '🃏大王', '🃏大王'), LV), 'joker_bomb'));
});

group('牌型识别 - 非法牌型', () => {
    test('两张不同点数不是对子', () => assert.strictEqual(shape(hand('♠5', '♥6'), LV), null));
    test('顺子不能跨2 (J-Q-K-A-2)', () =>
        assert.strictEqual(shape(hand('♠J', '♥Q', '♣K', '♦A', '♠2'), LV), null));
    test('顺子不能含王', () =>
        assert.strictEqual(shape(hand('♠10', '♥J', '♣Q', '♦K', '🃏小王'), LV), null));
    test('不连续的5张牌无效', () =>
        assert.strictEqual(shape(hand('♠3', '♥4', '♣5', '♦6', '♠8'), LV), null));
    test('连对必须连续', () =>
        assert.strictEqual(shape(hand('♠5', '♥5', '♣6', '♦6', '♠8', '♥8'), LV), null));
    test('两对不构成连对(至少3对)', () =>
        assert.strictEqual(shape(hand('♠5', '♥5', '♣6', '♦6'), LV), null));
    test('大小王不能组成普通对子外的炸弹(3张王无效)', () =>
        assert.strictEqual(shape(hand('🃏大王', '🃏大王', '🃏小王'), LV), null));
});

group('级牌/万能牌 (红桃级牌)', () => {
    test('红桃2(级牌)可当任意牌凑对子', () =>
        assert.strictEqual(shape(hand('♠5', '♥2'), LV), 'pair'));
    test('红桃2可凑三张', () =>
        assert.strictEqual(shape(hand('♠5', '♣5', '♥2'), LV), 'triple'));
    test('红桃2可凑炸弹', () =>
        assert.strictEqual(shape(hand('♠5', '♣5', '♦5', '♥2'), LV), 'bomb'));
    test('红桃2可补顺子空缺', () =>
        assert.strictEqual(shape(hand('♠3', '♥2', '♣5', '♦6', '♠7'), LV), 'straight'));
    test('红桃2可补连对空缺', () =>
        assert.strictEqual(shape(hand('♠5', '♥2', '♣6', '♦6', '♠7', '♥7'), LV), 'pair_straight'));
    test('两张红桃2可凑炸弹', () =>
        assert.strictEqual(shape(hand('♠5', '♣5', '♥2', '♥2'), LV), 'bomb'));
    test('打2时红桃2与黑桃2同为级牌，大小相同且小过小王', () => {
        const wild = detectCombo(hand('♥2'), LV);
        const two = detectCombo(hand('♠2'), LV);
        const smallJoker = detectCombo(hand('🃏小王'), LV);
        assert.strictEqual(wild.rank, two.rank, '同为级牌应大小相同');
        assert.ok(wild.rank < smallJoker.rank, '级牌应小于小王');
    });
    test('打7时红桃7(万能牌)单出等同级牌大小', () => {
        const wild = detectCombo(hand('♥7'), '7');
        const two = detectCombo(hand('♠2'), '7');
        assert.ok(wild.rank > two.rank, '级牌应大于2');
    });
    test('非红桃的级牌不是万能牌', () =>
        assert.strictEqual(shape(hand('♠5', '♠2'), LV), null));
    test('打不同级时万能牌随之改变(打7时红桃7万能)', () =>
        assert.strictEqual(shape(hand('♠5', '♥7'), '7'), 'pair'));
    test('打7时红桃2不再是万能牌', () =>
        assert.strictEqual(shape(hand('♠5', '♥2'), '7'), null));
    test('万能牌不能凑王的对子', () =>
        assert.strictEqual(shape(hand('🃏大王', '♥2'), LV), null));
});

group('级牌大小提升 (级牌大过A和2，小过王)', () => {
    const beats = (a, b, level) => canBeat(detectCombo(a, level), detectCombo(b, level));

    test('打7时，单张7大过单张2', () => assert.ok(beats(hand('♠7'), hand('♠2'), '7')));
    test('打7时，单张7大过单张A', () => assert.ok(beats(hand('♠7'), hand('♠A'), '7')));
    test('打7时，单张7小过小王', () => assert.ok(!beats(hand('♠7'), hand('🃏小王'), '7')));
    test('打7时，黑桃7(非万能)也享受级牌大小', () =>
        assert.ok(beats(hand('♠7'), hand('♠2'), '7')));
    test('打7时，一对7大过一对A', () =>
        assert.ok(beats(hand('♠7', '♣7'), hand('♠A', '♣A'), '7')));
    test('打7时，四个7的炸弹大过四个A的炸弹', () =>
        assert.ok(beats(hand('♠7', '♣7', '♦7', '♥7'), hand('♠A', '♣A', '♦A', '♥A'), '7')));
    test('打7时，5-6-7-8-9顺子里的7仍按普通点数算(不影响顺子构成)', () =>
        assert.strictEqual(shape(hand('♠5', '♣6', '♠7', '♦8', '♠9'), '7'), 'straight'));
    test('打3时，单张3大过单张2(级牌提升)', () =>
        assert.ok(beats(hand('♠3'), hand('♠2'), '3')));
});

group('比牌 - 同类型比大小', () => {
    const beats = (a, b, level = LV) => canBeat(detectCombo(a, level), detectCombo(b, level));

    test('大单张压小单张', () => assert.ok(beats(hand('♠9'), hand('♠5'))));
    test('小单张压不过大单张', () => assert.ok(!beats(hand('♠5'), hand('♠9'))));
    test('2比A大', () => assert.ok(beats(hand('♠2'), hand('♠A'))));
    test('大王最大', () => assert.ok(beats(hand('🃏大王'), hand('🃏小王'))));
    test('大对子压小对子', () => assert.ok(beats(hand('♠9', '♣9'), hand('♠5', '♣5'))));
    test('对子压不过三张(类型不同)', () =>
        assert.ok(!beats(hand('♠A', '♣A'), hand('♠5', '♣5', '♦5'))));
    test('长顺子压不过短顺子(张数需相同)', () => {
        const six = hand('♠3', '♥4', '♣5', '♦6', '♠7', '♥8');
        const five = hand('♠9', '♥10', '♣J', '♦Q', '♠K');
        assert.ok(!beats(six, five));
    });
    test('同长度大顺子压小顺子', () => {
        const big = hand('♠9', '♥10', '♣J', '♦Q', '♠K');
        const small = hand('♠3', '♥4', '♣5', '♦6', '♠7');
        assert.ok(beats(big, small));
    });
});

group('比牌 - 炸弹体系', () => {
    const beats = (a, b, level = LV) => canBeat(detectCombo(a, level), detectCombo(b, level));

    test('炸弹压普通牌型', () =>
        assert.ok(beats(hand('♠5', '♥5', '♣5', '♦5'), hand('♠A', '♣A'))));
    test('普通牌型压不过炸弹', () =>
        assert.ok(!beats(hand('♠A', '♣A'), hand('♠5', '♥5', '♣5', '♦5'))));
    test('大炸弹压小炸弹(同为4张)', () =>
        assert.ok(beats(hand('♠9', '♥9', '♣9', '♦9'), hand('♠5', '♥5', '♣5', '♦5'))));
    test('5张炸弹压4张炸弹', () =>
        assert.ok(beats(hand('♠3', '♥3', '♣3', '♦3', '♠3'), hand('♠A', '♥A', '♣A', '♦A'))));
    test('同花顺压5张以下炸弹', () =>
        assert.ok(beats(hand('♠3', '♠4', '♠5', '♠6', '♠7'), hand('♠A', '♥A', '♣A', '♦A', '♠A'))));
    test('6张炸弹压同花顺', () =>
        assert.ok(beats(hand('♠3', '♥3', '♣3', '♦3', '♠3', '♥3'), hand('♠3', '♠4', '♠5', '♠6', '♠7'))));
    test('四王炸压一切', () => {
        const jokerBomb = hand('🃏小王', '🃏小王', '🃏大王', '🃏大王');
        assert.ok(beats(jokerBomb, hand('♠3', '♥3', '♣3', '♦3', '♠3', '♥3', '♣3', '♦3')));
        assert.ok(beats(jokerBomb, hand('♠3', '♠4', '♠5', '♠6', '♠7')));
    });
    test('任何炸弹压不过四王炸', () =>
        assert.ok(!beats(hand('♠3', '♥3', '♣3', '♦3', '♠3', '♥3'),
            hand('🃏小王', '🃏小王', '🃏大王', '🃏大王'))));
});

group('牌堆', () => {
    test('两副牌共108张', () => assert.strictEqual(createDoubleDeck().length, 108));
    test('每种普通牌各8张(2副x4花色)', () => {
        const deck = createDoubleDeck();
        const fives = deck.filter(card => card.rank === '5');
        assert.strictEqual(fives.length, 8);
    });
    test('大小王各2张', () => {
        const deck = createDoubleDeck();
        assert.strictEqual(deck.filter(card => card.rank === '大王').length, 2);
        assert.strictEqual(deck.filter(card => card.rank === '小王').length, 2);
    });
});


// ===== 以下为查出 bug 后补的回归测试 =====

group('万能牌不能冒充大小王', () => {
    test('大王大王+万能牌+散牌 不能算三带一（凑不出三张王）', () =>
        assert.strictEqual(shape(hand('🃏大王', '🃏大王', '♥6', '♠2'), '6'), null));
    test('单张王+两张万能牌+一对 不能算三带二', () =>
        assert.strictEqual(shape(hand('🃏大王', '♥4', '♥4', '♠A', '♥A'), '4'), null));
    test('三张王(带牌形式)与单独三张王判定一致，都无效', () => {
        assert.strictEqual(shape(hand('🃏大王', '🃏大王', '♥6'), '6'), null);
        assert.strictEqual(shape(hand('🃏大王', '🃏大王', '♥6', '♠2'), '6'), null);
    });
    test('小王小王当"带的一对"是合法的（真牌，没用万能牌冒充）', () => {
        const combo = detectCombo(hand('🃏小王', '🃏小王', '♥4', '♣4', '♥7'), '7');
        assert.ok(combo, '应该是有效牌型');
        assert.strictEqual(combo.shapeType, 'triple_pair');
        assert.strictEqual(combo.rank, 4, '应读作444带一对小王，而不是王的三张');
    });
});

group('万能牌在"带"的位置可以当任意牌', () => {
    test('打7: 999 + Q和万能牌 = 三带二', () => {
        const combo = detectCombo(hand('♠9', '♦9', '♣9', '♠Q', '♥7'), '7');
        assert.ok(combo, '不应被判为无效');
        assert.strictEqual(combo.shapeType, 'triple_pair');
        assert.strictEqual(combo.rank, 9);
    });
    test('打9: 222 + K和万能牌 = 三带二', () => {
        const combo = detectCombo(hand('♠2', '♥2', '♣2', '♥K', '♥9'), '9');
        assert.ok(combo);
        assert.strictEqual(combo.shapeType, 'triple_pair');
    });
    test('带的一对不能是"王+万能牌"', () =>
        assert.strictEqual(shape(hand('♠9', '♦9', '♣9', '🃏大王', '♥7'), '7'), null));
});

group('有歧义时取最有利的解读', () => {
    const beats = (mine, theirs, level) =>
        !!findBeatingCombo(mine, level, detectCombo(theirs, level));

    test('顺子: 4567+万能 读作4-8而不是3-7', () =>
        assert.strictEqual(detectCombo(hand('♠4', '♦5', '♣6', '♠7', '♥K'), 'K').rank, 4));
    test('顺子: 4567+万能 压得过 34567', () =>
        assert.ok(beats(hand('♠4', '♦5', '♣6', '♠7', '♥K'), hand('♦3', '♦4', '♦5', '♠6', '♣7'), 'K')));
    test('连对: 5566+两万能 压得过 445566', () =>
        assert.ok(beats(hand('♣5', '♥5', '♣6', '♥6', '♥2', '♥2'),
            hand('♠4', '♦4', '♠5', '♦5', '♠6', '♦6'), '2')));
    test('三带一: 6+9+两万能 读作999带6', () =>
        assert.strictEqual(detectCombo(hand('♠6', '♥9', '♥Q', '♥Q'), 'Q').rank, 9));
    test('三带二: 222(级牌)+99 读作级牌三张(rank16)', () =>
        assert.strictEqual(detectCombo(hand('♠2', '♣2', '♥2', '♥2', '♥9'), '2').rank, 16));
    test('同花顺: ♠10JQ+两万能 读作10-A', () => {
        const combo = detectCombo(hand('♠10', '♠J', '♠Q', '♥9', '♥9'), '9');
        assert.strictEqual(combo.shapeType, 'straight_flush');
        assert.strictEqual(combo.rank, 10);
    });
    test('同花顺压得过更小的同花顺', () =>
        assert.ok(beats(hand('♠10', '♠J', '♠Q', '♥9', '♥9'),
            hand('♦9', '♦10', '♦J', '♦Q', '♦K'), '9')));
});

group('detectCombos 列出多种解读', () => {
    test('4567+万能 至少有两种顺子读法', () => {
        const all = detectCombos(hand('♠4', '♦5', '♣6', '♠7', '♥K'), 'K')
            .filter(c => c.shapeType === 'straight');
        assert.ok(all.length >= 2, `只找到 ${all.length} 种读法`);
    });
    test('无效牌返回空数组', () =>
        assert.strictEqual(detectCombos(hand('♠3', '♦7', '♣J'), '2').length, 0));
});

group('findBeatingCombo', () => {
    test('压不过时返回 null', () =>
        assert.strictEqual(findBeatingCombo(hand('♠3'), '2', detectCombo(hand('♠9'), '2')), null));
    test('没有上家时随便出都行', () =>
        assert.ok(findBeatingCombo(hand('♠3'), '2', null)));
    test('炸弹能压普通牌型', () =>
        assert.ok(findBeatingCombo(hand('♠5', '♥5', '♣5', '♦5'), '2', detectCombo(hand('♠A', '♣A'), '2'))));
});


group('提示功能 (suggestPlay)', () => {
    const hintFor = (myHand, lastCards, level) =>
        suggestPlay(myHand, level, detectCombo(lastCards, level));

    test('能找到同花顺来压炸弹（曾经完全漏找）', () => {
        const got = hintFor(hand('♠3', '♠4', '♠5', '♠6', '♠7', '♦9', '♣J'),
            hand('♠8', '♥8', '♣8', '♦8'), '2');
        assert.ok(got, '应该找到同花顺');
        assert.strictEqual(detectCombo(got, '2').shapeType, 'straight_flush');
    });
    test('能找到同花顺来压更小的同花顺', () => {
        const got = hintFor(hand('♠9', '♠10', '♠J', '♠Q', '♠K', '♦3', '♣4'),
            hand('♦3', '♦4', '♦5', '♦6', '♦7'), '2');
        assert.ok(got);
    });
    test('两张万能牌可以当一对（曾经上限写成 need-1 导致找不到）', () => {
        const got = hintFor(hand('♥7', '♥7', '♠3', '♦4', '♣5'), hand('♠A', '♣A'), '7');
        assert.ok(got, '应该找到两张♥7当级牌对子');
        assert.strictEqual(got.length, 2);
    });
    test('真的没有能压过的牌时返回 null', () =>
        assert.strictEqual(hintFor(hand('♦3', '♦4', '♣6', '♠8'), hand('♣J'), 'J'), null));
    test('提示给出的牌一定是手里有的、且真的压得过', () => {
        const myHand = hand('♠9', '♦9', '♣9', '♠Q', '♥7', '♠3', '♣4');
        const last = detectCombo(hand('♠5', '♦5', '♣5', '♠8', '♦8'), '7');
        const got = suggestPlay(myHand, '7', last);
        assert.ok(got, '应该找到三带二');
        got.forEach(card => assert.ok(myHand.includes(card), '提示了手里没有的牌'));
        assert.ok(findBeatingCombo(got, '7', last), '提示的牌压不过上家');
    });
    test('没有上家时提示最小的单张', () => {
        const got = suggestPlay(hand('♠9', '♦3', '♣K'), '2', null);
        assert.strictEqual(got.length, 1);
        assert.strictEqual(got[0].rank, '3');
    });
});

console.log(`\n${'='.repeat(40)}`);
console.log(`通过: ${passed}  失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
