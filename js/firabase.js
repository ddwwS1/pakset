// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, doc, getDoc, collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
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

export { db, getAuth, getStorage, getFunctions, doc, getDoc, collection, query, where, orderBy, getDocs, fetchSchedulesByDateRange, fetchWorkerSchedulesByWeekStarts, fetchAllWorkers, fetchAllWorkerSchedules };