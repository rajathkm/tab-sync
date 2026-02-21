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
  return toggles[profileLabel] === true; // disabled by default
}

// Normalize URLs for comparison — strip fragment
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
