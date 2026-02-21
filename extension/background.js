// background.js — service worker: WebSocket client, event listeners, queue logic
importScripts('config.js');

// --- State ---
let ws = null;
let wsChannel = null;
let wsDevice = null;
let wsConfig = null;
let retryCount = 0;
let retryTimer = null;
let primaryFailed = false;
let primaryRetryCount = 0;
const MAX_PRIMARY_RETRIES = 3;
const MAX_BACKOFF = 60000;
const QUEUE_MAX = 50;
const EVENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Sequence tracking for received events
const receivedSeqs = new Map(); // channel -> lastProcessedSeq
const receiveBuffer = new Map(); // channel -> Map<seq, event>
const gapTimers = new Map(); // channel -> timer

// --- Profile detection ---
// Chrome/Dia expose the profile path in chrome.runtime
function getProfileDir() {
  // chrome.runtime.getURL gives us the extension URL which includes the profile path
  // Format: chrome-extension://<id>/ — but profile dir comes from the data directory
  // We use a heuristic: read from the internal extension path
  const url = chrome.runtime.getURL('');
  // Profile directory is not directly available via API, but we can detect it
  // from the browser's profile info. In Chromium, the profile directory name
  // is exposed via chrome.runtime when the extension is loaded in different profiles.
  // We'll store the detected profile during setup and use that.
  return null; // Detected during setup wizard
}

// Detect browser type from user agent
function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Dia/i.test(ua)) return 'dia';
  return 'chrome';
}

// --- WebSocket connection ---
async function connect() {
  const config = await getConfig();
  if (!config) return;

  const setupDone = await isSetupComplete();
  if (!setupDone) return;

  wsConfig = config;
  wsDevice = config.device;

  // Determine which profiles are enabled and connect for each
  // Actually, the extension connects once per profile that's enabled
  // But since a single browser profile runs one instance of the extension,
  // we connect with the profile this extension instance is running in.
  const profileDir = config.activeProfileDir;
  if (!profileDir) return;

  const profileLabel = config.profiles[profileDir];
  if (!profileLabel) return;

  const enabled = await isProfileEnabled(profileLabel);
  if (!enabled) {
    updateConnectionStatus(profileLabel, 'disabled');
    return;
  }

  const channel = `${config.browser}:${profileLabel}`;
  wsChannel = channel;

  const serverUrl = primaryFailed ? config.secondaryServer : config.primaryServer;
  if (!serverUrl) return;

  const connectUrl = `${serverUrl}?channel=${encodeURIComponent(channel)}&device=${encodeURIComponent(config.device)}`;

  try {
    // Capture this specific instance so stale close events from a previous
    // MV3 service worker lifecycle don't clobber the current connection.
    //
    // Root cause of the reconnect storm:
    // 1. MV3 SW restarts → IIFE runs → connect() → ws = WS_new
    // 2. Server sees same deviceId and closes WS_old (code 4002 "Replaced")
    // 3. WS_old's onclose fires → ws = null  ← CLOBBERS WS_new
    // 4. retryTimer fires → connect() → ws = WS_newer → repeat
    //
    // Fix: each connect() captures `thisWs`. onclose/onopen check
    // `ws === thisWs` before touching the module-level `ws` variable.
    const thisWs = new WebSocket(connectUrl);
    ws = thisWs;

    // If auth token configured, send it via the first message (since WebSocket
    // constructor doesn't support custom headers in browsers)
    thisWs.onopen = async () => {
      if (ws !== thisWs) return; // Superseded by a newer connection — ignore
      retryCount = 0;

      if (config.authToken) {
        thisWs.send(JSON.stringify({ type: 'auth', token: config.authToken }));
      }

      updateConnectionStatus(profileLabel, primaryFailed ? 'backup' : 'connected');

      // Replay offline queue
      await replayQueue();
    };

    thisWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleIncomingEvent(data);
      } catch (e) {
        console.error('[TabSync] Failed to parse message:', e);
      }
    };

    thisWs.onclose = (event) => {
      if (ws !== thisWs) return; // Stale close from a previous lifecycle — do NOT clobber ws
      ws = null;
      updateConnectionStatus(profileLabel, 'offline');
      if (event.wasClean) {
        // Clean close = service worker suspended or server intentionally closed.
        // Don't count against primary retry budget — just reconnect quickly.
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => connect(), 500);
      } else {
        // Abnormal close = network error, server unreachable — counts as failure.
        scheduleReconnect();
      }
    };

    thisWs.onerror = (err) => {
      console.error('[TabSync] WebSocket error:', err);
      // onclose will fire after this with wasClean=false
    };
  } catch (e) {
    console.error('[TabSync] Connect failed:', e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (retryTimer) clearTimeout(retryTimer);

  retryCount++;
  primaryRetryCount++;

  // After 3 failed primary retries, switch to secondary
  if (!primaryFailed && primaryRetryCount >= MAX_PRIMARY_RETRIES) {
    primaryFailed = true;
    primaryRetryCount = 0;
    retryCount = 0;
    console.log('[TabSync] Primary server failed after 3 retries, switching to secondary');
  }

  const delay = Math.min(1000 * Math.pow(2, retryCount - 1), MAX_BACKOFF);
  retryTimer = setTimeout(() => connect(), delay);
}

// --- Connection status tracking ---
const connectionStatus = {};

function updateConnectionStatus(profileLabel, status) {
  connectionStatus[profileLabel] = { status, timestamp: Date.now() };
  // Broadcast status to popup
  chrome.runtime.sendMessage({
    type: 'status_update',
    profile: profileLabel,
    status,
    timestamp: Date.now()
  }).catch(() => {}); // popup may not be open
}

// --- Event handling ---
function handleIncomingEvent(event) {
  // Verify channel matches (defense in depth — server should enforce this)
  if (event.channel && event.channel !== wsChannel) return;

  // Sequence ordering
  if (event.seq !== undefined) {
    processWithSequencing(event);
  } else {
    executeEvent(event);
  }
}

function processWithSequencing(event) {
  const channel = event.channel || wsChannel;
  const lastSeq = receivedSeqs.get(channel) || 0;
  const expectedSeq = lastSeq + 1;

  if (event.seq === expectedSeq) {
    // In order — process immediately
    executeEvent(event);
    receivedSeqs.set(channel, event.seq);
    // Process any buffered events that are now in order
    drainBuffer(channel);
  } else if (event.seq > expectedSeq) {
    // Out of order — buffer it
    if (!receiveBuffer.has(channel)) receiveBuffer.set(channel, new Map());
    receiveBuffer.get(channel).set(event.seq, event);

    // Start gap timer if not already running
    if (!gapTimers.has(channel)) {
      const timer = setTimeout(() => {
        // Gap tolerance: process what we have after 2 seconds
        gapTimers.delete(channel);
        drainBufferForced(channel);
      }, 2000);
      gapTimers.set(channel, timer);
    }
  }
  // If event.seq <= lastSeq, it's a duplicate — ignore
}

function drainBuffer(channel) {
  const buffer = receiveBuffer.get(channel);
  if (!buffer) return;

  let lastSeq = receivedSeqs.get(channel) || 0;
  let next = lastSeq + 1;

  while (buffer.has(next)) {
    const event = buffer.get(next);
    buffer.delete(next);
    executeEvent(event);
    receivedSeqs.set(channel, next);
    next++;
  }

  if (buffer.size === 0) {
    receiveBuffer.delete(channel);
    // Clear gap timer since we caught up
    if (gapTimers.has(channel)) {
      clearTimeout(gapTimers.get(channel));
      gapTimers.delete(channel);
    }
  }
}

function drainBufferForced(channel) {
  const buffer = receiveBuffer.get(channel);
  if (!buffer) return;

  // Sort by seq and process everything, updating lastSeq to highest
  const sorted = [...buffer.entries()].sort((a, b) => a[0] - b[0]);
  let maxSeq = receivedSeqs.get(channel) || 0;

  for (const [seq, event] of sorted) {
    executeEvent(event);
    if (seq > maxSeq) maxSeq = seq;
  }

  receivedSeqs.set(channel, maxSeq);
  receiveBuffer.delete(channel);
}

async function executeEvent(event) {
  if (event.device === wsDevice) return; // Ignore our own events

  switch (event.type) {
    case 'tab_closed':
      await handleTabClosed(event);
      break;
    case 'tab_opened':
      await handleTabOpened(event);
      break;
  }
}

async function handleTabClosed(event) {
  const normalized = normalizeUrl(event.url);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (normalizeUrl(tab.url) === normalized) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error('[TabSync] Failed to close tab:', e);
      }
    }
  }
}

async function handleTabOpened(event) {
  // Check if open-sync is enabled (or if this is a push event which bypasses open-sync toggle)
  if (!event.push) {
    const config = await getConfig();
    const profileDir = config?.activeProfileDir;
    const profileLabel = config?.profiles?.[profileDir];

    // If we can't resolve the profile, err on the side of caution and skip.
    // Previously this fell through and opened the tab regardless of toggle.
    if (!profileLabel) return;

    const openSyncOn = await isOpenSyncEnabled(profileLabel);
    if (!openSyncOn) return;
  }

  // Duplicate suppression — check if URL already open (ignore fragments)
  const normalized = normalizeUrl(event.url);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (normalizeUrl(tab.url) === normalized) {
      return; // Already open, suppress
    }
  }

  try {
    await chrome.tabs.create({ url: event.url, active: false });
  } catch (e) {
    console.error('[TabSync] Failed to open tab:', e);
  }
}

// --- Outgoing events ---
async function sendEvent(event) {
  const config = await getConfig();
  if (!config) return;

  const profileDir = config.activeProfileDir;
  const profileLabel = config.profiles?.[profileDir];
  if (!profileLabel) return;

  // Check per-profile toggle
  const enabled = await isProfileEnabled(profileLabel);
  if (!enabled) return;

  event.channel = `${config.browser}:${profileLabel}`;
  event.device = config.device;
  event.ts = Date.now();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  } else {
    await enqueueEvent(event);
  }
}

// --- Offline queue ---
const QUEUE_KEY = 'tabsync_offline_queue';

async function getQueue() {
  const result = await chrome.storage.session.get(QUEUE_KEY);
  return result[QUEUE_KEY] || [];
}

async function saveQueue(queue) {
  await chrome.storage.session.set({ [QUEUE_KEY]: queue });
}

async function enqueueEvent(event) {
  let queue = await getQueue();
  queue.push(event);

  // Cap at 50 — drop oldest
  if (queue.length > QUEUE_MAX) {
    queue = queue.slice(queue.length - QUEUE_MAX);
  }

  await saveQueue(queue);
}

async function replayQueue() {
  let queue = await getQueue();
  if (queue.length === 0) return;

  const now = Date.now();
  // Filter out stale events (older than 5 minutes)
  queue = queue.filter(e => (now - e.ts) < EVENT_TTL_MS);

  // Send in order
  for (const event of queue) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  // Clear queue after replay
  await saveQueue([]);
}

// --- Tab event listeners ---
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const url = tabUrlCache.get(tabId);
  tabUrlCache.delete(tabId);
  newTabIds.delete(tabId); // clean up either way

  if (!url) return;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;

  await sendEvent({ type: 'tab_closed', url });
});

chrome.tabs.onCreated.addListener(async (tab) => {
  // tab.url can be undefined, null, or empty string depending on Chrome version and tab type.
  // Coerce to a safe string immediately to avoid null-reference errors.
  const url = (typeof tab.url === 'string' ? tab.url : '').trim();
  const isInternal = !url ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:');

  if (isInternal) {
    // No real URL yet — mark as "new" so onUpdated emits tab_opened when URL arrives
    newTabIds.add(tab.id);
    return;
  }

  // Tab was created with a real URL already (e.g. cmd+click, JS window.open) — emit now.
  // Don't add to newTabIds; onUpdated will also fire but won't find tabId in the set.
  tabUrlCache.set(tab.id, url);
  const config = await getConfig();
  const profileDir = config?.activeProfileDir;
  const profileLabel = config?.profiles?.[profileDir];
  if (profileLabel && await isOpenSyncEnabled(profileLabel)) {
    await sendEvent({ type: 'tab_opened', url });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  const url = changeInfo.url;
  const isInternal = url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');

  tabUrlCache.set(tabId, url);

  if (isInternal) {
    newTabIds.delete(tabId);
    return;
  }

  // Only emit tab_opened for tabs that were born without a real URL
  // (covers address-bar navigation into a blank tab, or tabs that started as chrome://newtab)
  if (newTabIds.has(tabId)) {
    newTabIds.delete(tabId);
    const config = await getConfig();
    const profileDir = config?.activeProfileDir;
    const profileLabel = config?.profiles?.[profileDir];
    if (profileLabel && await isOpenSyncEnabled(profileLabel)) {
      await sendEvent({ type: 'tab_opened', url });
    }
  }
});

// Tab URL cache — needed because onRemoved doesn't provide the URL
const tabUrlCache = new Map();
// newTabIds — tracks tabs created but not yet assigned a real URL.
// Needed because cmd+click (and programmatic tab open) fires onCreated with
// the URL already set, so tabUrlCache already has the URL when onUpdated fires,
// making oldUrl truthy and causing the open event to be silently dropped.
const newTabIds = new Set();

// Initialize cache with all current tabs
async function initTabCache() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) {
      tabUrlCache.set(tab.id, tab.url);
    }
  }
}

// --- Context menu ---
async function setupContextMenu() {
  const config = await getConfig();
  const deviceName = config?.device || 'other device';
  const title = `Push tab to ${deviceName}`;

  // Use update → create fallback to eliminate the removeAll() race.
  // removeAll() + create() are two separate async operations: if both
  // onInstalled and the startup IIFE call setupContextMenu() concurrently,
  // both removeAll() calls can resolve before either create() fires,
  // producing "Cannot create item with duplicate id push-tab".
  //
  // update() is atomic: if the item already exists, it updates in-place
  // (no duplicate possible). If it doesn't exist, we catch the error and
  // create it. No removeAll needed, no race window.
  chrome.contextMenus.update('push-tab', { title }, () => {
    if (chrome.runtime.lastError) {
      // Item doesn't exist yet (fresh install or cleared state) — create it
      chrome.contextMenus.create(
        { id: 'push-tab', title, contexts: ['page'] },
        () => {
          // Suppress any remaining errors (e.g., rapid concurrent create from
          // onInstalled + IIFE in the same event loop tick)
          if (chrome.runtime.lastError) { /* intentionally checked */ }
        }
      );
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'push-tab' && tab?.url) {
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) return;

    await sendEvent({ type: 'tab_opened', url: tab.url, push: true });

    // Brief visual feedback — update badge
    try {
      await chrome.action.setBadgeText({ text: '\u2713', tabId: tab.id });
      await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId: tab.id });
      setTimeout(async () => {
        try {
          await chrome.action.setBadgeText({ text: '', tabId: tab.id });
        } catch {}
      }, 2000);
    } catch {}
  }
});

// --- Message handler (from popup/setup) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_status') {
    sendResponse({ connectionStatus, primaryFailed });
    return true;
  }

  if (msg.type === 'push_all_tabs') {
    pushAllTabs(msg.profileLabel).then(result => sendResponse(result));
    return true;
  }

  if (msg.type === 'reconnect') {
    // Force reconnect (e.g. after config change)
    if (ws) ws.close();
    primaryFailed = false;
    primaryRetryCount = 0;
    retryCount = 0;
    setTimeout(() => connect(), 100);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'toggle_profile') {
    setToggle(msg.profileLabel, msg.enabled).then(async () => {
      if (msg.enabled) {
        // Reconnect for this profile
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          connect();
        }
      } else {
        // Disconnect if this was the active channel
        const config = await getConfig();
        const profileDir = config?.activeProfileDir;
        const label = config?.profiles?.[profileDir];
        if (label === msg.profileLabel && ws) {
          ws.close();
          ws = null;
        }
        updateConnectionStatus(msg.profileLabel, 'disabled');
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'toggle_open_sync') {
    setOpenSyncToggle(msg.profileLabel, msg.enabled).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'config_saved') {
    // Re-initialize after setup
    setupContextMenu();
    if (ws) ws.close();
    primaryFailed = false;
    primaryRetryCount = 0;
    retryCount = 0;
    setTimeout(() => connect(), 100);
    sendResponse({ ok: true });
    return true;
  }
});

async function pushAllTabs(profileLabel) {
  const config = await getConfig();
  if (!config) return { pushed: 0, skipped: 0 };

  const tabs = await chrome.tabs.query({});
  const validTabs = tabs.filter(t =>
    t.url &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('about:')
  );

  let pushed = 0;
  let skipped = 0;

  for (let i = 0; i < validTabs.length; i++) {
    const tab = validTabs[i];
    const event = {
      type: 'tab_opened',
      url: tab.url,
      push: true,
      channel: `${config.browser}:${profileLabel}`,
      device: config.device,
      ts: Date.now()
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
      pushed++;
    } else {
      await enqueueEvent(event);
      pushed++;
    }

    // 100ms stagger between events
    if (i < validTabs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Send progress update to popup
    chrome.runtime.sendMessage({
      type: 'push_progress',
      current: i + 1,
      total: validTabs.length,
      pushed,
      skipped
    }).catch(() => {});
  }

  return { pushed, skipped };
}

// --- Init ---
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Open setup wizard on first install
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  }
  await initTabCache();
  await setupContextMenu();
});

// --- Keepalive alarm (prevents service worker from sleeping mid-session) ---
// Chrome MV3 minimum alarm interval is 1 minute. This wakes the SW and reconnects if dropped.
chrome.alarms.create('tabsync-keepalive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tabsync-keepalive') return;
  const setupDone = await isSetupComplete();
  if (!setupDone) return;
  // If WebSocket is not open, reconnect
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (!retryTimer) connect(); // Only if not already retrying
  }
});

// Service worker startup
(async () => {
  await initTabCache();
  const setupDone = await isSetupComplete();
  if (setupDone) {
    await setupContextMenu();
    connect();
  }
})();
