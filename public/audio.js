// audio.js - sound effects and café-style background music, all synthesized with the Web Audio API.
// Nothing is loaded from files, so there are no samples or recordings with a copyright.
"use strict";
window.AyoAudio = (() => {
    let ctx = null, master = null, sfxBus = null, musicBus = null, reverb = null, noiseBuf = null;
    let opts = { sound: true, volume: 0.7, music: true };

    function refresh() {
        if (window.AyoStore) {
            const s = AyoStore.getSettings();
            opts = { sound: s.sound, volume: s.volume, music: s.music };
        }
        if (!ctx) return;
        const t = ctx.currentTime;
        sfxBus.gain.setTargetAtTime(opts.sound ? opts.volume : 0, t, 0.05);
        musicBus.gain.setTargetAtTime(opts.music ? opts.volume * 0.42 : 0, t, 0.4);
        if (opts.music) startMusic(); else stopMusic();
    }

    // Created on the first sound, after the player has clicked something (browsers require that)
    function init() {
        if (ctx) {
            if (ctx.state === 'suspended') ctx.resume();
            return true;
        }
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { return false; }
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(comp);
        comp.connect(ctx.destination);

        sfxBus = ctx.createGain();
        musicBus = ctx.createGain();
        sfxBus.connect(master);
        musicBus.connect(master);

        // A soft room: decaying noise as the impulse response
        reverb = ctx.createConvolver();
        const len = Math.floor(ctx.sampleRate * 2.6);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        reverb.buffer = ir;
        const wet = ctx.createGain();
        wet.gain.value = 0.32;
        reverb.connect(wet);
        wet.connect(master);

        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const n = noiseBuf.getChannelData(0);
        for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;

        document.addEventListener('visibilitychange', () => {
            if (!ctx) return;
            if (document.hidden) ctx.suspend(); else ctx.resume();
        });
        refresh();
        return true;
    }

    // ---------- building blocks ----------
    // A note with a quick attack and an exponential fade. o: { type, dur, vol, at, attack, bus, wet, detune, lp }
    function note(freq, o) {
        const t = ctx.currentTime + (o.at || 0);
        const dur = o.dur || 0.3;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
        if (o.detune) osc.detune.value = o.detune;
        const attack = o.attack || 0.005;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
        let out = g;
        osc.connect(g);
        if (o.lp) {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = o.lp;
            g.connect(f);
            out = f;
        }
        out.connect(o.bus || sfxBus);
        if (o.wet) {
            const send = ctx.createGain();
            send.gain.value = o.wet;
            out.connect(send);
            send.connect(reverb);
        }
        osc.start(t);
        osc.stop(t + attack + dur + 0.05);
    }
    // Wooden mallet: a sine with a faint overtone that dies quickly
    function mallet(freq, at, vol, wet) {
        note(freq, { at, vol, dur: 0.45, wet });
        note(freq * 4, { at, vol: vol * 0.18, dur: 0.08 });
    }
    // Glassy bell for chimes and melody
    function bell(freq, at, vol, wet, bus) {
        note(freq, { at, vol, dur: 1.4, wet, bus });
        note(freq * 2.01, { at, vol: vol * 0.25, dur: 0.6, wet, bus });
    }
    // Filtered noise: card slides and swishes
    function swish(at, dur, vol, from, to, type, bus) {
        const t = ctx.currentTime + at;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = type || 'bandpass';
        f.Q.value = 0.9;
        f.frequency.setValueAtTime(from, t);
        f.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(bus || sfxBus);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    }

    // ---------- sound effects ----------
    const SFX = {
        click() { note(1350, { vol: 0.07, dur: 0.035 }); },
        deal() { swish(0, 0.06, 0.12, 3200, 1800); },
        card() {
            swish(0, 0.1, 0.22, 2600, 900);
            note(150, { vol: 0.2, dur: 0.09, slideTo: 90, at: 0.06 });
        },
        draw() {
            swish(0, 0.16, 0.16, 700, 3200, 'highpass');
            note(520, { vol: 0.05, dur: 0.1, at: 0.1 });
        },
        action() { mallet(523.25, 0, 0.22, 0.2); mallet(783.99, 0.09, 0.2, 0.25); },
        penalty() { mallet(392, 0, 0.2, 0.2); mallet(311.13, 0.14, 0.2, 0.25); },
        turn() { bell(783.99, 0, 0.09, 0.35); bell(1174.66, 0.11, 0.07, 0.35); },
        ayo() {
            [659.25, 830.61, 987.77].forEach((f, i) => mallet(f, i * 0.05, 0.18, 0.3));
            bell(1318.5, 0.16, 0.08, 0.4);
        },
        forgot() { note(240, { vol: 0.22, dur: 0.35, slideTo: 150, type: 'triangle', lp: 900 }); },
        win() {
            [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(f, i * 0.12, 0.12, 0.45));
            [261.63, 329.63, 392].forEach(f => note(f, { at: 0.6, vol: 0.07, dur: 1.6, attack: 0.08, wet: 0.4, type: 'triangle', lp: 1500 }));
        },
        lose() {
            [440, 392, 329.63, 261.63].forEach((f, i) => note(f, { at: i * 0.22, vol: 0.12, dur: 0.6, attack: 0.03, wet: 0.35, type: 'triangle', lp: 1200 }));
        }
    };
    function play(name) {
        if (!opts.sound || !SFX[name]) return;
        if (!init()) return;
        try { SFX[name](); } catch (e) { /* ignore */ }
    }

    // ---------- background music: two small generative café tracks ----------
    // 'game': light bossa / jazz café groove. 'menu': slower lounge with arpeggios.
    // Every bar is composed on the fly from a chord loop, so it never repeats exactly.
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];

    // Electric piano: a sine with a soft octave shimmer, through a warm filter
    function epiano(m, at, vol, dur) {
        const f = midi(m);
        note(f, { at, vol, dur, type: 'sine', lp: 2400, bus: musicBus, wet: 0.25 });
        note(f * 2, { at, vol: vol * 0.22, dur: dur * 0.35, type: 'triangle', lp: 3000, bus: musicBus });
    }
    function bass(m, at, vol, dur) {
        note(midi(m), { at, vol, dur, type: 'triangle', lp: 520, bus: musicBus, attack: 0.012 });
    }
    function vibes(m, at, vol) {
        note(midi(m), { at, vol, dur: 0.9, bus: musicBus, wet: 0.45 });
        note(midi(m) * 4, { at, vol: vol * 0.12, dur: 0.12, bus: musicBus });
    }
    const hat = (at, vol) => swish(at, 0.045, vol, 9000, 7000, 'highpass', musicBus);
    const shaker = (at, vol) => swish(at, 0.07, vol, 6500, 5000, 'bandpass', musicBus);
    const rim = (at, vol) => swish(at, 0.035, vol, 1900, 1700, 'bandpass', musicBus);
    const kick = (at, vol) => note(95, { at, vol, dur: 0.16, slideTo: 48, bus: musicBus });

    const TRACKS = {
        // ii-V-I-vi in F with a little swing, about 96 bpm
        game: {
            bpm: 96,
            chords: [[55, 58, 62, 65], [48, 52, 55, 58], [53, 57, 60, 64], [50, 53, 57, 60]],   // Gm7 C7 Fmaj7 Dm7
            scale: [65, 67, 69, 70, 72, 74, 76, 77],
            bar(c, next, t, beat) {
                const sw = (b) => t + (Math.floor(b) + (b % 1 ? 0.62 : 0)) * beat;   // swung eighths
                // comping: a long chord on 1, short stabs on the "and" of 2 and on 4
                c.forEach((m, i) => epiano(m + 12, sw(0) + i * 0.012, 0.035, beat * 1.8));
                c.slice(1).forEach(m => epiano(m + 12, sw(1.5), 0.028, beat * 0.5));
                if (Math.random() < 0.7) c.slice(1).forEach(m => epiano(m + 12, sw(3), 0.024, beat * 0.6));
                // walking bass: root, third or fifth, fifth or octave, approach the next root
                const r = c[0] - 12, nr = next[0] - 12;
                [r, r + pick([3, 4, 7]), r + pick([7, 12, 9]), nr + pick([-1, 1, 2])]
                    .forEach((m, i) => bass(m, t + i * beat, 0.16, beat * 0.9));
                // brushes and a soft kick / rim
                for (let e = 0; e < 8; e++) hat(sw(e / 2), e % 2 ? 0.05 : 0.03);
                kick(t, 0.22); kick(sw(2.5), 0.12);
                rim(t + beat, 0.05); rim(t + beat * 3, 0.05);
                // now and then a short vibraphone phrase
                if (Math.random() < 0.55) {
                    let pos = pick([0.5, 1, 1.5]);
                    let idx = Math.floor(Math.random() * this.scale.length);
                    const n = 2 + Math.floor(Math.random() * 3);
                    for (let k = 0; k < n && pos < 4; k++) {
                        vibes(this.scale[idx] + 12, sw(pos), 0.04);
                        idx = Math.max(0, Math.min(this.scale.length - 1, idx + pick([-2, -1, 1, 2])));
                        pos += pick([0.5, 0.5, 1]);
                    }
                }
            }
        },
        // Ebmaj7 - Cm9 - Abmaj7 - Bb7sus, straight eighths, about 80 bpm
        menu: {
            bpm: 80,
            chords: [[51, 55, 58, 62], [48, 51, 55, 58], [56, 60, 63, 67], [46, 51, 53, 56]],
            scale: [63, 65, 67, 70, 72, 75],
            bar(c, next, t, beat) {
                // rolling arpeggio up and back down
                const arp = [0, 1, 2, 3, 2, 3, 1, 2];
                arp.forEach((ix, e) => epiano(c[ix] + 12, t + e * beat / 2, e % 2 ? 0.022 : 0.03, beat * 0.9));
                // long bass notes: root, then the fifth halfway
                bass(c[0] - 12, t, 0.15, beat * 1.9);
                bass(c[0] - 5, t + beat * 2, 0.11, beat * 1.7);
                // light shaker, a rim click on 4
                for (let e = 0; e < 8; e++) shaker(t + e * beat / 2, e % 2 ? 0.035 : 0.02);
                rim(t + beat * 3, 0.04);
                if (Math.random() < 0.4) vibes(pick(this.scale) + 12, t + beat * pick([1, 2, 2.5]), 0.035);
            }
        }
    };
    let track = 'game';
    let musicTimer = null, nextBar = 0, barIndex = 0;

    function scheduleBar(t0) {
        const tr = TRACKS[track];
        const c = tr.chords[barIndex % tr.chords.length];
        const next = tr.chords[(barIndex + 1) % tr.chords.length];
        tr.bar(c, next, t0, 60 / tr.bpm);
        barIndex++;
    }
    function startMusic() {
        if (musicTimer || !opts.music || !ctx) return;
        nextBar = ctx.currentTime + 0.3;
        barIndex = 0;
        musicTimer = setInterval(() => {
            if (ctx.state !== 'running') return;
            while (nextBar < ctx.currentTime + 1.5) {
                scheduleBar(nextBar);
                nextBar += 4 * 60 / TRACKS[track].bpm;
            }
        }, 300);
    }
    function stopMusic() {
        clearInterval(musicTimer);
        musicTimer = null;
    }
    // Each page picks its own piece ('menu' or 'game')
    function setTrack(name) {
        if (TRACKS[name]) track = name;
    }

    // The first click or key press anywhere starts the audio (and the music, if it is on)
    function unlockOnGesture() {
        const go = () => {
            window.removeEventListener('pointerdown', go);
            window.removeEventListener('keydown', go);
            if (init()) refresh();
        };
        window.addEventListener('pointerdown', go);
        window.addEventListener('keydown', go);
    }

    refresh();
    return { play, refresh, unlockOnGesture, setTrack };
})();
