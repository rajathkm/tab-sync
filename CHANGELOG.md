# Changelog

All notable changes follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking protocol/architecture changes (extension + server must update together)
- **MINOR** — new features, backward-compatible (new sync modes, profile options)
- **PATCH** — bug fixes, UI changes, no protocol changes

Extension version is in `extension/manifest.json` → `"version"`. Always bump before pushing.

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
