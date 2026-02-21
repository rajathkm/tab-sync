# Changelog

All notable changes follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking protocol/architecture changes (extension + server must update together)
- **MINOR** — new features, backward-compatible (new sync modes, profile options)
- **PATCH** — bug fixes, UI changes, no protocol changes

Extension version is in `extension/manifest.json` → `"version"`. Always bump before pushing.

---

## [1.1.13] — 2026-02-21

### Fixed
- **Dia browser detected as "chrome"** — `detectBrowser()` previously used the User-Agent string to detect Dia, but Dia (like most Chromium forks) omits its own name from the UA for web-compatibility reasons. Fixed in both `background.js` and `setup.js` to use `chrome.runtime.getURL('')` instead: if the URL starts with `dia-extension://` it's Dia; `chrome-extension://` means Chrome. UA check kept as belt-and-braces fallback.

### Added
- **`install.sh`** — one-command macOS server installer. Checks Node.js version, clones/updates the repo, runs `npm install`, offers to generate an auth token, installs a LaunchAgent for auto-start, verifies the health endpoint, and prints the exact server URL(s) to paste into the extension wizard on every device. Detects both local IP and Tailscale IP if present.
- **`README.md`** — public-facing documentation covering: what Relay does, how the server+extension architecture works, quick install steps, platform support table, sync feature matrix, networking options (same-LAN / Tailscale / VPS), and a troubleshooting table.

### Changed
- **`push-update.sh`** — removed hardcoded secondary-device SSH target. Rsync to a second machine is now opt-in via `RELAY_SYNC_TARGET=user@host:path` env var.
- **`PRD.md` + `TASK.md`** — moved to `.gitignore` (internal design docs, not for public repo).

---

## [1.1.12] — 2026-02-21

### Added

- **In-tab navigation sync (`tab_navigated` event)** — navigating within a synced tab (link clicks, address bar changes, redirects, Cmd+L) now propagates to the other device in real time.

  **Root cause (3 reasons it wasn't working):**
  1. `onUpdated` explicitly skipped real→real URL transitions (`if (!isInternalUrl(prevUrl)) return`). v1.1.11 was intentionally "tab opens only."
  2. No `tab_navigated` event type existed — the receiver only handled `tab_opened` (new tab create) and `tab_closed`. In-tab events had nowhere to land.
  3. No tab correlation mechanism — tabs don't share IDs across browsers. Fix matches by URL: receiver finds the tab showing `oldUrl` and navigates it to `newUrl`.

  **New `tab_navigated` event**: `{ type: 'tab_navigated', oldUrl, newUrl }`. Sender emits when `onUpdated` fires with both `prevUrl` and `url` being real (non-internal) URLs that differ. Receiver's `handleTabNavigated()` queries all tabs, finds one matching `oldUrl`, calls `chrome.tabs.update(tabId, { url: newUrl })`, and flashes the badge.

- **Echo suppression for navigation** — `pendingNavUrls` Set tracks `${tabId}:${url}` pairs triggered by `handleTabNavigated`. When `onUpdated` fires as a result of a received `tab_navigated`, it's suppressed so the navigation doesn't echo back to the sender.

---

## [1.1.11] — 2026-02-21

### Fixed (root cause of Cmd+T sync failure)

- **`newTabIds` reset on service worker restart silently killed address-bar tab sync** — this is the core reason Cmd+T → navigate never synced while Cmd+Shift+T (restore) and tab close both worked.

  MV3 service workers die after ~30 seconds of inactivity and restart on the next event. `newTabIds` was an in-memory `Set` — gone on every restart. When the user pressed Cmd+T (adds tab to `newTabIds`) and then typed a URL (wakes SW for `onUpdated`), `newTabIds` was empty on the restarted SW and the navigation was silently dropped.

  Cmd+Shift+T worked because `onCreated` fires with the URL already set (no `newTabIds` needed). Tab close worked because `tabUrlCache` is repopulated by `initTabCache()` on every restart.

  **Fix**: removed `newTabIds` entirely. Replaced with a `prevUrl` approach: `onCreated` always writes the tab's starting URL ('' for blank/newtab) to `tabUrlCache`. `onUpdated` reads the previous URL and emits `tab_opened` only when the transition is internal→real (blank or chrome://newtab → actual website). `tabUrlCache` survives SW restarts because `initTabCache()` re-seeds it from `chrome.tabs.query()` on every SW startup — so existing tabs are correctly classified even after a sleep cycle.

- **`isInternalUrl()` helper** — extracted repeated URL-scheme check into a shared function. Added `dia://` and `dia-extension://` schemes (for Dia browser compatibility) in all relevant checks including `onRemoved`.

---

## [1.1.10] — 2026-02-21

### Fixed

- **pendingSyncUrls map silently killed live sync sending** — v1.1.9 added a `pendingSyncUrls` Map (keyed by normalised URL) to suppress echo `tab_opened` events emitted by `onCreated`/`onUpdated` when `handleTabOpened` created a tab. The map was designed to only hold URLs currently being opened by the sync path, but it caused live sync events from the *user's own* tab opens to be silently dropped in edge cases (e.g. after `push-all-tabs` populated the map, or when Dia's `chrome.tabs.create` fired `onCreated` with an empty URL, leaving the map entry unconsumed). Result: post-v1.1.9 reload, both devices showed zero live `tab_opened` events in the server log while `push-all-tabs` (which bypasses the listener path entirely) still worked. **Fix**: removed `pendingSyncUrls` entirely. Echoes are harmless — the originating device always suppresses them via the duplicate-URL check in `handleTabOpened`.

- **`isInternal` missing Dia-specific URL schemes** — added `dia://` and `dia-extension://` to the internal URL scheme list in `onCreated`. Without this, Dia's custom new-tab URL would have been treated as a real URL, incorrectly emitting `tab_opened` for the new-tab page and skipping the `newTabIds` path that detects subsequent address-bar navigations.

---

## [1.1.9] — 2026-02-21

### Fixed

- **Echo cascade making synced tabs appear invisible** — when `handleTabOpened` created a tab on the receiving device, `onCreated` fired and emitted `tab_opened` back to the originating device. The echo itself was harmless (duplicate-suppressed at origin). But it coupled the synced tab's lifetime to the echo chain: user opens tab on A → syncs to B (background, 1.2s delay) → user closes test tab on A before noticing B's tab → close event arrives at B → B closes its synced tab → B echoes `tab_closed` → apparent result: tab appeared for ~1s then vanished, looks like sync broke. Fix: `pendingSyncUrls` map (keyed by `normalizeUrl(url)`, value = count for concurrent same-URL syncs) tracks URLs currently being opened by `handleTabOpened`. `onCreated` and `onUpdated` check the map before emitting `tab_opened` — sync-created tabs are silently consumed from the map and no echo is sent. Tab close still propagates normally (user-initiated closes on either device should still close the other).

- **Zero feedback for received tabs** — synced tabs open as background tabs (`active: false`) with no indicator they arrived. With the echo suppression above, the receiving device no longer echoes back to the originating device, so the originating user gets no confirmation either. Added a 3-second amber badge flash (`+1`) when `handleTabOpened` successfully creates a tab. The badge uses the existing Relay amber color (`#F0B433`).

- **Silent failure modes were invisible** — added `console.log` at every decision point in `executeEvent`, `handleTabOpened`, `onCreated`, `onUpdated`, and `onRemoved`. Open the background service worker DevTools (`dia://extensions` → Relay → Service Worker "Inspect") to see exactly which path each event takes.

---

## [1.1.8] — 2026-02-22

### Fixed

- **Auto-open defaulted to off on every device** — `isOpenSyncEnabled` used `=== true` (opt-in), meaning a freshly set-up device would ignore all received `tab_opened` events and never emit its own. Both the sender and receiver check this toggle, so if *either* device had it off, the whole auto-open chain was silently broken. Mac Mini was just installed with a fresh config — toggle was `undefined`, evaluated to `false`. Changed to `!== false` (opt-out): enabled unless explicitly disabled. Popup display updated to match.

---

## [1.1.7] — 2026-02-22

### Fixed

- **Auto-open toggle was a dummy button** — the CSS hides the `<input>` checkbox (`width:0; height:0`) and overlays a `.slider` span. With `<div class="toggle">`, clicking the slider had no `<label>` connection to the hidden checkbox, so no `change` event fired, the message to the background was never sent, and the state never changed. "Sync enabled" appeared to work only because setup enables it programmatically — it was never actually clicked. Fix: changed both toggle wrappers in `popup.js` from `<div class="toggle">` to `<label class="toggle">`, so clicking anywhere in the label area (including the slider) toggles the checkbox.

- **All tab events buffered for 2 seconds after reconnect** — the sequence ordering logic expected `seq=1` as the first event but the server's monotonic counter survived the reconnect storm and was at 100+. Every post-reconnect first event went into the gap-timer buffer and waited 2s. Simplified sequencing to deduplication only: events are processed immediately; only `event.seq <= lastSeq` (already-seen events) are skipped. Out-of-order delivery over a TCP WebSocket is practically impossible.

---

## [1.1.6] — 2026-02-22

### Fixed (critical — reconnect storm)

- **Stale WS close events clobbering active connection** — the root cause of the infinite reconnect loop and "Offline" popup status.

  MV3 service workers restart on every browser event (tab open, alarm, etc). Each restart calls `connect()`, setting `ws = WS_new`. The server then closes `WS_old` (code 4002 "Replaced"). `WS_old`'s `onclose` handler fired after the fact and executed `ws = null`, clobbering `WS_new`. The retry timer then created `WS_newer`, the server closed `WS_new`, and the cycle repeated every ~300–500ms.

  Fix: `connect()` now captures each WebSocket in a local `thisWs` constant. The `onopen` and `onclose` handlers check `ws === thisWs` before touching the module-level `ws` variable. Stale close events from previous lifecycles silently return.

---

## [1.1.5] — 2026-02-22

### Fixed

- **Context menu race — replaced `removeAll + create` with `update → create` fallback**
  The previous approach (removeAll + create) had a window where both `onInstalled` and the startup IIFE could each call `removeAll()` and then `create()` before the other's removal completed, producing "Cannot create item with duplicate id". A module-level boolean guard was proposed but rejected: MV3 service worker resets all in-memory state on every restart, so the guard is always `false` when the race matters. New approach: `update('push-tab', ...)` — if the item exists, it updates in-place (no duplicate); if not, the error callback creates it. Any remaining concurrent `create()` race is silently handled by checking `lastError`.

- **`handleTabOpened` fall-through bug** — if `config.activeProfileDir` was null/stale, the profile label lookup returned `undefined`, the toggle check was silently skipped, and the tab opened regardless of the user's open-sync setting. Now returns early when profile can't be resolved.

- **Null-safe `tab.url` in `onCreated`** — `tab.url` can be `undefined`, `null`, or empty depending on Chrome version and tab type. Coerced to a safe string with type check before any `.startsWith()` call.

---

## [1.1.4] — 2026-02-22

### Changed
- **Renamed to Relay** — extension name, manifest title, popup heading, setup wizard, styles comment all updated
- **New icons** — amber-gold squircle background, white browser-tab shape with amber relay arrow; all 3 sizes (16/48/128px) regenerated to match Sarvam warm sovereign design language

### Fixed
- **Auto-open tab detection** — replaced unreliable `!oldUrl` check with a `newTabIds` Set; tabs opened via cmd+click, `window.open`, or JS now correctly emit `tab_opened` events; `onCreated` is the source of truth for new tab detection, `onUpdated` handles tabs that start blank then navigate

---

## [1.1.3] — 2026-02-22

### Fixed
- **Duplicate context menu id** — `setupContextMenu()` now uses the callback form of `chrome.contextMenus.create()` to suppress harmless "duplicate id" errors that fire when the service worker restarts rapidly (both `onInstalled` and the startup IIFE call `setupContextMenu()` concurrently; `removeAll()` was already awaited but the Chrome API still races on rapid SW restarts)

---

## [1.1.2] — 2026-02-22

### Fixed
- Settings icon was an SVG sun (straight spokes); replaced with a proper gear/cog icon
- Secondary server URL config was not persisting correctly across profiles — note: each Dia profile stores its own config; if you set up additional profiles before this fix, re-run setup for those profiles to update their secondary server URL

---

## [1.1.1] — 2026-02-21

### Fixed
- Service worker clean closes (sleep) no longer count toward primary server failover threshold
- Added `chrome.alarms` keepalive (1-min interval) to reconnect WebSocket after service worker wakes
- Added `alarms` permission to manifest
- Eliminates spurious `ERR_CONNECTION_REFUSED` on port 7778 caused by false primary failures

---

## [1.1.0] — 2026-02-21

### Added
- Warm sovereign minimal UI redesign (Sarvam-inspired)
- `extension/styles.css` — shared design system with CSS variables
- Custom font pairing: Playfair Display (headings) + DM Sans (body)
- Animated Connected status badge (CSS pulse keyframe)
- Step progress indicator with connecting line in setup wizard
- Inline SVG icons per setup step
- Responsive layout down to 320px
- Free-text profile labels (replaced hardcoded Personal/Work dropdown)
- Skip toggle per profile in setup wizard

### Fixed
- Popup "Offline" display bug — now listens for live `status_update` messages from service worker
- Profile label collection now uses text inputs (setup.js)

---

## [1.0.0] — 2026-02-21

### Added
- Initial build: Chrome/Dia extension (Manifest V3)
- WebSocket sync server (Node.js, `ws` package)
- Profile-scoped sync channels: `{browser}:{profile-label}`
- Tab close sync (always on) and tab open sync (opt-in)
- Offline queue: 50 events max, 5-min TTL, persisted to `chrome.storage.session`
- Sequence numbers for ordered event delivery
- Primary/secondary server failover
- Exponential backoff reconnect (1s → 60s cap)
- Context menu "Push tab to other device"
- Popup "Push all tabs" with 100ms stagger
- Per-profile sync toggle persisted to `chrome.storage.local`
- 5-step setup wizard
- LaunchAgent plists for Mac Mini (primary) and MacBook Pro (secondary)
- Tailscale ACL snippet for port-level hardening
- Bearer token auth option for non-Tailscale deployments
