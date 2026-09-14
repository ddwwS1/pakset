import { 
  fetchAllWorkers, 
  saveWorkerDoc, 
  deleteWorkerDoc, 
  createAccountBySupervisor,
  fetchRoles,
  saveRoleDoc,
  deleteRoleDoc,
  DEFAULT_ROLES
} from './firabase.js';

let workersList = [];
let rolesList = [];
let currentFilter = 'all';
let searchQuery = '';

function showAlert(elementId, message, type = 'danger') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = message;
}

function hideAlert(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    el.className = 'alert';
    el.textContent = '';
  }
}

// Load Roles from Firestore & Local Storage
async function loadRoles() {
  try {
    rolesList = await fetchRoles();
    populateRoleDropdowns();
    renderFilterPills();
    renderRolesList();
  } catch (err) {
    console.error('Error loading roles:', err);
    rolesList = DEFAULT_ROLES;
    populateRoleDropdowns();
    renderFilterPills();
  }
}

function populateRoleDropdowns() {
  const createSelect = document.getElementById('workerRoleSelect');
  const editSelect = document.getElementById('editWorkerRole');

  const optionsHTML = rolesList.map(r => `
    <option value="${r.id}">${r.name}</option>
  `).join('');

  if (createSelect) createSelect.innerHTML = optionsHTML;
  if (editSelect) editSelect.innerHTML = optionsHTML;
}

function renderFilterPills() {
  const container = document.getElementById('filterPillsContainer');
  if (!container) return;

  container.innerHTML = `
    <button type="button" class="filter-chip ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
  `;

  rolesList.forEach(role => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `filter-chip ${currentFilter === role.id ? 'active' : ''}`;
    btn.dataset.filter = role.id;
    btn.textContent = role.name;
    container.appendChild(btn);
  });

  // Re-attach listeners
  container.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderWorkersAccordion();
    });
  });
}

// Load Workers from Firestore
async function loadWorkers() {
  const container = document.getElementById('workersAccordionContainer');
  if (!container) return;

  try {
    const rawWorkers = await fetchAllWorkers();
    workersList = (rawWorkers || []).map(w => {
      const data = w.data || {};
      return {
        id: w.id,
        name: data.name || w.id,
        workerId: data.workerId || w.id,
        email: data.email || 'N/A',
        role: (data.role || 'worker').toLowerCase(),
        phone: data.phone || 'N/A',
        disabilities: data.disabilities || 'None',
        allergies: data.allergies || 'None',
        emergencyName: data.emergencyName || 'N/A',
        emergencyRelation: data.emergencyRelation || 'N/A',
        emergencyPhone: data.emergencyPhone || 'N/A',
        monthlyHours: data.monthlyHours || { '2026-09': 160, '2026-08': 152, '2026-07': 168 },
        totalHoursWorked: data.totalHoursWorked !== undefined ? Number(data.totalHoursWorked) : 480,
        notes: data.notes || data.info || '',
        _data: data
      };
    });

    renderWorkersAccordion();
  } catch (err) {
    console.error('Error loading workers:', err);
    showAlert('listAlert', 'Error fetching worker records: ' + err.message);
  }
}

// Render Compact Accordion Worker Registry
function renderWorkersAccordion() {
  const container = document.getElementById('workersAccordionContainer');
  const countBadge = document.getElementById('workerCountBadge');
  if (!container) return;

  let filtered = workersList.filter(w => {
    // Role filter
    if (currentFilter !== 'all' && w.role !== currentFilter) return false;

    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = w.name.toLowerCase().includes(q);
      const matchId = w.workerId.toLowerCase().includes(q);
      const matchEmail = w.email.toLowerCase().includes(q);
      const matchRole = w.role.toLowerCase().includes(q);
      const matchPhone = w.phone.toLowerCase().includes(q);
      return matchName || matchId || matchEmail || matchRole || matchPhone;
    }

    return true;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Worker File${filtered.length !== 1 ? 's' : ''}`;
  }

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px; color: var(--muted);">
        No worker files found matching your search and filter criteria.
      </div>
    `;
    return;
  }

  filtered.forEach(worker => {
    const initials = worker.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'W';
    const roleObj = rolesList.find(r => r.id === worker.role) || { name: worker.role.toUpperCase() };

    const item = document.createElement('div');
    item.className = 'accordion-item';

    // Format Monthly Hours Table HTML
    const monthlyEntries = Object.entries(worker.monthlyHours || {});
    let monthlyRowsHTML = '';
    if (monthlyEntries.length > 0) {
      monthlyRowsHTML = monthlyEntries.map(([month, hrs]) => `
        <tr>
          <td>${month}</td>
          <td><strong>${hrs} hrs</strong></td>
        </tr>
      `).join('');
    } else {
      monthlyRowsHTML = '<tr><td colspan="2" style="color:var(--muted);">No monthly log recorded.</td></tr>';
    }

    item.innerHTML = `
      <div class="accordion-header">
        <div class="accordion-header-left">
          <div class="accordion-avatar">${initials}</div>
          <div class="accordion-meta">
            <span class="accordion-name">${worker.name}</span>
            <span class="accordion-sub">
              ID: <span class="worker-id-tag">${worker.workerId}</span> • 📞 ${worker.phone}
            </span>
          </div>
        </div>

        <div class="accordion-header-right">
          <span class="badge badge-worker">${roleObj.name}</span>
          <span class="total-hours-pill">⏱️ ${worker.totalHoursWorked} hrs</span>
          <span class="chevron-icon">▼</span>
        </div>
      </div>

      <div class="accordion-body">
        <div class="details-grid">
          
          <!-- Health & Safety -->
          <div class="detail-block">
            <span class="detail-block-title">🏥 Health & Medical Profile</span>
            <div class="detail-line">
              <span>Disabilities:</span>
              <strong>${worker.disabilities}</strong>
            </div>
            <div class="detail-line">
              <span>Allergies:</span>
              <strong>${worker.allergies}</strong>
            </div>
          </div>

          <!-- Emergency Contact -->
          <div class="detail-block">
            <span class="detail-block-title">🚨 Emergency Contact Info</span>
            <div class="detail-line">
              <span>Contact Person:</span>
              <strong>${worker.emergencyName} (${worker.emergencyRelation})</strong>
            </div>
            <div class="detail-line">
              <span>Emergency Phone:</span>
              <strong>${worker.emergencyPhone}</strong>
            </div>
          </div>

          <!-- Monthly Hours Log -->
          <div class="detail-block" style="grid-column: 1 / -1;">
            <span class="detail-block-title">📅 Factory Monthly Work Breakdown</span>
            <table class="monthly-hours-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Hours Worked</th>
                </tr>
              </thead>
              <tbody>
                ${monthlyRowsHTML}
              </tbody>
            </table>
            <div style="font-size:12px; margin-top:8px; font-weight:700; color:var(--text);">
              Total Factory Hours Accumulated: <span style="color:var(--primary);">${worker.totalHoursWorked} Hours</span>
            </div>
          </div>

          <!-- Account Credentials -->
          <div class="detail-block" style="grid-column: 1 / -1;">
            <span class="detail-block-title">🔑 Account Details & Notes</span>
            <div class="detail-line">
              <span>Email Address:</span>
              <strong>${worker.email}</strong>
            </div>
            ${worker.notes ? `
              <div class="detail-line" style="flex-direction:column; gap:2px; margin-top:4px;">
                <span>Notes / Certifications:</span>
                <strong style="font-weight:normal; font-size:12px;">${worker.notes}</strong>
              </div>
            ` : ''}
          </div>

        </div>

        <div class="accordion-actions">
          <button class="btn btn-secondary edit-worker-btn" data-id="${worker.id}">✏️ Edit File</button>
          <button class="btn btn-danger delete-worker-btn" data-id="${worker.id}" data-name="${worker.name}">🗑️ Delete File</button>
        </div>
      </div>
    `;

    container.appendChild(item);

    // Accordion Toggle
    const headerEl = item.querySelector('.accordion-header');
    headerEl.addEventListener('click', () => {
      item.classList.toggle('open');
    });
  });

  // Action Button Listeners
  container.querySelectorAll('.edit-worker-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });

  container.querySelectorAll('.delete-worker-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteWorker(btn.dataset.id, btn.dataset.name);
    });
  });
}

// Create Worker Submit Handler
async function handleCreateWorkerSubmit(e) {
  e.preventDefault();
  hideAlert('formAlert');

  const workerId = document.getElementById('workerIdInput').value.trim();
  const name = document.getElementById('workerNameInput').value.trim();
  const email = document.getElementById('workerEmailInput').value.trim();
  const password = document.getElementById('workerPasswordInput').value;
  const role = document.getElementById('workerRoleSelect').value;
  const phone = document.getElementById('workerPhoneInput').value.trim() || 'N/A';
  const disabilities = document.getElementById('workerDisabilitiesInput').value.trim() || 'None';
  const allergies = document.getElementById('workerAllergiesInput').value.trim() || 'None';
  const emergencyName = document.getElementById('workerEmergencyNameInput').value.trim() || 'N/A';
  const emergencyRelation = document.getElementById('workerEmergencyRelationInput').value.trim() || 'N/A';
  const emergencyPhone = document.getElementById('workerEmergencyPhoneInput').value.trim() || 'N/A';
  const totalHoursWorked = Number(document.getElementById('workerTotalHoursInput').value) || 160;
  const notes = document.getElementById('workerNotesInput').value.trim();

  if (!workerId || !name || !email || !password) {
    showAlert('formAlert', 'Please complete all required fields.');
    return;
  }

  const submitBtn = document.getElementById('submitWorkerBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving Worker File...';

  try {
    // 1. Create Auth Account
    try {
      await createAccountBySupervisor(email, password, role, name);
    } catch (_) {}

    // 2. Save document to Firestore workers collection
    await saveWorkerDoc({
      workerId,
      id: workerId,
      name,
      email,
      password,
      role,
      phone,
      disabilities,
      allergies,
      emergencyName,
      emergencyRelation,
      emergencyPhone,
      monthlyHours: {
        '2026-09': totalHoursWorked > 160 ? 160 : totalHoursWorked,
        '2026-08': totalHoursWorked > 320 ? 160 : 152
      },
      totalHoursWorked,
      notes,
      info: notes
    });

    submitBtn.disabled = false;
    submitBtn.textContent = '➕ Register & Save Worker File';

    showAlert('formAlert', `Worker file "${name}" (${workerId}) created successfully!`, 'success');
    document.getElementById('createWorkerForm').reset();

    // Reload list
    await loadWorkers();

  } catch (err) {
    console.error('Error creating worker file:', err);
    submitBtn.disabled = false;
    submitBtn.textContent = '➕ Register & Save Worker File';
    showAlert('formAlert', 'Failed to save worker file: ' + err.message);
  }
}

// Open Edit Modal
function openEditModal(docId) {
  const worker = workersList.find(w => w.id === docId);
  if (!worker) return;

  document.getElementById('editDocId').value = worker.id;
  document.getElementById('editWorkerId').value = worker.workerId;
  document.getElementById('editWorkerName').value = worker.name;
  document.getElementById('editWorkerEmail').value = worker.email;
  const passwordInput = document.getElementById('editWorkerPassword');
  if (passwordInput) passwordInput.value = '';
  document.getElementById('editWorkerRole').value = worker.role;
  document.getElementById('editWorkerPhone').value = worker.phone;
  document.getElementById('editWorkerDisabilities').value = worker.disabilities;
  document.getElementById('editWorkerAllergies').value = worker.allergies;
  document.getElementById('editWorkerEmergencyName').value = worker.emergencyName;
  document.getElementById('editWorkerEmergencyRelation').value = worker.emergencyRelation;
  document.getElementById('editWorkerEmergencyPhone').value = worker.emergencyPhone;
  document.getElementById('editWorkerTotalHours').value = worker.totalHoursWorked;
  document.getElementById('editWorkerNotes').value = worker.notes;

  hideAlert('editModalAlert');
  document.getElementById('editWorkerModal').classList.add('active');
}

// Save Worker Edits
async function handleEditWorkerSubmit(e) {
  e.preventDefault();
  hideAlert('editModalAlert');

  const docId = document.getElementById('editDocId').value;
  const workerId = document.getElementById('editWorkerId').value.trim();
  const name = document.getElementById('editWorkerName').value.trim();
  const email = document.getElementById('editWorkerEmail').value.trim();
  const newPassword = document.getElementById('editWorkerPassword')?.value.trim();
  const role = document.getElementById('editWorkerRole').value;
  const phone = document.getElementById('editWorkerPhone').value.trim();
  const disabilities = document.getElementById('editWorkerDisabilities').value.trim();
  const allergies = document.getElementById('editWorkerAllergies').value.trim();
  const emergencyName = document.getElementById('editWorkerEmergencyName').value.trim();
  const emergencyRelation = document.getElementById('editWorkerEmergencyRelation').value.trim();
  const emergencyPhone = document.getElementById('editWorkerEmergencyPhone').value.trim();
  const totalHoursWorked = Number(document.getElementById('editWorkerTotalHours').value) || 0;
  const notes = document.getElementById('editWorkerNotes').value.trim();

  const saveBtn = document.getElementById('saveEditWorkerBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving Changes...';

  try {
    const payload = {
      id: docId,
      workerId,
      name,
      email,
      role,
      phone,
      disabilities,
      allergies,
      emergencyName,
      emergencyRelation,
      emergencyPhone,
      totalHoursWorked,
      notes,
      info: notes
    };

    if (newPassword && newPassword.length >= 6) {
      payload.password = newPassword;
    }

    await saveWorkerDoc(payload);

    // If updating current logged in Chief Supervisor / user
    const currentName = sessionStorage.getItem('pakset_user_name');
    if (docId === 'SUP-001' || name === currentName || docId === sessionStorage.getItem('pakset_worker_id')) {
      sessionStorage.setItem('pakset_user_name', name);
      sessionStorage.setItem('pakset_user_role', role);
      sessionStorage.setItem('pakset_worker_id', workerId);
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Worker File Changes';

    document.getElementById('editWorkerModal').classList.remove('active');
    await loadWorkers();

  } catch (err) {
    console.error('Error saving worker edits:', err);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Worker File Changes';
    showAlert('editModalAlert', 'Failed to save changes: ' + err.message);
  }
}

// Delete Worker
async function handleDeleteWorker(docId, name) {
  if (!confirm(`Are you sure you want to delete worker file "${name}" (${docId})?`)) {
    return;
  }

  try {
    await deleteWorkerDoc(docId);
    await loadWorkers();
  } catch (err) {
    console.error('Error deleting worker:', err);
    showAlert('listAlert', 'Failed to delete worker: ' + err.message);
  }
}

// Render Roles List in Modal
function renderRolesList() {
  const container = document.getElementById('rolesListContainer');
  if (!container) return;

  container.innerHTML = '';

  rolesList.forEach(role => {
    const item = document.createElement('div');
    item.className = 'role-card-item';

    const permLabels = (role.permissions || []).map(p => {
      if (p === 'assign_machines') return '🛠️ Reassign Machines';
      if (p === 'view_qc_popups') return '🔍 QC Inspection';
      if (p === 'edit_schedules') return '📅 Schedule Planner';
      if (p === 'manage_accounts') return '👥 Account Manager';
      if (p === 'manage_cafeteria') return '🍱 Manage Cafeteria';
      return p;
    });

    item.innerHTML = `
      <div class="role-info">
        <div class="role-title-row">
          <span>${role.name}</span>
          <span class="badge badge-supervisor" style="font-size:10px;">ID: ${role.id}</span>
        </div>
        <span style="font-size:12px; color:var(--muted);">${role.description || 'Custom access role.'}</span>
        <div class="role-perm-tags">
          ${permLabels.length > 0 
            ? permLabels.map(l => `<span class="perm-tag">${l}</span>`).join('') 
            : '<span class="perm-tag" style="color:var(--danger);">No elevated permissions</span>'}
        </div>
      </div>
      ${!DEFAULT_ROLES.some(dr => dr.id === role.id) ? `
        <button type="button" class="btn btn-danger delete-role-btn" data-id="${role.id}" style="padding:6px 10px; font-size:12px;">Delete</button>
      ` : ''}
    `;

    container.appendChild(item);
  });

  container.querySelectorAll('.delete-role-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm(`Delete custom role "${btn.dataset.id}"?`)) {
        await deleteRoleDoc(btn.dataset.id);
        await loadRoles();
      }
    });
  });
}

// Save New Custom Role
async function handleCreateRoleSubmit(e) {
  e.preventDefault();
  hideAlert('rolesModalAlert');

  const name = document.getElementById('newRoleNameInput').value.trim();
  const description = document.getElementById('newRoleDescInput').value.trim();

  const cbs = document.querySelectorAll('.role-perm-cb:checked');
  const permissions = Array.from(cbs).map(cb => cb.value);

  if (!name) {
    showAlert('rolesModalAlert', 'Please enter a role name.');
    return;
  }

  const saveBtn = document.getElementById('saveNewRoleBtn');
  saveBtn.disabled = true;

  try {
    await saveRoleDoc({ name, description, permissions });
    saveBtn.disabled = false;

    showAlert('rolesModalAlert', `Role "${name}" saved successfully!`, 'success');
    document.getElementById('createRoleForm').reset();

    await loadRoles();

  } catch (err) {
    console.error('Error saving role:', err);
    saveBtn.disabled = false;
    showAlert('rolesModalAlert', 'Failed to save role: ' + err.message);
  }
}

// Setup Event Listeners on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  await loadRoles();
  await loadWorkers();

  const createForm = document.getElementById('createWorkerForm');
  if (createForm) createForm.addEventListener('submit', handleCreateWorkerSubmit);

  const editForm = document.getElementById('editWorkerForm');
  if (editForm) editForm.addEventListener('submit', handleEditWorkerSubmit);

  const closeEditModalBtn = document.getElementById('closeEditModalBtn');
  if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', () => {
      document.getElementById('editWorkerModal').classList.remove('active');
    });
  }

  // Roles Modal Controls
  const openRolesBtn = document.getElementById('openRolesModalBtn');
  const closeRolesBtn = document.getElementById('closeRolesModalBtn');
  const rolesModal = document.getElementById('rolesModal');

  if (openRolesBtn) {
    openRolesBtn.addEventListener('click', () => {
      hideAlert('rolesModalAlert');
      rolesModal.classList.add('active');
    });
  }

  if (closeRolesBtn) {
    closeRolesBtn.addEventListener('click', () => {
      rolesModal.classList.remove('active');
    });
  }

  const createRoleForm = document.getElementById('createRoleForm');
  if (createRoleForm) createRoleForm.addEventListener('submit', handleCreateRoleSubmit);

  // Search Input
  const searchInput = document.getElementById('searchWorkerInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderWorkersAccordion();
    });
  }
});
