// server.js - AYO! web server: serves the game (public/) and relays online events
// (who is online, friend requests, game invites) over Socket.IO.
"use strict";
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 8001;
const DATA_DIR = process.env.AYO_DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const CODE_RE = /^AYO-[A-Z0-9]{4}$/;
const INVITE_TTL = 60 * 1000;          // a game invite stays open for 60 seconds
const OFFLINE_GRACE = 4000;            // a page change is not "going offline"
const MAX_PENDING_PER_TARGET = 50;     // friend requests waiting for one player
const MAX_OUTBOX = 100;                // events kept for an offline player
const MAX_FRIENDS = 50;

// ---------- persistent store (a JSON file, good enough until a real database) ----------
// users:    code -> { hash, name, lastSeen, stats: { played, wins } }
// friends:  code -> [codes]            (only accepted friendships)
// requests: id   -> { from, fromName, to, created }
// outbox:   code -> [{ event, payload }]  (delivered on the next connect)
let store = { users: {}, friends: {}, requests: {}, outbox: {} };
try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    store = Object.assign(store, raw);
} catch (e) { /* first run: no store yet */ }

let saveTimer = null;
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(STORE_FILE + '.tmp', JSON.stringify(store));
            fs.renameSync(STORE_FILE + '.tmp', STORE_FILE);
        } catch (e) {
            console.error('Could not save data/store.json:', e.message);
        }
    }, 300);
}

const hashSecret = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => crypto.randomBytes(8).toString('hex');
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
// Match results are kept on each device; friends see the numbers the player last reported
function cleanStats(st, fallback) {
    const num = (v) => Math.max(0, Math.min(1e6, Math.floor(Number(v)) || 0));
    if (!st || typeof st !== 'object') return fallback || { played: 0, wins: 0 };
    const played = num(st.played);
    return { played, wins: Math.min(num(st.wins), played) };
}
const userRoom = (code) => 'user:' + code;
const watchRoom = (code) => 'watch:' + code;

function friendsOf(code) { return store.friends[code] || []; }
function areFriends(a, b) { return friendsOf(a).includes(b); }
function linkFriends(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
        const list = friendsOf(x).filter(c => c !== y);
        list.unshift(y);
        store.friends[x] = list.slice(0, MAX_FRIENDS);
    }
    save();
}
function unlinkFriends(a, b) {
    store.friends[a] = friendsOf(a).filter(c => c !== b);
    store.friends[b] = friendsOf(b).filter(c => c !== a);
    save();
}

// ---------- http: static game files only ----------
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const server = http.createServer(app);
// Pages served by another local server (e.g. VS Code Live Server on :5500) may connect too
const LOCAL_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/;
function isLocalOrigin(origin, cb) {
    try { cb(null, !origin || LOCAL_HOST_RE.test(new URL(origin).hostname)); } catch (e) { cb(null, false); }
}
const io = new Server(server, { maxHttpBufferSize: 16 * 1024, cors: { origin: isLocalOrigin } });

function isOnline(code) {
    const room = io.sockets.adapter.rooms.get(userRoom(code));
    return !!room && room.size > 0;
}

// Send to a player right now, or keep it for their next visit
function deliver(code, event, payload) {
    if (isOnline(code)) {
        io.to(userRoom(code)).emit(event, payload);
        return;
    }
    const box = store.outbox[code] || [];
    box.push({ event, payload });
    store.outbox[code] = box.slice(-MAX_OUTBOX);
    save();
}

// Game invites live in memory only; they expire quickly anyway
const invites = new Map();   // id -> { from, fromName, to, timer }

function closeInvite(id, reason) {
    const inv = invites.get(id);
    if (!inv) return null;
    clearTimeout(inv.timer);
    invites.delete(id);
    io.to(userRoom(inv.to)).emit('game:invite-closed', { id, reason });
    return inv;
}

// ---------- socket events ----------
io.on('connection', (socket) => {
    let me = null;   // this socket's friend code after a successful hello

    // Simple flood guard: at most 30 events per 10 seconds per connection
    let tokens = 30;
    const refill = setInterval(() => { tokens = 30; }, 10000);
    socket.use((packet, next) => {
        if (tokens-- <= 0) return next(new Error('rate-limited'));
        next();
    });
    socket.on('error', () => { /* rate-limited packets are just dropped */ });

    const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
    const needLogin = (ack) => {
        if (!me) { reply(ack, { ok: false, error: 'not-ready' }); return true; }
        return false;
    };

    // First message: who am I? The secret proves this browser owns the code.
    socket.on('hello', (data, ack) => {
        const code = String(data && data.code || '').toUpperCase();
        const secret = String(data && data.secret || '');
        if (!CODE_RE.test(code) || secret.length < 16 || secret.length > 128) {
            return reply(ack, { ok: false, error: 'bad-hello' });
        }
        const hash = hashSecret(secret);
        const known = store.users[code];
        if (known && known.hash !== hash) return reply(ack, { ok: false, error: 'code-taken' });

        const wasOnline = isOnline(code);
        const stats = cleanStats(data.stats, known && known.stats);
        store.users[code] = { hash, name: cleanName(data.name), lastSeen: Date.now(), stats };
        save();
        me = code;
        socket.join(userRoom(me));
        if (!wasOnline) io.to(watchRoom(me)).emit('presence', { code: me, online: true });

        reply(ack, {
            ok: true,
            code: me,
            friends: friendsOf(me).map(c => ({ code: c, name: store.users[c] ? store.users[c].name : 'Player' }))
        });

        // Friend requests waiting for this player, then anything kept in the outbox
        for (const [id, r] of Object.entries(store.requests)) {
            if (r.to === me) socket.emit('friend:request', { id, from: { code: r.from, name: r.fromName } });
        }
        // Game invites still open (e.g. the page changed from the menu to the game)
        for (const [id, inv] of invites) {
            if (inv.to === me) {
                socket.emit('game:invite', { id, from: { code: inv.from, name: inv.fromName }, ttl: inv.expires - Date.now() });
            }
        }
        const box = store.outbox[me];
        if (box && box.length) {
            box.forEach(item => socket.emit(item.event, item.payload));
            delete store.outbox[me];
            save();
        }
    });

    socket.on('profile', (data, ack) => {
        if (needLogin(ack)) return;
        store.users[me].name = cleanName(data && data.name);
        save();
        reply(ack, { ok: true });
    });

    // A friend's profile card: name, online state and match record
    socket.on('profile:get', (data, ack) => {
        if (needLogin(ack)) return;
        const code = String(data && data.code || '').toUpperCase();
        if (!CODE_RE.test(code) || !areFriends(me, code) || !store.users[code]) {
            return reply(ack, { ok: false, error: 'not-friends' });
        }
        const u = store.users[code];
        reply(ack, {
            ok: true,
            code,
            name: u.name,
            online: isOnline(code),
            lastSeen: u.lastSeen || 0,
            stats: u.stats || { played: 0, wins: 0 },
            friends: friendsOf(code).length
        });
    });

    // Tell me which of these codes are online, and keep me posted
    socket.on('presence:watch', (codes, ack) => {
        if (needLogin(ack)) return;
        const list = (Array.isArray(codes) ? codes : [])
            .map(c => String(c).toUpperCase())
            .filter(c => CODE_RE.test(c) && areFriends(me, c))
            .slice(0, MAX_FRIENDS);
        for (const room of socket.rooms) {
            if (room.startsWith('watch:')) socket.leave(room);
        }
        list.forEach(c => socket.join(watchRoom(c)));
        reply(ack, { ok: true, online: list.filter(isOnline) });
    });

    socket.on('friend:request', (data, ack) => {
        if (needLogin(ack)) return;
        const to = String(data && data.to || '').toUpperCase();
        if (!CODE_RE.test(to)) return reply(ack, { ok: false, error: 'bad-code' });
        if (to === me) return reply(ack, { ok: false, error: 'self' });
        if (!store.users[to]) return reply(ack, { ok: false, error: 'unknown-code' });
        if (areFriends(me, to)) return reply(ack, { ok: true, accepted: true, name: store.users[to].name });

        const entries = Object.entries(store.requests);
        // They already asked me: that counts as both sides accepting
        const reverse = entries.find(([, r]) => r.from === to && r.to === me);
        if (reverse) {
            delete store.requests[reverse[0]];
            linkFriends(me, to);
            deliver(to, 'friend:answered', { id: reverse[0], accepted: true, by: { code: me, name: store.users[me].name } });
            return reply(ack, { ok: true, accepted: true, name: store.users[to].name });
        }
        if (entries.some(([, r]) => r.from === me && r.to === to)) return reply(ack, { ok: false, error: 'already-sent' });
        if (entries.filter(([, r]) => r.to === to).length >= MAX_PENDING_PER_TARGET) {
            return reply(ack, { ok: false, error: 'target-full' });
        }

        const id = newId();
        store.requests[id] = { from: me, fromName: store.users[me].name, to, created: Date.now() };
        save();
        io.to(userRoom(to)).emit('friend:request', { id, from: { code: me, name: store.users[me].name } });
        reply(ack, { ok: true, accepted: false });
    });

    socket.on('friend:respond', (data, ack) => {
        if (needLogin(ack)) return;
        const id = String(data && data.id || '');
        const r = store.requests[id];
        if (!r || r.to !== me) return reply(ack, { ok: false, error: 'no-request' });
        delete store.requests[id];
        const accepted = !!(data && data.accept);
        if (accepted) linkFriends(me, r.from);
        save();
        deliver(r.from, 'friend:answered', { id, accepted, by: { code: me, name: store.users[me].name } });
        // Other open tabs of mine should drop the same prompt
        socket.to(userRoom(me)).emit('friend:request-closed', { id });
        reply(ack, { ok: true });
    });

    socket.on('friend:remove', (data, ack) => {
        if (needLogin(ack)) return;
        const code = String(data && data.code || '').toUpperCase();
        if (!CODE_RE.test(code)) return reply(ack, { ok: false, error: 'bad-code' });
        // Also cancels a request I sent that is still waiting
        for (const [id, r] of Object.entries(store.requests)) {
            if (r.from === me && r.to === code) {
                delete store.requests[id];
                io.to(userRoom(code)).emit('friend:request-closed', { id });
            }
        }
        if (areFriends(me, code)) {
            unlinkFriends(me, code);
            deliver(code, 'friend:removed', { code: me });
        }
        save();
        reply(ack, { ok: true });
    });

    socket.on('game:invite', (data, ack) => {
        if (needLogin(ack)) return;
        const to = String(data && data.to || '').toUpperCase();
        if (!CODE_RE.test(to) || !areFriends(me, to)) return reply(ack, { ok: false, error: 'not-friends' });
        if (!isOnline(to)) return reply(ack, { ok: false, error: 'offline' });
        for (const inv of invites.values()) {
            if (inv.from === me && inv.to === to) return reply(ack, { ok: false, error: 'already-sent' });
        }
        const id = newId();
        const inv = { from: me, fromName: store.users[me].name, to, expires: Date.now() + INVITE_TTL };
        inv.timer = setTimeout(() => {
            closeInvite(id, 'expired');
            io.to(userRoom(inv.from)).emit('game:answered', { id, accepted: false, expired: true, by: { code: to, name: store.users[to].name } });
        }, INVITE_TTL);
        invites.set(id, inv);
        io.to(userRoom(to)).emit('game:invite', { id, from: { code: me, name: inv.fromName }, ttl: INVITE_TTL });
        reply(ack, { ok: true, id });
    });

    socket.on('game:respond', (data, ack) => {
        if (needLogin(ack)) return;
        const id = String(data && data.id || '');
        const inv = invites.get(id);
        if (!inv || inv.to !== me) return reply(ack, { ok: false, error: 'no-invite' });
        closeInvite(id, 'answered');
        const accepted = !!(data && data.accept);
        io.to(userRoom(inv.from)).emit('game:answered', { id, accepted, by: { code: me, name: store.users[me].name } });
        reply(ack, { ok: true });
    });

    socket.on('disconnect', () => {
        clearInterval(refill);
        if (!me) return;
        if (store.users[me]) { store.users[me].lastSeen = Date.now(); save(); }
        // Moving from the menu to the game page reconnects within a moment:
        // only count the player as gone if they are still away after a short grace period
        const code = me;
        setTimeout(() => {
            if (isOnline(code)) return;
            io.to(watchRoom(code)).emit('presence', { code, online: false });
            // Invites I sent are pointless once I am gone
            for (const [id, inv] of invites) {
                if (inv.from === code) closeInvite(id, 'cancelled');
            }
        }, OFFLINE_GRACE);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n[HATA] Port ${PORT} baska bir program tarafindan kullaniliyor (ornegin eski "python -m http.server").`);
        console.error('Acik kalan eski sunucu pencerelerini kapatip tekrar deneyin.\n');
        process.exit(1);
    }
    throw err;
});
server.listen(PORT, () => {
    console.log(`AYO! server running on http://localhost:${PORT}`);
});
