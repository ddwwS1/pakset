const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

const ROTATION_ORDER = ['morning', 'night', 'afternoon'];
const ANCHOR_DATE = '2026-01-18';
const SHIFT_DEFS = {
  morning: { start: '07:30', end: '19:30', duration: 12, overtime: 4 },
  night: { start: '19:30', end: '07:30', duration: 12, overtime: 4 },
  afternoon: { start: '15:30', end: '23:30', duration: 8, overtime: 0 }
};

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekStartSunday(date) {
  const d = new Date(date.getTime());
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getRotationIndex(shift) {
  const idx = ROTATION_ORDER.indexOf((shift || '').toLowerCase());
  return idx === -1 ? 0 : idx;
}

function computeShiftForWeek(initialShift, weekStart) {
  const anchor = getWeekStartSunday(parseDate(ANCHOR_DATE));
  const weeksSinceAnchor = Math.floor((weekStart.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const startIdx = getRotationIndex(initialShift);
  const idx = (startIdx + (weeksSinceAnchor % ROTATION_ORDER.length) + ROTATION_ORDER.length) % ROTATION_ORDER.length;
  return ROTATION_ORDER[idx];
}

function buildDayEntry(dateStr, assignedShift) {
  const shift = SHIFT_DEFS[assignedShift];
  if (!shift) return {};

  const weekday = new Date(dateStr + 'T00:00:00').getDay();
  if (assignedShift === 'afternoon' && (weekday === 0 || weekday === 1 || weekday === 6)) {
    return { status: 'off' };
  }

  return {
    shift: assignedShift,
    status: 'scheduled',
    start: shift.start,
    end: shift.end,
    duration: shift.duration,
    overtime: shift.overtime
  };
}

function mergeOverride(baseDay, override) {
  if (!override) return baseDay;
  return { ...baseDay, ...override };
}

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function backupCollection(name, outDir) {
  const snap = await db.collection(name).get();
  const docs = [];
  snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `${name}-backup-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
  return { count: docs.length, filePath };
}

function getWeekStartsInRange(startDate, endDate) {
  const set = new Set();
  for (let d = new Date(startDate.getTime()); d.getTime() <= endDate.getTime(); d.setDate(d.getDate() + 1)) {
    const ws = getWeekStartSunday(d);
    set.add(formatDate(ws));
  }
  return Array.from(set);
}

async function fixWorkerSchedules() {
  const startArg = getArg('start');
  const endArg = getArg('end');
  const backupDir = getArg('backupDir', path.join(__dirname, '..', 'backups'));

  const today = new Date();
  const weekStart = getWeekStartSunday(today);
  const defaultStart = formatDate(weekStart);
  const defaultEnd = formatDate(addDays(weekStart, 6));

  const startDateStr = startArg || defaultStart;
  const endDateStr = endArg || defaultEnd;

  const startDate = parseDate(startDateStr);
  const endDate = parseDate(endDateStr);

  if (startDate.getTime() > endDate.getTime()) {
    throw new Error('Start date must be before end date.');
  }

  ensureDir(backupDir);
  const workersBackup = await backupCollection('workers', backupDir);
  const schedulesBackup = await backupCollection('workerSchedules', backupDir);

  const workersSnap = await db.collection('workers').get();
  const workers = [];
  workersSnap.forEach(doc => workers.push({ id: doc.id, data: doc.data() }));

  if (workers.length === 0) {
    throw new Error('No workers found in Firestore.');
  }

  const weekStarts = getWeekStartsInRange(startDate, endDate);

  const bulkWriter = db.bulkWriter();

  weekStarts.forEach(weekStartStr => {
    const weekStartDate = parseDate(weekStartStr);

    workers.forEach(worker => {
      const data = worker.data || {};
      const workerId = worker.id;
      const initialShift = data.initialShift || data.currentShift || 'morning';
      const rotationEnabled = data.rotationEnabled !== false;
      const assignedShift = rotationEnabled ? computeShiftForWeek(initialShift, weekStartDate) : initialShift;
      const manualOverrides = data.manualOverrides || {};

      const days = {};
      for (let i = 0; i < 7; i++) {
        const dateStr = formatDate(addDays(weekStartDate, i));
        const baseDay = buildDayEntry(dateStr, assignedShift);
        const override = manualOverrides[dateStr];
        days[dateStr] = mergeOverride(baseDay, override);
      }

      const scheduleDoc = {
        workerId,
        weekStart: weekStartStr,
        assignedShift,
        days
      };

      const docId = `${workerId}_${weekStartStr}`;
      const docRef = db.collection('workerSchedules').doc(docId);
      bulkWriter.set(docRef, scheduleDoc, { merge: true });
    });
  });

  await bulkWriter.close();

  return {
    range: { startDate: startDateStr, endDate: endDateStr },
    backups: { workersBackup, schedulesBackup },
    workerCount: workers.length,
    weekStarts: weekStarts.length
  };
}

fixWorkerSchedules()
  .then(result => {
    console.log('✅ Worker schedules fixed.');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed to fix schedules:', err);
    process.exit(1);
  });
