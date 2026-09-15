import { auth, fetchAllWorkers, getUserProfile, saveWorkerDoc } from './firabase.js';

let currentMyRecord = null;

function getVacationLocalKey(workerId) {
  return `pakset_vacation_${workerId}`;
}

// Merge any locally-cached vacation/day-tracking overrides on top of the source record
function applyLocalOverrides(record) {
  try {
    const raw = localStorage.getItem(getVacationLocalKey(record.workerId));
    if (raw) {
      const overrides = JSON.parse(raw);
      return { ...record, ...overrides };
    }
  } catch (_) {}
  return record;
}

function saveLocalOverrides(record) {
  try {
    const overrides = {
      vacationDaysTotal: record.vacationDaysTotal,
      vacationDaysUsed: record.vacationDaysUsed,
      vacationRequests: record.vacationRequests
    };
    localStorage.setItem(getVacationLocalKey(record.workerId), JSON.stringify(overrides));
  } catch (_) {}
}

// Renders a neumorphic donut chart from conic-gradient segments into the given container
function renderDonut(containerId, segments, centerText) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0) || 1;
  let cumulative = 0;
  const stops = segments.map(seg => {
    const start = (cumulative / total) * 100;
    cumulative += Math.max(0, seg.value);
    const end = (cumulative / total) * 100;
    return `${seg.color} ${start}% ${end}%`;
  }).join(', ');

  el.innerHTML = `
    <div class="donut-chart" style="background: conic-gradient(${stops});">
      <div class="donut-chart-hole">${centerText}</div>
    </div>
  `;
}

function renderVacationSection(record) {
  const remaining = Math.max(0, record.vacationDaysTotal - record.vacationDaysUsed);
  renderDonut('vacationDonut', [
    { value: record.vacationDaysUsed, color: 'var(--primary)' },
    { value: remaining, color: '#cbd5e0' }
  ], `${remaining}\nleft`);

  document.getElementById('vacationUsedText').textContent = record.vacationDaysUsed;
  document.getElementById('vacationRemainingText').textContent = remaining;
  document.getElementById('vacationTotalText').textContent = record.vacationDaysTotal;

  const listEl = document.getElementById('vacationRequestsList');
  if (listEl) {
    const requests = [...(record.vacationRequests || [])].reverse();
    if (requests.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px; color:var(--muted);">No vacation requests yet.</div>';
    } else {
      listEl.innerHTML = requests.map(r => `
        <div class="vacation-request-chip">
          <span>${r.days} day${r.days !== 1 ? 's' : ''} requested on ${new Date(r.requestedAt).toLocaleDateString()}</span>
          <span class="vacation-request-chip-actions">
            <span class="request-status ${r.status}">${r.status}</span>
            ${r.status === 'pending' ? `<button type="button" class="cancel-request-btn" data-cancel-id="${r.id}">Cancel</button>` : ''}
          </span>
        </div>
      `).join('');
    }
  }
}

async function loadMyProfile() {
  const user = auth.currentUser;
  const userEmail = (user ? user.email : sessionStorage.getItem('pakset_user_name')) || '';
  const savedRole = sessionStorage.getItem('pakset_user_role') || 'worker';
  const savedName = sessionStorage.getItem('pakset_user_name') || 'Factory Staff';

  let myRecord = {
    name: savedName,
    workerId: sessionStorage.getItem('pakset_worker_id') || 'ID-001',
    email: userEmail || 'user@pakset.com',
    role: savedRole,
    phone: 'N/A',
    disabilities: 'None',
    allergies: 'None',
    emergencyName: 'N/A',
    emergencyRelation: 'N/A',
    emergencyPhone: 'N/A',
    monthlyHours: { '2026-09': 160, '2026-08': 152, '2026-07': 168 },
    totalHoursWorked: 480,
    notes: 'Active Factory Staff',
    vacationDaysTotal: 20,
    vacationDaysUsed: 4,
    vacationRequests: [],
    workingDaysThisMonth: 18,
    sickDaysThisMonth: 1,
    workingDaysThisYear: 165,
    sickDaysThisYear: 6
  };

  try {
    const rawWorkers = await fetchAllWorkers();
    if (rawWorkers && rawWorkers.length > 0) {
      const match = rawWorkers.find(w => {
        const d = w.data || {};
        return (d.email && d.email.toLowerCase() === userEmail.toLowerCase()) || 
               (d.name && d.name.toLowerCase() === savedName.toLowerCase());
      });

      if (match) {
        const d = match.data || {};
        myRecord = {
          name: d.name || savedName,
          workerId: d.workerId || match.id,
          email: d.email || userEmail,
          role: d.role || savedRole,
          phone: d.phone || 'N/A',
          disabilities: d.disabilities || 'None',
          allergies: d.allergies || 'None',
          emergencyName: d.emergencyName || 'N/A',
          emergencyRelation: d.emergencyRelation || 'N/A',
          emergencyPhone: d.emergencyPhone || 'N/A',
          monthlyHours: d.monthlyHours || { '2026-09': 160, '2026-08': 152, '2026-07': 168 },
          totalHoursWorked: d.totalHoursWorked !== undefined ? d.totalHoursWorked : 480,
          notes: d.notes || d.info || 'None',
          vacationDaysTotal: d.vacationDaysTotal !== undefined ? d.vacationDaysTotal : 20,
          vacationDaysUsed: d.vacationDaysUsed !== undefined ? d.vacationDaysUsed : 4,
          vacationRequests: Array.isArray(d.vacationRequests) ? d.vacationRequests : [],
          workingDaysThisMonth: d.workingDaysThisMonth !== undefined ? d.workingDaysThisMonth : 18,
          sickDaysThisMonth: d.sickDaysThisMonth !== undefined ? d.sickDaysThisMonth : 1,
          workingDaysThisYear: d.workingDaysThisYear !== undefined ? d.workingDaysThisYear : 165,
          sickDaysThisYear: d.sickDaysThisYear !== undefined ? d.sickDaysThisYear : 6
        };
      }
    }
  } catch (err) {
    console.warn('loadMyProfile error, using session profile:', err);
  }

  myRecord = applyLocalOverrides(myRecord);
  currentMyRecord = myRecord;

  // Populate UI
  const initials = myRecord.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'P';
  document.getElementById('myPhotoFrame').textContent = initials;
  document.getElementById('myNameDisplay').textContent = myRecord.name;
  document.getElementById('myIdDisplay').textContent = myRecord.workerId;
  document.getElementById('myRoleBadge').textContent = myRecord.role.replace(/_/g, ' ').toUpperCase();

  document.getElementById('myDisabilities').textContent = myRecord.disabilities;
  document.getElementById('myAllergies').textContent = myRecord.allergies;

  document.getElementById('myEmergencyName').textContent = myRecord.emergencyName;
  document.getElementById('myEmergencyRelation').textContent = myRecord.emergencyRelation;
  document.getElementById('myEmergencyPhone').textContent = myRecord.emergencyPhone;

  document.getElementById('myEmail').textContent = myRecord.email;
  document.getElementById('myPhone').textContent = myRecord.phone;
  document.getElementById('myNotes').textContent = myRecord.notes;

  document.getElementById('myTotalHours').textContent = `${myRecord.totalHoursWorked} Hours`;

  // Render Monthly Body
  const bodyEl = document.getElementById('myMonthlyHoursBody');
  if (bodyEl) {
    const entries = Object.entries(myRecord.monthlyHours || {});
    if (entries.length > 0) {
      bodyEl.innerHTML = entries.map(([m, hrs]) => `
        <tr>
          <td>${m}</td>
          <td><strong>${hrs} hrs</strong></td>
        </tr>
      `).join('');
    } else {
      bodyEl.innerHTML = '<tr><td colspan="2" style="color:var(--muted);">No monthly hours recorded.</td></tr>';
    }
  }

  renderVacationSection(myRecord);

  renderDonut('monthDonut', [
    { value: myRecord.workingDaysThisMonth, color: 'var(--accent)' },
    { value: myRecord.sickDaysThisMonth, color: 'var(--danger)' }
  ], `${myRecord.workingDaysThisMonth + myRecord.sickDaysThisMonth}\ndays`);
  document.getElementById('monthWorkingText').textContent = myRecord.workingDaysThisMonth;
  document.getElementById('monthSickText').textContent = myRecord.sickDaysThisMonth;

  renderDonut('yearDonut', [
    { value: myRecord.workingDaysThisYear, color: 'var(--accent)' },
    { value: myRecord.sickDaysThisYear, color: 'var(--danger)' }
  ], `${myRecord.workingDaysThisYear + myRecord.sickDaysThisYear}\ndays`);
  document.getElementById('yearWorkingText').textContent = myRecord.workingDaysThisYear;
  document.getElementById('yearSickText').textContent = myRecord.sickDaysThisYear;
}

function showVacationAlert(message, isError) {
  const alertEl = document.getElementById('vacationAlert');
  if (!alertEl) return;
  alertEl.style.display = 'block';
  alertEl.style.background = isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
  alertEl.style.color = isError ? '#b91c1c' : '#047857';
  alertEl.textContent = message;
}

document.addEventListener('DOMContentLoaded', loadMyProfile);

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'vacationRequestForm') return;
  e.preventDefault();
  if (!currentMyRecord) return;

  const input = document.getElementById('vacationDaysInput');
  const days = parseInt(input.value, 10);

  if (isNaN(days) || days < 3) {
    showVacationAlert('Minimum vacation request is 3 days.', true);
    return;
  }

  const pendingDays = (currentMyRecord.vacationRequests || [])
    .filter(r => r.status === 'pending')
    .reduce((sum, r) => sum + r.days, 0);
  const remaining = currentMyRecord.vacationDaysTotal - currentMyRecord.vacationDaysUsed - pendingDays;

  if (days > remaining) {
    showVacationAlert(`You only have ${remaining} vacation day(s) available.`, true);
    return;
  }

  currentMyRecord.vacationRequests = [
    ...(currentMyRecord.vacationRequests || []),
    { id: `vac-${Date.now()}`, days, status: 'pending', requestedAt: new Date().toISOString() }
  ];

  saveLocalOverrides(currentMyRecord);
  renderVacationSection(currentMyRecord);
  showVacationAlert(`Request for ${days} day(s) sent for supervisor approval.`, false);
  input.value = 3;

  try {
    await saveWorkerDoc(currentMyRecord);
  } catch (err) {
    console.warn('Could not sync vacation request to Firestore, kept locally:', err);
  }
});

// Cancel a pending vacation request
document.addEventListener('click', async (e) => {
  const cancelBtn = e.target.closest('.cancel-request-btn');
  if (!cancelBtn || !currentMyRecord) return;

  const requestId = cancelBtn.dataset.cancelId;
  const req = (currentMyRecord.vacationRequests || []).find(r => r.id === requestId);
  if (!req || req.status !== 'pending') return;

  req.status = 'cancelled';
  req.cancelledAt = new Date().toISOString();

  saveLocalOverrides(currentMyRecord);
  renderVacationSection(currentMyRecord);
  showVacationAlert(`Cancelled request for ${req.days} day(s).`, false);

  try {
    await saveWorkerDoc(currentMyRecord);
  } catch (err) {
    console.warn('Could not sync vacation cancellation to Firestore, kept locally:', err);
  }
});

// ============================================================================
// Detailed Work Day History (per-diagram "History" buttons)
// ============================================================================

// Distributes sick days evenly across a date range for a plausible day-by-day view
function generateDailyHistory(totalDays, sickCount, startDate) {
  const entries = [];
  const sickDaySet = new Set();
  if (sickCount > 0 && totalDays > 0) {
    const interval = Math.max(1, Math.floor(totalDays / sickCount));
    for (let i = 0; i < sickCount; i++) {
      sickDaySet.add(Math.min(totalDays, (i + 1) * interval));
    }
  }
  for (let i = 1; i <= totalDays; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + (i - 1));
    entries.push({ date, type: sickDaySet.has(i) ? 'sick' : 'working' });
  }
  return entries;
}

// Splits yearly working/sick totals across the known demo months for a per-month breakdown
function generateMonthlyBreakdown(record) {
  const months = Object.keys(record.monthlyHours || {}).sort();
  if (months.length === 0) return {};
  const totalWorking = record.workingDaysThisYear || 0;
  const totalSick = record.sickDaysThisYear || 0;
  const workingBase = Math.floor(totalWorking / months.length);
  const sickBase = Math.floor(totalSick / months.length);
  const breakdown = {};
  months.forEach((m, i) => {
    const isLast = i === months.length - 1;
    breakdown[m] = {
      working: isLast ? totalWorking - workingBase * (months.length - 1) : workingBase,
      sick: isLast ? totalSick - sickBase * (months.length - 1) : sickBase
    };
  });
  return breakdown;
}

function buildMonthHistoryHtml(record) {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const totalDays = (record.workingDaysThisMonth || 0) + (record.sickDaysThisMonth || 0);
  const entries = generateDailyHistory(totalDays, record.sickDaysThisMonth || 0, startDate).reverse();

  if (entries.length === 0) {
    return '<div style="font-size:13px; color:var(--muted);">No work day records for this month yet.</div>';
  }

  const rows = entries.map(e => `
    <tr>
      <td>${e.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td><span class="day-type ${e.type}">${e.type === 'sick' ? 'Sick' : 'Working'}</span></td>
    </tr>
  `).join('');

  return `<table class="history-table"><thead><tr><th>Date</th><th>Day Type</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildYearHistoryHtml(record) {
  const breakdown = generateMonthlyBreakdown(record);
  const months = Object.keys(breakdown).sort().reverse();

  if (months.length === 0) {
    return '<div style="font-size:13px; color:var(--muted);">No work day records for this year yet.</div>';
  }

  const rows = months.map(m => `
    <tr>
      <td>${m}</td>
      <td><span class="day-type working">${breakdown[m].working} Working</span></td>
      <td><span class="day-type sick">${breakdown[m].sick} Sick</span></td>
    </tr>
  `).join('');

  return `<table class="history-table"><thead><tr><th>Month</th><th>Working</th><th>Sick</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildVacationHistoryHtml(record) {
  const requests = [...(record.vacationRequests || [])].reverse();

  if (requests.length === 0) {
    return '<div style="font-size:13px; color:var(--muted);">No vacation requests have been made yet.</div>';
  }

  const rows = requests.map(r => `
    <tr>
      <td>${new Date(r.requestedAt).toLocaleDateString()}</td>
      <td>${r.days} day${r.days !== 1 ? 's' : ''}</td>
      <td><span class="request-status ${r.status}">${r.status}</span></td>
    </tr>
  `).join('');

  return `<table class="history-table"><thead><tr><th>Requested</th><th>Days</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function openHistoryModal(type) {
  if (!currentMyRecord) return;
  const modal = document.getElementById('historyModal');
  const titleEl = document.getElementById('historyModalTitle');
  const bodyEl = document.getElementById('historyModalBody');
  if (!modal || !titleEl || !bodyEl) return;

  if (type === 'vacation') {
    titleEl.textContent = '🏖️ Vacation Request History';
    bodyEl.innerHTML = buildVacationHistoryHtml(currentMyRecord);
  } else if (type === 'month') {
    titleEl.textContent = '📅 This Month: Work Day History';
    bodyEl.innerHTML = buildMonthHistoryHtml(currentMyRecord);
  } else if (type === 'year') {
    titleEl.textContent = '🗓️ This Year: Work Day History';
    bodyEl.innerHTML = buildYearHistoryHtml(currentMyRecord);
  } else {
    return;
  }

  modal.style.display = 'flex';
}

function closeHistoryModal() {
  const modal = document.getElementById('historyModal');
  if (modal) modal.style.display = 'none';
}

document.addEventListener('click', (e) => {
  const historyBtn = e.target.closest('.history-btn');
  if (historyBtn) {
    openHistoryModal(historyBtn.dataset.history);
    return;
  }

  if (e.target.id === 'historyModalCloseBtn' || e.target.id === 'historyModal') {
    closeHistoryModal();
  }
});

