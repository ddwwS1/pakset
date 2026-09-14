import { auth, fetchAllWorkers, getUserProfile } from './firabase.js';

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
    notes: 'Active Factory Staff'
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
          notes: d.notes || d.info || 'None'
        };
      }
    }
  } catch (err) {
    console.warn('loadMyProfile error, using session profile:', err);
  }

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
}

document.addEventListener('DOMContentLoaded', loadMyProfile);
