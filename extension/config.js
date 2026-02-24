// config.js — shared config helpers for chrome.storage.local

const CONFIG_KEY = 'tabsync_config';
const TOGGLE_KEY = 'tabsync_toggles';

async function getConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return result[CONFIG_KEY] || null;
}

async function saveConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

async function isSetupComplete() {
  const config = await getConfig();
  if (!config) return false;
  return !!(config.browser && config.device && config.primaryServer && config.profiles && Object.keys(config.profiles).length > 0);
}

// Returns the profile label (e.g. "personal", "work") for the current browser profile directory
async function getProfileLabel(profileDir) {
  const config = await getConfig();
  if (!config || !config.profiles) return null;
  return config.profiles[profileDir] || null;
}

// Build channel string: "{browser}:{profileLabel}"
async function getChannel(profileLabel) {
  const config = await getConfig();
  if (!config || !config.browser) return null;
  return `${config.browser}:${profileLabel}`;
}

// Per-profile sync toggle
async function getToggles() {
  const result = await chrome.storage.local.get(TOGGLE_KEY);
  return result[TOGGLE_KEY] || {};
}

async function setToggle(profileLabel, enabled) {
  const toggles = await getToggles();
  toggles[profileLabel] = enabled;
  await chrome.storage.local.set({ [TOGGLE_KEY]: toggles });
}

async function isProfileEnabled(profileLabel) {
  const toggles = await getToggles();
  // Default to enabled if not explicitly set
  return toggles[profileLabel] !== false;
}

// Open-sync toggle (tab_opened events)
const OPEN_SYNC_KEY = 'tabsync_open_sync';

async function getOpenSyncToggles() {
  const result = await chrome.storage.local.get(OPEN_SYNC_KEY);
  return result[OPEN_SYNC_KEY] || {};
}

async function setOpenSyncToggle(profileLabel, enabled) {
  const toggles = await getOpenSyncToggles();
  toggles[profileLabel] = enabled;
  await chrome.storage.local.set({ [OPEN_SYNC_KEY]: toggles });
}

async function isOpenSyncEnabled(profileLabel) {
  const toggles = await getOpenSyncToggles();
  // Opt-out default: enabled unless explicitly set to false.
  // Both sending and receiving check this toggle, so both devices need it on.
  // Defaulting to true means a freshly-installed extension works immediately
  // without requiring the user to manually enable it on every device.
  return toggles[profileLabel] !== false;
}

// URLs matching these patterns are excluded from ALL sync events (open, navigate, close).
// These are real-time / session-specific pages where syncing across devices causes
// active sessions to be disrupted (e.g. killing a video call tab mid-meeting).
const SYNC_BLOCKLIST = [
  // Video calls — session tabs are device-specific; closing/navigating remotely kills the call
  /meet\.google\.com/,
  /zoom\.us\/j\//,
  /teams\.microsoft\.com\/l\/meetup/,
  /whereby\.com\//,
  /webex\.com\/meet\//,
  /around\.co\//,
  // Live/streaming sessions
  /youtube\.com\/live/,
  // Auth/OAuth flows — navigating these mid-flow breaks sign-in
  /accounts\.google\.com\/o\/oauth/,
  /github\.com\/login\/oauth/,
  // LinkedIn auth interstitials — when one device isn't logged in, LinkedIn
  // redirects to /login or /authwall and fires nav events that loop back.
  /linkedin\.com\/login/,
  /linkedin\.com\/authwall/,
  /linkedin\.com\/uas\/login/,
  /linkedin\.com\/checkpoint/,
  // Generic login/auth redirect patterns — session_redirect and returnUrl params
  // indicate the site is intercepting navigation to force login; syncing these
  // causes the other (logged-in) device to be bounced to a login page.
  /[?&]session_redirect=/,
  /[?&]returnUrl=/,
  /[?&]return_to=/,
  /[?&]redirect_uri=/,
];

// Returns true if the URL should be excluded from all sync operations.
function isSyncBlocked(url) {
  if (!url) return false;
  try {
    return SYNC_BLOCKLIST.some(pattern => pattern.test(url));
  } catch {
    return false;
  }
}

// Normalize URLs for comparison — strip fragment and query params for known dynamic sites
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';

    // Google Docs: /edit, /view, /preview all point to same doc
    // Strip query params and normalize path
    if (u.hostname.includes('docs.google.com')) {
      u.search = '';
      // Normalize /edit, /view, /preview to /view
      u.pathname = u.pathname.replace(/\/(edit|view|preview)$/, '/view');
      return u.toString();
    }

    // Google Drive: strip user index /u/N/ (varies per machine/account),
    // query params (usp=sharing, resourcekey, etc.), and normalize file actions.
    // /u/0/ on one device may be /u/1/ on another — treat them as identical.
    if (u.hostname === 'drive.google.com') {
      u.search = '';
      // Strip /u/0/, /u/1/, etc. from path prefix
      u.pathname = u.pathname.replace(/^\/drive\/u\/\d+\//, '/drive/');
      // Normalize file actions: /edit, /preview → /view
      u.pathname = u.pathname.replace(/\/(edit|preview)$/, '/view');
      return u.toString();
    }

    // Vercel: strip UTM and other tracking params
    if (u.hostname.includes('vercel.com')) {
      u.search = ''; // Strip all query params on vercel
      return u.toString();
    }

    // Other sites: strip query params too (most sites use params for tracking)
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}
