#!/usr/bin/env node
// server.js — WebSocket server that routes tab sync events by channel

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const PORT = parseInt(getArg('port', '7777'), 10);
const IS_SECONDARY = args.includes('--secondary');
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;

// --- Logging ---
const LOG_DIR = '/tmp/tabsync';
const LOG_FILE = path.join(LOG_DIR, 'server.log');

try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    // Simple rotation: if log exceeds 10MB, truncate
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 10 * 1024 * 1024) {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      fs.writeFileSync(LOG_FILE, content.slice(-1024 * 1024)); // keep last 1MB
    }
  } catch {}
}

// --- Channel state ---
// Map<channelId, Map<deviceId, WebSocket>>
const channels = new Map();

// Monotonic sequence counter per channel
const seqCounters = new Map();

function getSeq(channel) {
  const current = seqCounters.get(channel) || 0;
  const next = current + 1;
  seqCounters.set(channel, next);
  return next;
}

// --- Auth ---
// Browser WebSocket API doesn't support custom headers, so auth is handled
// via the first message (type: 'auth') or via query parameter.
function validateAuth(req) {
  if (!AUTH_TOKEN) return true; // No auth configured

  // Check Authorization header (for non-browser clients like primary<->secondary)
  const authHeader = req.headers['authorization'];
  if (authHeader === `Bearer ${AUTH_TOKEN}`) return true;

  // Check query parameter
  const parsed = url.parse(req.url, true);
  if (parsed.query.token === AUTH_TOKEN) return true;

  return false;
}

// Pending auth connections: these sent no header/query token and need to send auth message
const pendingAuth = new Set();

// --- HTTP server ---
const httpServer = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      mode: IS_SECONDARY ? 'secondary' : 'primary',
      channels: [...channels.keys()],
      uptime: process.uptime()
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const channel = parsed.query.channel;
  const device = parsed.query.device;

  if (!channel || !device) {
    log(`REJECT: missing channel or device from ${req.socket.remoteAddress}`);
    ws.close(4000, 'Missing channel or device parameter');
    return;
  }

  // Auth check
  const headerAuthed = validateAuth(req);
  if (!headerAuthed && AUTH_TOKEN) {
    // Allow client to auth via first message
    pendingAuth.add(ws);
    ws._channel = channel;
    ws._device = device;

    // Give client 5 seconds to send auth message
    ws._authTimer = setTimeout(() => {
      if (pendingAuth.has(ws)) {
        log(`AUTH TIMEOUT: ${device} on ${channel}`);
        pendingAuth.delete(ws);
        ws.close(4001, 'Authentication timeout');
      }
    }, 5000);
  } else if (AUTH_TOKEN && !headerAuthed) {
    log(`AUTH FAIL: ${device} on ${channel} from ${req.socket.remoteAddress}`);
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Register in channel map (or defer if pending auth)
  if (!pendingAuth.has(ws)) {
    registerConnection(ws, channel, device);
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle auth message from browser clients
      if (msg.type === 'auth') {
        if (pendingAuth.has(ws)) {
          clearTimeout(ws._authTimer);
          if (AUTH_TOKEN && msg.token !== AUTH_TOKEN) {
            log(`AUTH FAIL (message): ${ws._device} on ${ws._channel}`);
            pendingAuth.delete(ws);
            ws.close(4001, 'Invalid token');
            return;
          }
          pendingAuth.delete(ws);
          registerConnection(ws, ws._channel, ws._device);
          log(`AUTH OK (message): ${ws._device} on ${ws._channel}`);
        }
        return;
      }

      // If still pending auth, reject all non-auth messages
      if (pendingAuth.has(ws)) return;

      // Handle reconciliation request from primary<->secondary
      if (msg.type === 'reconcile') {
        handleReconcile(ws, msg);
        return;
      }

      // Route the event
      routeEvent(ws, msg, ws._channel, ws._device);
    } catch (e) {
      log(`ERROR parsing message from ${ws._device}: ${e.message}`);
    }
  });

  ws.on('close', () => {
    cleanupConnection(ws);
    pendingAuth.delete(ws);
    if (ws._authTimer) clearTimeout(ws._authTimer);
  });

  ws.on('error', (err) => {
    log(`WS ERROR: ${ws._device} on ${ws._channel}: ${err.message}`);
  });
});

function registerConnection(ws, channel, device) {
  ws._channel = channel;
  ws._device = device;

  if (!channels.has(channel)) {
    channels.set(channel, new Map());
  }

  const channelMap = channels.get(channel);

  // If same device reconnects, close old connection
  if (channelMap.has(device)) {
    const old = channelMap.get(device);
    if (old !== ws && old.readyState === WebSocket.OPEN) {
      old.close(4002, 'Replaced by new connection');
    }
  }

  channelMap.set(device, ws);
  log(`CONNECTED: ${device} on ${channel} (${channelMap.size} devices on channel)`);
}

function cleanupConnection(ws) {
  if (!ws._channel || !ws._device) return;
  const channelMap = channels.get(ws._channel);
  if (channelMap) {
    // Only remove if this ws is still the registered one (not already replaced)
    if (channelMap.get(ws._device) === ws) {
      channelMap.delete(ws._device);
      log(`DISCONNECTED: ${ws._device} from ${ws._channel} (${channelMap.size} remaining)`);
    }
    if (channelMap.size === 0) {
      channels.delete(ws._channel);
    }
  }
}

function routeEvent(senderWs, event, channel, device) {
  // Stamp sequence number
  const seq = getSeq(channel);
  event.seq = seq;
  event.channel = channel;
  event.device = device;

  const channelMap = channels.get(channel);
  if (!channelMap) return;

  const serialized = JSON.stringify(event);
  let routed = 0;

  // Send to ALL other devices on the SAME channel only
  for (const [devId, ws] of channelMap) {
    if (devId === device) continue; // Don't echo back to sender
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
      routed++;
    }
  }

  log(`ROUTE: ${event.type} on ${channel} from ${device} seq=${seq} → ${routed} device(s)`);
}

// --- Reconciliation (primary<->secondary) ---
function handleReconcile(ws, msg) {
  // Exchange sequence counters
  const response = {
    type: 'reconcile_response',
    sequences: Object.fromEntries(seqCounters)
  };
  ws.send(JSON.stringify(response));

  // Update our counters if theirs are higher
  if (msg.sequences) {
    for (const [channel, seq] of Object.entries(msg.sequences)) {
      const current = seqCounters.get(channel) || 0;
      if (seq > current) {
        seqCounters.set(channel, seq);
        log(`RECONCILE: updated ${channel} seq to ${seq}`);
      }
    }
  }

  log(`RECONCILE: exchanged sequences with ${ws._device || 'peer'}`);
}

// --- Secondary mode: connect to primary for reconciliation ---
let primaryWs = null;

function connectToPrimary() {
  if (!IS_SECONDARY) return;

  // Secondary doesn't auto-connect to primary — primary connects to it.
  // But when primary reconnects, it sends a reconcile message.
  log('Running in SECONDARY mode — waiting for primary to connect for reconciliation');
}

// --- Start ---
httpServer.listen(PORT, () => {
  log(`Tab Sync server started on port ${PORT} (${IS_SECONDARY ? 'secondary' : 'primary'})`);
  if (AUTH_TOKEN) {
    log('Auth: Bearer token required');
  } else {
    log('Auth: disabled (no AUTH_TOKEN set)');
  }

  if (IS_SECONDARY) {
    connectToPrimary();
  }
});

// --- Heartbeat — keeps MV3 service workers alive ---
// Chrome MV3 SWs terminate after ~30s of inactivity. An open WebSocket
// connection alone does NOT prevent this. Sending a lightweight JSON message
// every 25s forces the browser's onmessage handler to fire, which the Chrome
// SW scheduler treats as activity and resets the idle timer.
const HEARTBEAT_INTERVAL_MS = 25_000;

setInterval(() => {
  const hb = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
  for (const [channel, devMap] of channels) {
    for (const [device, clientWs] of devMap) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(hb);
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down');
  wss.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  log('SIGINT received, shutting down');
  wss.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});

// Prevent crash on unhandled errors
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (err) => {
  log(`UNHANDLED REJECTION: ${err}`);
});
