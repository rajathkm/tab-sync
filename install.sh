#!/bin/bash
# Relay — server installer for macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/rajathkm/tab-sync/main/install.sh | bash
# Or clone the repo and run: bash install.sh

set -e

REPO_URL="https://github.com/rajathkm/tab-sync.git"
INSTALL_DIR="$HOME/relay-server"
PLIST_LABEL="com.relay.tabsync"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
PORT=7777
LOG_DIR="/tmp/tabsync"

# ── Colours ────────────────────────────────────────────────────────────────────
bold=$(tput bold 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)
green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
nc='\033[0m'

info()    { echo -e "  ${green}✓${nc} $1"; }
warn()    { echo -e "  ${yellow}!${nc} $1"; }
error()   { echo -e "  ${red}✗${nc} $1"; exit 1; }
header()  { echo; echo "${bold}$1${reset}"; }

# ── OS check ───────────────────────────────────────────────────────────────────
if [[ "$OSTYPE" != "darwin"* ]]; then
  error "This installer is for macOS only. For Linux, see the README for manual setup."
fi

echo
echo "${bold}Relay — Tab Sync Server Installer${reset}"
echo "──────────────────────────────────────────────────────────────────────────"

# ── Node.js check ──────────────────────────────────────────────────────────────
header "Checking dependencies..."
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install it from https://nodejs.org (v18 or later) and re-run."
fi

NODE_VERSION=$(node -e "process.exit(parseInt(process.version.slice(1).split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null && node --version || true)
if node -e "process.exit(parseInt(process.version.slice(1).split('.')[0]) < 18 ? 1 : 0)" 2>/dev/null; then
  info "Node.js $(node --version)"
else
  error "Node.js 18+ required. Found $(node --version). Install a newer version from https://nodejs.org"
fi

if ! command -v git &>/dev/null; then
  error "git not found. Install Xcode Command Line Tools: xcode-select --install"
fi
info "git $(git --version | awk '{print $3}')"

# ── Clone or update repo ───────────────────────────────────────────────────────
header "Setting up server files..."
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Found existing install at $INSTALL_DIR — pulling latest"
  git -C "$INSTALL_DIR" pull --quiet origin main
elif [ -d "$INSTALL_DIR/server" ]; then
  info "Found existing server at $INSTALL_DIR (no git — leaving as-is)"
else
  info "Cloning repo to $INSTALL_DIR"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/server"
npm install --silent
info "Server dependencies installed"

# ── Log directory ──────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Detect local IP ───────────────────────────────────────────────────────────
header "Detecting network address..."

# Try to find the primary non-loopback IPv4 address
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || \
           ifconfig | awk '/inet / && !/127\.0\.0\.1/ {print $2; exit}')

if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="YOUR_IP"
  warn "Could not auto-detect local IP. Check with: ipconfig getifaddr en0"
else
  info "Local IP: $LOCAL_IP"
fi

# Also check for Tailscale
TAILSCALE_IP=$(ipconfig getifaddr utun0 2>/dev/null || \
               ifconfig | awk '/100\.[0-9]+\.[0-9]+\.[0-9]+/ {print $2; exit}' 2>/dev/null || true)
if [ -n "$TAILSCALE_IP" ]; then
  info "Tailscale IP: $TAILSCALE_IP (recommended for cross-network sync)"
fi

# ── Auth token (optional) ──────────────────────────────────────────────────────
header "Auth token..."
AUTH_ENV_LINE=""
if [ -n "$AUTH_TOKEN" ]; then
  info "Using AUTH_TOKEN from environment"
  AUTH_TOKEN_VALUE="$AUTH_TOKEN"
else
  read -r -p "  Set an auth token? (recommended for security) [y/N] " yn < /dev/tty
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    AUTH_TOKEN_VALUE=$(openssl rand -hex 24 2>/dev/null || cat /dev/urandom | LC_ALL=C tr -dc 'a-f0-9' | head -c 48)
    echo
    echo "  ${bold}Generated token:${reset} $AUTH_TOKEN_VALUE"
    echo "  ${yellow}Save this — you'll enter it in the extension setup wizard on every device.${reset}"
    echo
    AUTH_ENV_LINE="<key>AUTH_TOKEN</key><string>${AUTH_TOKEN_VALUE}</string>"
  else
    info "Skipping auth token — any device can connect"
    AUTH_TOKEN_VALUE=""
  fi
fi

# ── Install LaunchAgent ───────────────────────────────────────────────────────
header "Installing LaunchAgent (auto-start on login)..."

NODE_PATH=$(command -v node)
SERVER_PATH="$INSTALL_DIR/server/server.js"

# Build optional env dict for plist
ENV_DICT=""
if [ -n "$AUTH_TOKEN_VALUE" ]; then
  ENV_DICT="
        <key>AUTH_TOKEN</key>
        <string>${AUTH_TOKEN_VALUE}</string>"
fi

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${SERVER_PATH}</string>
        <string>--port</string>
        <string>${PORT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}/server</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/server.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/server.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>${ENV_DICT}
    </dict>
</dict>
</plist>
PLIST

# Unload old instance if running
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
chmod 600 "$PLIST_PATH"
info "LaunchAgent permissions secured (600)"
info "LaunchAgent loaded — server starts automatically on login"

# ── Health check ──────────────────────────────────────────────────────────────
header "Verifying server..."
sleep 2
if curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
  info "Server is running ✓"
else
  warn "Server health check failed — check logs: tail -f $LOG_DIR/server.log"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────────────────────────────────────"
echo "${bold}✅  Relay server installed!${reset}"
echo
echo "  ${bold}Your server URL (same local network):${reset}"
echo "    ws://${LOCAL_IP}:${PORT}"
if [ -n "$TAILSCALE_IP" ]; then
  echo
  echo "  ${bold}Your server URL (across networks, via Tailscale):${reset}"
  echo "    ws://${TAILSCALE_IP}:${PORT}"
fi
if [ -n "$AUTH_TOKEN_VALUE" ]; then
  echo
  echo "  ${bold}Auth token:${reset}"
  echo "    ${AUTH_TOKEN_VALUE}"
fi
echo
echo "──────────────────────────────────────────────────────────────────────────"
echo
echo "  ${bold}Next steps on EVERY device (including this one):${reset}"
echo
echo "  1. Download the extension:"
echo "     https://github.com/rajathkm/tab-sync/releases/latest"
echo "     → relay-extension.zip → unzip it"
echo
echo "  2. Load it in Chrome or Dia:"
echo "     chrome://extensions  (or dia://extensions for Dia)"
echo "     → Enable Developer mode → Load unpacked → select the extension/ folder"
echo
echo "  3. Complete the setup wizard:"
echo "     Enter the server URL above when prompted."
echo "     (Use the local IP if all devices are on the same network."
echo "      Use the Tailscale IP if devices are on different networks.)"
if [ -n "$AUTH_TOKEN_VALUE" ]; then
  echo "     Enter the auth token above when prompted."
fi
echo
echo "  Logs: tail -f $LOG_DIR/server.log"
echo "  Stop: launchctl unload $PLIST_PATH"
echo
