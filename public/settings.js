// settings.js - shared settings + match history storage (used by the menu and the game)
"use strict";
window.AyoStore = (() => {
    const SKEY = 'ayoSettings';
    const HKEY = 'ayoHistory';
    const MAX_HISTORY = 30;
    const defaults = { sound: true, volume: 0.7, bots: 3, speed: 'normal', scale: 100, theme: 'classic', music: true };
    const SCALES = [85, 100, 115, 130];
    const THEMES = ['classic', 'midnight', 'royal', 'lagoon', 'neon', 'graphite'];
    const memory = {};   // fallback when localStorage is blocked

    const read = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* storage blocked */ }
        return key in memory ? memory[key] : fallback;
    };
    const write = (key, value) => {
        memory[key] = value;
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    };

    function sanitize(s) {
        const out = Object.assign({}, defaults, s || {});
        out.sound = out.sound !== false;
        out.music = out.music !== false;
        out.volume = Math.min(1, Math.max(0, Number(out.volume)));
        if (Number.isNaN(out.volume)) out.volume = defaults.volume;
        out.bots = Math.min(3, Math.max(1, parseInt(out.bots, 10) || defaults.bots));
        if (!['slow', 'normal', 'fast'].includes(out.speed)) out.speed = defaults.speed;
        out.scale = SCALES.includes(Number(out.scale)) ? Number(out.scale) : defaults.scale;
        if (!THEMES.includes(out.theme)) out.theme = defaults.theme;
        return out;
    }

    function getSettings() { return sanitize(read(SKEY, {})); }
    function saveSettings(patch) {
        const next = sanitize(Object.assign({}, getSettings(), patch));
        write(SKEY, next);
        return next;
    }

    function getHistory() {
        const h = read(HKEY, []);
        return Array.isArray(h) ? h : [];
    }
    function addMatch(match) {
        const h = getHistory();
        h.unshift(match);
        write(HKEY, h.slice(0, MAX_HISTORY));
    }
    function clearHistory() { write(HKEY, []); }

    function getStats() {
        const h = getHistory();
        const wins = h.filter(m => m.won).length;
        return {
            played: h.length,
            wins,
            losses: h.length - wins,
            rate: h.length ? Math.round((wins / h.length) * 100) : 0
        };
    }

    // ---------- profile + friends (stored on this device only) ----------
    const PKEY = 'ayoProfile', FKEY = 'ayoFriends';
    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const CODE_RE = /^AYO-[A-Z0-9]{4}$/;
    const MAX_FRIENDS = 50;

    function makeCode() {
        let c = 'AYO-';
        for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        return c;
    }
    function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16); }
    function normalizeCode(c) { return String(c || '').trim().toUpperCase(); }

    // The secret never leaves this device except to prove to the server that this code is ours
    function makeSecret() {
        const bytes = new Uint8Array(24);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    function getProfile() {
        let p = read(PKEY, null);
        if (!p || !CODE_RE.test(p.code || '')) {
            p = { name: 'Player', code: makeCode(), secret: makeSecret() };
            write(PKEY, p);
        }
        if (typeof p.secret !== 'string' || p.secret.length < 16) {
            p.secret = makeSecret();
            write(PKEY, p);
        }
        p.name = cleanName(p.name) || 'Player';
        return p;
    }
    function saveProfile(patch) {
        const next = Object.assign({}, getProfile(), patch);
        next.name = cleanName(next.name) || 'Player';
        write(PKEY, next);
        return next;
    }
    // The server said another device already owns our code: pick a fresh one
    function regenerateCode() {
        return saveProfile({ code: makeCode(), secret: makeSecret() });
    }
    function getFriends() {
        const f = read(FKEY, []);
        return Array.isArray(f) ? f : [];
    }
    function uniqueName(list, name, code) {
        if (!list.some(f => f.name.toLowerCase() === name.toLowerCase())) return name;
        return cleanName(name.slice(0, 10) + ' ' + code.slice(4));
    }
    // returns an error message, or '' when this friend can be added
    function checkFriend(name, code) {
        name = cleanName(name);
        code = normalizeCode(code);
        if (!name) return 'Enter a name for your friend.';
        if (code && !CODE_RE.test(code)) return 'Friend codes look like AYO-7K3Q.';
        if (code && code === getProfile().code) return 'That is your own friend code.';
        const list = getFriends();
        if (list.length >= MAX_FRIENDS) return 'Your friends list is full.';
        if (code && list.some(f => f.code === code)) return 'You are already friends with that code.';
        if (list.some(f => f.name.toLowerCase() === name.toLowerCase())) return 'You already have a friend with that name.';
        return '';
    }
    // returns { ok: true } or { ok: false, error: '...' }
    // opts.pending: a friend request was sent and is waiting for an answer
    function addFriend(name, code, opts) {
        const error = checkFriend(name, code);
        if (error) return { ok: false, error };
        const list = getFriends();
        list.unshift({ name: cleanName(name), code: normalizeCode(code), added: Date.now(), pending: !!(opts && opts.pending) });
        write(FKEY, list);
        return { ok: true };
    }
    // A friendship confirmed through the server: add it, or clear the "pending" mark
    function confirmFriend(name, code) {
        code = normalizeCode(code);
        if (!CODE_RE.test(code)) return;
        const list = getFriends();
        const existing = list.find(f => f.code === code);
        if (existing) {
            existing.pending = false;
        } else {
            if (list.length >= MAX_FRIENDS) return;
            list.unshift({ name: uniqueName(list, cleanName(name) || 'Player', code), code, added: Date.now(), pending: false });
        }
        write(FKEY, list);
    }
    function removeFriend(name) {
        write(FKEY, getFriends().filter(f => f.name !== name));
    }
    function removeFriendByCode(code) {
        write(FKEY, getFriends().filter(f => f.code !== code));
    }

    // Theme colours come from themes.css; both pages apply the saved one as soon as this file loads
    function applyTheme() { document.documentElement.dataset.theme = getSettings().theme; }
    applyTheme();

    return { getSettings, saveSettings, getHistory, addMatch, clearHistory, getStats, applyTheme, THEMES,
             getProfile, saveProfile, regenerateCode, getFriends, addFriend, checkFriend, confirmFriend,
             removeFriend, removeFriendByCode, SCALES };
})();
