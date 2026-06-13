# Turf Wars — Online Multiplayer

## What you need

1. A **Railway** account (free) — https://railway.app
2. A **GitHub** account (free) — to host the code

That's it. No credit card required for the free tier.

---

## One-time setup (takes ~15 minutes)

### Step 1 — Put the code on GitHub

1. Go to https://github.com/new
2. Create a new repository called `turf-wars`
3. Upload all files from the `turf-wars-online` folder:
   - `package.json`
   - `server/index.js`
   - `server/engine.js`
   - `public/index.html`

### Step 2 — Deploy on Railway

1. Go to https://railway.app and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `turf-wars` repository
4. Railway detects Node.js automatically and runs `npm start`
5. Click **Generate Domain** in the Settings tab
6. Your game is live at the URL Railway gives you (e.g. `turf-wars-production.up.railway.app`)

### Step 3 — Play

1. Open the URL in your browser
2. Enter your name, pick player count, click **Create Room**
3. Share the 4-letter room code with friends
4. They open the same URL, enter their name, paste the code, click **Join**
5. Game starts automatically when all players have joined

---

## How private hands work

- The server holds the full game state including all hands and the deck order
- Each player's browser only receives their own hand — opponents see only card counts
- You cannot cheat by inspecting browser state because your hand data is sent only to your socket connection

---

## Free tier limits (Railway)

- 500 hours/month of runtime (enough for ~20 hours/day)
- Sleeps after inactivity — first load after sleep takes ~10 seconds
- Upgrade to $5/month for always-on if you want to avoid the sleep

## Local testing (before deploying)

```bash
cd turf-wars-online
npm install
npm start
# open http://localhost:3000 in two browser tabs
```

---

## File structure

```
turf-wars-online/
├── package.json          ← Node dependencies
├── server/
│   ├── index.js          ← Game server (Socket.io, room management, card logic)
│   └── engine.js         ← Deck building, game state projection
└── public/
    └── index.html        ← Client (React, lobby, game UI)
```
