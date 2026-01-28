const admin = require("firebase-admin");

// Initialize Admin SDK (uses GOOGLE_APPLICATION_CREDENTIALS or default env)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

const ROTATION_ORDER = ["morning", "night", "afternoon"];
const ANCHOR_DATE = "2026-01-18"; // YYYY-MM-DD (Sunday)

const SHIFT_DEFS = {
  morning: { start: "07:30", end: "19:30", duration: 12, overtime: 4 },
  night: { start: "19:30", end: "07:30", duration: 12, overtime: 4 },
  afternoon: { start: "15:30", end: "23:30", duration: 8, overtime: 0 }
};

// Predefined workers list (example). Replace with your own list.
const WORKERS = [
  { id: "worker-001", name: "Alice", initialShift: "morning", rotationEnabled: true },
  { id: "worker-002", name: "Bob", initialShift: "night", rotationEnabled: true },
  { id: "worker-003", name: "Charlie", initialShift: "afternoon", rotationEnabled: true }
];

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(n => parseInt(n, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDate(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekStartSunday(date) {
  const d = new Date(date.getTime());
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getRotationIndex(shift) {
  const idx = ROTATION_ORDER.indexOf(shift);
  return idx === -1 ? 0 : idx;
}

function computeShiftForWeek(initialShift, weeksSinceAnchor) {
  const startIdx = getRotationIndex(initialShift);
  const idx = (startIdx + (weeksSinceAnchor % ROTATION_ORDER.length) + ROTATION_ORDER.length) % ROTATION_ORDER.length;
  return ROTATION_ORDER[idx];
}

function buildDayEntry(dateStr, assignedShift) {
  const shift = SHIFT_DEFS[assignedShift];
  if (!shift) return {};

  const weekday = new Date(dateStr + "T00:00:00").getDay();
  if (assignedShift === "afternoon" && (weekday === 0 || weekday === 1 || weekday === 6)) {
    return { status: "off" }; // afternoon only Tue–Fri
  }

  return {
    shift: assignedShift,
    status: "scheduled",
    start: shift.start,
    end: shift.end,
    duration: shift.duration,
    overtime: shift.overtime
  };
}

function mergeOverride(baseDay, override) {
  if (!override) return baseDay;
  return {
    ...baseDay,
    ...override
  };
}

async function generateWorkerSchedules() {
  const now = new Date();
  const weekStart = getWeekStartSunday(now);
  const weekStartStr = formatDate(weekStart);

  const anchor = getWeekStartSunday(parseDate(ANCHOR_DATE));
  const weeksSinceAnchor = Math.floor((weekStart.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));

  const batch = db.batch();

  for (const worker of WORKERS) {
    const workerId = worker.id;
    const baseShift = worker.initialShift || "morning";

    let assignedShift = baseShift;
    if (worker.rotationEnabled) {
      assignedShift = computeShiftForWeek(baseShift, weeksSinceAnchor);
    }

    const days = {};
    for (let i = 0; i < 7; i++) {
      const dayDate = addDays(weekStart, i);
      const dayStr = formatDate(dayDate);
      const baseDay = buildDayEntry(dayStr, assignedShift);
      const override = worker.manualOverrides ? worker.manualOverrides[dayStr] : null;
      days[dayStr] = mergeOverride(baseDay, override);
    }

    const scheduleDoc = {
      workerId,
      weekStart: weekStartStr,
      assignedShift,
      days
    };

    const docId = `${workerId}_${weekStartStr}`;
    const docRef = db.collection("workerSchedules").doc(docId);
    batch.set(docRef, scheduleDoc, { merge: true });

    // Optionally update worker currentShift
    const workerRef = db.collection("workers").doc(workerId);
    batch.set(workerRef, { name: worker.name, initialShift: baseShift, currentShift: assignedShift, rotationEnabled: !!worker.rotationEnabled }, { merge: true });
  }

  await batch.commit();
  return { weekStart: weekStartStr, count: WORKERS.length };
}

module.exports = { generateWorkerSchedules };
