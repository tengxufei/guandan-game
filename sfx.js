// 音效：全部用 Web Audio 现场合成，不加载任何音频文件。
// 这样局域网离线也能用，也不用等资源加载。
(function () {
'use strict';

let ctx = null;
let muted = false;

try {
    muted = localStorage.getItem('guandan-muted') === '1';
} catch (e) { /* 隐私模式下 localStorage 会抛错，忽略即可 */ }

// 浏览器要求必须由用户操作触发才能出声，所以第一次点击时才创建
function ensureCtx() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

function tone({ freq, dur = 0.12, type = 'sine', gain = 0.18, delay = 0, slideTo = null }) {
    const ac = ensureCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    // 快起慢落的包络，听着像"叮"而不是"滴——"
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

// 白噪声，用来做纸牌摩擦声和炸弹
function noise({ dur = 0.12, gain = 0.12, delay = 0, filterFreq = 2000, filterType = 'bandpass' }) {
    const ac = ensureCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const frames = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(t0);
}

const SOUNDS = {
    // 出牌：纸牌甩到桌上的摩擦声
    play() {
        noise({ dur: 0.09, gain: 0.16, filterFreq: 1800 });
        tone({ freq: 320, dur: 0.07, type: 'triangle', gain: 0.08 });
    },
    // 选牌/取消：很轻的一下
    tap() {
        tone({ freq: 660, dur: 0.04, type: 'sine', gain: 0.05 });
    },
    // 不要：闷闷的低音
    pass() {
        tone({ freq: 220, dur: 0.13, type: 'sine', gain: 0.1, slideTo: 165 });
    },
    // 轮到你了：上行两声，最显眼的提示音
    turn() {
        tone({ freq: 784, dur: 0.13, type: 'triangle', gain: 0.2 });
        tone({ freq: 1175, dur: 0.22, type: 'triangle', gain: 0.18, delay: 0.11 });
    },
    // 炸弹：低频轰 + 噪声
    bomb() {
        tone({ freq: 150, dur: 0.45, type: 'sawtooth', gain: 0.22, slideTo: 45 });
        noise({ dur: 0.35, gain: 0.25, filterFreq: 900, filterType: 'lowpass' });
        noise({ dur: 0.2, gain: 0.12, filterFreq: 4000, delay: 0.02 });
    },
    // 发牌：连续几下纸牌声
    deal() {
        for (let i = 0; i < 6; i++) {
            noise({ dur: 0.05, gain: 0.09, filterFreq: 2400, delay: i * 0.07 });
        }
    },
    // 有人出完牌
    finish() {
        [523, 659, 784].forEach((f, i) =>
            tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.16, delay: i * 0.09 }));
    },
    // 本局结束，赢了
    win() {
        [523, 659, 784, 1047].forEach((f, i) =>
            tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.2, delay: i * 0.12 }));
    },
    // 本局结束，没赢
    lose() {
        [440, 392, 330].forEach((f, i) =>
            tone({ freq: f, dur: 0.25, type: 'sine', gain: 0.14, delay: i * 0.13 }));
    },
    // 出错/不能出
    error() {
        tone({ freq: 180, dur: 0.16, type: 'square', gain: 0.09 });
    },
    // 有人加入房间
    join() {
        tone({ freq: 587, dur: 0.1, type: 'sine', gain: 0.12 });
        tone({ freq: 880, dur: 0.14, type: 'sine', gain: 0.12, delay: 0.09 });
    },
};

const Sfx = {
    play(name) {
        if (muted) return;
        const fn = SOUNDS[name];
        if (!fn) return;
        try { fn(); } catch (e) { /* 音频出问题不该影响游戏 */ }
    },
    isMuted() { return muted; },
    toggleMute() {
        muted = !muted;
        try { localStorage.setItem('guandan-muted', muted ? '1' : '0'); } catch (e) {}
        if (!muted) Sfx.play('tap');
        return muted;
    },
    // 用户第一次点击时叫一下，把 AudioContext 解锁
    unlock() { ensureCtx(); },
};

globalThis.Sfx = Sfx;
})();
