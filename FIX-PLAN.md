# Tab-Sync Duplicate Tab Fix Plan — 2026-03-14

## Files in scope
- `extension/config.js` — normalizeUrl, SYNC_BLOCKLIST
- `extension/background.js` — pendingNavUrls, handleTabOpened, onUpdated, initTabCache

## DO NOT TOUCH
- `server/` directory — no server changes needed
- `manifest.json`
- `popup.js`, `popup.html`, `setup.js`, `setup.html`
- Any infra files

---

## Fix 1 — RCA 3: Google Docs `?tab=` param causes spurious tab_navigated loop (HIGHEST PRIORITY)

**Problem:** Google Docs recently started appending `?tab=t.0` (and similar) to URLs during load.
This is NOT meaningful navigation — it's an internal Docs state param. But `isHashOnlyChange()`
only ignores fragment changes, not query param changes. So `onUpdated` fires, emits `tab_navigated`,
the other device navigates its Docs tab, which fires another `onUpdated`, loop begins, duplicate tabs result.

**Fix in `config.js` — expand `normalizeUrl` for Google Docs:**
In the `docs.google.com` branch of `normalizeUrl`, also strip the `tab` query param specifically
(in addition to clearing all search params, which already happens). Actually `u.search = ''` already
strips ALL params for Docs — the issue is that `tabUrlCache` stores the raw URL before normalization,
so the comparison in `onUpdated` between `prevUrl` (raw, has `?tab=t.0`) and `url` (new raw value)
doesn't match normalized form.

**Real fix:** In `onUpdated`, before emitting `tab_navigated`, check if the normalized forms of
`prevUrl` and `url` are identical — if so, skip (it's a param-only change that normalizes away).

Add this check in `onUpdated` in `background.js`, just before the `tab_navigated` send:
```js
// Skip if normalized URLs are identical — param-only change (e.g. Google Docs ?tab=t.0)
if (normalizeUrl(prevUrl) === normalizeUrl(url)) {
  console.log('[Relay] onUpdated: skipped param-only change (normalized identical):', url);
  return;
}
```

Place this check AFTER the `isHashOnlyChange` check, BEFORE sending `tab_navigated`.

---

## Fix 2 — RCA 2: pendingNavUrls echo suppression misses on redirect (MEDIUM PRIORITY)

**Problem:** `handleTabOpened` stores `${tabId}:${event.url}` in `pendingNavUrls`.
But `chrome.tabs.update` may trigger a redirect (HTTP→HTTPS, tracking params added),
so `onUpdated` fires with a DIFFERENT url than what was stored. Echo suppression misses,
`onUpdated` emits `tab_opened` back, duplicate appears.

**Fix in `background.js`:** In `handleTabOpened`, after calling `chrome.tabs.update`,
also add a tabId-only suppression entry for 5 seconds:

Add a new Set: `const pendingTabNavTabIds = new Set();`

In `handleTabOpened` (the `blankTab` branch), after adding to `pendingNavUrls`, also add:
```js
pendingTabNavTabIds.add(blankTab.id);
setTimeout(() => pendingTabNavTabIds.delete(blankTab.id), 5000);
```

In `onUpdated`, in the `real→real` branch, add a check BEFORE the `pendingNavUrls` check:
```js
if (pendingTabNavTabIds.has(tabId)) {
  pendingTabNavTabIds.delete(tabId);
  console.log('[Relay] onUpdated: suppressed echo (tabId-based pendingNav):', url);
  return;
}
```

---

## Fix 3 — RCA 1: normalizeUrl non-idempotency + tabUrlCache stores raw URLs (LOWER PRIORITY)

**Problem:** `tabUrlCache` stores raw (non-normalized) URLs. When `handleTabOpened` does
duplicate suppression, it normalizes both `event.url` and `tab.url`. But if `tab.url` was
stored raw and `normalizeUrl` is not perfectly idempotent, the comparison can fail.

**Fix in `background.js`:** In `initTabCache`, normalize URLs on store:
```js
tabUrlCache.set(tab.id, tab.url ? normalizeUrl(tab.url) : '');
```

Also in `onCreated`:
```js
tabUrlCache.set(tab.id, url ? normalizeUrl(url) : '');
```

And in `onUpdated` (the cache write at top):
```js
tabUrlCache.set(tabId, normalizeUrl(url));
```

**Important:** After this change, `prevUrl` in `onUpdated` will already be normalized.
Update the `isHashOnlyChange(prevUrl, url)` call to use raw `url` (not normalized prevUrl)
— pass `normalizeUrl(prevUrl)` and `normalizeUrl(url)` to `isHashOnlyChange` won't work
since hash is stripped. Keep `isHashOnlyChange` using raw URLs, just update cache writes.

---

## Verification checklist

After implementing all fixes:

1. [ ] `normalizeUrl` called on same Google Docs URL twice returns same result
2. [ ] Open a Google Doc on Device A — Device B should open it ONCE (not twice)
3. [ ] Navigate within Google Docs (heading jump, tab param change) — should NOT fire tab_navigated to other device
4. [ ] Open a site that does HTTP→HTTPS redirect (e.g. http://example.com) — Device B opens ONCE
5. [ ] Close a tab on Device A — Device B closes it (close sync still works)
6. [ ] Navigate a real URL (e.g. click a link in a webpage) — Device B navigates its matching tab
7. [ ] Push All Tabs still works
8. [ ] Context menu "Push tab" still works
9. [ ] No TypeScript/JS errors in background service worker console

## Version bump
Bump `extension/manifest.json` version from current to next PATCH (e.g. 1.1.19 → 1.1.20).
Add entry to `CHANGELOG.md` describing the three fixes.

## Final report
List every change made, file + line, and checklist pass/fail for each item above.
