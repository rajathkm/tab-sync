// popup.js — status per profile, toggles, push-all-tabs

document.addEventListener('DOMContentLoaded', async () => {
  const config = await getConfig();
  const container = document.getElementById('content');

  // Settings button
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  });

  if (!config || !(await isSetupComplete())) {
    container.innerHTML = `
      <div class="no-setup">
        <div class="no-setup-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 1l4 4-4 4"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <path d="M7 23l-4-4 4-4"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </div>
        <p>Relay is not configured yet.<br>Set up cross-device tab syncing in a few steps.</p>
        <button class="btn-primary" id="run-setup" style="width:100%;">Run Setup</button>
      </div>
    `;
    document.getElementById('run-setup').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    });
    return;
  }

  // Request current status from background
  const status = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'get_status' }, resolve);
  });

  const toggles = await getToggles();
  const openSyncToggles = await getOpenSyncToggles();

  container.innerHTML = '<div class="profiles-list"></div>';
  const profilesList = container.querySelector('.profiles-list');

  // Build UI for each configured profile
  for (const [dir, label] of Object.entries(config.profiles)) {
    const connStatus = status?.connectionStatus?.[label];
    const statusText = connStatus?.status || 'offline';
    const enabled = toggles[label] !== false;
    const openSyncOn = openSyncToggles[label] === true;

    const card = document.createElement('div');
    card.className = 'profile-card';
    card.dataset.profile = label;

    const statusClass = {
      connected: 'status-connected',
      offline: 'status-offline',
      backup: 'status-backup',
      disabled: 'status-disabled'
    }[statusText] || 'status-offline';

    const statusLabel = {
      connected: 'Connected',
      offline: 'Offline',
      backup: 'Using Backup',
      disabled: 'Disabled'
    }[statusText] || 'Offline';

    card.innerHTML = `
      <div class="profile-header">
        <span class="profile-name">${label}</span>
        <span class="status-badge ${statusClass}" data-status-badge="${label}">${statusLabel}</span>
      </div>
      <div class="toggle-row">
        <label>Sync enabled</label>
        <div class="toggle">
          <input type="checkbox" data-toggle="sync" data-profile="${label}" ${enabled ? 'checked' : ''} aria-label="Toggle sync for ${label}">
          <span class="slider"></span>
        </div>
      </div>
      <div class="toggle-row">
        <label>Auto-open tabs</label>
        <div class="toggle">
          <input type="checkbox" data-toggle="open-sync" data-profile="${label}" ${openSyncOn ? 'checked' : ''} aria-label="Toggle auto-open for ${label}">
          <span class="slider"></span>
        </div>
      </div>
      <button class="push-btn" data-push="${label}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        Push all tabs
      </button>
      <div class="push-status" data-push-status="${label}"></div>
    `;

    profilesList.appendChild(card);
  }

  // Wire up sync toggles
  container.querySelectorAll('input[data-toggle="sync"]').forEach(input => {
    input.addEventListener('change', () => {
      chrome.runtime.sendMessage({
        type: 'toggle_profile',
        profileLabel: input.dataset.profile,
        enabled: input.checked
      });
    });
  });

  // Wire up open-sync toggles
  container.querySelectorAll('input[data-toggle="open-sync"]').forEach(input => {
    input.addEventListener('change', () => {
      chrome.runtime.sendMessage({
        type: 'toggle_open_sync',
        profileLabel: input.dataset.profile,
        enabled: input.checked
      });
    });
  });

  // Wire up push-all buttons
  container.querySelectorAll('.push-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const label = btn.dataset.push;
      const statusEl = container.querySelector(`[data-push-status="${label}"]`);
      btn.disabled = true;
      statusEl.textContent = 'Pushing tabs\u2026';

      chrome.runtime.sendMessage({ type: 'push_all_tabs', profileLabel: label }, (result) => {
        btn.disabled = false;
        if (result) {
          statusEl.textContent = `${result.pushed} pushed, ${result.skipped} already open`;
        } else {
          statusEl.textContent = 'Push failed';
        }
        setTimeout(() => { statusEl.textContent = ''; }, 5000);
      });
    });
  });

  // Listen for live updates while popup is open
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'push_progress') {
      const statusEls = container.querySelectorAll('.push-status');
      statusEls.forEach(el => {
        el.textContent = `Pushing ${msg.current}/${msg.total}\u2026`;
      });
    }

    if (msg.type === 'status_update') {
      updateProfileStatus(msg.profile, msg.status);
    }
  });
});

// Update a single profile's status badge without reloading
function updateProfileStatus(profileLabel, newStatus) {
  const badge = document.querySelector(`[data-status-badge="${profileLabel}"]`);
  if (!badge) return;

  // Remove old status classes
  badge.classList.remove('status-connected', 'status-offline', 'status-backup', 'status-disabled');

  const statusClass = {
    connected: 'status-connected',
    offline: 'status-offline',
    backup: 'status-backup',
    disabled: 'status-disabled'
  }[newStatus] || 'status-offline';

  const statusLabel = {
    connected: 'Connected',
    offline: 'Offline',
    backup: 'Using Backup',
    disabled: 'Disabled'
  }[newStatus] || 'Offline';

  badge.className = `status-badge ${statusClass}`;
  badge.setAttribute('data-status-badge', profileLabel);
  badge.textContent = statusLabel;
}
