# Price Watcher Bot

A Telegram bot that tracks price changes for products on **Wildberries**.  
Users can subscribe to specific items and get notified when the price changes.

Built with **Node.js**, **Telegraf**, and **MongoDB**.  
Runs autonomously on a server without Docker, managed via **PM2**.  
The goal is to provide a reliable, minimalistic tool that solves a specific problem.

---

## ⚙️ Tech Stack

- **Node.js 22**
- **Telegraf 4.x** — Telegram Bot Framework  
- **MongoDB 7.x** — Data storage for users and subscriptions  
- **PM2** — Production process manager  
- **nvm** — Node.js version manager  
- **Bash + rsync** — Deployment automation  
- **Custom Wildberries API** — Price and product data fetching

---

## 🧩 Core Functionality

The bot handles user commands and inline buttons via Telegram UI.

Main user interactions:
- `/start` — greet new users  
- **➕ Add product** — request article or link  
- **📋 My subscriptions** — show tracked items  
- **❌ Unsubscribe all** — clear all subscriptions  

All UI logic lives in `src/bot/ui.mjs` and `src/bot/tgBot.mjs`,  
while messages are built dynamically with Markdown and inline keyboards.

---

## 🧠 Technical Highlights

### 🔹 Automatic Message Cleanup

The bot keeps chats clean by tracking and removing outdated messages.  
All message operations go through a wrapper `createTrackedUi()`:

```js
const trackedUi = createTrackedUi(ui, msgStore)
```

This proxy intercepts all `reply*` and `send*` calls,  
cleans old messages and registers new ones for later deletion.

---

## 🧱 Project Structure

```
src/
├── bot/
│   ├── tgBot.mjs           # Main Telegram bot logic
│   ├── ui.mjs              # UI and message functions
│   ├── tracked-ui.mjs      # Message cleanup wrapper
│   ├── user-service.mjs    # User and subscription logic
│   ├── messages.mjs        # MessageStore implementation
├── services/
│   ├── wbApi.mjs           # Wildberries API integration
│   └── basketMap.mjs       # WB images baskets
├── data/
│   └── message-cache.json  # Persistent message cache
└── index.js                # Entry point
```

Architecture: hybrid — class-based services and functional modules.  
Each component is isolated and testable.

---

## 🚀 Deployment

### 1️⃣ Setup server (once)

Server: **Ubuntu**, user `pwb`, local MongoDB.

```bash
npm run setup
```

This script:
- creates user `pwb`
- installs MongoDB and Node.js (via nvm)
- installs PM2 and enables auto-start

---

### 2️⃣ Deploy from Mac

```bash
npm run deploy
```

`deploy.sh`:
- syncs files via `rsync`  
- installs dependencies (`npm ci --omit=dev`)  
- restarts the bot with PM2  
- requires no git or manual file copying

---

### 3️⃣ Managing the Bot

| Command | Description |
|----------|-------------|
| `npm run start` | Start bot via PM2 |
| `npm run restart` | Reload process |
| `npm run stop` | Stop all PM2 processes |
| `npm run logs` | View logs |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |

---

## 🔑 Configuration

Private data is stored in `auth/auth.mjs` (excluded from git):

```js
export const BOT_TOKEN = 'telegram-bot-token'
export const SERVER_HOST = '11.111.111.11'
export const SERVER_PORT = '1111' // if needed
```

A public template is provided as `auth/auth.mjs.sample`.

---

## 🧠 Code Features

- Graceful shutdown (`SIGINT`) with persistent cache  
- Pure async functions  
- Single entry point (`index.js`)  
- Auto-cleanup for inactive users (TTL in MessageStore)  
- Persistent cache between restarts  

---

## 🪄 Why No Docker

The project is small and efficient enough without containers.  
Deployment and setup are handled by Bash scripts (`setup.sh`, `deploy.sh`),  
which simplifies maintenance and keeps infrastructure lean.

---

## 🧩 Requirements

- Ubuntu 22+
- Node.js 22 (via nvm)
- MongoDB 7+
- PM2 5+

---

## 📜 License

MIT License  
© Riabinin Pavel, 2025

---

## ✉️ Contact

GitHub: [RPG812](https://github.com/RPG812)
