# Tab Sync — Setup Guide

Complete setup for cross-device browser tab sync. Works with Chrome and Dia on macOS.

## Prerequisites

- Node.js 20+ on all machines
- Chrome and/or Dia (developer mode enabled for unpacked extensions)
- Tailscale on all devices (recommended) or a shared local network

## 1. Install the Server

On your **primary server machine** (always-on device):

```bash
cd server/
npm install
```

Test it starts:

```bash
node server.js --port 7777
# Should print: Tab Sync server started on port 7777 (primary)
# Ctrl+C to stop
```

### Optional: Auth Token

To require a shared secret for all connections:

```bash
AUTH_TOKEN=your-secret-token-here node server.js --port 7777
```

Use the same token in the extension setup wizard.

## 2. Install LaunchAgents

### Primary Server (always-on machine)

1. Edit `infra/com.relay.tabsync.primary.plist`:
   - Replace `YOURUSERNAME` with your macOS username
   - Update the Node.js path if needed (`which node` to find it)

2. Copy and load:

```bash
cp infra/com.relay.tabsync.primary.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.relay.tabsync.primary.plist
```

3. Verify:

```bash
curl http://localhost:7777/health
```

### Secondary Server (client machine — optional)

1. Edit `infra/com.relay.tabsync.secondary.plist`:
   - Replace `YOURUSERNAME` with your macOS username
   - Update the Node.js path if needed

2. Copy and load:

```bash
cp infra/com.relay.tabsync.secondary.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.relay.tabsync.secondary.plist
```

## 3. Configure Tailscale ACL (Recommended)

If using Tailscale, add this ACL rule in the [Tailscale admin console](https://login.tailscale.com/admin/acls):

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:tabsync"],
      "dst": ["tag:tabsync:7777", "tag:tabsync:7778"]
    }
  ],
  "tagOwners": {
    "tag:tabsync": ["autogroup:admin"]
  }
}
```

Then tag your devices with `tag:tabsync` in the Tailscale admin.

## 4. Install the Extension

On **each device**, for **each browser** (Chrome and/or Dia):

1. Open Chrome/Dia → `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked** → select the `extension/` directory
4. The setup wizard opens automatically

### Setup Wizard Steps

1. **Browser**: Auto-detected (Chrome or Dia). Confirm or change.
2. **Profiles**: Map each profile directory to a label (personal / work / skip).
   - Common dirs: `Default` = first profile, `Profile 1` = second profile
3. **Server**: Enter your primary server URL (e.g., `ws://100.x.x.x:7777` for Tailscale IP)
4. **Secondary**: Optional fallback server URL (e.g., `ws://100.x.x.x:7778`)
5. **Auth**: Choose Tailscale / Shared token / None

Repeat for each browser profile on each device.

## 5. Verify

- Open the extension popup — each profile should show **Connected**
- Open a tab on Device A → close it → verify it closes on Device B
- Check server logs: `tail -f /tmp/tabsync/server.log`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Offline" in popup | Check server is running: `curl http://your-server:7777/health` |
| Wrong tabs syncing | Re-run setup wizard (click gear icon in popup) to verify profile mapping |
| LaunchAgent not starting | Check: `launchctl list | grep tabsync` and logs at `/tmp/tabsync/server.log` |
| Auth errors | Ensure same `AUTH_TOKEN` on server and in extension setup |

## Uninstall

```bash
# Stop LaunchAgents
launchctl unload ~/Library/LaunchAgents/com.relay.tabsync.primary.plist
launchctl unload ~/Library/LaunchAgents/com.relay.tabsync.secondary.plist

# Remove plists
rm ~/Library/LaunchAgents/com.relay.tabsync.primary.plist
rm ~/Library/LaunchAgents/com.relay.tabsync.secondary.plist

# Remove extension from chrome://extensions
```
