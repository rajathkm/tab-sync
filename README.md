# Relay

Real-time tab sync across browsers and devices. Open a tab on your Mac Mini, it appears on your MacBook. Navigate to an article, the other device follows. Close a tab, it closes everywhere.

Works with **Chrome** and **Dia** browser on **macOS**.

---

## How it works

Relay has two parts:

1. **Server** — a lightweight WebSocket relay that runs on one always-on machine (Mac Mini, desktop, or a cheap VPS). All your devices talk to this single server.
2. **Extension** — installed in Chrome or Dia on every device you want synced. Each device connects to the server and sends/receives tab events.

```
MacBook (Dia)          Mac Mini (Dia)
  extension  ←──────────  extension
      │        WebSocket       │
      └──────→  server  ←──────┘
```

You only run the server once. Every other device just installs the extension.

---

## Quick install (macOS)

### Step 1 — Run the server on your always-on machine

```bash
curl -fsSL https://raw.githubusercontent.com/rajathkm/tab-sync/main/install.sh | bash
```

The script will:
- Check for Node.js 18+
- Install server dependencies
- Start the server as a LaunchAgent (auto-starts on login)
- Print a URL like: `ws://192.168.1.42:7777`

**Copy that URL.** You'll need it on every device in Step 3.

### Step 2 — Install the extension on every device and browser

1. [Download the latest release](https://github.com/rajathkm/tab-sync/releases/latest) → `relay-extension.zip`
2. Unzip it anywhere (e.g. `~/relay-extension/`)
3. Open `chrome://extensions` (Chrome) or `dia://extensions` (Dia)
4. Enable **Developer mode** (toggle, top right)
5. Click **Load unpacked** → select the unzipped `extension/` folder
6. The **Relay setup wizard** opens automatically

Repeat for each browser profile you want synced.

### Step 3 — Run the setup wizard (every device, every profile)

The wizard asks for:

| Field | What to enter |
|-------|--------------|
| Browser | Auto-detected (Chrome or Dia) — confirm it |
| Profile label | Short name for this profile: `personal`, `work`, etc. |
| Primary server | The `ws://...` URL printed by `install.sh` in Step 1 |
| Secondary server | Optional fallback — leave blank if you only have one server |
| Auth token | Optional — if you set one in `install.sh`, paste it here |

**The server URL is the same on every device.** All devices point at the single server running on your always-on machine.

---

## Platform support

| Browser | macOS |
|---------|-------|
| Chrome | ✅ |
| Dia | ✅ |
| Brave / Arc / Edge | 🧪 likely works |

The server runs anywhere Node.js 18+ runs. The extension is Chrome MV3 and should work in any Chromium-based browser.

---

## Sync features

| What | How to trigger | Synced? |
|------|---------------|---------|
| New tab from blank | Cmd+T → type URL | ✅ |
| Restore closed tab | Cmd+Shift+T | ✅ |
| Link click (new tab) | Cmd+click | ✅ |
| Navigate within tab | Click link / Cmd+L | ✅ |
| Close a tab | Cmd+W | ✅ |
| Push one tab manually | Right-click → Push tab to [device] | ✅ |
| Push all tabs | Relay popup → Push all tabs | ✅ |
| Internal browser pages | chrome:// / dia:// | ❌ (intentional) |

Open-sync (auto-open tabs on other device) can be toggled per profile in the popup.

---

## Networking

**No Tailscale required.** Use whichever option fits your setup:

### Option A — Same local network (no extra tools needed)

All your devices are on the same Wi-Fi or ethernet (home, office). `install.sh` detects and prints your local IP automatically. Use that IP in the extension wizard on every device.

**This works as long as all your devices stay on the same network.** If your laptop leaves the house, it loses the connection until it comes back.

### Option B — Different networks (Tailscale, free)

Your server is at home but your laptop moves around. [Tailscale](https://tailscale.com) creates a private network between your devices regardless of where they physically are — no port forwarding, no firewall changes.

Free tier covers up to 3 devices, which is enough for most setups. `install.sh` automatically prints your Tailscale IP if it detects Tailscale is installed.

1. Install Tailscale on every device: [tailscale.com/download](https://tailscale.com/download)
2. Sign in with the same account on all of them
3. Use the `100.x.x.x` Tailscale IP from `install.sh` as your server URL

### Option C — VPS / cloud server (always-on, accessible anywhere)

Run `server.js` on a cheap VPS (Hetzner, DigitalOcean, etc. — ~$5/month). Use its public IP or domain as the server URL. Set an `AUTH_TOKEN` so only your devices can connect.

```bash
AUTH_TOKEN=your-secret node server.js --port 7777
```

This is the only option where you don't need to keep a personal machine on 24/7.

---

**TL;DR:** Start with Option A if your devices share a network. Add Tailscale (Option B) if your laptop moves. Rent a VPS (Option C) if you want zero dependency on any personal machine being online.

---

## Manual server setup (without install.sh)

```bash
git clone https://github.com/rajathkm/tab-sync.git
cd tab-sync/server
npm install
node server.js --port 7777
# Server running on ws://0.0.0.0:7777
```

To run as a background service on macOS, edit `infra/com.clawd.tabsync.primary.plist` (replace `YOURUSERNAME`), then:

```bash
cp infra/com.clawd.tabsync.primary.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.clawd.tabsync.primary.plist
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Popup shows "Offline" | Check server is running: `curl http://your-server-ip:7777/health` |
| Browser detected as "chrome" in Dia | Update to v1.1.12+ — Dia detection now uses URL scheme, not UA string |
| Tabs open but don't navigate together | Confirm both devices are on v1.1.12+ (in-tab nav added in v1.1.12) |
| Extension setup wizard doesn't appear | Go to `chrome://extensions` → Relay → click the extension icon |
| Tabs sync but echo back | Check that both devices are running the same version |
| Can't reach server from another device | Confirm firewall allows port 7777; use Tailscale for cross-network |

---

## Development

```bash
git clone https://github.com/rajathkm/tab-sync.git
cd tab-sync

# Run server in dev mode
cd server && npm install && node server.js --port 7777

# Load extension in Chrome/Dia
# chrome://extensions → Developer mode → Load unpacked → select extension/
```

To release a new version:

```bash
./push-update.sh "fix: description" patch   # or minor / major
```

Optionally set `RELAY_SYNC_TARGET=user@host:path` to also rsync to a second machine after pushing.

---

## License

[MIT](./LICENSE)
