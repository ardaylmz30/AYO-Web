# Ayo Web

A modern browser-based card game inspired by the classic UNO experience.

Built with HTML, CSS and JavaScript, with a small Node.js server for the online features. Ayo Web has bots to play against, a friend system with live invites, six table themes, generated café music and smooth animations, on both desktop and mobile.

> Türkçe için: [README_TR.md](README_TR.md)

## Features

**Gameplay**
- Play against 1 to 3 bots with adjustable speed
- Wild and Wild +4 cards (both can be played at any time), +2 / +4 stacking, Skip, Reverse
- **AYO button**: call AYO when you are down to one card, or draw +1. You can call it ahead of time while you hold two cards, or within a short countdown after your second-to-last card. Bots sometimes forget, too.
- The color in play glows on the ring in the middle of the table
- Full game log you can scroll back through

**Friends (needs the server)**
- Friend codes (`AYO-XXXX`), friend requests with a pending requests list
- Online status, game invites answered right on the friends list
- Friend profiles: online / last seen and match record

**Look and sound**
- Six themes: Classic, Midnight, Royal, Lagoon, Neon Night, Graphite (table, rim, background, highlights)
- Sound effects and two background music pieces (menu and game), all synthesized in the browser with the Web Audio API: no audio files, no copyrighted samples
- Interface scale, sound / music / volume settings, match history and stats

## Project Structure

```
Ayo-Web/
├── server.js           # Node.js server: serves public/ + online features (Socket.IO)
├── package.json        # Server dependencies (express, socket.io)
├── web-launcher.bat    # Windows: installs packages (first run) and starts the server
├── data/               # Created by the server at runtime (not in git): players, friends, requests
├── public/
│   ├── index.html      # Main menu
│   ├── menu.js         # Menu: panels, settings, friends, profiles, themes
│   ├── menu.css        # Menu styles
│   ├── game.html       # Game page
│   ├── app.js          # Game logic, bots, AYO rule, animations
│   ├── style.css       # Game styles
│   ├── themes.css      # Theme colors (table, rim, background, accent)
│   ├── audio.js        # Synthesized sound effects and background music
│   ├── online.js       # Server connection: presence, friend requests, game invites
│   ├── settings.js     # Settings, profile, friends and match history (localStorage)
│   └── bg-pattern.svg  # Background pattern
├── Screenshots/
├── README.md
└── README_TR.md
```

## Technologies

- HTML5, CSS3, JavaScript (ES2020)
- Web Audio API (sound effects and music)
- Node.js, Express, Socket.IO (online features)

## Installation

```bash
git clone https://github.com/<your-username>/ayo-web.git
cd ayo-web
```

Install [Node.js](https://nodejs.org) (18 or newer), then run `web-launcher.bat` (Windows) or:

```bash
npm install
npm start
```

The game runs on http://localhost:8001. Phones on the same Wi-Fi can join through the computer's local IP (the launcher prints it).

Serving `public/` with a plain static file server also works, but then friend requests and invites stay offline.

### Testing with several accounts

Each account lives in the browser's storage for one address, so you can open several on one computer: `http://localhost:8001`, `http://127.0.0.1:8001`, your local IP, a private window or another browser are all separate players.

## Screenshots

![Menu Mobile](Screenshots/Mobile-Menu.png)
![Desk Mobile](Screenshots/Mobile-Desk.png)
![Menu PC](Screenshots/PC-Menu.png)
![Desk PC](Screenshots/PC-Desk.png)

## Roadmap

### Gameplay

- [x] Wild Card
- [x] Wild Draw 4
- [x] "Call AYO" button and penalty
- [ ] Custom rules

### Multiplayer

- [x] Friend system (requests, online status, game invites)
- [x] Friend profiles
- [ ] Online multiplayer matches
- [ ] Private rooms
- [ ] Ranked matchmaking

### Player Progress

- [x] Match history and statistics
- [ ] Achievements

### Other

- [x] Themes
- [x] Background music
- [ ] More languages

## License

This project is intended for educational purposes only.

## Disclaimer

This project is a fan-made game created for educational and non-commercial purposes. UNO is a trademark of Mattel. This project is not affiliated with, endorsed by, or sponsored by Mattel.
