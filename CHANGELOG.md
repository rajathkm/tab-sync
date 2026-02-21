# Changelog

All notable changes follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking protocol/architecture changes (extension + server must update together)
- **MINOR** — new features, backward-compatible (new sync modes, profile options)
- **PATCH** — bug fixes, UI changes, no protocol changes

Extension version is in `extension/manifest.json` → `"version"`. Always bump before pushing.

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
