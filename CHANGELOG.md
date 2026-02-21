# Changelog

All notable changes follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking protocol/architecture changes (extension + server must update together)
- **MINOR** — new features, backward-compatible (new sync modes, profile options)
- **PATCH** — bug fixes, UI changes, no protocol changes

Extension version is in `extension/manifest.json` → `"version"`. Always bump before pushing.

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

### Fixed (MiniMax adversarial review)

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
- Secondary server URL updated to point at MacBook Pro (`ws://100.112.174.57:7778`) — note: each Dia profile stores its own config; if you set up additional profiles before this fix, re-run setup for those profiles to update their secondary server URL

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
