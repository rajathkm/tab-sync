#!/bin/bash
# Usage: ./push-update.sh "fix: description" [patch|minor|major]
# Bumps version, commits, tags, pushes to GitHub.
# Always rsyncs to MacBook Pro at the correct extension path.
# Optional extra target: set RELAY_SYNC_TARGET=user@host:path to also rsync elsewhere.

# MacBook Pro extension path (canonical — do not change without updating Relay extension load path)
MACBOOK_PRO_TARGET="rajath@100.112.174.57:~/Downloads/Projects/tab-sync/"

set -e
cd "$(dirname "$0")"

MESSAGE="${1:-chore: update}"
BUMP="${2:-patch}"

# Get current version from manifest
CURRENT=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP" in
  major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR+1)); PATCH=0 ;;
  patch) PATCH=$((PATCH+1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Bump version in manifest
python3 -c "
import json
with open('extension/manifest.json') as f: m = json.load(f)
m['version'] = '${NEW_VERSION}'
with open('extension/manifest.json', 'w') as f: json.dump(m, f, indent=2)
"

echo "📦 Bumping $CURRENT → $NEW_VERSION"

# Commit + tag
git add -A
git commit -m "v${NEW_VERSION}: ${MESSAGE}"
git tag "v${NEW_VERSION}"

# Push to GitHub
git push origin main --tags
echo "✅ Pushed to GitHub (v${NEW_VERSION})"

# Always sync to MacBook Pro (~/Downloads/Projects/tab-sync/extension/ is the load path)
rsync -a --exclude='node_modules' --exclude='.git' . "$MACBOOK_PRO_TARGET"
echo "✅ Synced to MacBook Pro (${MACBOOK_PRO_TARGET})"
echo "👉 MacBook Pro: dia://extensions → Relay → ⟳ reload"

# Optional: sync to an additional device
if [ -n "$RELAY_SYNC_TARGET" ]; then
  rsync -a --exclude='node_modules' --exclude='.git' . "$RELAY_SYNC_TARGET"
  echo "✅ Synced to $RELAY_SYNC_TARGET"
fi
