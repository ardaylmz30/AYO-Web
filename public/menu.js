// menu.js - main menu page logic (panels, settings, match history, share)
"use strict";
(() => {
    const $ = (id) => document.getElementById(id);
    const overlay = $('panel-overlay');
    const panels = ['panel-settings', 'panel-history', 'panel-howto', 'panel-friends', 'panel-soon', 'panel-share', 'panel-profile', 'panel-themes'].map($);
    let lastFocus = null;

    // ---------- tiny click sound (respects settings) ----------
    let ctx = null;
    function blip(freq = 420, dur = 0.06) {
        const s = AyoStore.getSettings();
        if (!s.sound) return;
        try {
            ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = freq;
            g.gain.setValueAtTime(0.1 * s.volume / 0.7, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + dur);
        } catch (e) { /* ignore */ }
    }

    // ---------- panels ----------
    function openPanel(id) {
        lastFocus = document.activeElement;
        panels.forEach(p => p.classList.toggle('hidden', p.id !== id));
        overlay.classList.remove('hidden');
        const first = $(id).querySelector('button, input');
        if (first) first.focus();
    }
    function closePanel() {
        overlay.classList.add('hidden');
        panels.forEach(p => p.classList.add('hidden'));
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        renderRecord();
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { blip(320); closePanel(); } });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { blip(320); closePanel(); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closePanel(); });

    // ---------- navigation ----------
    const ICONS = {
        online: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
        room: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M12 9v6M9 12h6"/></svg>'
    };
    const SOON = {
        online: {
            title: 'Play Online',
            text: 'Quick matches against real players are on the way. Online play needs a game server, which this version does not have yet.',
            items: ['Quick match with players worldwide', 'Ranked matchmaking and leaderboards', 'Reconnect to a game after a dropped connection']
        },
        room: {
            title: 'Create Room',
            text: 'Private rooms will let you invite friends with a short room code. This needs a game server, which is not part of this version yet.',
            items: ['Share a room code or link with friends', 'Choose the number of players and house rules', 'Mix real players and bots in one game']
        }
    };
    function openSoon(kind) {
        const d = SOON[kind];
        $('soon-icon').innerHTML = ICONS[kind];
        $('pn-title').textContent = d.title;
        $('pn-text').textContent = d.text;
        const list = $('pn-list');
        list.textContent = '';
        d.items.forEach(t => { const li = document.createElement('li'); li.textContent = t; list.appendChild(li); });
        openPanel('panel-soon');
    }
    function playBots() {
        blip(520, 0.1);
        document.body.classList.add('leaving');
        setTimeout(() => { window.location.href = 'game.html'; }, 220);
    }

    document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const a = btn.dataset.action;
            if (a !== 'bots' && a !== 'bots-from-panel') blip();
            if (a === 'bots' || a === 'bots-from-panel') playBots();
            else if (a === 'online') openSoon('online');
            else if (a === 'room') openSoon('room');
            else if (a === 'settings') { renderSettings(); openPanel('panel-settings'); }
            else if (a === 'history') { renderHistory(); openPanel('panel-history'); }
            else if (a === 'share') { renderShare(); openPanel('panel-share'); }
            else if (a === 'howto') openPanel('panel-howto');
            else if (a === 'friends') { renderFriends(); openPanel('panel-friends'); }
            else if (a === 'themes') { renderThemes(); openPanel('panel-themes'); }
        });
    });

    // ---------- record chip ----------
    function renderRecord() {
        const s = AyoStore.getStats();
        $('rec-played').textContent = s.played;
        $('rec-wins').textContent = s.wins;
        $('rec-rate').textContent = s.rate + '%';
    }

    // ---------- settings ----------
    function renderSettings() {
        const s = AyoStore.getSettings();
        const sw = $('set-sound');
        sw.setAttribute('aria-checked', String(s.sound));
        $('set-music').setAttribute('aria-checked', String(s.music));
        $('set-volume').value = Math.round(s.volume * 100);
        $('vol-label').textContent = Math.round(s.volume * 100) + '%';
        $('set-volume').disabled = !s.sound && !s.music;
        markSegment($('set-bots'), String(s.bots));
        markSegment($('set-speed'), s.speed);
        markSegment($('set-scale'), String(s.scale));
    }

    // Interface scale: the menu uses CSS zoom, the game page scales its container
    function applyScale() {
        document.documentElement.style.setProperty('--ui', String(AyoStore.getSettings().scale / 100));
    }
    $('set-scale').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        AyoStore.saveSettings({ scale: Number(b.dataset.value) });
        applyScale(); renderSettings(); blip();
    });
    function markSegment(el, value) {
        el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
    }
    $('set-sound').addEventListener('click', () => {
        const on = $('set-sound').getAttribute('aria-checked') !== 'true';
        AyoStore.saveSettings({ sound: on });
        renderSettings();
        blip(500);
    });
    $('set-music').addEventListener('click', () => {
        AyoStore.saveSettings({ music: $('set-music').getAttribute('aria-checked') !== 'true' });
        AyoAudio.refresh();
        renderSettings();
        blip(500);
    });
    $('set-volume').addEventListener('input', (e) => {
        const v = Number(e.target.value) / 100;
        AyoStore.saveSettings({ volume: v });
        AyoAudio.refresh();
        $('vol-label').textContent = Math.round(v * 100) + '%';
    });
    $('set-volume').addEventListener('change', () => blip(500));
    $('set-bots').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        AyoStore.saveSettings({ bots: Number(b.dataset.value) });
        renderSettings(); blip();
    });
    $('set-speed').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        AyoStore.saveSettings({ speed: b.dataset.value });
        renderSettings(); blip();
    });

    // ---------- themes ----------
    const THEME_INFO = {
        classic:  { name: 'Classic', text: 'Green felt, wooden rim, gold' },
        midnight: { name: 'Midnight', text: 'Deep blue felt, steel rim, ice blue' },
        royal:    { name: 'Royal', text: 'Wine-red velvet, walnut, rose gold' },
        lagoon:   { name: 'Lagoon', text: 'Teal water, light oak, aqua' },
        neon:     { name: 'Neon Night', text: 'Purple felt, black rim, pink glow' },
        graphite: { name: 'Graphite', text: 'Carbon grey with ember orange' }
    };
    function renderThemes() {
        const current = AyoStore.getSettings().theme;
        const grid = $('theme-grid');
        grid.textContent = '';
        AyoStore.THEMES.forEach(id => {
            const info = THEME_INFO[id];
            const b = document.createElement('button');
            b.className = 'theme-card';
            b.dataset.theme = id;
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(id === current));
            const prev = document.createElement('span');
            prev.className = 'theme-preview';
            prev.innerHTML = '<span class="tp-table"><span class="tp-ring"></span><span class="tp-card"></span></span>';
            const nm = document.createElement('b');
            nm.textContent = info.name;
            const sub = document.createElement('small');
            sub.textContent = info.text;
            b.append(prev, nm, sub);
            b.addEventListener('click', () => {
                AyoStore.saveSettings({ theme: id });
                AyoStore.applyTheme();
                renderThemes(); renderThemeSub(); blip(520);
                grid.querySelector(`[data-theme="${id}"]`).focus();
            });
            grid.appendChild(b);
        });
    }
    function renderThemeSub() {
        $('themes-sub').textContent = 'Current: ' + THEME_INFO[AyoStore.getSettings().theme].name;
    }

    // ---------- history ----------
    function formatDate(ts) {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' · ' +
               d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    function renderHistory() {
        const stats = AyoStore.getStats();
        $('h-played').textContent = stats.played;
        $('h-wins').textContent = stats.wins;
        $('h-losses').textContent = stats.losses;
        $('h-rate').textContent = stats.rate + '%';

        const list = $('history-list');
        list.textContent = '';
        const items = AyoStore.getHistory();
        $('history-empty').classList.toggle('hidden', items.length > 0);
        $('btn-clear-history').classList.toggle('hidden', items.length === 0);
        items.forEach(m => {
            const li = document.createElement('li');
            li.className = 'hist-row ' + (m.won ? 'won' : 'lost');
            const tag = document.createElement('span');
            tag.className = 'hist-tag';
            tag.textContent = m.won ? 'WIN' : 'LOSS';
            const info = document.createElement('span');
            info.className = 'hist-info';
            const main = document.createElement('b');
            main.textContent = m.won ? 'You won' : (m.forfeit ? 'You left the game' : `${m.winner} won`);
            const sub = document.createElement('small');
            const bots = Number(m.bots) || 0;
            sub.textContent = `${bots} bot${bots === 1 ? '' : 's'} · ${Number(m.plays) || 0} cards played` +
                (m.won ? '' : ` · ${Number(m.cardsLeft) || 0} left in your hand`);
            info.append(main, sub);
            const date = document.createElement('span');
            date.className = 'hist-date';
            date.textContent = formatDate(m.date);
            li.append(tag, info, date);
            list.appendChild(li);
        });
    }
    $('btn-clear-history').addEventListener('click', () => {
        if (window.confirm('Delete your whole match history?')) {
            AyoStore.clearHistory();
            renderHistory();
        }
    });

    // ---------- share ----------
    function renderShare() {
        const url = window.location.href.split('#')[0].split('?')[0];
        $('share-url').value = url;
        $('qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
    }
    $('btn-copy-link').addEventListener('click', () => {
        const input = $('share-url');
        input.select();
        const btn = $('btn-copy-link');
        const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(input.value).then(done).catch(() => {});
        } else {
            try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
        }
    });

    // ---------- friends ----------
    const AV_COLORS = ['#e63946', '#0096e0', '#2fbf9f', '#f2c14e', '#b06bff', '#ff8a3d'];
    function avatarColor(name) {
        let h = 0;
        for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return AV_COLORS[h % AV_COLORS.length];
    }
    function setAvatar(el, name) {
        el.textContent = (name.trim()[0] || '?').toUpperCase();
        el.style.background = avatarColor(name);
    }
    function msg(text, bad) {
        const m = $('friend-msg');
        m.textContent = text;
        m.classList.toggle('bad', !!bad);
        // The profile panel covers the friends list: show the message there too
        if (text && profileOpen()) $('fp-note').textContent = text;
        clearTimeout(msg.t);
        if (text) msg.t = setTimeout(() => { m.textContent = ''; }, 4000);
    }
    function renderFriendsCount() {
        const n = AyoStore.getFriends().length;
        const r = AyoOnline.getRequests().length;
        const inviter = AyoStore.getFriends().find(f => f.code && AyoOnline.getInvite(f.code));
        $('friends-count').textContent = n;
        $('friends-count').classList.toggle('zero', n === 0);
        $('friends-count').closest('.menu-item').classList.toggle('has-alert', !!inviter || r > 0);
        $('friends-sub').textContent = inviter ? `${inviter.name} invites you to a game`
            : r > 0 ? (r === 1 ? '1 friend request waiting' : `${r} friend requests waiting`)
            : n === 0 ? 'Add friends and invite them to a game'
            : (n === 1 ? '1 friend on your list' : `${n} friends on your list`);
    }
    function renderRequests() {
        const reqs = AyoOnline.getRequests();
        $('request-section').classList.toggle('hidden', reqs.length === 0);
        $('request-total').textContent = reqs.length;
        const list = $('request-list');
        list.textContent = '';
        reqs.forEach(r => {
            const li = document.createElement('li');
            li.className = 'friend-row';
            const av = document.createElement('span');
            av.className = 'avatar-sm';
            setAvatar(av, r.from.name);
            const info = document.createElement('span');
            info.className = 'friend-info';
            const nm = document.createElement('b');
            nm.textContent = r.from.name;
            const sub = document.createElement('small');
            sub.textContent = r.from.code + ' · Wants to be your friend';
            info.append(nm, sub);
            const actions = document.createElement('span');
            actions.className = 'request-actions';
            const yes = document.createElement('button');
            yes.className = 'mini-btn gold';
            yes.textContent = 'Accept';
            const no = document.createElement('button');
            no.className = 'mini-btn';
            no.textContent = 'Decline';
            const answer = (accept) => {
                yes.disabled = no.disabled = true;
                AyoOnline.respondRequest(r.id, accept).then(res => {
                    if (res.ok) { blip(accept ? 560 : 300); return; }
                    yes.disabled = no.disabled = false;
                    if (res.error === 'no-request') msg('That request is no longer open.', true);
                });
            };
            yes.addEventListener('click', () => answer(true));
            no.addEventListener('click', () => answer(false));
            actions.append(yes, no);
            li.append(av, info, actions);
            list.appendChild(li);
        });
    }
    function renderOnlineStatus() {
        const st = $('online-status');
        const on = AyoOnline.isConnected();
        st.classList.toggle('is-on', on);
        st.textContent = on ? 'Connected: friend requests and invites are sent live.'
            : (AyoOnline.available ? 'Connecting to the server...'
                : 'Offline mode: start the game with web-launcher.bat to send friend requests and invites.');
    }
    function renderFriends() {
        renderOnlineStatus();
        const me = AyoStore.getProfile();
        $('me-name').value = me.name;
        $('me-code').textContent = me.code;
        setAvatar($('me-avatar'), me.name);
        renderRequests();

        const friends = AyoStore.getFriends();
        $('friend-total').textContent = friends.length;
        $('friend-empty').classList.toggle('hidden', friends.length > 0);
        const list = $('friend-list');
        list.textContent = '';
        friends.forEach(f => {
            const li = document.createElement('li');
            li.className = 'friend-row';
            const open = document.createElement('button');
            open.className = 'friend-open';
            open.setAttribute('aria-label', `Open ${f.name}'s profile`);
            open.addEventListener('click', () => { blip(); openProfile(f.code || f.name); });
            const av = document.createElement('span');
            av.className = 'avatar-sm';
            setAvatar(av, f.name);
            const info = document.createElement('span');
            info.className = 'friend-info';
            const nm = document.createElement('b');
            nm.textContent = f.name;
            const sub = document.createElement('small');
            const online = !!f.code && AyoOnline.isOnline(f.code);
            const invite = f.code && AyoOnline.getInvite(f.code);
            if (invite) {
                sub.textContent = 'Invites you to a game';
            } else if (f.pending) {
                sub.textContent = f.code + ' · Request sent, waiting for an answer';
            } else {
                sub.textContent = (f.code ? f.code + ' · ' : '') + 'Friends since ' + shortDate(f.added);
            }
            if (f.code && !f.pending && AyoOnline.isConnected()) {
                const dot = document.createElement('i');
                dot.className = 'presence' + (online ? ' on' : '');
                dot.title = online ? 'Online' : 'Offline';
                nm.appendChild(dot);
            }
            info.append(nm, sub);
            open.append(av, info);
            li.appendChild(open);

            if (invite) {
                // Their invite to me: answer it right here
                li.classList.add('has-invite');
                const actions = document.createElement('span');
                actions.className = 'request-actions';
                const yes = document.createElement('button');
                yes.className = 'mini-btn join';
                yes.textContent = 'Join';
                const no = document.createElement('button');
                no.className = 'mini-btn';
                no.textContent = 'Decline';
                const answer = (accept) => {
                    yes.disabled = no.disabled = true;
                    blip(accept ? 560 : 300);
                    AyoOnline.respondInvite(f.code, accept);
                };
                yes.addEventListener('click', () => answer(true));
                no.addEventListener('click', () => answer(false));
                actions.append(yes, no);
                const bar = document.createElement('span');
                bar.className = 'invite-timer';
                bar.style.animationDuration = invite.ttl + 'ms';
                bar.style.animationDelay = -(invite.ttl - (invite.expires - Date.now())) + 'ms';
                li.append(actions, bar);
            } else {
                const sent = !!f.code && AyoOnline.hasSentInvite(f.code);
                const inv = document.createElement('button');
                inv.className = 'mini-btn gold';
                inv.textContent = f.pending ? 'Pending' : sent ? 'Invited' : (online ? 'Invite' : 'Copy invite');
                inv.disabled = !!f.pending || sent;
                inv.addEventListener('click', () => inviteFriend(f));
                li.appendChild(inv);
            }
            const del = document.createElement('button');
            del.className = 'icon-btn';
            del.setAttribute('aria-label', 'Remove ' + f.name);
            del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
            del.addEventListener('click', () => { if (removeFriend(f)) renderFriends(); });
            li.appendChild(del);
            list.appendChild(li);
        });
    }
    function shortDate(ts) {
        return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    }
    function removeFriend(f) {
        if (!window.confirm(`Remove ${f.name} from your friends?`)) return false;
        AyoStore.removeFriend(f.name);
        AyoOnline.removeFriend(f.code);
        renderFriendsCount(); blip(300);
        return true;
    }

    // ---------- friend profile ----------
    let profileKey = null;   // friend code, or the name for a friend added without a code
    let profileLoad = 0;
    const findFriend = (key) => AyoStore.getFriends().find(f => (f.code || f.name) === key);
    function lastSeenText(ts) {
        if (!ts) return 'Offline';
        const min = Math.round((Date.now() - ts) / 60000);
        if (min < 1) return 'Last seen just now';
        if (min < 60) return `Last seen ${min} min ago`;
        if (min < 60 * 24) return `Last seen ${Math.round(min / 60)} h ago`;
        return 'Last seen ' + shortDate(ts);
    }
    function setProfileStats(st) {
        $('fp-played').textContent = st ? st.played : '–';
        $('fp-wins').textContent = st ? st.wins : '–';
        $('fp-losses').textContent = st ? st.played - st.wins : '–';
        $('fp-rate').textContent = st ? (st.played ? Math.round(st.wins / st.played * 100) : 0) + '%' : '–';
    }
    function renderProfile() {
        const f = findFriend(profileKey);
        if (!f) { renderFriends(); openPanel('panel-friends'); return null; }
        $('pp-title').textContent = f.name;
        $('fp-code').textContent = f.code || 'No friend code';
        setAvatar($('fp-avatar'), f.name);
        $('fp-since').textContent = f.pending ? 'Request pending' : shortDate(f.added);
        const online = !!f.code && AyoOnline.isOnline(f.code);
        const sent = !!f.code && AyoOnline.hasSentInvite(f.code);
        $('fp-invite').textContent = sent ? 'Invite sent' : online ? 'Invite to a game' : 'Copy invite';
        $('fp-invite').disabled = !!f.pending || sent;
        const status = $('fp-status');
        status.classList.toggle('on', online);
        if (online) status.textContent = 'Online now';
        else if (!status.dataset.lastSeen) status.textContent = AyoOnline.isConnected() && f.code && !f.pending ? 'Offline' : '';
        else status.textContent = status.dataset.lastSeen;
        return f;
    }
    function openProfile(key) {
        profileKey = key;
        delete $('fp-status').dataset.lastSeen;
        setProfileStats(null);
        $('fp-friends').textContent = '–';
        const note = $('fp-note');
        note.textContent = '';
        const f = renderProfile();
        if (!f) return;
        openPanel('panel-profile');
        if (!f.code || f.pending) {
            note.textContent = f.pending ? 'Their profile shows up once they accept your friend request.'
                : 'This friend was added without a friend code, so there is no online profile to show.';
            return;
        }
        if (!AyoOnline.isConnected()) {
            note.textContent = 'Connect to the server to see their match record.';
            return;
        }
        const load = ++profileLoad;
        AyoOnline.getFriendProfile(f.code).then(res => {
            if (load !== profileLoad || profileKey !== key) return;
            if (!res.ok) { note.textContent = 'Could not load their profile right now.'; return; }
            setProfileStats(res.stats);
            $('fp-friends').textContent = res.friends;
            $('fp-status').dataset.lastSeen = lastSeenText(res.lastSeen);
            note.textContent = res.stats.played ? '' : 'No matches played yet.';
            renderProfile();
        });
    }
    $('btn-profile-back').addEventListener('click', () => { blip(320); renderFriends(); openPanel('panel-friends'); });
    $('fp-invite').addEventListener('click', () => {
        const f = findFriend(profileKey);
        if (f) { blip(); inviteFriend(f); }
    });
    $('fp-remove').addEventListener('click', () => {
        const f = findFriend(profileKey);
        if (f && removeFriend(f)) { renderFriends(); openPanel('panel-friends'); }
    });

    function inviteFriend(f) {
        // Online friend: a live invite they can accept or decline in the game
        if (f.code && AyoOnline.isOnline(f.code)) {
            AyoOnline.inviteToGame(f.code).then(res => {
                if (res.ok) { msg(`Invite sent to ${f.name}. They have 60 seconds to answer.`); blip(560); return; }
                const text = INVITE_ERRORS[res.error] || 'Could not send the invite. Please try again.';
                msg(text, true);
            });
            return;
        }
        copyInvite(f);
    }
    const INVITE_ERRORS = {
        'already-sent': 'You already sent an invite. Wait for the answer.',
        'offline': 'Your friend just went offline.',
        'not-friends': 'Your friend has not accepted your friend request yet.'
    };
    const REQUEST_ERRORS = {
        'unknown-code': 'No player with that code has been online yet. Check the code.',
        'already-sent': 'You already sent a request to that code.',
        'target-full': 'That player has too many open requests. Try again later.',
        'self': 'That is your own friend code.',
        'bad-code': 'Friend codes look like AYO-7K3Q.'
    };
    // Offline friend (or no server): copy a text with the link to send in a chat app
    function copyInvite(f) {
        const me = AyoStore.getProfile();
        const url = new URL('index.html', window.location.href).href;
        const text = `Hey ${f.name}, ${me.name} invites you to play AYO!` + (me.code ? ` My friend code: ${me.code}.` : '');
        // Phones: native share sheet. Desktop (Windows opens Outlook/Mail there): copy the invite instead
        const touchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        if (navigator.share && touchDevice) {
            navigator.share({ title: 'AYO! invite', text, url }).catch(() => {});
            return;
        }
        const full = `${text} ${url}`;
        const done = () => msg(`Invite for ${f.name} copied. Paste it in your chat app.`);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(full).then(done).catch(() => msg('Could not copy the invite.', true));
        } else {
            msg('Copying is not available in this browser.', true);
        }
    }
    $('me-name').addEventListener('input', (e) => {
        const p = AyoStore.saveProfile({ name: e.target.value });
        setAvatar($('me-avatar'), p.name);
        AyoOnline.updateName(p.name);
    });
    $('btn-copy-code').addEventListener('click', () => {
        const code = $('me-code').textContent;
        const b = $('btn-copy-code');
        const done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(() => {});
    });
    $('friend-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
    $('friend-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('friend-name').value;
        const code = $('friend-code').value.trim().toUpperCase();
        const done = (text) => {
            $('friend-name').value = '';
            $('friend-code').value = '';
            msg(text);
            renderFriends(); renderFriendsCount(); blip(560);
        };
        // With a code and a server connection the friend gets a request to accept
        if (code && AyoOnline.isConnected()) {
            const error = AyoStore.checkFriend(name, code);
            if (error) { msg(error, true); return; }
            AyoOnline.sendFriendRequest(code).then(res => {
                if (!res.ok) { msg(REQUEST_ERRORS[res.error] || 'Could not send the request. Please try again.', true); return; }
                const added = AyoStore.addFriend(name, code, { pending: !res.accepted });
                if (!added.ok) { msg(added.error, true); return; }
                AyoOnline.refreshFriends();
                done(res.accepted ? 'You are now friends.' : 'Friend request sent. They will show up as a friend once they accept.');
            });
            return;
        }
        // A code needs the server: adding it only here would look like an accepted request
        if (code) {
            msg(AyoOnline.available ? 'Still connecting to the server. Please try again in a moment.'
                : 'The server is not running. Start the game with web-launcher.bat to send friend requests.', true);
            return;
        }
        const res = AyoStore.addFriend(name, code);
        if (!res.ok) { msg(res.error, true); return; }
        done('Friend added.');
    });

    // Live updates from the server
    const friendsOpen = () => !$('panel-friends').classList.contains('hidden') && !overlay.classList.contains('hidden');
    const profileOpen = () => !$('panel-profile').classList.contains('hidden') && !overlay.classList.contains('hidden');
    const refreshFriendsUi = () => {
        renderFriendsCount();
        if (friendsOpen()) renderFriends();
        if (profileOpen()) renderProfile();
    };
    AyoOnline.on('presence', refreshFriendsUi);
    AyoOnline.on('friends', refreshFriendsUi);
    AyoOnline.on('status', refreshFriendsUi);
    AyoOnline.on('requests', refreshFriendsUi);
    AyoOnline.on('invites', refreshFriendsUi);
    // This page lists game invites on the friend rows, so no corner cards for them here
    AyoOnline.showInviteCards(false);
    AyoOnline.on('profile', () => { if (friendsOpen()) renderFriends(); });

    // The menu has its own, slower piece; it starts with the first click
    AyoAudio.setTrack('menu');
    AyoAudio.unlockOnGesture();

    applyScale();
    renderThemeSub();
    renderRecord();
    renderFriendsCount();
})();
