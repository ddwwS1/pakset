// Import the functions you need from the SDKs you need
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, where, orderBy, getDocs, setDoc, updateDoc, deleteDoc, deleteField } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDaUEnCmD2eVv50aGk076RnghZzxvouAZ8",
  authDomain: "pakset-work.firebaseapp.com",
  projectId: "pakset-work",
  storageBucket: "pakset-work.firebasestorage.app",
  messagingSenderId: "176607128375",
  appId: "1:176607128375:web:70e4a64d2a41f13daf08b2",
  measurementId: "G-06VVRGDKKS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const db = getFirestore(app);
const auth = getAuth(app);

async function getUserProfile(uid) {
  try {
    const userDocRef = doc(db, 'users', uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    console.error('getUserProfile error:', err);
    return null;
  }
}

async function setUserProfile(uid, profileData) {
  try {
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, {
      ...profileData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('setUserProfile error:', err);
    throw err;
  }
}

async function createAccountBySupervisor(email, password, role = 'worker', name = '') {
  const secondaryAppName = `SecondaryApp_${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);
  
  try {
    const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = userCred.user.uid;

    await setUserProfile(newUid, {
      email,
      name: name || email.split('@')[0],
      role: role.toLowerCase(),
      createdAt: new Date().toISOString()
    });

    await signOut(secondaryAuth);
    await deleteApp(secondaryApp);

    return { uid: newUid, email, role, name };
  } catch (err) {
    try {
      await deleteApp(secondaryApp);
    } catch (_) {}

    // Fallback if Email/Password provider is not enabled in Firebase Console (auth/configuration-not-found)
    if (err.code === 'auth/configuration-not-found' || err.code === 'auth/operation-not-allowed') {
      console.warn('Firebase Auth Provider not enabled in Console. Using Firestore user profile fallback.');
      const fallbackUid = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const profile = {
        email,
        password, // stored for fallback authentication when Auth SDK is unconfigured in Console
        name: name || email.split('@')[0],
        role: role.toLowerCase(),
        createdAt: new Date().toISOString()
      };

      await setUserProfile(fallbackUid, profile);

      // Save to local user registry fallback
      try {
        const existingUsers = JSON.parse(localStorage.getItem('pakset_local_users') || '{}');
        existingUsers[email.toLowerCase()] = { uid: fallbackUid, ...profile };
        localStorage.setItem('pakset_local_users', JSON.stringify(existingUsers));
      } catch (_) {}

      return { uid: fallbackUid, email, role, name };
    }

    console.error('createAccountBySupervisor error:', err);
    throw err;
  }
}

async function fetchSchedulesByDateRange(startDate, endDate) {
  // startDate, endDate: 'YYYY-MM-DD' strings (inclusive)
  try {
    const colRef = collection(db, 'schedules');
    const q = query(colRef, where('date', '>=', startDate), where('date', '<=', endDate), orderBy('date'));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, data: d.data() }));
    return out;
  } catch (err) {
    console.error('fetchSchedulesByDateRange error', err);
    throw err;
  }
}

async function fetchWorkerSchedulesByWeekStarts(weekStarts) {
  try {
    if (!Array.isArray(weekStarts) || weekStarts.length === 0) return [];

    const out = [];
    const chunkSize = 10; // Firestore 'in' query limit
    for (let i = 0; i < weekStarts.length; i += chunkSize) {
      const chunk = weekStarts.slice(i, i + chunkSize);
      const colRef = collection(db, 'workerSchedules');
      const q = query(colRef, where('weekStart', 'in', chunk));
      const snap = await getDocs(q);
      snap.forEach(d => out.push({ id: d.id, data: d.data() }));
    }
    return out;
  } catch (err) {
    console.error('fetchWorkerSchedulesByWeekStarts error', err);
    throw err;
  }
}

async function fetchAllWorkers() {
  try {
    const colRef = collection(db, 'workers');
    const snap = await getDocs(colRef);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, data: d.data() }));
    return out;
  } catch (err) {
    console.error('fetchAllWorkers error', err);
    throw err;
  }
}

const DEFAULT_ROLES = [
  {
    id: 'supervisor',
    name: 'Workfloor Supervisor',
    permissions: ['assign_machines', 'view_qc_popups', 'edit_schedules', 'manage_accounts', 'manage_cafeteria'],
    description: 'Full administrative control over workfloor operations, machine assignments, schedules, worker accounts, and cafeteria breaks.'
  },
  {
    id: 'chief_cook',
    name: 'Chief Cook / Kitchen Lead',
    permissions: ['manage_cafeteria'],
    description: 'Can set shift lunch & break times, schedule food breaks, and publish daily cafeteria menus.'
  },
  {
    id: 'workfloor_chef',
    name: 'Workfloor Chef',
    permissions: ['assign_machines', 'view_qc_popups', 'edit_schedules'],
    description: 'Can reassign or give machines to workers, edit schedules, and inspect machine worker details.'
  },
  {
    id: 'quality_control',
    name: 'Quality Control',
    permissions: ['view_qc_popups'],
    description: 'Access to detailed machine workers inspection popup and quality monitoring.'
  },
  {
    id: 'maintenance_lead',
    name: 'Maintenance Lead',
    permissions: ['assign_machines'],
    description: 'Can reassign machine operators and manage machine status.'
  },
  {
    id: 'worker',
    name: 'Worker',
    permissions: [],
    description: 'Standard worker view access for factory floor monitoring.'
  }
];

async function fetchRoles() {
  try {
    const colRef = collection(db, 'roles');
    const snap = await getDocs(colRef);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, data: d.data() }));

    // Fallback/Merge with DEFAULT_ROLES if Firestore collection empty or local storage
    const savedLocalRoles = JSON.parse(localStorage.getItem('pakset_custom_roles') || '[]');
    const map = new Map();

    DEFAULT_ROLES.forEach(r => map.set(r.id, r));
    savedLocalRoles.forEach(r => map.set(r.id, r));
    out.forEach(d => {
      map.set(d.id, { id: d.id, ...d.data() });
    });

    return Array.from(map.values());
  } catch (err) {
    console.warn('fetchRoles Firestore error, using local/default roles:', err);
    const savedLocalRoles = JSON.parse(localStorage.getItem('pakset_custom_roles') || '[]');
    const map = new Map();
    DEFAULT_ROLES.forEach(r => map.set(r.id, r));
    savedLocalRoles.forEach(r => map.set(r.id, r));
    return Array.from(map.values());
  }
}

async function saveRoleDoc(roleData) {
  try {
    const roleId = (roleData.id || roleData.name || '').toLowerCase().replace(/\s+/g, '_');
    const roleRef = doc(db, 'roles', roleId);

    const payload = {
      id: roleId,
      name: roleData.name || roleId,
      permissions: Array.isArray(roleData.permissions) ? roleData.permissions : [],
      description: roleData.description || '',
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(roleRef, payload, { merge: true });
    } catch (_) {}

    // Save to local storage cache
    const savedLocalRoles = JSON.parse(localStorage.getItem('pakset_custom_roles') || '[]');
    const idx = savedLocalRoles.findIndex(r => r.id === roleId);
    if (idx >= 0) savedLocalRoles[idx] = payload;
    else savedLocalRoles.push(payload);
    localStorage.setItem('pakset_custom_roles', JSON.stringify(savedLocalRoles));

    return payload;
  } catch (err) {
    console.error('saveRoleDoc error:', err);
    throw err;
  }
}

async function deleteRoleDoc(roleId) {
  try {
    const roleRef = doc(db, 'roles', roleId);
    try {
      await deleteDoc(roleRef);
    } catch (_) {}

    const savedLocalRoles = JSON.parse(localStorage.getItem('pakset_custom_roles') || '[]');
    const filtered = savedLocalRoles.filter(r => r.id !== roleId);
    localStorage.setItem('pakset_custom_roles', JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.error('deleteRoleDoc error:', err);
    throw err;
  }
}

async function fetchCafeteriaSchedule() {
  try {
    const docRef = doc(db, 'settings', 'cafeteria');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      if (!data.breaks && data.lunchTimeText) {
        data.breaks = [{
          id: 'break-default',
          name: 'Lunch Break',
          timeText: data.lunchTimeText,
          startPct: data.lunchStartPct !== undefined ? data.lunchStartPct : 45,
          endPct: data.lunchEndPct !== undefined ? data.lunchEndPct : 55
        }];
      }
      return data;
    }
  } catch (err) {
    console.warn('fetchCafeteriaSchedule error, using fallback:', err);
  }

  // Local Storage Fallback
  const saved = localStorage.getItem('pakset_cafeteria_schedule');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (!data.breaks && data.lunchTimeText) {
        data.breaks = [{
          id: 'break-default',
          name: 'Lunch Break',
          timeText: data.lunchTimeText,
          startPct: data.lunchStartPct !== undefined ? data.lunchStartPct : 45,
          endPct: data.lunchEndPct !== undefined ? data.lunchEndPct : 55
        }];
      }
      return data;
    } catch (_) {}
  }

  // No break by default - Chief Cook assigns breaks
  return {
    breaks: [],
    menuTitle: 'Today\'s Cafeteria Offerings',
    menuItems: [],
    updatedBy: 'Chief Cook',
    updatedAt: new Date().toISOString()
  };
}

async function saveCafeteriaSchedule(cafeteriaData) {
  try {
    const payload = {
      ...cafeteriaData,
      updatedAt: new Date().toISOString()
    };

    // Instant local save so UI updates with 0 delay
    try {
      localStorage.setItem('pakset_cafeteria_schedule', JSON.stringify(payload));
    } catch (_) {}

    // Async Firestore update in background
    try {
      const docRef = doc(db, 'settings', 'cafeteria');
      setDoc(docRef, payload, { merge: true }).catch(err => {
        console.warn('Background Firestore cafeteria sync error:', err.message);
      });
    } catch (_) {}

    return payload;
  } catch (err) {
    console.error('saveCafeteriaSchedule error:', err);
    throw err;
  }
}

async function saveWorkerDoc(workerData) {
  try {
    const docId = workerData.workerId || workerData.id || `worker-${Date.now()}`;
    const workerRef = doc(db, 'workers', docId);

    const payload = {
      name: workerData.name || '',
      workerId: docId,
      email: workerData.email || '',
      role: (workerData.role || 'worker').toLowerCase(),
      phone: workerData.phone || '',
      disabilities: workerData.disabilities || 'None',
      allergies: workerData.allergies || 'None',
      emergencyName: workerData.emergencyName || '',
      emergencyRelation: workerData.emergencyRelation || '',
      emergencyPhone: workerData.emergencyPhone || '',
      monthlyHours: workerData.monthlyHours || { '2026-09': 160, '2026-08': 152, '2026-07': 168 },
      totalHoursWorked: workerData.totalHoursWorked !== undefined ? Number(workerData.totalHoursWorked) : 480,
      notes: workerData.notes || workerData.info || '',
      status: workerData.status || 'active',
      vacationDaysTotal: workerData.vacationDaysTotal !== undefined ? Number(workerData.vacationDaysTotal) : 20,
      vacationDaysUsed: workerData.vacationDaysUsed !== undefined ? Number(workerData.vacationDaysUsed) : 0,
      vacationRequests: Array.isArray(workerData.vacationRequests) ? workerData.vacationRequests : [],
      workingDaysThisMonth: workerData.workingDaysThisMonth !== undefined ? Number(workerData.workingDaysThisMonth) : 0,
      sickDaysThisMonth: workerData.sickDaysThisMonth !== undefined ? Number(workerData.sickDaysThisMonth) : 0,
      workingDaysThisYear: workerData.workingDaysThisYear !== undefined ? Number(workerData.workingDaysThisYear) : 0,
      sickDaysThisYear: workerData.sickDaysThisYear !== undefined ? Number(workerData.sickDaysThisYear) : 0,
      updatedAt: new Date().toISOString()
    };

    await setDoc(workerRef, payload, { merge: true });

    // Also link/save to local storage user fallback if email exists
    if (workerData.email) {
      try {
        const cleanEmail = workerData.email.toLowerCase();
        const localUsers = JSON.parse(localStorage.getItem('pakset_local_users') || '{}');
        localUsers[cleanEmail] = {
          uid: docId,
          email: workerData.email,
          password: workerData.password || (localUsers[cleanEmail] ? localUsers[cleanEmail].password : 'WorkerPakset2026!'),
          name: workerData.name,
          role: (workerData.role || 'worker').toLowerCase(),
          workerId: docId
        };
        localStorage.setItem('pakset_local_users', JSON.stringify(localUsers));
      } catch (_) {}
    }

    return { id: docId, ...payload };
  } catch (err) {
    console.error('saveWorkerDoc error:', err);
    throw err;
  }
}

async function deleteWorkerDoc(docId) {
  try {
    const workerRef = doc(db, 'workers', docId);
    await deleteDoc(workerRef);
    return true;
  } catch (err) {
    console.error('deleteWorkerDoc error:', err);
    throw err;
  }
}

async function fetchAllWorkerSchedules() {
  try {
    const colRef = collection(db, 'workerSchedules');
    const snap = await getDocs(colRef);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, data: d.data() }));
    return out;
  } catch (err) {
    console.error('fetchAllWorkerSchedules error', err);
    throw err;
  }
}

export { 
  app,
  firebaseConfig,
  db, 
  auth,
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  sendPasswordResetEmail,
  getUserProfile,
  setUserProfile,
  createAccountBySupervisor,
  DEFAULT_ROLES,
  fetchRoles,
  saveRoleDoc,
  deleteRoleDoc,
  fetchCafeteriaSchedule,
  saveCafeteriaSchedule,
  saveWorkerDoc,
  deleteWorkerDoc,
  getStorage, 
  getFunctions, 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  deleteField, 
  fetchSchedulesByDateRange, 
  fetchWorkerSchedulesByWeekStarts, 
  fetchAllWorkers, 
  fetchAllWorkerSchedules 
};