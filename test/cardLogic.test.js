const assert = require('assert');
const { detectCombo, canBeat, createDoubleDeck, SHAPE_NAMES } = require('../cardLogic');

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

console.log(`\n${'='.repeat(40)}`);
console.log(`通过: ${passed}  失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
