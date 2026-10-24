// app.js - Core game logic and UI animation for the Ayo web game
"use strict";

// Global error handler: it can't stop an unexpected error from happening,
// but it at least logs it cleanly and tries to stop the game from getting
// stuck forever in the "isAnimating" lock.
window.addEventListener('error', (event) => {
    if (window.game) {
        window.game.isAnimating = false;
    }
});
window.addEventListener('unhandledrejection', (event) => {
    if (window.game) {
        window.game.isAnimating = false;
    }
});

const AYO_WINDOW = 2600;          // ms you get to press AYO after your second-to-last card
const AYO_FORGET_CHANCE = 0.25;   // how often a bot forgets to say AYO
const LOG_LIMIT = 300;            // game log lines kept

class WebAyoGame {
    constructor() {
        this.Renkler = ["Red", "Blue", "Green", "Yellow"];
        this.Degerler = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Skip", "Reverse", "+2"];

        this.resetGameLogic();
        this.setupEventListeners();
        this.initConfetti();
        if (window.AyoAudio) { AyoAudio.setTrack('game'); AyoAudio.unlockOnGesture(); }
    }

    resetGameLogic() {
        if (this.botThinkingTimeout) {
        clearTimeout(this.botThinkingTimeout);
        }
        this.botThinkingTimeout = null;
        this.deste = [];
        this.ortaYigin = [];
        // Settings from the main menu (bot count, speed, sound)
        this.settings = window.AyoStore ? AyoStore.getSettings() : { sound: true, volume: 0.7, bots: 3, speed: 'normal' };
        this.botNames = ["Bot 1", "Bot 2", "Bot 3"].slice(0, this.settings.bots);
        this.oyuncular = { "You": [] };
        this.botNames.forEach(b => { this.oyuncular[b] = []; });
        this.oyuncuSirasi = Object.keys(this.oyuncular);
        this.playCount = 0;
        this.matchRecorded = false;
        this.layoutSeats();
        this.applyUiScale();
        this.sira = 0;
        this.yon = 1;
        this.ustKart = null;
        this.guncelRenk = null;
        this.cezaKartlari = 0;
        this.ayoCalled = false;      // you pressed AYO before your second-to-last card left your hand
        this.ayoWindow = null;       // { done } while the game waits for your AYO
        this.turnAngle = undefined;
        this.pendingColorCallback = null;
        document.getElementById('color-picker-overlay')?.classList.add('hidden');

        this.isAnimating = false;
        this.botThinkingTimeout = null;
        this.paused = false;
        this.resumeTurnOnUnpause = false;
        this.dealQueue = [];
    }

    // Interface scale (Settings): scale the whole game container
    applyUiScale() {
        const s = (this.settings.scale || 100) / 100;
        this.uiScale = s;
        const c = document.getElementById('game-container');
        if (!c) return;
        if (s === 1) {
            c.style.transform = '';
            c.style.width = '';
            c.style.height = '';
            c.style.transformOrigin = '';
        } else {
            c.style.transformOrigin = '0 0';
            c.style.transform = `scale(${s})`;
            c.style.width = `${100 / s}%`;
            c.style.height = `${100 / s}%`;
        }
    }

    // Place the bot panels around the table depending on how many bots play
    layoutSeats() {
        const layouts = {
            3: { "Bot 1": "pos-left", "Bot 2": "pos-top", "Bot 3": "pos-right" },
            2: { "Bot 1": "pos-left", "Bot 2": "pos-right" },
            1: { "Bot 1": "pos-top" }
        };
        const layout = layouts[this.botNames.length];
        for (const bot of ["Bot 1", "Bot 2", "Bot 3"]) {
            const panel = document.getElementById(`player-${this.getDomIdSuffix(bot)}`);
            if (!panel) continue;
            panel.classList.remove('pos-left', 'pos-right', 'pos-top');
            if (layout[bot]) {
                panel.classList.add(layout[bot]);
                panel.classList.remove('seat-empty');
            } else {
                panel.classList.add('seat-empty');
            }
        }
    }

    setupEventListeners() {
        document.getElementById('btn-restart').addEventListener('click', () => this.restartGame());
        
        // Share buttons
        document.getElementById('btn-float-share').addEventListener('click', () => this.openShareModal());
        document.getElementById('btn-share-close').addEventListener('click', () => this.closeShareModal());
        document.getElementById('btn-copy-link').addEventListener('click', () => this.copyShareUrl());

        // Drawing a card from the deck
        document.getElementById('draw-pile').addEventListener('click', () => {
            if (this.isAnimating) return;
            const aktifOyuncu = this.oyuncuSirasi[this.sira];
            if (aktifOyuncu === "You") {
                if (this.cezaKartlari > 0) {
                    this.humanDrawPenalty();
                } else {
                    this.humanDrawCard();
                }
            }
        });

        // Back to the main menu (a separate page)
        document.getElementById('btn-over-menu').addEventListener('click', () => {
            this.playClickSound();
            window.location.href = 'index.html';
        });
        document.getElementById('btn-back-menu').addEventListener('click', () => {
            this.playClickSound();
            if (this.isGameOver()) {
                window.location.href = 'index.html';
            } else {
                this.openDialog('leave-overlay');
            }
        });
        document.getElementById('btn-leave-stay').addEventListener('click', () => {
            this.playClickSound();
            this.closeDialog('leave-overlay');
        });
        document.getElementById('btn-leave-confirm').addEventListener('click', () => this.forfeitGame());

        // In-game settings (the game is paused while the panel is open)
        document.getElementById('btn-game-settings').addEventListener('click', () => {
            this.playClickSound();
            this.renderGameSettings();
            this.openDialog('game-settings-overlay');
        });
        document.getElementById('btn-settings-close').addEventListener('click', () => {
            this.playClickSound();
            this.closeDialog('game-settings-overlay');
        });
        this.setupGameSettings();

        // Esc closes the open dialog; clicking the dark backdrop does too
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            ['leave-overlay', 'game-settings-overlay'].forEach(id => {
                if (!document.getElementById(id).classList.contains('hidden')) this.closeDialog(id);
            });
        });
        ['leave-overlay', 'game-settings-overlay'].forEach(id => {
            const el = document.getElementById(id);
            el.addEventListener('click', (e) => { if (e.target === el) this.closeDialog(id); });
        });

        // Game log show / hide
        document.getElementById('btn-log-toggle').addEventListener('click', () => this.toggleLog());
        let logHidden = false;
        try { logHidden = localStorage.getItem('ayoLogHidden') === '1'; } catch (e) {}
        if (logHidden) this.setLogVisible(false, false);

        // AYO button (and the A key)
        document.getElementById('btn-ayo').addEventListener('click', () => this.callAyo());
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) this.callAyo();
        });

        // Color picker buttons (Wild cards)
        document.querySelectorAll('.color-choice').forEach(btn => {
            btn.addEventListener('click', () => this.onColorChosen(btn.dataset.color));
        });

        // Recalculate card positions when the window is resized
        window.addEventListener('resize', () => {
            this.renderHumanHand();
            this.renderBotHands();
        });
    }

    isGameOver() {
        return !document.getElementById('game-over-overlay').classList.contains('hidden');
    }

    // Leave warning / settings: open as an in-game dialog and pause the bots
    openDialog(id) {
        this.paused = true;
        if (this.botThinkingTimeout) {
            clearTimeout(this.botThinkingTimeout);
            this.botThinkingTimeout = null;
            this.resumeTurnOnUnpause = true;
        }
        document.getElementById(id).classList.remove('hidden');
        document.querySelector(`#${id} button`)?.focus();
    }

    closeDialog(id) {
        document.getElementById(id).classList.add('hidden');
        const anyOpen = ['leave-overlay', 'game-settings-overlay']
            .some(d => !document.getElementById(d).classList.contains('hidden'));
        if (anyOpen) return;
        this.paused = false;
        if (this.resumeTurnOnUnpause) {
            this.resumeTurnOnUnpause = false;
            if (!this.isGameOver()) this.startTurn();
        }
    }

    // Going back to the menu mid-game counts as a loss
    forfeitGame() {
        if (!this.matchRecorded && window.AyoStore) {
            this.matchRecorded = true;
            AyoStore.addMatch({
                date: Date.now(),
                won: false,
                forfeit: true,
                winner: null,
                bots: this.botNames.length,
                plays: this.playCount,
                cardsLeft: this.oyuncular["You"].length
            });
        }
        window.location.href = 'index.html';
    }

    renderGameSettings() {
        const s = AyoStore.getSettings();
        document.getElementById('gs-sound').setAttribute('aria-checked', String(s.sound));
        document.getElementById('gs-music').setAttribute('aria-checked', String(s.music));
        const vol = document.getElementById('gs-volume');
        vol.value = Math.round(s.volume * 100);
        vol.disabled = !s.sound && !s.music;
        document.getElementById('gs-vol-label').textContent = Math.round(s.volume * 100) + '%';
        const mark = (id, value) => document.getElementById(id).querySelectorAll('button')
            .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
        mark('gs-speed', s.speed);
        mark('gs-scale', String(s.scale));
        mark('gs-bots', String(s.bots));
    }

    // Save a settings change; sound, volume, speed and scale apply right away,
    // the bot count is read again when the next game starts
    applyGameSetting(patch) {
        const saved = AyoStore.saveSettings(patch);
        Object.assign(this.settings, {
            sound: saved.sound, volume: saved.volume, speed: saved.speed, scale: saved.scale, music: saved.music
        });
        if (window.AyoAudio) AyoAudio.refresh();
        this.renderGameSettings();
        if ('scale' in patch) {
            this.applyUiScale();
            window.dispatchEvent(new Event('resize'));
        }
    }

    setupGameSettings() {
        if (!window.AyoStore) {
            document.getElementById('btn-game-settings').classList.add('hidden');
            return;
        }
        document.getElementById('gs-sound').addEventListener('click', (e) => {
            this.applyGameSetting({ sound: e.currentTarget.getAttribute('aria-checked') !== 'true' });
            this.playClickSound();
        });
        document.getElementById('gs-music').addEventListener('click', (e) => {
            this.applyGameSetting({ music: e.currentTarget.getAttribute('aria-checked') !== 'true' });
            this.playClickSound();
        });
        document.getElementById('gs-volume').addEventListener('input', (e) => {
            this.applyGameSetting({ volume: Number(e.target.value) / 100 });
        });
        document.getElementById('gs-volume').addEventListener('change', () => this.playClickSound());
        const segment = (id, key, toValue) => {
            document.getElementById(id).addEventListener('click', (e) => {
                const b = e.target.closest('button');
                if (!b) return;
                this.applyGameSetting({ [key]: toValue(b.dataset.value) });
                this.playClickSound();
            });
        };
        segment('gs-speed', 'speed', v => v);
        segment('gs-scale', 'scale', Number);
        segment('gs-bots', 'bots', Number);
    }

    // Game log panel: collapse / expand
    toggleLog() {
        const open = !document.getElementById('game-container').classList.contains('log-collapsed');
        this.setLogVisible(!open, true);
    }

    setLogVisible(visible, save) {
        document.getElementById('game-container').classList.toggle('log-collapsed', !visible);
        document.getElementById('btn-log-toggle').setAttribute('aria-expanded', String(visible));
        if (save) {
            try { localStorage.setItem('ayoLogHidden', visible ? '0' : '1'); } catch (e) {}
            this.playClickSound();
        }
        // Table size changes: re-layout the hand once the transition finishes
        setTimeout(() => window.dispatchEvent(new Event('resize')), 380);
    }

    // Safely clear all of an element's children (instead of innerHTML = '')
    clearElement(el) {
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    // Add a message to the game log
    logMessage(msg, type = 'system') {
        const feed = document.getElementById('log-feed');
        // Only follow new messages when the reader is already at the bottom (scrolling up to read stays put)
        const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
        const item = document.createElement('div');
        item.className = `log-item ${type}`;
        item.innerText = msg;
        feed.appendChild(item);

        // The whole game stays readable; only very long games drop their oldest lines
        while (feed.children.length > LOG_LIMIT) {
            feed.removeChild(feed.firstChild);
        }
        if (atBottom) feed.scrollTop = feed.scrollHeight;
    }

    desteOlustur() {
        this.deste = [];
        for (const renk of this.Renkler) {
            this.deste.push(`${renk} 0`);
            for (const deger of this.Degerler.slice(1)) {
                this.deste.push(`${renk} ${deger}`);
                this.deste.push(`${renk} ${deger}`);
            }
        }
        // Wild cards: 4x Color Change, 4x Wild +4
        for (let i = 0; i < 4; i++) {
            this.deste.push("Black Wild");
            this.deste.push("Black +4");
        }
    }

    desteyiKaristir() {
        for (let i = this.deste.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deste[i], this.deste[j]] = [this.deste[j], this.deste[i]];
        }
    }

    kartCek() {
        if (this.deste.length === 0) {
            if (this.ortaYigin.length <= 1) {
                this.desteOlustur();
                this.desteyiKaristir();
                this.logMessage("A new deck was created and shuffled.", "system");
            } else {
                const ust = this.ortaYigin.pop();
                this.deste = [...this.ortaYigin];
                this.ortaYigin = [ust];
                this.desteyiKaristir();
                this.logMessage("The discard pile was shuffled into a new deck.", "system");
            }
        }
        return this.deste.pop();
    }

    // Is this a Wild card (Color Change or +4)?
    isWild(kart) {
        return kart.startsWith("Black ");
    }

    // Is this a penalty card that can be stacked (+2 or +4)?
    isPenaltyCard(kart) {
        return kart.includes("+2") || kart.includes("+4");
    }

    // Wild cards (Color Change and +4) can always be played
    oynanabilirmi(kart) {
        if (!this.ustKart) return true;
        if (this.isWild(kart)) return true;
        const [kartRenk, kartDeger] = kart.split(' ');
        const [ustRenk, ustDeger] = this.ustKart.split(' ');

        return (
            kartRenk === this.guncelRenk ||
            kartDeger === ustDeger
        );
    }

    // Start the game
    startGame() {
        this.resetGameLogic();
        
        // Reset the log
        const logFeed = document.getElementById('log-feed');
        this.clearElement(logFeed);
        const startItem = document.createElement('div');
        startItem.className = 'log-item system';
        startItem.textContent = 'AYO WEB Started!';
        logFeed.appendChild(startItem);
        
        this.desteOlustur();
        this.desteyiKaristir();
        this.startDealing();
    }

    restartGame() {
        this.stopConfetti();
        document.getElementById('game-over-overlay').classList.add('hidden');
        this.startGame();
    }

    // Card dealing animation
    startDealing() {
        this.isAnimating = true;
        this.dealQueue = [];
        
        for (let i = 0; i < 7; i++) {
            for (const player of this.oyuncuSirasi) {
                this.dealQueue.push(player);
            }
        }
        this.triggerNextDeal();
    }

    triggerNextDeal() {
        if (this.dealQueue.length > 0) {
            const player = this.dealQueue.shift();
            const card = this.kartCek();
            
            this.playSound('deal');
            this.animateCardFlight(card, 'draw-pile', player, (player === 'You'), () => {
                this.oyuncular[player].push(card);
                this.renderHumanHand();
                this.renderBotHands();
                this.triggerNextDeal();
            });
        } else {
            // Reveal the first starter card
            let starterCard = this.deste.pop();
            // The starting card can't be a Wild card: put it at the bottom and draw another one
            while (this.isWild(starterCard)) {
                this.deste.unshift(starterCard);
                starterCard = this.deste.pop();
            }
            this.playSound('deal');
            this.animateCardFlight(starterCard, 'draw-pile', 'discard-pile-container', true, () => {
                this.ustKart = starterCard;
                this.ortaYigin.push(starterCard);
                this.guncelRenk = starterCard.split(' ')[0];
                this.isAnimating = false;
                this.logMessage(`Starting card: ${starterCard}`, 'system');
                
                this.updateUI();
                this.startTurn();
            });
        }
    }

    // Card flight animation engine
    animateCardFlight(cardVal, fromId, toIdOrPlayer, faceUp, onComplete) {
        const felt = document.getElementById('felt-table');
        const feltRect = felt.getBoundingClientRect();

        const fromElem = document.getElementById(fromId);
        if (!fromElem) return onComplete();
        const fromRect = fromElem.getBoundingClientRect();

        let toRect;
        if (toIdOrPlayer === 'discard-pile-container') {
            toRect = document.getElementById('discard-pile-container').getBoundingClientRect();
        } else {
            // Target panel position
            const panel = document.querySelector(`.player-panel[id*="${this.getDomIdSuffix(toIdOrPlayer)}"]`);
            if (panel) {
                toRect = panel.getBoundingClientRect();
            } else {
                toRect = { left: feltRect.left + feltRect.width/2, top: feltRect.top + feltRect.height/2 };
            }
        }

        // Create a temporary flying card
        const tempCard = document.createElement('div');
        tempCard.className = 'card animating';
        
        // Set up the card's content
        this.styleCardElement(tempCard, cardVal, faceUp);
            

        // Starting coordinates (relative to the felt table)
        const sc = this.uiScale || 1;   // rects are in screen px, the card lives in scaled layout px
        tempCard.style.left = `${(fromRect.left - feltRect.left) / sc}px`;
        tempCard.style.top = `${(fromRect.top - feltRect.top) / sc}px`;
        tempCard.style.margin = '0';
        tempCard.style.transform = 'none';

        felt.appendChild(tempCard);

        // Force a reflow
        tempCard.getBoundingClientRect();

        // Fly it to the target coordinates
        let targetX = (toRect.left - feltRect.left) / sc;
        let targetY = (toRect.top - feltRect.top) / sc;

        // Add a slight random rotation on its way to the discard pile
        let targetRotate = 'none';
        if (toIdOrPlayer === 'discard-pile-container') {
            const angle = (Math.random() - 0.5) * 20;
            targetRotate = `rotate(${angle}deg)`;
        }

        tempCard.style.left = `${targetX}px`;
        tempCard.style.top = `${targetY}px`;
        tempCard.style.transform = targetRotate;

        tempCard.addEventListener('transitionend', () => {
            felt.removeChild(tempCard);
            onComplete();
        }, { once: true });
    }

        showWhoseTurn(aktifOyuncu) {
        const felt = document.getElementById('felt-table');
        if (!felt) return;

        const existing = felt.querySelector('.turn-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        const isMine = aktifOyuncu === "You";
        banner.className = `turn-banner ${isMine ? 'mine' : 'theirs'}`;
        banner.innerText = isMine ? 'YOUR TURN!' : `${aktifOyuncu} is playing...`;
        felt.appendChild(banner);

        setTimeout(() => {
            if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 1800);

        const handEl = document.getElementById('human-hand');
        const drawPile = document.getElementById('draw-pile');
        if (handEl) handEl.classList.toggle('my-turn-glow', isMine);
        if (drawPile) drawPile.classList.toggle('my-turn-glow', isMine && this.cezaKartlari === 0);

        if (isMine) this.playSound('turn');
    }

    // Build the card div's content and styling
    styleCardElement(cardElem, cardVal, faceUp) {
        if (!faceUp) {
            cardElem.className += ' card-back';
            const inner = document.createElement('div');
            inner.className = 'card-inner';
            const star = document.createElement('div');
            star.className = 'card-star';
            const logo = document.createElement('span');
            logo.className = 'logo-text';
            logo.textContent = 'AYO';
            inner.appendChild(star);
            inner.appendChild(logo);
            cardElem.appendChild(inner);
            return;
        }

        const [renk, deger] = cardVal.split(' ');
        
        // Assign the CSS color class
        const renkClass = {
            "Red": "kirmizi",
            "Blue": "mavi",
            "Green": "yesil",
            "Yellow": "sari",
            "Black": "siyah"
        }[renk];
        cardElem.className += ` ${renkClass}`;

        const inner = document.createElement('div');
        inner.className = 'card-inner';

        const makeDiv = (className, text) => {
            const d = document.createElement('div');
            if (className) d.className = className;
            if (text !== undefined) d.textContent = text;
            return d;
        };

        if (renk === "Black") {
            const label = deger === "+4" ? "+4" : "★";
            inner.appendChild(makeDiv('corner top-left', label));
            inner.appendChild(makeDiv('card-star'));
            inner.appendChild(makeDiv('wild-center'));
            if (deger === "+4") inner.appendChild(makeDiv('value action-text wild-plus4', '+4'));
            inner.appendChild(makeDiv('corner bottom-right', label));
        } else if (deger === "Skip") {
            inner.appendChild(makeDiv('corner top-left special-corner', '⊘'));
            inner.appendChild(makeDiv('card-star'));
            inner.appendChild(makeDiv('special-center skip-icon', '⊘'));
            inner.appendChild(makeDiv('corner bottom-right special-corner', '⊘'));
        } else if (deger === "Reverse") {
            inner.appendChild(makeDiv('corner top-left special-corner', '↺'));
            inner.appendChild(makeDiv('card-star'));
            inner.appendChild(makeDiv('special-center reverse-icon', '↺'));
            inner.appendChild(makeDiv('corner bottom-right special-corner', '↺'));
        } else {
            // Numbers and +2
            const valueClass = deger.length > 2 ? 'value action-text' : 'value';
            inner.appendChild(makeDiv('corner top-left', deger));
            inner.appendChild(makeDiv('card-star'));
            inner.appendChild(makeDiv(valueClass, deger));
            inner.appendChild(makeDiv('corner bottom-right', deger));
        }
        cardElem.appendChild(inner);
    }

    getDomIdSuffix(name) {
        if (name === "You") return "sen";   // the human panel id is #player-sen
        if (name === "Bot 1") return "bot1";
        if (name === "Bot 2") return "bot2";
        if (name === "Bot 3") return "bot3";
        return "";
    }

    // Manage turn order
    startTurn() {
        if (this.isAnimating) return;
        if (this.botThinkingTimeout) {
        clearTimeout(this.botThinkingTimeout);
        this.botThinkingTimeout = null;
        }
        const aktifOyuncu = this.oyuncuSirasi[this.sira];
        
        if (aktifOyuncu === "You") this.ayoCalled = false;

        // Highlight whose turn it is
        document.querySelectorAll('.player-panel').forEach(p => p.classList.remove('active-turn'));
        const activePanel = document.getElementById(`player-${this.getDomIdSuffix(aktifOyuncu)}`);
        if (activePanel) activePanel.classList.add('active-turn');

        // Restart the activation animation even if the same panel stays active
        if (activePanel) {
            activePanel.classList.remove('active-turn');
            void activePanel.offsetWidth;
            activePanel.classList.add('active-turn');
        }
        this.pointTurnRing(aktifOyuncu);

        this.updateUI();

        if (aktifOyuncu !== "You") {
            // Paused by a dialog: the bot moves once it closes
            if (this.paused) {
                this.resumeTurnOnUnpause = true;
                return;
            }
            // Bot's move
            this.botThinkingTimeout = setTimeout(() => {
                this.playBotTurn(aktifOyuncu);
            }, { slow: 1800, normal: 1200, fast: 600 }[this.settings.speed] || 1200);
        }
    }

    // Rotate the glowing ring toward the active player (always the shortest way round)
    pointTurnRing(player) {
        const ring = document.getElementById('turn-ring');
        if (!ring) return;
        const mobile = window.innerWidth <= 768;
        const panel = document.getElementById(`player-${this.getDomIdSuffix(player)}`);
        if (!panel) return;
        let target;
        if (panel.classList.contains('pos-bottom')) target = 180;
        else if (panel.classList.contains('pos-top')) target = 0;
        else if (panel.classList.contains('pos-left')) target = mobile ? -38 : 270;
        else if (panel.classList.contains('pos-right')) target = mobile ? 38 : 90;
        if (target === undefined) return;
        if (this.turnAngle === undefined) this.turnAngle = target;
        const delta = ((target - this.turnAngle) % 360 + 540) % 360 - 180;
        this.turnAngle += delta;
        ring.classList.add('visible');
        ring.style.transform = `translate(-50%, -50%) rotate(${this.turnAngle}deg)`;
    }

    // Human plays a card
    playHumanCard(index) {
        if (this.isAnimating) return;
        if (this.oyuncuSirasi[this.sira] !== "You") {
        this.logMessage("It's not your turn!", "error");
        return;
    }
        const hand = this.oyuncular["You"];
        const card = hand[index];

        if (this.cezaKartlari > 0) {
            // While penalized, only a +2 or +4 can be played (stacking)
            if (!this.isPenaltyCard(card)) {
                this.logMessage("You can only play a +2 / +4 card or draw the penalty cards from the deck!", "error");
                return;
            }
        } else if (!this.oynanabilirmi(card)) {
            this.logMessage("You can't play this card!", "error");
            return;
        }

        this.isAnimating = true;
        this.playCardSound();
        hand.splice(index, 1);

        // The card's coordinates within the hand
        const handContainer = document.getElementById('human-hand');
        const cardsInHand = handContainer.querySelectorAll('.card');
        const cardRect = cardsInHand[index].getBoundingClientRect();
        
        // Temporary flight animation
        const felt = document.getElementById('felt-table');
        const feltRect = felt.getBoundingClientRect();

        const tempCard = document.createElement('div');
        tempCard.className = 'card animating';
        this.styleCardElement(tempCard, card, true);

        const sc = this.uiScale || 1;
        tempCard.style.left = `${(cardRect.left - feltRect.left) / sc}px`;
        tempCard.style.top = `${(cardRect.top - feltRect.top) / sc}px`;
        tempCard.style.margin = '0';
        tempCard.style.transform = 'none';

        felt.appendChild(tempCard);
        this.renderHumanHand(); // Update the rest of the hand right away

        tempCard.getBoundingClientRect(); // Force a reflow

        const destRect = document.getElementById('discard-pile-container').getBoundingClientRect();
        const angle = (Math.random() - 0.5) * 20;

        tempCard.style.left = `${(destRect.left - feltRect.left) / sc}px`;
        tempCard.style.top = `${(destRect.top - feltRect.top) / sc}px`;
        tempCard.style.transform = `rotate(${angle}deg)`;

        tempCard.addEventListener('transitionend', () => {
            felt.removeChild(tempCard);
            
            this.kartOynandi("You", card, hand, `You played: ${card}`, 'human');
        }, { once: true });
    }

    // Human draws a card (normal)
    humanDrawCard() {
        this.isAnimating = true;
        this.playDrawSound();
        const yeniKart = this.kartCek();

        this.animateCardFlight(yeniKart, 'draw-pile', 'You', true, () => {
            this.oyuncular["You"].push(yeniKart);
            this.logMessage("You drew a card from the deck.", "human");
            this.isAnimating = false;
            this.sonrakiOyuncu();
            this.startTurn();
        });
    }

    // Human draws penalty cards
    humanDrawPenalty() {
        this.isAnimating = true;
        this.playWarningSound();
        const nDraw = this.cezaKartlari;
        this.logMessage(`Drawing penalty cards: +${nDraw} card!`, "warning");
        this.cezaKartlari = 0;

        let drawnCount = 0;
        const drawSequence = () => {
            if (drawnCount < nDraw) {
                this.playDrawSound();
                const k = this.kartCek();
                this.animateCardFlight(k, 'draw-pile', 'You', true, () => {
                    this.oyuncular["You"].push(k);
                    this.renderHumanHand();
                    drawnCount++;
                    drawSequence();
                });
            } else {
                this.isAnimating = false;
                document.getElementById('penalty-banner').classList.add('hidden');
                this.sonrakiOyuncu();
                this.startTurn();
            }
        };
        drawSequence();
    }

    // Bot move logic
    playBotTurn(botName) {
        if (this.isAnimating) return;
        if (this.oyuncuSirasi[this.sira] !== botName) return;
        const hand = this.oyuncular[botName];

        if (this.cezaKartlari > 0) {
            // Check for penalty stacking
            // Prefer +2 first, keep the +4 for later
            const plusTwos = hand.filter(k => k.includes("+2"));
            const plusFours = hand.filter(k => k === "Black +4");
            const counters = plusTwos.length > 0 ? plusTwos : plusFours;
            if (counters.length > 0) {
                const secilen = counters[Math.floor(Math.random() * counters.length)];
                hand.splice(hand.indexOf(secilen), 1);
                
                this.isAnimating = true;
                this.playCardSound();
                this.animateCardFlight(secilen, `player-${this.getDomIdSuffix(botName)}`, 'discard-pile-container', true, () => {
                    this.kartOynandi(botName, secilen, hand, `${botName} countered the penalty with a ${secilen.split(' ')[1]}!`, 'bot');
                });
            } else {
                // Draw the penalty
                this.isAnimating = true;
                this.playWarningSound();
                const nDraw = this.cezaKartlari;
                this.logMessage(`${botName} is drawing +${nDraw} penalty cards!`, 'warning');
                this.cezaKartlari = 0;

                let drawn = 0;
                const drawSequence = () => {
                    if (drawn < nDraw) {
                        this.playDrawSound();
                        const k = this.kartCek();
                        this.animateCardFlight(k, 'draw-pile', botName, false, () => {
                            hand.push(k);
                            this.renderBotHands();
                            drawn++;
                            drawSequence();
                        });
                    } else {
                        this.isAnimating = false;
                        document.getElementById('penalty-banner').classList.add('hidden');
                        this.sonrakiOyuncu();
                        this.startTurn();
                    }
                };
                drawSequence();
            }
            return;
        }

        // Normal bot move
        const oynanabilirler = hand.filter(k => this.oynanabilirmi(k));
        
        if (oynanabilirler.length === 0) {
            // Draw a card
            this.isAnimating = true;
            this.playDrawSound();
            const cekilen = this.kartCek();
            this.animateCardFlight(cekilen, 'draw-pile', botName, false, () => {
                hand.push(cekilen);
                this.logMessage(`${botName} drew a card from the deck.`, 'bot');
                this.isAnimating = false;
                this.sonrakiOyuncu();
                this.startTurn();
            });
        } else {
            // Strategy: number cards first, then colored action cards, Wild cards last
            const normallar = oynanabilirler.filter(k => !this.isWild(k) && !k.includes("Skip") && !k.includes("Reverse") && !k.includes("+2"));
            const renkliAksiyon = oynanabilirler.filter(k => !this.isWild(k) && !normallar.includes(k));
            const havuz = normallar.length > 0 ? normallar : (renkliAksiyon.length > 0 ? renkliAksiyon : oynanabilirler);
            const secilen = havuz[Math.floor(Math.random() * havuz.length)];
            
            hand.splice(hand.indexOf(secilen), 1);
            this.isAnimating = true;
            this.playCardSound();

            this.animateCardFlight(secilen, `player-${this.getDomIdSuffix(botName)}`, 'discard-pile-container', true, () => {
                this.kartOynandi(botName, secilen, hand, `${botName} played: ${secilen}`, 'bot');
            });
        }
    }

    // Common logic after any card lands on the discard pile
    kartOynandi(oyuncu, kart, hand, logMsg, logType) {
        if (this.ustKart) this.ortaYigin.push(this.ustKart);
        this.ustKart = kart;
        this.guncelRenk = kart.split(' ')[0];
        this.logMessage(logMsg, logType);

        this.playCount++;
        const devam = () => {
            this.ozelKartUygula(kart);

            if (this.kazananKontrol() === oyuncu) {
                this.endGame(oyuncu);
                return;
            }
            const sonraki = () => {
                this.isAnimating = false;
                this.sonrakiOyuncu();
                this.startTurn();
            };
            if (hand.length === 1) this.ayoKontrol(oyuncu, hand, sonraki);
            else sonraki();
        };

        // Wild card as the last card: the game ends, no need to pick a color
        if (this.isWild(kart) && hand.length > 0) {
            this.renkSec(oyuncu, hand, devam);
        } else {
            devam();
        }
    }

    // Choose the new color after a Wild card
    renkSec(oyuncu, hand, devam) {
        if (oyuncu === "You") {
            // Wait for the player to choose (the game stays locked via isAnimating)
            this.pendingColorCallback = devam;
            document.getElementById('color-picker-overlay').classList.remove('hidden');
            return;
        }
        // Bot: pick the color it holds the most of
        const sayac = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };
        hand.forEach(k => {
            const r = k.split(' ')[0];
            if (r in sayac) sayac[r]++;
        });
        const enCok = Math.max(...Object.values(sayac));
        const adaylar = Object.keys(sayac).filter(r => sayac[r] === enCok);
        const secilen = adaylar[Math.floor(Math.random() * adaylar.length)];
        this.guncelRenk = secilen;
        this.logMessage(`${oyuncu} chose the color ${secilen}!`, 'bot');
        this.renderCenterPile();
        devam();
    }

    onColorChosen(renk) {
        if (!this.pendingColorCallback) return;
        const devam = this.pendingColorCallback;
        this.pendingColorCallback = null;
        this.playClickSound();
        document.getElementById('color-picker-overlay').classList.add('hidden');
        this.guncelRenk = renk;
        this.logMessage(`You chose the color ${renk}!`, 'human');
        this.renderCenterPile();
        devam();
    }

    ozelKartUygula(kart) {
        if (kart.includes("Reverse")) {
            this.yon *= -1;
            this.logMessage("Play direction reversed!", "warning");
            this.playActionSound();
            
            // Update the wheel's class
            const wheel = document.getElementById('center-wheel');
            if (this.yon === 1) {
                wheel.className = 'clockwise';
            } else {
                wheel.className = 'counter-clockwise';
            }
        } else if (kart.includes("Skip")) {
            this.sonrakiOyuncu();
            const pasHedef = this.oyuncuSirasi[this.sira];
            this.logMessage(`${pasHedef} was skipped!`, "warning");
            this.showSpeechBubble(pasHedef, "Skipped!", "block");
            this.playActionSound();
        } else if (kart.includes("+2")) {
            this.cezaKartlari += 2;
            this.logMessage(`Penalty stack: +${this.cezaKartlari} !`, "warning");
            this.playActionSound();
        } else if (kart === "Black +4") {
            this.cezaKartlari += 4;
            this.logMessage(`Wild +4! Penalty stack: +${this.cezaKartlari} !`, "warning");
            this.playActionSound();
        } else if (kart === "Black Wild") {
            this.playActionSound();
        }
    }

    sonrakiOyuncu() {
        this.sira += this.yon;
        if (this.sira >= this.oyuncuSirasi.length) {
            this.sira = 0;
        } else if (this.sira < 0) {
            this.sira = this.oyuncuSirasi.length - 1;
        }
    }

    triggerAyo(player) {
        this.showSpeechBubble(player, "AYO!", "burst");
        this.logMessage(`${player} called AYO!`, 'warning');
        this.playSound('ayo');
    }

    // ---------- AYO: say it when you are down to one card, or draw +1 ----------
    // Bots sometimes forget. You can press AYO during your turn while you hold 2 cards,
    // or within a few seconds after your second-to-last card is played.
    ayoKontrol(oyuncu, hand, devam) {
        if (oyuncu !== "You") {
            if (Math.random() < AYO_FORGET_CHANCE) this.forgotAyo(oyuncu, hand, devam);
            else { this.triggerAyo(oyuncu); devam(); }
            return;
        }
        if (this.ayoCalled) {
            this.ayoCalled = false;
            this.triggerAyo("You");
            devam();
            return;
        }
        // Last chance: the game waits a moment for the button
        const btn = document.getElementById('btn-ayo');
        btn.style.setProperty('--ayo-window', AYO_WINDOW + 'ms');
        const timer = setTimeout(() => {
            this.ayoWindow = null;
            this.renderAyoButton();
            this.forgotAyo("You", hand, devam);
        }, AYO_WINDOW);
        this.ayoWindow = {
            done: () => {
                clearTimeout(timer);
                this.ayoWindow = null;
                this.renderAyoButton();
                this.triggerAyo("You");
                devam();
            }
        };
        this.renderAyoButton();
    }

    callAyo() {
        if (this.isGameOver()) return;
        if (this.ayoWindow) { this.ayoWindow.done(); return; }
        const hand = this.oyuncular["You"];
        const myTurn = this.oyuncuSirasi[this.sira] === "You";
        if (!myTurn || hand.length !== 2 || this.ayoCalled || this.cezaKartlari > 0) return;
        this.ayoCalled = true;
        this.playClickSound();
        this.logMessage("You are ready to call AYO with your next card.", 'human');
        this.renderAyoButton();
    }

    forgotAyo(oyuncu, hand, devam) {
        const who = oyuncu === "You" ? "You" : oyuncu;
        this.logMessage(oyuncu === "You" ? "You forgot to say AYO! +1 card." : `${who} forgot to say AYO! +1 card.`, 'warning');
        this.showSpeechBubble(oyuncu, "Forgot AYO!", "block");
        this.playSound('forgot');
        const k = this.kartCek();
        this.animateCardFlight(k, 'draw-pile', oyuncu, oyuncu === "You", () => {
            hand.push(k);
            this.renderHumanHand();
            this.renderBotHands();
            devam();
        });
    }

    renderAyoButton() {
        const btn = document.getElementById('btn-ayo');
        if (!btn) return;
        const hand = this.oyuncular["You"] || [];
        const myTurn = this.oyuncuSirasi[this.sira] === "You";
        const ready = myTurn && hand.length === 2 && this.cezaKartlari === 0 && !this.ayoCalled;
        btn.classList.toggle('is-ready', ready);
        btn.classList.toggle('is-called', this.ayoCalled);
        btn.classList.toggle('is-urgent', !!this.ayoWindow);
        btn.disabled = !(ready || this.ayoWindow);
    }

    kazananKontrol() {
        for (const oyuncu of this.oyuncuSirasi) {
            if (this.oyuncular[oyuncu].length === 0) {
                return oyuncu;
            }
        }
        return null;
    }

    // Speech bubble next to a player's panel (AYO!, Skipped!). Placement depends on the seat + screen size.
    showSpeechBubble(player, text, icon) {
        const panel = document.getElementById(`player-${this.getDomIdSuffix(player)}`);
        if (!panel) return;

        // Only one bubble per panel at a time
        panel.querySelectorAll('.speech-bubble').forEach(b => b.remove());

        const mobile = window.innerWidth <= 768;
        let place;
        if (panel.classList.contains('pos-bottom')) place = 'b-right';
        else if (mobile) {
            place = panel.classList.contains('pos-left') ? 'b-below-start'
                  : panel.classList.contains('pos-right') ? 'b-below-end' : 'b-below';
        }
        else if (panel.classList.contains('pos-top')) place = 'b-right';
        else place = 'b-above';

        const bubble = document.createElement('div');
        bubble.className = `speech-bubble ${place}` + (icon === 'block' ? ' warn' : '');
        if (icon) {
            const ic = document.createElement('span');
            ic.className = 'bubble-icon';
            ic.appendChild(this.makeIcon(icon));
            bubble.appendChild(ic);
        }
        const label = document.createElement('span');
        label.className = 'bubble-text';
        label.textContent = text;
        bubble.appendChild(label);
        panel.appendChild(bubble);

        requestAnimationFrame(() => requestAnimationFrame(() => bubble.classList.add('show')));
        setTimeout(() => {
            bubble.classList.remove('show');
            setTimeout(() => bubble.remove(), 360);
        }, 2000);
    }

    // Render the UI
    updateUI() {
        this.renderHumanHand();
        this.renderBotHands();
        this.renderCenterPile();
        this.renderAyoButton();

        // Penalty indicator
        const penaltyBanner = document.getElementById('penalty-banner');
        if (this.cezaKartlari > 0) {
            penaltyBanner.querySelector('.penalty-text').innerText = `PENALTY STACK: +${this.cezaKartlari} CARDS!`;
            penaltyBanner.classList.remove('hidden');
            
            const aktifOyuncu = this.oyuncuSirasi[this.sira];
            if (aktifOyuncu === "You") {
                document.getElementById('draw-pile').classList.add('penalty-pulse');
            } else {
                document.getElementById('draw-pile').classList.remove('penalty-pulse');
            }
        } else {
            penaltyBanner.classList.add('hidden');
            document.getElementById('draw-pile').classList.remove('penalty-pulse');
        }
    }

        // Render the human's hand
        renderHumanHand() {
        const container = document.getElementById('human-hand');
        this.clearElement(container);
        
        const hand = this.oyuncular["You"];
        const count = hand.length;
        if (count === 0) return;

        const containerWidth = container.clientWidth || 550;
        const isMobile = window.innerWidth <= 900;
        const cardW = isMobile ? 50 : 80;
        
        let spacing = cardW + 8;
        if (count > 1) {
            spacing = Math.min(cardW + 8, (containerWidth - cardW) / (count - 1));
        }

        const startX = (containerWidth - (spacing * (count - 1) + cardW)) / 2;
        const aktifOyuncu = this.oyuncuSirasi[this.sira];

        hand.forEach((card, idx) => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card';

            // Set up the card's front styling
            this.styleCardElement(cardDiv, card, true);

            // Positioning
            cardDiv.style.left = `${startX + idx * spacing}px`;
            cardDiv.style.zIndex = idx + 1;

            // Lock check (it's not your turn, OR you're penalized and this card isn't a +2)
            const digerininSirasi = aktifOyuncu !== "You";
            const cezaliVeOynanamaz = (aktifOyuncu === "You" && this.cezaKartlari > 0 && !this.isPenaltyCard(card));
            const isLocked = digerininSirasi || cezaliVeOynanamaz;

            if (isLocked) {
                cardDiv.classList.add('dimmed');
            } else {
                cardDiv.addEventListener('click', () => this.playHumanCard(idx));
            }

            container.appendChild(cardDiv);
        });

        // Update the panel's card count
        document.querySelector('#player-sen .card-count').innerText = `${count} Card`;
        document.getElementById('player-sen').classList.toggle('low-cards', count <= 2);
    }

    // Render the bots' info
    renderBotHands() {
        for (const bot of this.botNames) {
            const suffix = this.getDomIdSuffix(bot);
            const hand = this.oyuncular[bot];
            const count = hand.length;

            // Panel count
            document.querySelector(`#player-${suffix} .card-count`).innerText = `${count} Card`;
            document.getElementById(`player-${suffix}`).classList.toggle('low-cards', count > 0 && count <= 2);

            // Mini visuals (just symbolic card backs)
            const handElem = document.querySelector(`#player-${suffix} .hand`);
            this.clearElement(handElem);
            
            const maxVisible = Math.min(5, count);
            for (let i = 0; i < maxVisible; i++) {
                const back = document.createElement('div');
                back.className = 'card card-back';
                back.style.width = '24px';
                back.style.height = '36px';
                back.style.borderRadius = '3px';
                back.style.position = 'relative';
                back.style.boxShadow = '1px 1px 3px rgba(0,0,0,0.3)';
                back.style.marginLeft = i > 0 ? '-14px' : '0px';

                const backInner = document.createElement('div');
                backInner.className = 'card-inner';
                backInner.style.borderWidth = '1px';
                const backStar = document.createElement('div');
                backStar.className = 'card-star';
                backStar.style.position = 'absolute';
                backStar.style.width = '90%';
                backStar.style.height = '80%';
                backStar.style.top = '10%';
                backStar.style.left = '5%';
                backInner.appendChild(backStar);
                back.appendChild(backInner);

                handElem.appendChild(back);
            }
            if (count > 5) {
                const plus = document.createElement('div');
                plus.style.fontSize = '11px';
                plus.style.fontWeight = 'bold';
                plus.style.marginLeft = '4px';
                plus.innerText = `+${count - 5}`;
                handElem.appendChild(plus);
            }
        }
    }

    // Update the discard pile in the middle
    renderCenterPile() {
        const container = document.getElementById('discard-pile');
        this.clearElement(container);

        if (this.ustKart) {
            // Layers underneath
            const len = this.ortaYigin.length;
            for (let i = Math.max(0, len - 3); i < len - 1; i++) {
                const oldCard = this.ortaYigin[i];
                const cardDiv = document.createElement('div');
                cardDiv.className = 'card';
                this.styleCardElement(cardDiv, oldCard, true);
                cardDiv.style.opacity = '0.35';
                
                const angle = (i - (len - 2)) * 8;
                cardDiv.style.transform = `rotate(${angle}deg)`;
                container.appendChild(cardDiv);
            }

            // The top one
            const topCard = document.createElement('div');
            topCard.className = 'card';
            this.styleCardElement(topCard, this.ustKart, true);
            container.appendChild(topCard);
        }

        // Active color: its quarter of the ring on the table glows
        const glow = document.getElementById('color-glow');
        if (glow) glow.dataset.color = this.guncelRenk || '';

        // Active color badge
        const badge = document.getElementById('active-color-badge');
        if (this.guncelRenk) {
            const colorHex = {
                "Red": "#e63946",
                "Blue": "#1c5fd0",
                "Green": "#2a8f2e",
                "Yellow": "#e9c46a"
            };
            badge.style.backgroundColor = colorHex[this.guncelRenk] || 'var(--color-bg)';
            badge.innerText = this.guncelRenk[0];
            badge.style.color = this.guncelRenk === "Yellow" ? "#000" : "#fff";
        }
    }

    // Small inline SVG icons (used instead of emoji)
    makeIcon(name) {
        const paths = {
            block: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6 18L18 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
            burst: '<path d="M12 1l2.6 6.6L21 5l-3 6.2L23 14l-6.6 1.2L16 22l-4-5-4 5-.4-6.8L1 14l5-2.8L3 5l6.4 2.6z" fill="currentColor"/>'
        };
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'inline-icon');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = paths[name] || '';
        return svg;
    }

    // Winner overlay
    endGame(winner) {
        const overlay = document.getElementById('game-over-overlay');
        const box = document.getElementById('game-over-box');
        const kicker = document.getElementById('over-kicker');
        const title = document.getElementById('win-title');
        const sub = document.getElementById('win-subtitle');
        const won = winner === "You";

        // Save the match to the history (once per game)
        if (!this.matchRecorded && window.AyoStore) {
            this.matchRecorded = true;
            AyoStore.addMatch({
                date: Date.now(),
                won,
                winner,
                bots: this.botNames.length,
                plays: this.playCount,
                cardsLeft: this.oyuncular["You"].length
            });
        }

        overlay.classList.toggle('is-win', won);
        overlay.classList.toggle('is-lose', !won);
        box.classList.toggle('is-win', won);
        box.classList.toggle('is-lose', !won);

        if (won) {
            kicker.innerText = "VICTORY";
            title.innerText = "YOU WIN";
            sub.innerText = "You got rid of all your cards and beat every bot.";
            this.startConfetti();
            this.playWinSound();
        } else {
            kicker.innerText = "DEFEAT";
            title.innerText = "YOU LOSE";
            sub.innerText = `${winner} played their last card. Better luck next time.`;
            this.playLoseSound();
        }

        // Final standings: fewest cards left first
        const list = document.getElementById('over-standings');
        this.clearElement(list);
        const rows = this.oyuncuSirasi
            .map(name => ({ name, left: this.oyuncular[name].length }))
            .sort((a, b) => a.left - b.left);
        rows.forEach((r, i) => {
            const li = document.createElement('li');
            li.className = 'over-row' + (r.name === winner ? ' is-winner' : '') + (r.name === "You" ? ' is-you' : '');
            const rank = document.createElement('span');
            rank.className = 'over-rank';
            rank.textContent = String(i + 1);
            const nm = document.createElement('span');
            nm.className = 'over-name';
            nm.textContent = r.name;
            const left = document.createElement('span');
            left.className = 'over-left';
            left.textContent = r.left === 0 ? 'Winner' : `${r.left} card${r.left === 1 ? '' : 's'} left`;
            li.append(rank, nm, left);
            list.appendChild(li);
        });

        overlay.classList.remove('hidden');
    }

    // --- Confetti effect system (Canvas) ---
    initConfetti() {
        this.canvas = document.getElementById('confetti-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.confettiParticles = [];
        this.confettiActive = false;

        // Set the size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        if (this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }
    }

    startConfetti() {
        this.confettiActive = true;
        this.confettiParticles = [];
        for (let i = 0; i < 100; i++) {
            this.confettiParticles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height - this.canvas.height,
                size: Math.random() * 8 + 6,
                color: ["#e63946", "#1c5fd0", "#2a8f2e", "#e9c46a", "#f4a261"][Math.floor(Math.random() * 5)],
                speedY: Math.random() * 4 + 3,
                speedX: Math.random() * 2 - 1,
                rot: Math.random() * 360,
                rotSpeed: Math.random() * 4 - 2
            });
        }
        this.animateConfetti();
    }

    animateConfetti() {
        if (!this.confettiActive) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        let active = false;
        this.confettiParticles.forEach(p => {
            p.y += p.speedY;
            p.x += p.speedX;
            p.rot += p.rotSpeed;

            if (p.y < this.canvas.height + 20) {
                active = true;
                
                this.ctx.save();
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate(p.rot * Math.PI / 180);
                this.ctx.fillStyle = p.color;
                this.ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
                this.ctx.restore();
            } else {
                p.y = -20;
                p.x = Math.random() * this.canvas.width;
            }
        });

        if (active) {
            requestAnimationFrame(() => this.animateConfetti());
        }
    }

    stopConfetti() {
        this.confettiActive = false;
        if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // --- Sounds (synthesized in audio.js) ---
    playSound(name) {
        if (window.AyoAudio) AyoAudio.play(name);
    }

    playCardSound() { this.playSound('card'); }
    playDrawSound() { this.playSound('draw'); }
    playActionSound() { this.playSound('action'); }
    playWarningSound() { this.playSound('penalty'); }
    playWinSound() { this.playSound('win'); }
    playLoseSound() { this.playSound('lose'); }
    playClickSound() { this.playSound('click'); }

    // --- Game sharing features ---
    openShareModal() {
        this.playClickSound();
        // Share the main menu page, not the running game
        const shareUrl = new URL('index.html', window.location.href).href;
        document.getElementById('share-url').value = shareUrl;
        
        // Using a QR code generator API
        const qrImg = document.getElementById('qr-image');
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;
        
        const overlay = document.getElementById('share-overlay');
        overlay.classList.remove('hidden');
    }

    closeShareModal() {
        this.playClickSound();
        document.getElementById('share-overlay').classList.add('hidden');
    }

    copyShareUrl() {
        this.playClickSound();
        const copyText = document.getElementById('share-url');
        copyText.select();
        copyText.setSelectionRange(0, 99999);
        
        navigator.clipboard.writeText(copyText.value)
            .then(() => {
                const copyBtn = document.getElementById('btn-copy-link');
                const origText = copyBtn.innerText;
                copyBtn.innerText = "Copied!";
                copyBtn.style.backgroundColor = "var(--color-green)";
                setTimeout(() => {
                    copyBtn.innerText = origText;
                    copyBtn.style.backgroundColor = "";
                }, 2000);
            })
            .catch(err => {
                console.error("Copy failed:", err);
            });
    }
}

// Start the game
window.addEventListener('DOMContentLoaded', () => {
    window.game = new WebAyoGame();
    window.game.startGame();   // the game page starts right away; the menu is a separate page
});