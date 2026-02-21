// setup.js — 5-step setup wizard

let currentStep = 1;
const profiles = {}; // dir -> label

// --- Browser detection ---
function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Dia/i.test(ua)) return 'dia';
  return 'chrome';
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  const browser = detectBrowser();
  document.getElementById('detected-browser').textContent = browser === 'dia' ? 'Dia' : 'Chrome';
  document.getElementById('browser-select').value = browser;

  // Generate a random token for shared-secret mode
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
  document.getElementById('generated-token').textContent = token;

  // Pre-populate with common profile dirs
  addProfileRow('Default', '');
  addProfileRow('Profile 1', '');

  // Load existing config if re-running setup
  const existing = await getConfig();
  if (existing) {
    document.getElementById('browser-select').value = existing.browser || browser;
    document.getElementById('device-name').value = existing.device || '';
    document.getElementById('primary-server').value = existing.primaryServer || '';
    document.getElementById('secondary-server').value = existing.secondaryServer || '';

    if (existing.profiles) {
      document.getElementById('profiles-list').innerHTML = '';
      for (const [dir, label] of Object.entries(existing.profiles)) {
        addProfileRow(dir, label);
      }
    }
  }

  setupNavigation();
  setupAuthToggle();
});

function addProfileRow(dir, label) {
  const list = document.getElementById('profiles-list');

  // Don't add duplicate
  const existing = list.querySelectorAll('.profile-row');
  for (const row of existing) {
    if (row.dataset.dir === dir) return;
  }

  const isSkip = label === 'skip';
  const row = document.createElement('div');
  row.className = 'profile-row';
  row.dataset.dir = dir;
  row.innerHTML = `
    <span class="profile-dir">${dir}</span>
    <input type="text"
           class="profile-input"
           data-profile-dir="${dir}"
           placeholder="Label (e.g. personal, work)"
           value="${isSkip ? '' : (label || '')}"
           aria-label="Label for ${dir}"
           ${isSkip ? 'disabled' : ''}>
    <label class="skip-label">
      <input type="checkbox" data-skip-dir="${dir}" ${isSkip ? 'checked' : ''}> Skip
    </label>
  `;
  list.appendChild(row);
}

function setupNavigation() {
  // Step 1 -> 2
  document.getElementById('btn-step1-next').addEventListener('click', () => goToStep(2));

  // Step 2
  document.getElementById('btn-step2-back').addEventListener('click', () => goToStep(1));
  document.getElementById('btn-step2-next').addEventListener('click', () => {
    // Collect profile mappings from text inputs
    const inputs = document.querySelectorAll('#profiles-list input[type="text"]');
    let hasProfile = false;
    for (const input of inputs) {
      const dir = input.dataset.profileDir;
      const skipBox = document.querySelector(`input[data-skip-dir="${dir}"]`);
      if (skipBox && skipBox.checked) continue;
      const val = input.value.trim().toLowerCase().replace(/\s+/g, '-');
      if (val) {
        profiles[dir] = val;
        hasProfile = true;
      }
    }
    if (!hasProfile) {
      alert('Please assign a label to at least one profile.');
      return;
    }
    goToStep(3);
  });

  // Skip checkbox toggles the text input
  document.getElementById('profiles-list').addEventListener('change', (e) => {
    if (e.target.dataset.skipDir) {
      const dir = e.target.dataset.skipDir;
      const input = document.querySelector(`input[data-profile-dir="${dir}"]`);
      if (input) {
        input.disabled = e.target.checked;
        if (e.target.checked) input.value = '';
      }
    }
  });

  // Add manual profile
  document.getElementById('btn-add-profile').addEventListener('click', () => {
    const input = document.getElementById('manual-profile-dir');
    const dir = input.value.trim();
    if (dir) {
      addProfileRow(dir, '');
      input.value = '';
    }
  });

  // Step 3
  document.getElementById('btn-step3-back').addEventListener('click', () => goToStep(2));
  document.getElementById('btn-step3-next').addEventListener('click', () => {
    const device = document.getElementById('device-name').value.trim();
    const server = document.getElementById('primary-server').value.trim();
    if (!device) { alert('Device name is required.'); return; }
    if (!server) { alert('Primary server URL is required.'); return; }
    goToStep(4);
  });

  // Step 4
  document.getElementById('btn-step4-back').addEventListener('click', () => goToStep(3));
  document.getElementById('btn-step4-next').addEventListener('click', () => goToStep(5));

  // Step 5
  document.getElementById('btn-step5-back').addEventListener('click', () => goToStep(4));
  document.getElementById('btn-step5-finish').addEventListener('click', () => finishSetup());
}

function setupAuthToggle() {
  const cards = document.querySelectorAll('.auth-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      // Update card selection visuals
      cards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      // Check the radio
      const radio = card.querySelector('input[type="radio"]');
      radio.checked = true;

      // Show/hide auth detail panels
      const authType = radio.value;
      document.querySelectorAll('.auth-detail').forEach(el => el.classList.remove('visible'));
      const panel = document.getElementById(`auth-${authType}`);
      if (panel) panel.classList.add('visible');
    });
  });
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  const target = document.querySelector(`.step[data-step="${step}"]`);
  if (target) target.classList.add('active');

  // Update dots and lines
  document.querySelectorAll('.step-dot').forEach(dot => {
    const dotStep = parseInt(dot.dataset.step);
    dot.classList.remove('active', 'done');
    if (dotStep === step) dot.classList.add('active');
    else if (dotStep < step) dot.classList.add('done');
  });

  document.querySelectorAll('.step-line').forEach(line => {
    const lineStep = parseInt(line.dataset.line);
    line.classList.remove('done');
    if (lineStep < step) line.classList.add('done');
  });
}

async function finishSetup() {
  const browser = document.getElementById('browser-select').value;
  const device = document.getElementById('device-name').value.trim();
  const primaryServer = document.getElementById('primary-server').value.trim();
  const secondaryServer = document.getElementById('secondary-server').value.trim();
  const authType = document.querySelector('input[name="auth-type"]:checked').value;

  let authToken = null;
  if (authType === 'token') {
    authToken = document.getElementById('generated-token').textContent;
  }

  const profileDirs = Object.keys(profiles);
  const activeProfileDir = profileDirs[0] || 'Default';

  const config = {
    browser,
    device,
    primaryServer,
    secondaryServer: secondaryServer || null,
    profiles,
    activeProfileDir,
    authType,
    authToken
  };

  await saveConfig(config);

  // Enable all profiles by default
  for (const label of Object.values(profiles)) {
    await setToggle(label, true);
  }

  // Notify background script
  chrome.runtime.sendMessage({ type: 'config_saved' }).catch(() => {});

  goToStep('done');
}
