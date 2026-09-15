import { 
  auth, 
  onAuthStateChanged, 
  signOut, 
  getUserProfile, 
  createAccountBySupervisor 
} from './firabase.js';

let currentUserProfile = null;

// ============================================================================
// Hidden Hardware Simulator (Dev Tools) — Shift+F1
// Simulates the face-scan turnstile & door NFC reader until real hardware is wired in
// ============================================================================
const WORKER_STATUS_KEY = 'pakset_dev_worker_status';

const WORKER_STATUS_CONFIG = {
  working: { color: '#10b981', glow: 'rgba(16,185,129,0.85)', label: 'Working (on workfloor)' },
  break:   { color: '#fb923c', glow: 'rgba(251,146,60,0.85)', label: 'On Break (left workfloor)' },
  home:    { color: '#94a3b8', glow: 'rgba(148,163,184,0.5)', label: 'Home (not at factory)' }
};

function getWorkerStatus() {
  const val = localStorage.getItem(WORKER_STATUS_KEY);
  return WORKER_STATUS_CONFIG[val] ? val : 'home';
}

function setWorkerStatus(status) {
  if (!WORKER_STATUS_CONFIG[status]) return;
  localStorage.setItem(WORKER_STATUS_KEY, status);
  applyWorkerStatusLed();
}

function applyWorkerStatusLed() {
  const led = document.getElementById('workerStatusLed');
  if (!led) return;
  const cfg = WORKER_STATUS_CONFIG[getWorkerStatus()];
  led.style.background = cfg.color;
  led.style.setProperty('--led-color', cfg.color);
  led.style.setProperty('--led-glow', cfg.glow);
  led.title = `Live status (dev-simulated): ${cfg.label}`;
}

function injectDevToolStyles() {
  if (document.getElementById('devToolLedStyles')) return;
  const style = document.createElement('style');
  style.id = 'devToolLedStyles';
  style.textContent = `
    @keyframes ledPulse {
      0%, 100% { box-shadow: 0 0 4px 1px var(--led-color), 0 0 8px 2px var(--led-glow); }
      50% { box-shadow: 0 0 7px 2px var(--led-color), 0 0 15px 5px var(--led-glow); }
    }
    .worker-status-led {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
      animation: ledPulse 1.8s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// Registry so other page scripts (e.g. my-info.js) can inject their own simulator
// controls into the same hidden dev tools panel without auth-guard.js knowing about them.
window.__paksetDevToolSections = window.__paksetDevToolSections || [];
window.registerPaksetDevToolSection = function registerPaksetDevToolSection(renderFn) {
  window.__paksetDevToolSections.push(renderFn);
};

// Hidden dev tools panel: Shift+F1 toggles a simulator for factory hardware inputs.
// Built to be extended later with more simulated hardware controls in the same panel.
function toggleDevToolsPanel() {
  let panel = document.getElementById('hiddenDevToolsPanel');
  if (panel) {
    panel.remove();
    return;
  }

  panel = document.createElement('div');
  panel.id = 'hiddenDevToolsPanel';
  panel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    width: 300px;
    max-height: 80vh;
    overflow-y: auto;
    background: #e0e5ec;
    padding: 16px;
    border-radius: 18px;
    box-shadow: 9px 9px 16px #a3b1c6, -9px -9px 16px #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #2d3748;
  `;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <span style="font-weight:800; font-size:13px;">🛠️ Hardware Simulator</span>
      <button id="devToolsCloseBtn" style="background:#e0e5ec; border:none; width:24px; height:24px; border-radius:8px; box-shadow:3px 3px 6px #a3b1c6, -3px -3px 6px #ffffff; cursor:pointer; font-size:11px;">✕</button>
    </div>
    <div style="font-size:11px; color:#718096; margin-bottom:10px;">Simulates the facescan turnstile &amp; door NFC reader (not wired to real hardware yet).</div>
    <div style="display:flex; flex-direction:column; gap:8px;" id="devToolsStatusOptions"></div>
    <div id="devToolsExtraSections"></div>
  `;

  document.body.appendChild(panel);

  const optionsEl = panel.querySelector('#devToolsStatusOptions');
  const current = getWorkerStatus();
  Object.entries(WORKER_STATUS_CONFIG).forEach(([key, cfg]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `
      display:flex; align-items:center; gap:8px;
      padding:8px 10px; border:none; border-radius:12px;
      background:#e0e5ec; cursor:pointer; font-size:12px; font-weight:700; color:#2d3748;
      box-shadow: ${key === current ? 'inset 3px 3px 6px #a3b1c6, inset -3px -3px 6px #ffffff' : '3px 3px 6px #a3b1c6, -3px -3px 6px #ffffff'};
    `;
    btn.innerHTML = `<span style="width:10px; height:10px; border-radius:50%; background:${cfg.color}; flex-shrink:0;"></span>${cfg.label}`;
    btn.addEventListener('click', () => {
      setWorkerStatus(key);
      panel.remove();
      toggleDevToolsPanel();
    });
    optionsEl.appendChild(btn);
  });

  panel.querySelector('#devToolsCloseBtn').addEventListener('click', () => panel.remove());

  // Let other page scripts render their own simulator sections into this same panel
  const extraEl = panel.querySelector('#devToolsExtraSections');
  (window.__paksetDevToolSections || []).forEach(renderFn => {
    try {
      renderFn(extraEl, () => { panel.remove(); toggleDevToolsPanel(); });
    } catch (err) {
      console.error('Dev tool section render error:', err);
    }
  });

  const footerNote = document.createElement('div');
  footerNote.style.cssText = 'font-size:10px; color:#a0aec0; margin-top:12px; border-top:1px solid rgba(163,177,198,0.3); padding-top:8px;';
  footerNote.textContent = 'More simulated hardware/data controls will be added here later.';
  panel.appendChild(footerNote);
}

document.addEventListener('keydown', (e) => {
  if (e.shiftKey && e.key === 'F1') {
    e.preventDefault();
    toggleDevToolsPanel();
  }
});

// Initialize Auth Guard
function initAuthGuard() {
  const is2FAVerified = sessionStorage.getItem('pakset_2fa_verified') === 'true';

  if (!is2FAVerified) {
    // Lock access - redirect to login page
    window.location.href = 'login.html';
    return;
  }

  const savedRole = sessionStorage.getItem('pakset_user_role') || 'supervisor';
  const savedName = sessionStorage.getItem('pakset_user_name') || 'User';

  currentUserProfile = {
    name: savedName,
    role: savedRole
  };

  // Page Specific Role Enforcement
  const currentPage = window.location.pathname.split('/').pop();
  if ((currentPage === 'schedule-editor.html' || currentPage === 'worker-accounts.html') && currentUserProfile.role !== 'supervisor') {
    alert('Access Restricted: This section is reserved for Supervisors only.');
    window.location.href = 'workfloor.html';
    return;
  }

  // Render User Header Controls
  renderUserHeaderUI(currentUserProfile);
}

// Run auth guard check
initAuthGuard();

onAuthStateChanged(auth, async (user) => {
  if (user && sessionStorage.getItem('pakset_2fa_verified') === 'true') {
    try {
      let profile = await getUserProfile(user.uid);
      const isDefaultSupervisor = user.email && (user.email.includes('supervisor') || user.email.includes('admin'));
      if (!profile) {
        profile = {
          email: user.email,
          name: user.email.split('@')[0],
          role: isDefaultSupervisor ? 'supervisor' : 'worker'
        };
      } else if (isDefaultSupervisor) {
        profile.role = 'supervisor';
      }
      
      currentUserProfile = profile;
      sessionStorage.setItem('pakset_user_role', profile.role);
      sessionStorage.setItem('pakset_user_name', profile.name || profile.email);
      renderUserHeaderUI(profile);
    } catch (_) {}
  }
});

// Render Neumorphic User Profile Badge & Logout Controls
function renderUserHeaderUI(profile) {
  // Find header actions container in workfloor.html or schedule-editor.html
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  // Check if user badge already exists
  if (document.getElementById('userNavProfile')) return;

  const role = (profile.role || sessionStorage.getItem('pakset_user_role') || 'worker').toLowerCase();
  const name = profile.name || profile.displayName || sessionStorage.getItem('pakset_user_name') || 'Factory Staff';
  const workerId = profile.workerId || profile.uid || sessionStorage.getItem('pakset_worker_id') || 'ID-001';
  
  const roleDisplay = role.replace(/_/g, ' ').toUpperCase();
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'P';

  const cardContainer = document.createElement('div');
  cardContainer.id = 'userNavProfile';
  cardContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    background: #e0e5ec;
    padding: 6px 12px;
    border-radius: 16px;
    box-shadow: 5px 5px 10px #a3b1c6, -5px -5px 10px #ffffff;
    color: #2d3748;
    user-select: none;
    margin-left: auto;
    flex-shrink: 0;
  `;

  cardContainer.innerHTML = `
    <div id="idCardClickableArea" style="
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      transition: opacity 0.2s ease;
    " title="Click to view your Worker File & Info">
      <div style="
        width: 36px;
        height: 36px;
        border-radius: 12px;
        background: #e0e5ec;
        box-shadow: inset 3px 3px 6px #a3b1c6, inset -3px -3px 6px #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 13px;
        color: #3b82f6;
        flex-shrink: 0;
      ">${initials}</div>

      <div style="display:flex; flex-direction:column; justify-content:center;">
        <span style="font-weight:800; font-size:12px; line-height:1.2; color:#2d3748; display:flex; align-items:center; gap:5px;">
          <span id="workerStatusLed" class="worker-status-led"></span>
          ${name}
        </span>
        <div style="display:flex; align-items:center; gap:6px; font-size:10px; margin-top:2px;">
          <span style="font-family:monospace; font-weight:700; color:#3b82f6;">${workerId}</span>
          <span style="color:#718096;">•</span>
          <span style="font-weight:800; color:#047857; text-transform:uppercase; letter-spacing:0.3px;">${roleDisplay}</span>
        </div>
      </div>
    </div>

    <button id="navLogoutBtn" style="
      height: 28px;
      background: #e0e5ec;
      border: none;
      padding: 0 10px;
      border-radius: 10px;
      box-shadow: 3px 3px 6px #a3b1c6, -3px -3px 6px #ffffff;
      color: #ef4444;
      font-weight: 800;
      font-size: 11px;
      cursor: pointer;
      margin-left: 4px;
    " title="Sign out of account">Sign Out</button>
  `;

  headerActions.appendChild(cardContainer);

  injectDevToolStyles();
  applyWorkerStatusLed();

  // Click card to open personal Worker Info page
  document.getElementById('idCardClickableArea').addEventListener('click', () => {
    window.location.href = 'my-info.html';
  });

  // Sign Out Click Handler
  document.getElementById('navLogoutBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    sessionStorage.removeItem('pakset_2fa_verified');
    sessionStorage.removeItem('pakset_user_role');
    sessionStorage.removeItem('pakset_user_name');
    sessionStorage.removeItem('pakset_worker_id');
    await signOut(auth);
    window.location.href = 'login.html';
  });
}

// Supervisor Account Creation Modal
function openCreateAccountModal() {
  let modal = document.getElementById('supervisorModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'supervisorModal';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-card" style="
        width: 100%;
        max-width: 480px;
        background: #e0e5ec;
        padding: 28px;
        border-radius: 24px;
        box-shadow: 9px 9px 16px #a3b1c6, -9px -9px 16px #ffffff;
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid rgba(163,177,198,0.3); padding-bottom:10px;">
          <span style="font-weight:700; font-size:18px; color:#2d3748;">Supervisor: Create Worker Account</span>
          <button id="closeModalBtn" style="background:#e0e5ec; border:none; width:32px; height:32px; border-radius:10px; box-shadow:3px 3px 6px #a3b1c6, -3px -3px 6px #ffffff; cursor:pointer;">✕</button>
        </div>

        <div id="modalAlert" style="display:none; padding:10px 14px; border-radius:12px; font-size:13px;"></div>

        <form id="modalAccountForm" style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:13px; font-weight:600; color:#2d3748;">Full Name</label>
            <input type="text" id="mWorkerName" required style="padding:12px; border-radius:12px; border:none; background:#e0e5ec; box-shadow:inset 3px 3px 6px #a3b1c6, inset -3px -3px 6px #ffffff; outline:none;" placeholder="John Doe" />
          </div>

          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:13px; font-weight:600; color:#2d3748;">Email Address</label>
            <input type="email" id="mWorkerEmail" required style="padding:12px; border-radius:12px; border:none; background:#e0e5ec; box-shadow:inset 3px 3px 6px #a3b1c6, inset -3px -3px 6px #ffffff; outline:none;" placeholder="worker@pakset.com" />
          </div>

          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:13px; font-weight:600; color:#2d3748;">Password</label>
            <input type="password" id="mWorkerPassword" required minlength="6" style="padding:12px; border-radius:12px; border:none; background:#e0e5ec; box-shadow:inset 3px 3px 6px #a3b1c6, inset -3px -3px 6px #ffffff; outline:none;" placeholder="Min. 6 characters" />
          </div>

          <div style="display:flex; flex-direction:column; gap:4px;">
            <label style="font-size:13px; font-weight:600; color:#2d3748;">Role</label>
            <select id="mWorkerRole" style="padding:12px; border-radius:12px; border:none; background:#e0e5ec; box-shadow:inset 3px 3px 6px #a3b1c6, inset -3px -3px 6px #ffffff; outline:none;">
              <option value="worker">Worker (Normal Role)</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </div>

          <button type="submit" id="mSubmitBtn" style="
            margin-top: 10px;
            padding: 12px;
            border-radius: 14px;
            border: none;
            background: #3b82f6;
            color: #ffffff;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 4px 4px 8px #a3b1c6, -4px -4px 8px #ffffff;
          ">Create Account</button>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('closeModalBtn').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    document.getElementById('modalAccountForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertEl = document.getElementById('modalAlert');
      alertEl.style.display = 'none';

      const name = document.getElementById('mWorkerName').value.trim();
      const email = document.getElementById('mWorkerEmail').value.trim();
      const password = document.getElementById('mWorkerPassword').value;
      const role = document.getElementById('mWorkerRole').value;

      const submitBtn = document.getElementById('mSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      try {
        await createAccountBySupervisor(email, password, role, name);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';

        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(16, 185, 129, 0.2)';
        alertEl.style.color = '#047857';
        alertEl.textContent = `Success! Account created for ${email}`;

        document.getElementById('modalAccountForm').reset();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(239, 68, 68, 0.2)';
        alertEl.style.color = '#b91c1c';
        alertEl.textContent = 'Error: ' + err.message;
      }
    });
  } else {
    modal.style.display = 'flex';
  }
}
