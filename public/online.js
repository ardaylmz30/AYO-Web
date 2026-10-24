// online.js - connection to the AYO! server (shared by the menu and the game page):
// who is online, friend requests and game invites, with accept / decline prompts.
// Without the server (e.g. a plain static file server) everything falls back to offline mode.
"use strict";
window.AyoOnline = (() => {
    const listeners = {};
    function on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); }
    function fire(event, data) { (listeners[event] || []).forEach(fn => { try { fn(data); } catch (e) { /* ignore */ } }); }

    const onlineCodes = new Set();
    let ready = false;

    // ---------- notices (bottom-right cards with optional Accept / Decline) ----------
    let stack = null;
    function getStack() {
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'ayo-notices';
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }
        return stack;
    }
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function removeNotice(n) {
        if (!n || !n.isConnected) return;
        n.classList.add('leaving');
        setTimeout(() => n.remove(), 220);
    }
    // opts: { title, text, name, kind, ttl, accept, decline, id }
    function notice(opts) {
        const n = el('div', 'ayo-notice' + (opts.kind ? ' ' + opts.kind : ''));
        if (opts.id) n.dataset.id = opts.id;
        if (opts.accept) n.setAttribute('role', 'alertdialog');
        const av = el('span', 'ayo-notice-avatar', ((opts.name || '!').trim()[0] || '!').toUpperCase());
        const body = el('div', 'ayo-notice-body');
        body.appendChild(el('b', '', opts.title));
        if (opts.text) body.appendChild(el('small', '', opts.text));
        n.append(av, body);
        if (opts.accept) {
            const row = el('div', 'ayo-notice-actions');
            const yes = el('button', 'ayo-notice-btn yes', 'Accept');
            const no = el('button', 'ayo-notice-btn no', 'Decline');
            yes.addEventListener('click', () => { removeNotice(n); opts.accept(); });
            no.addEventListener('click', () => { removeNotice(n); opts.decline(); });
            row.append(yes, no);
            body.appendChild(row);
        } else {
            const x = el('button', 'ayo-notice-close', '×');
            x.setAttribute('aria-label', 'Dismiss');
            x.addEventListener('click', () => removeNotice(n));
            n.appendChild(x);
        }
        if (opts.ttl) {
            const bar = el('span', 'ayo-notice-timer');
            bar.style.animationDuration = opts.ttl + 'ms';
            n.appendChild(bar);
        }
        getStack().appendChild(n);
        // Plain messages go away by themselves; prompts wait for an answer (or their ttl)
        const life = opts.accept ? opts.ttl : (opts.ttl || 5000);
        if (life) setTimeout(() => removeNotice(n), life);
        return n;
    }
    function closeNotice(id) {
        if (!stack) return;
        stack.querySelectorAll('.ayo-notice').forEach(n => { if (n.dataset.id === id) removeNotice(n); });
    }
    const toast = (title, text, kind) => notice({ title, text, kind });

    // ---------- offline fallback ----------
    if (typeof window.io !== 'function' || !window.AyoStore) {
        return {
            available: false, on, toast,
            isConnected: () => false, isOnline: () => false,
            sendFriendRequest: () => Promise.resolve({ ok: false, error: 'offline-mode' }),
            getRequests: () => [],
            respondRequest: () => Promise.resolve({ ok: false, error: 'offline-mode' }),
            inviteToGame: () => Promise.resolve({ ok: false, error: 'offline-mode' }),
            getInvite: () => null, hasSentInvite: () => false, showInviteCards: () => {},
            respondInvite: () => Promise.resolve({ ok: false, error: 'offline-mode' }),
            getFriendProfile: () => Promise.resolve({ ok: false, error: 'offline-mode' }),
            removeFriend: () => {}, refreshFriends: () => {}, updateName: () => {}
        };
    }

    const opts = { reconnectionDelayMax: 8000 };
    const socket = window.AYO_SERVER ? window.io(window.AYO_SERVER, opts) : window.io(opts);
    const ask = (event, data) => new Promise(resolve => {
        if (!ready) return resolve({ ok: false, error: 'not-ready' });
        socket.timeout(8000).emit(event, data, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res));
    });

    function hello(retried) {
        const p = AyoStore.getProfile();
        const st = AyoStore.getStats();
        socket.emit('hello', { code: p.code, name: p.name, secret: p.secret, stats: { played: st.played, wins: st.wins } }, (res) => {
            if (res && res.ok) {
                ready = true;
                // The server sends every open request right after this answer: start the list fresh
                seenBeforeHello = new Set(incoming.keys());
                incoming = new Map();
                fire('requests');
                // Friendships the server knows about but this device does not (e.g. accepted while away)
                (res.friends || []).forEach(f => {
                    const mine = AyoStore.getFriends().find(x => x.code === f.code);
                    if (!mine || mine.pending) AyoStore.confirmFriend(f.name, f.code);
                });
                fire('status', true);
                fire('friends');
                refreshFriends();
            } else if (res && res.error === 'code-taken' && !retried) {
                AyoStore.regenerateCode();
                fire('profile');
                hello(true);
            }
        });
    }
    socket.on('connect', () => hello(false));
    socket.on('disconnect', () => {
        ready = false;
        onlineCodes.clear();
        invitesOut.clear();
        fire('status', false);
        fire('presence');
    });

    function refreshFriends() {
        if (!ready) return;
        const codes = AyoStore.getFriends().filter(f => f.code && !f.pending).map(f => f.code);
        socket.emit('presence:watch', codes, (res) => {
            onlineCodes.clear();
            ((res && res.online) || []).forEach(c => onlineCodes.add(c));
            fire('presence');
        });
    }
    socket.on('presence', ({ code, online }) => {
        if (online) onlineCodes.add(code); else onlineCodes.delete(code);
        fire('presence');
    });

    // ---------- friend requests ----------
    // Requests waiting for my answer (id -> { id, from }); the friends panel lists them too
    let incoming = new Map();
    let seenBeforeHello = new Set();
    function dropRequest(id) {
        closeNotice(id);
        if (incoming.delete(id)) fire('requests');
    }
    function respondRequest(id, accept) {
        const req = incoming.get(id);
        if (!req) return Promise.resolve({ ok: false, error: 'no-request' });
        const from = req.from;
        return ask('friend:respond', { id, accept }).then(res => {
            if (!res.ok) {
                if (res.error === 'no-request') dropRequest(id);
                else toast(accept ? 'Could not accept the request' : 'Could not decline the request', 'Please try again in a moment.', 'is-bad');
                return res;
            }
            dropRequest(id);
            if (accept) {
                AyoStore.confirmFriend(from.name, from.code);
                fire('friends');
                refreshFriends();
                toast(`You and ${from.name} are now friends`, '', 'is-good');
            }
            return res;
        });
    }
    socket.on('friend:request', (req) => {
        const from = req.from;
        const known = incoming.has(req.id) || seenBeforeHello.has(req.id);
        incoming.set(req.id, { id: req.id, from });
        fire('requests');
        // After a reconnect the server sends open requests again: no second card for those
        if (known) return;
        notice({
            id: req.id, name: from.name, kind: 'is-friend',
            title: `${from.name} wants to be friends`,
            text: `Friend code ${from.code}`,
            accept: () => respondRequest(req.id, true),
            decline: () => respondRequest(req.id, false)
        });
    });
    socket.on('friend:request-closed', ({ id }) => dropRequest(id));
    socket.on('friend:answered', ({ accepted, by }) => {
        const mine = AyoStore.getFriends().find(f => f.code === by.code);
        const name = mine ? mine.name : by.name;
        if (accepted) {
            AyoStore.confirmFriend(by.name, by.code);
            toast(`${name} accepted your friend request`, 'You can now invite them to a game.', 'is-good');
        } else {
            AyoStore.removeFriendByCode(by.code);
            toast(`${name} declined your friend request`, '', 'is-bad');
        }
        fire('friends');
        refreshFriends();
    });
    socket.on('friend:removed', ({ code }) => {
        AyoStore.removeFriendByCode(code);
        fire('friends');
        refreshFriends();
    });

    // ---------- game invites ----------
    // Invites waiting for my answer (friend code -> { id, from, ttl, expires }) and invites I sent
    // (friend code -> id). A page with a friends list shows them there; other pages get a card.
    const invitesIn = new Map();
    const invitesOut = new Map();
    let inviteCards = true;
    function dropInvite(id) {
        closeNotice(id);
        for (const [code, inv] of invitesIn) {
            if (inv.id === id) { clearTimeout(inv.timer); invitesIn.delete(code); fire('invites'); }
        }
    }
    function respondInvite(code, accept) {
        const inv = invitesIn.get(code);
        if (!inv) return Promise.resolve({ ok: false, error: 'no-invite' });
        return ask('game:respond', { id: inv.id, accept }).then(res => {
            dropInvite(inv.id);
            if (!res.ok) { toast('This invite is no longer open', '', 'is-bad'); return res; }
            if (accept) {
                toast(`You accepted ${inv.from.name}'s invite`,
                    'Online matches arrive in the next update. Until then you can play against the bots.', 'is-good');
            }
            return res;
        });
    }
    socket.on('game:invite', (inv) => {
        const from = inv.from;
        const old = invitesIn.get(from.code);
        if (old && old.id === inv.id) return;   // sent again after a page change
        if (old) dropInvite(old.id);
        const entry = { id: inv.id, from, ttl: inv.ttl, expires: Date.now() + inv.ttl };
        entry.timer = setTimeout(() => dropInvite(inv.id), inv.ttl);
        invitesIn.set(from.code, entry);
        fire('invites');
        if (!inviteCards) return;
        notice({
            id: inv.id, name: from.name, kind: 'is-invite', ttl: inv.ttl,
            title: `${from.name} invites you to a game`,
            text: 'Answer before the timer runs out.',
            accept: () => respondInvite(from.code, true),
            decline: () => respondInvite(from.code, false)
        });
    });
    socket.on('game:invite-closed', ({ id }) => dropInvite(id));
    socket.on('game:answered', ({ accepted, expired, by }) => {
        invitesOut.delete(by.code);
        const mine = AyoStore.getFriends().find(f => f.code === by.code);
        const name = mine ? mine.name : by.name;
        if (accepted) {
            toast(`${name} accepted your invite`,
                'Online matches arrive in the next update. Until then you can play against the bots.', 'is-good');
        } else {
            toast(expired ? `${name} did not answer your invite` : `${name} declined your invite`, '', 'is-bad');
        }
        fire('invite-answered', by.code);
        fire('invites');
    });
    function inviteToGame(code) {
        return ask('game:invite', { to: code }).then(res => {
            if (res.ok) { invitesOut.set(code, res.id); fire('invites'); }
            return res;
        });
    }

    // ---------- API for the pages ----------
    let nameTimer = null;
    return {
        available: true, on, toast,
        isConnected: () => ready,
        isOnline: (code) => onlineCodes.has(code),
        sendFriendRequest: (code) => ask('friend:request', { to: code }),
        getRequests: () => Array.from(incoming.values()),
        respondRequest,
        inviteToGame,
        getInvite: (code) => invitesIn.get(code) || null,
        hasSentInvite: (code) => invitesOut.has(code),
        respondInvite,
        // Pages with their own friends list show invites there instead of in a card
        showInviteCards: (on) => { inviteCards = !!on; },
        getFriendProfile: (code) => ask('profile:get', { code }),
        removeFriend: (code) => { if (code) ask('friend:remove', { code }).then(refreshFriends); },
        refreshFriends,
        updateName: (name) => {
            clearTimeout(nameTimer);
            nameTimer = setTimeout(() => ask('profile', { name }), 600);
        }
    };
})();
