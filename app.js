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

class WebAyoGame {
    constructor() {
        this.Renkler = ["Red", "Blue", "Green", "Yellow"];
        this.Degerler = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Skip", "Reverse", "+2"];

        this.resetGameLogic();
        this.setupEventListeners();
        this.initConfetti();
        this.initAudio();
    }

    resetGameLogic() {
        if (this.botThinkingTimeout) {
        clearTimeout(this.botThinkingTimeout);
        }
        this.botThinkingTimeout = null;
        this.deste = [];
        this.ortaYigin = [];
        this.oyuncular = {
            "You": [],
            "Bot 1": [],
            "Bot 2": [],
            "Bot 3": [],
        };
        this.oyuncuSirasi = Object.keys(this.oyuncular);
        this.sira = 0;
        this.yon = 1;
        this.ustKart = null;
        this.guncelRenk = null;
        this.cezaKartlari = 0;

        this.isAnimating = false;
        this.botThinkingTimeout = null;
        this.dealQueue = [];
    }

    setupEventListeners() {
        document.getElementById('btn-start').addEventListener('click', () => this.startGame());
        document.getElementById('btn-restart').addEventListener('click', () => this.restartGame());
        
        // Share buttons
        document.getElementById('btn-menu-share').addEventListener('click', () => this.openShareModal());
        document.getElementById('btn-sidebar-share').addEventListener('click', () => this.openShareModal());
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

        // Recalculate card positions when the window is resized
        window.addEventListener('resize', () => {
            this.renderHumanHand();
            this.renderBotHands();
        });
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
        const item = document.createElement('div');
        item.className = `log-item ${type}`;
        item.innerText = msg;
        feed.appendChild(item);
        feed.scrollTop = feed.scrollHeight;

        // Keep the log within its limit
        while (feed.children.length > 20) {
            feed.removeChild(feed.firstChild);
        }
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

    oynanabilirmi(kart) {
        if (!this.ustKart) return true;
        const [kartRenk, kartDeger] = kart.split(' ');
        const [ustRenk, ustDeger] = this.ustKart.split(' ');

        return (
            kartRenk === this.guncelRenk ||
            kartDeger === ustDeger
        );
    }

    // Start the game
    startGame() {
        this.playClickSound();
        document.getElementById('menu-overlay').classList.add('hidden');
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
            
            this.playTone(450, 'sine', 0.04, 0.05);
            this.animateCardFlight(card, 'draw-pile', player, (player === 'You'), () => {
                this.oyuncular[player].push(card);
                this.renderHumanHand();
                this.renderBotHands();
                this.triggerNextDeal();
            });
        } else {
            // Reveal the first starter card
            const starterCard = this.deste.pop();
            this.playTone(450, 'sine', 0.04, 0.05);
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
        tempCard.style.left = `${fromRect.left - feltRect.left}px`;
        tempCard.style.top = `${fromRect.top - feltRect.top}px`;
        tempCard.style.margin = '0';
        tempCard.style.transform = 'none';

        felt.appendChild(tempCard);

        // Force a reflow
        tempCard.getBoundingClientRect();

        // Fly it to the target coordinates
        let targetX = toRect.left - feltRect.left;
        let targetY = toRect.top - feltRect.top;

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
        banner.innerText = isMine ? 'YOUR TURN! 👉' : `${aktifOyuncu} is playing...`;
        felt.appendChild(banner);

        setTimeout(() => {
            if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 1800);

        const handEl = document.getElementById('human-hand');
        const drawPile = document.getElementById('draw-pile');
        if (handEl) handEl.classList.toggle('my-turn-glow', isMine);
        if (drawPile) drawPile.classList.toggle('my-turn-glow', isMine && this.cezaKartlari === 0);

        if (isMine) {
            this.playTone(700, 'sine', 0.12, 0.12);
            this.playTone(900, 'sine', 0.12, 0.12, 0.1);
        }
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
            "Yellow": "sari"
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

        if (deger === "Skip") {
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
        if (name === "You") return "you";
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
        
        // Highlight whose turn it is
        document.querySelectorAll('.player-panel').forEach(p => p.classList.remove('active-turn'));
        const activePanel = document.getElementById(`player-${this.getDomIdSuffix(aktifOyuncu)}`);
        if (activePanel) activePanel.classList.add('active-turn');

        this.updateUI();

        if (aktifOyuncu !== "You") {
            // Bot's move
            this.botThinkingTimeout = setTimeout(() => {
                this.playBotTurn(aktifOyuncu);
            }, 1200);
        }
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
            // While penalized, only a +2 can be played
            if (!card.includes("+2")) {
                this.logMessage("You can only play a +2 card or draw the penalty cards from the deck!", "error");
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

        tempCard.style.left = `${cardRect.left - feltRect.left}px`;
        tempCard.style.top = `${cardRect.top - feltRect.top}px`;
        tempCard.style.margin = '0';
        tempCard.style.transform = 'none';

        felt.appendChild(tempCard);
        this.renderHumanHand(); // Update the rest of the hand right away

        tempCard.getBoundingClientRect(); // Force a reflow

        const destRect = document.getElementById('discard-pile-container').getBoundingClientRect();
        const angle = (Math.random() - 0.5) * 20;

        tempCard.style.left = `${destRect.left - feltRect.left}px`;
        tempCard.style.top = `${destRect.top - feltRect.top}px`;
        tempCard.style.transform = `rotate(${angle}deg)`;

        tempCard.addEventListener('transitionend', () => {
            felt.removeChild(tempCard);
            
            if (this.ustKart) this.ortaYigin.push(this.ustKart);
            this.ustKart = card;
            this.guncelRenk = card.split(' ')[0];
            this.logMessage(`You played: ${card}`, 'human');

            this.ozelKartUygula(card);

            if (hand.length === 1) this.triggerAyo("You");

            if (this.kazananKontrol() === "You") {
                this.endGame("You");
            } else {
                this.isAnimating = false;
                this.sonrakiOyuncu();
                this.startTurn();
            }
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
            const plusTwos = hand.filter(k => k.includes("+2"));
            if (plusTwos.length > 0) {
                const secilen = plusTwos[Math.floor(Math.random() * plusTwos.length)];
                hand.splice(hand.indexOf(secilen), 1);
                
                this.isAnimating = true;
                this.playCardSound();
                this.animateCardFlight(secilen, `player-${this.getDomIdSuffix(botName)}`, 'discard-pile-container', true, () => {
                    if (this.ustKart) this.ortaYigin.push(this.ustKart);
                    this.ustKart = secilen;
                    this.guncelRenk = secilen.split(' ')[0];
                    this.logMessage(`${botName} countered the penalty with a +2!`, 'bot');

                    this.ozelKartUygula(secilen);

                    if (hand.length === 1) this.triggerAyo(botName);

                    if (this.kazananKontrol() === botName) {
                        this.endGame(botName);
                    } else {
                        this.isAnimating = false;
                        this.sonrakiOyuncu();
                        this.startTurn();
                    }
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
            // Prefer number cards over action cards (a bit of strategy)
            const normallar = oynanabilirler.filter(k => !k.includes("Skip") && !k.includes("Reverse") && !k.includes("+2"));
            const secilen = normallar.length > 0 ? normallar[Math.floor(Math.random() * normallar.length)] : oynanabilirler[Math.floor(Math.random() * oynanabilirler.length)];
            
            hand.splice(hand.indexOf(secilen), 1);
            this.isAnimating = true;
            this.playCardSound();

            this.animateCardFlight(secilen, `player-${this.getDomIdSuffix(botName)}`, 'discard-pile-container', true, () => {
                if (this.ustKart) this.ortaYigin.push(this.ustKart);
                this.ustKart = secilen;
                this.guncelRenk = secilen.split(' ')[0];
                this.logMessage(`${botName} played: ${secilen}`, 'bot');

                this.ozelKartUygula(secilen);

                if (hand.length === 1) this.triggerAyo(botName);

                if (this.kazananKontrol() === botName) {
                    this.endGame(botName);
                } else {
                    this.isAnimating = false;
                    this.sonrakiOyuncu();
                    this.startTurn();
                }
            });
        }
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
            this.showSpeechBubble(pasHedef, "Skipped!! 🚫");
            this.playActionSound();
        } else if (kart.includes("+2")) {
            this.cezaKartlari += 2;
            this.logMessage(`Penalty stack: +${this.cezaKartlari} !`, "warning");
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
        this.showSpeechBubble(player, "AYO! 💥");
        this.logMessage(`${player} called AYO!`, 'warning');
        this.playWarningSound();
    }

    kazananKontrol() {
        for (const oyuncu of this.oyuncuSirasi) {
            if (this.oyuncular[oyuncu].length === 0) {
                return oyuncu;
            }
        }
        return null;
    }

    // Show the AYO speech bubble
    showSpeechBubble(player, text) {

    const bubble = document.createElement('div');

    bubble.className = 'speech-bubble';
    bubble.innerText = text;

    const panel = document.getElementById(`player-${this.getDomIdSuffix(player)}`);

    if (panel) {

        // Add it first so we can measure its real width
        panel.appendChild(bubble);
            if (panel.classList.contains("pos-left")) {
                bubble.classList.add("bubble-left");
            }
            else if (panel.classList.contains("pos-right")) {
                bubble.classList.add("bubble-right");
            }
            else if (panel.classList.contains("pos-top")) {
                bubble.classList.add("bubble-top");
            }
            else if (panel.classList.contains("pos-bottom")) {
                bubble.classList.add("bubble-bottom");
            }

        bubble.style.left = "";
        bubble.style.top = "";
        bubble.style.marginTop = "";

        requestAnimationFrame(() => {
            bubble.classList.add("show");
        });

        setTimeout(() => {

            bubble.style.opacity = "0";

            bubble.addEventListener("transitionend", () => {

                bubble.remove();

            }, { once: true });

        }, 2000);

    }

}

    // Render the UI
    updateUI() {
        this.renderHumanHand();
        this.renderBotHands();
        this.renderCenterPile();

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
            const cezaliVeOynanamaz = (aktifOyuncu === "You" && this.cezaKartlari > 0 && !card.includes("+2"));
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
    }

    // Render the bots' info
    renderBotHands() {
        for (const bot of ["Bot 1", "Bot 2", "Bot 3"]) {
            const suffix = this.getDomIdSuffix(bot);
            const hand = this.oyuncular[bot];
            const count = hand.length;

            // Panel count
            document.querySelector(`#player-${suffix} .card-count`).innerText = `${count} Card`;

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

        // Active color badge
        const badge = document.getElementById('active-color-badge');
        if (this.guncelRenk) {
            const colorHex = {
                "Red": "#e63946",
                "Blue": "#0077b6",
                "Green": "#2a9d8f",
                "Yellow": "#e9c46a"
            };
            badge.style.backgroundColor = colorHex[this.guncelRenk] || 'var(--color-bg)';
            badge.innerText = this.guncelRenk[0];
            badge.style.color = this.guncelRenk === "Yellow" ? "#000" : "#fff";
        }
    }

    // Winner overlay
    endGame(winner) {
        const overlay = document.getElementById('game-over-overlay');
        const title = document.getElementById('win-title');
        const sub = document.getElementById('win-subtitle');

        if (winner === "You") {
            title.innerText = "CONGRATULATIONS, YOU WIN! 🎉";
            title.style.color = "var(--color-yellow)";
            sub.innerText = "You defeated all the bots with some great plays!";
            this.startConfetti();
            this.playWinSound();
        } else {
            title.innerText = "YOU LOSE! 😢";
            title.style.color = "var(--color-red)";
            sub.innerText = `${winner} won the game. Better luck next time`;
            this.playLoseSound();
        }

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
                color: ["#e63946", "#0077b6", "#2a9d8f", "#e9c46a", "#f4a261"][Math.floor(Math.random() * 5)],
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

    // --- Sound synthesizer engine (Web Audio API) ---
    initAudio() {
        this.audioCtx = null;
    }

    playTone(frequency, type, duration, volume = 0.1, delay = 0) {
        try {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime + delay);

            gain.gain.setValueAtTime(volume, this.audioCtx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + delay + duration);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start(this.audioCtx.currentTime + delay);
            osc.stop(this.audioCtx.currentTime + delay + duration);
        } catch (e) {
            console.warn("Audio Context Hatası:", e);
        }
    }

    playCardSound() {
        this.playTone(600, 'triangle', 0.08, 0.15);
        this.playTone(450, 'triangle', 0.08, 0.12, 0.03);
    }

    playDrawSound() {
        this.playTone(350, 'sine', 0.15, 0.15);
        this.playTone(280, 'sine', 0.15, 0.12, 0.05);
    }

    playActionSound() {
        this.playTone(520, 'square', 0.1, 0.08);
        this.playTone(659, 'square', 0.15, 0.08, 0.1);
    }

    playWarningSound() {
        this.playTone(880, 'sawtooth', 0.15, 0.05);
        this.playTone(880, 'sawtooth', 0.15, 0.05, 0.25);
    }

    playWinSound() {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
            this.playTone(freq, 'sine', 0.25, 0.15, idx * 0.12);
        });
    }

    playLoseSound() {
        const notes = [392.00, 349.23, 311.13, 261.63];
        notes.forEach((freq, idx) => {
            this.playTone(freq, 'sine', 0.35, 0.15, idx * 0.2);
        });
    }

    playClickSound() {
        this.playTone(400, 'sine', 0.05, 0.1);
    }

    // --- Game sharing features ---
    openShareModal() {
        this.playClickSound();
        const shareUrl = window.location.href;
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
                copyBtn.innerText = "Kopyalandı!";
                copyBtn.style.backgroundColor = "var(--color-green)";
                setTimeout(() => {
                    copyBtn.innerText = origText;
                    copyBtn.style.backgroundColor = "";
                }, 2000);
            })
            .catch(err => {
                console.error("Kopyalama başarısız:", err);
            });
    }
}

// Start the game
window.addEventListener('DOMContentLoaded', () => {
    window.game = new WebAyoGame();
});