import { db, doc, getDoc, fetchSchedulesByDateRange, fetchAllWorkers } from './firabase.js';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let state = {
    machines: [

    ],
    workers: [

    ],
    tags: [

    ],
    isEditMode: false,
    isAddingTag: false,
    shiftStartTime: new Date().setHours(8, 0, 0, 0),
    shiftDurationHours: 8,
    workersFilter: 'all',
    workersSearch: '',
    shiftInitialized: false,
    shiftOverlayTimer: null,
    shiftOverlayExitTimer: null,
    shiftOverlayShiftStart: null,
    shiftOverlayDemoShown: false,
    shiftOverlayResizeRaf: null
};
// Current active shift metadata
state.currentShiftName = null;

// Old room boxes removed (floor plan is now defined in HTML)
const rooms = [];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function getStatusColor(status) {
    const colors = {
        running: '#10b981',
        idle: '#fbbf24',
        maintenance: '#fb923c',
        offline: '#ef4444'
    };
    return colors[status] || '#718096';
}

function getMachineById(id) {
    return state.machines.find(m => m.id === id);
}

function getWorkerById(id) {
    return state.workers.find(w => w.id === id);
}

function normalizeShiftName(name) {
    const raw = String(name || '').toLowerCase().trim();
    if (!raw) return '';
    if (raw.includes('morning')) return 'morning';
    if (raw.includes('afternoon')) return 'afternoon';
    if (raw.includes('night')) return 'night';
    return raw;
}

function getCurrentShiftKey() {
    return normalizeShiftName(state.currentShiftKey || state.currentShiftName || '');
}

function getWorkerAssignedShiftForDate(worker, dateObj) {
    const data = worker._data || {};
    const initialShift = data.initialShift || data.currentShift || worker.initialShift || worker.currentShift || 'morning';
    const rotationEnabled = data.rotationEnabled !== false && worker.rotationEnabled !== false;
    const weekStart = getWeekStartSunday(dateObj);
    let assignedShift = rotationEnabled ? computeAssignedShift(initialShift, weekStart) : initialShift;

    const dateStr = formatLocalDate(dateObj);
    const override = (data.manualOverrides || worker.manualOverrides || {})[dateStr];
    if (override) {
        if ((override.status || '').toLowerCase() === 'off') return 'off';
        if (override.shift) assignedShift = override.shift;
    }

    return assignedShift;
}

function getCurrentShiftWorkers() {
    const shiftKey = getCurrentShiftKey();
    if (!shiftKey) return state.workers;
    const today = new Date();

    return state.workers.filter(worker => {
        const assignedShift = getWorkerAssignedShiftForDate(worker, today);
        if (!assignedShift) return false;
        if (String(assignedShift).toLowerCase() === 'off') return false;
        return normalizeShiftName(assignedShift) === shiftKey;
    });
}

function getWorkerInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'W';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function getAvatarColor(key) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#6366f1'];
    const str = String(key || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
}

function getShiftLabelForWorker(worker) {
    const shift = getWorkerAssignedShiftForDate(worker, new Date());
    if (!shift) return '—';
    if (String(shift).toLowerCase() === 'off') return 'Off';
    const normalized = normalizeShiftName(shift);
    return normalized ? (normalized.charAt(0).toUpperCase() + normalized.slice(1)) : String(shift);
}

function copyWorkerName(name) {
    const text = String(name || '').trim();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (e) {
        console.error('Copy failed', e);
    } finally {
        document.body.removeChild(textarea);
    }
}

function focusMachineMarker(machineId) {
    if (!machineId) return;
    const marker = document.querySelector(`.machine-marker[data-id="${machineId}"]`);
    if (!marker) return;
    marker.classList.add('highlighted');
    try {
        marker.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (e) {
        // ignore scroll failures
    }
    setTimeout(() => marker.classList.remove('highlighted'), 1500);
}

function updateStats() {
    const runningMachines = state.machines.filter(m => m.status === 'running').length;
    const totalWorkers = getCurrentShiftWorkers().length;
    const maintenanceMachines = state.machines.filter(m => m.status === 'maintenance').length;
    const runningMachinesList = state.machines.filter(m => m.status === 'running');
    const avgEfficiency = runningMachinesList.length > 0
        ? Math.round(runningMachinesList.reduce((sum, m) => sum + m.efficiency, 0) / runningMachinesList.length)
        : 0;

    document.getElementById('runningCount').textContent = runningMachines;
    document.getElementById('workerCount').textContent = totalWorkers;
    document.getElementById('maintenanceCount').textContent = maintenanceMachines;
    document.getElementById('avgEfficiency').textContent = avgEfficiency + '%';
}

function triggerShiftTransitionOverlay(shiftName, visibleDurationMs = 10 * 60 * 1000) {
    const label = String(shiftName || '').trim();
    if (!label) return;
    const overlay = document.getElementById('shiftTransitionOverlay');
    const textEl = document.getElementById('shiftTransitionText');
    const metaEl = document.getElementById('shiftTransitionMeta');
    const statsEl = document.getElementById('shiftTransitionStats');
    const container = document.querySelector('.shift-progress-container');
    const card = overlay ? overlay.querySelector('.shift-transition-card') : null;
    if (!overlay || !textEl) return;
    textEl.textContent = label;
    if (metaEl) {
        const s = state.shiftStartTime ? new Date(state.shiftStartTime) : null;
        const e = state.shiftEndTime ? new Date(state.shiftEndTime) : null;
        const pad = (n) => n.toString().padStart(2, '0');
        const fmt = dt => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        const timeRange = (s && e) ? `${fmt(s)} — ${fmt(e)}` : 'Schedule synced';
        metaEl.textContent = `Shift window · ${timeRange}`;
    }
    if (statsEl) {
        const totalWorkers = getCurrentShiftWorkers().length;
        const runningMachines = state.machines.filter(m => m.status === 'running').length;
        const regularHours = Math.round((state.shiftRegularMs || 0) / (1000 * 60 * 60));
        const overtimeHours = Math.round((state.shiftOvertimeMs || 0) / (1000 * 60 * 60));
        const totalHours = Math.round((state.shiftTotalMs || 0) / (1000 * 60 * 60));
        statsEl.innerHTML = '';
        const blocks = [
            { label: 'Workers', value: totalWorkers },
            { label: 'Running', value: runningMachines },
            { label: 'Duration', value: `${totalHours || '—'}h` },
            { label: 'Overtime', value: `${overtimeHours || 0}h` },
            { label: 'Regular', value: `${regularHours || 0}h` }
        ];
        blocks.forEach(item => {
            const div = document.createElement('div');
            div.className = 'shift-transition-stat';
            const span = document.createElement('span');
            span.textContent = item.label;
            const strong = document.createElement('strong');
            strong.textContent = item.value;
            div.appendChild(span);
            div.appendChild(strong);
            statsEl.appendChild(div);
        });
    }
    overlay.classList.remove('entering', 'visible', 'exiting');
    if (state.shiftOverlayTimer) {
        clearTimeout(state.shiftOverlayTimer);
    }
    if (state.shiftOverlayExitTimer) {
        clearTimeout(state.shiftOverlayExitTimer);
    }
    void overlay.offsetWidth;
    overlay.classList.add('entering');
    if (container && card) {
        const extraPadding = 56;
        const baseHeight = container.dataset.baseHeight
            ? Number(container.dataset.baseHeight)
            : container.getBoundingClientRect().height;
        if (!container.dataset.baseHeight) {
            container.dataset.baseHeight = String(Math.round(baseHeight));
        }
        const targetHeight = Math.max(baseHeight, card.offsetHeight + extraPadding);
        animateContainerHeight(container, targetHeight);
    }
    state.shiftOverlayTimer = setTimeout(() => {
        overlay.classList.remove('entering');
        overlay.classList.add('visible');
    }, 900);

    state.shiftOverlayExitTimer = setTimeout(() => {
        overlay.classList.remove('visible');
        overlay.classList.add('exiting');
        state.shiftOverlayTimer = setTimeout(() => {
            overlay.classList.remove('exiting');
            if (container) {
                const baseHeight = container.dataset.baseHeight
                    ? Number(container.dataset.baseHeight)
                    : container.getBoundingClientRect().height;
                animateContainerHeight(container, baseHeight, 700, () => {
                    container.style.height = '';
                    container.style.minHeight = '';
                });
            }
        }, 900);
    }, Math.max(0, visibleDurationMs));
}

function syncShiftOverlayForWindow() {
    const overlay = document.getElementById('shiftTransitionOverlay');
    if (!overlay) return;
    if (!state.currentShiftName || !state.shiftStartTime) {
        overlay.classList.remove('entering', 'visible', 'exiting');
        return;
    }
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const elapsed = now - state.shiftStartTime;
    if (elapsed < 0 || elapsed > windowMs) {
        overlay.classList.remove('entering', 'visible', 'exiting');
        return;
    }
    if (state.shiftOverlayShiftStart !== state.shiftStartTime) {
        state.shiftOverlayShiftStart = state.shiftStartTime;
        const remaining = windowMs - elapsed;
        triggerShiftTransitionOverlay(state.currentShiftName, remaining);
    }
}

function isShiftOverlayActive() {
    const overlay = document.getElementById('shiftTransitionOverlay');
    if (!overlay) return false;
    return overlay.classList.contains('entering') || overlay.classList.contains('visible') || overlay.classList.contains('exiting');
}

function animateContainerHeight(container, targetHeight, duration = 700, onDone) {
    if (!container) return;
    if (state.shiftOverlayResizeRaf) {
        cancelAnimationFrame(state.shiftOverlayResizeRaf);
        state.shiftOverlayResizeRaf = null;
    }
    const startHeight = container.getBoundingClientRect().height;
    const delta = targetHeight - startHeight;
    const startTime = performance.now();
    const step = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = startHeight + delta * progress;
        container.style.height = `${Math.round(current)}px`;
        container.style.minHeight = `${Math.round(current)}px`;
        if (progress < 1) {
            state.shiftOverlayResizeRaf = requestAnimationFrame(step);
        } else {
            state.shiftOverlayResizeRaf = null;
            if (typeof onDone === 'function') onDone();
        }
    };
    state.shiftOverlayResizeRaf = requestAnimationFrame(step);
}

function updateShiftProgress() {
    const now = Date.now();
    const fillEl = document.getElementById('progressFill');
    const otAreaEl = document.getElementById('progressOvertimeArea');
    const otFillEl = document.getElementById('progressOvertimeFill');
    const nextShiftEl = document.getElementById('nextShiftIn');

    if (!state.currentShiftName || !state.shiftTotalMs || !state.shiftStartTime) {
        document.getElementById('shiftName').textContent = 'No active shift';
        if (fillEl) fillEl.style.width = '0%';
        if (otAreaEl) { otAreaEl.style.width = '0%'; otAreaEl.style.left = '0%'; otAreaEl.style.display = 'none'; }
        if (otFillEl) { otFillEl.style.width = '0%'; otFillEl.style.left = '0%'; otFillEl.style.display = 'none'; }
        document.getElementById('shiftTime').textContent = 'Start: —  End: —';
        if (nextShiftEl) nextShiftEl.textContent = 'Next shift in: —';
        return;
    }

    const elapsed = now - state.shiftStartTime;
    const regularMs = state.shiftRegularMs || 0;
    const overtimeMs = state.shiftOvertimeMs || 0;
    const totalMs = Math.max(regularMs + overtimeMs, 1);

    const normalElapsed = Math.max(0, Math.min(elapsed, regularMs));
    const overtimeElapsed = Math.max(0, Math.min(elapsed - regularMs, overtimeMs));

    const regularAreaPct = (regularMs / totalMs) * 100;
    const overtimeAreaPct = (overtimeMs / totalMs) * 100; // static area representing OT region

    // Fill percentages relative to their areas
    const regularFillPctWithin = regularMs > 0 ? (normalElapsed / regularMs) * 100 : 0;
    const overtimeFillPctWithin = overtimeMs > 0 ? (overtimeElapsed / overtimeMs) * 100 : 0;

    // Convert fills to total-bar percentages so they don't overlap
    const regularFillPctOfTotal = (regularFillPctWithin / 100) * regularAreaPct; // equals (normalElapsed/totalMs)*100
    const overtimeFillPctOfTotal = (overtimeFillPctWithin / 100) * overtimeAreaPct; // equals (overtimeElapsed/totalMs)*100

    if (fillEl) {
        fillEl.style.left = '0%';
        fillEl.style.width = regularFillPctOfTotal + '%';
        fillEl.style.background = 'linear-gradient(90deg, #4299e1, #3b82f6)';
        fillEl.style.borderRadius = (regularAreaPct < 99.999 ? '12px 0 0 12px' : '12px');
        fillEl.style.zIndex = '6';
    }
    if (otAreaEl) {
        otAreaEl.style.left = (regularAreaPct) + '%';
        otAreaEl.style.width = overtimeAreaPct + '%';
        otAreaEl.style.display = overtimeMs > 0 ? 'block' : 'none';
        // make area transparent so it doesn't create a visible rectangle at the boundary
        otAreaEl.style.background = 'transparent';
        otAreaEl.style.zIndex = '8';
    }
    if (otFillEl) {
        otFillEl.style.left = (regularAreaPct) + '%';
        otFillEl.style.width = overtimeFillPctOfTotal + '%';
        otFillEl.style.display = overtimeMs > 0 ? 'block' : 'none';
        otFillEl.style.background = 'linear-gradient(90deg, #fb923c, #f97316)';
        otFillEl.style.borderRadius = (regularAreaPct > 0 ? '0 12px 12px 0' : '12px');
        otFillEl.style.zIndex = '12';
    }

    // Seam blending element — center it on the boundary and use transform for crisp placement
    const seamEl = document.getElementById('progressSeamSvg');
    if (seamEl) {
        const seamWidthPx = 320;
        if (overtimeMs > 0 && regularAreaPct > 0 && overtimeAreaPct > 0) {
            seamEl.style.display = 'block';
            seamEl.style.width = seamWidthPx + 'px';
            seamEl.style.left = `${regularAreaPct}%`;
            seamEl.style.transform = 'translateX(-50%)';
            seamEl.style.opacity = '1';
            seamEl.style.zIndex = '50';
        } else {
            seamEl.style.display = 'none';
            seamEl.style.transform = '';
        }
    }

    // Display time: elapsed vs regular + overtime
    const elapsedTotalHours = Math.floor(elapsed / (60 * 60 * 1000));
    const elapsedTotalMin = Math.floor((elapsed % (60 * 60 * 1000)) / (60 * 1000));

    const regularH = Math.floor(regularMs / (60 * 60 * 1000));
    const regularM = Math.floor((regularMs % (60 * 60 * 1000)) / (60 * 1000));

    const overtimeH = Math.floor(overtimeMs / (60 * 60 * 1000));
    const overtimeM = Math.floor((overtimeMs % (60 * 60 * 1000)) / (60 * 1000));

    // Build labeled start/end and stats
    const s = new Date(state.shiftStartTime);
    const e = new Date(state.shiftEndTime || (state.shiftStartTime + regularMs));
    const pad = (n) => n.toString().padStart(2, '0');
    const fmt = dt => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    // show start/end and append overtime amount when present
    let shiftTimeText = `Start: ${fmt(s)}  End: ${fmt(e)}`;
    if (overtimeMs > 0) {
        const otHours = Math.floor(overtimeMs / (60 * 60 * 1000));
        const otMinutes = Math.floor((overtimeMs % (60 * 60 * 1000)) / (60 * 1000));
        let otLabel = '';
        if (otMinutes === 0) otLabel = `${otHours}h`;
        else otLabel = `${otHours}h ${otMinutes}m`;
        shiftTimeText += `  Overtime: ${otLabel}`;
    }
    document.getElementById('shiftTime').textContent = shiftTimeText;

    if (nextShiftEl) {
        const endTime = state.shiftEndTime || (state.shiftStartTime + state.shiftTotalMs);
        const remainingMs = Math.max(0, endTime - now);
        const remH = Math.floor(remainingMs / (60 * 60 * 1000));
        const remM = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        const remS = Math.floor((remainingMs % (60 * 1000)) / 1000);
        const fmt = (n) => n.toString().padStart(2, '0');
        nextShiftEl.textContent = `Next shift in: ${fmt(remH)}:${fmt(remM)}:${fmt(remS)}`;
    }

        // no shiftStats element per user request

    // Keep regular fill blue and overtime fill orange; visibility already set above

    document.getElementById('shiftName').textContent = state.currentShiftName || 'Current Shift';
}

// ============================================================================
// Firestore schedule fetching + helpers
// ============================================================================

function parseTimeForDate(baseDateStr, timeStr) {
    // baseDateStr: 'YYYY-MM-DD', timeStr: 'HH:MM'
    // Create Date using local components to avoid timezone parsing issues
    const [y, m, d] = baseDateStr.split('-').map(n => parseInt(n, 10));
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

async function fetchSchedulesForDates(dateStrs) {
    state.fetchErrors = [];
    const results = [];
    for (const ds of dateStrs) {
        try {
            const dref = doc(db, 'schedules', ds);
            const snap = await getDoc(dref);
            if (snap.exists()) {
                results.push({ date: ds, data: snap.data() });
            }
        } catch (err) {
            console.error('Error fetching schedule', ds, err);
            state.fetchErrors.push({ date: ds, message: err.message });
        }
    }
    state.lastFetchedDocs = results;
    return results;
}

function buildShiftInstances(scheduleDocs) {
    const instances = [];
    for (const s of scheduleDocs) {
        const base = s.date; // YYYY-MM-DD
        const shifts = (s.data && s.data.shifts) || [];
        shifts.forEach(sh => {
            // shifts may store start/end as minutes since midnight (number) or as 'HH:MM' strings
            let startDateObj, endDateObj;

            if (typeof sh.start === 'number') {
                // minutes since midnight
                const [y, m, d] = base.split('-').map(n => parseInt(n, 10));
                startDateObj = new Date(y, m - 1, d, 0, 0, 0, 0);
                startDateObj = new Date(startDateObj.getTime() + sh.start * 60 * 1000);
            } else {
                startDateObj = parseTimeForDate(base, String(sh.start || '00:00'));
            }

            if (typeof sh.end === 'number') {
                const [y, m, d] = base.split('-').map(n => parseInt(n, 10));
                endDateObj = new Date(y, m - 1, d, 0, 0, 0, 0);
                endDateObj = new Date(endDateObj.getTime() + sh.end * 60 * 1000);
            } else {
                endDateObj = parseTimeForDate(base, String(sh.end || '00:00'));
            }

            if (endDateObj <= startDateObj) {
                // overnight -> next day
                endDateObj = new Date(endDateObj.getTime() + 24 * 60 * 60 * 1000);
            }

            instances.push({ name: sh.shift || sh.shiftName || 'Shift', start: startDateObj, end: endDateObj, raw: sh, date: base });
        });
    }
    return instances;
}

function minutesToHHMM(mins) {
    const total = Number(mins) || 0;
    const mm = total % 60;
    const hh = Math.floor(total / 60) % 24;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(hh)}:${pad(mm)}`;
}

function formatShiftForDisplay(baseDateStr, sh) {
    // sh may have numeric minutes or string times
    let startText = '';
    let endText = '';
    if (typeof sh.start === 'number') {
        startText = minutesToHHMM(sh.start);
    } else {
        startText = String(sh.start || '00:00');
    }
    if (typeof sh.end === 'number') {
        endText = minutesToHHMM(sh.end);
    } else {
        endText = String(sh.end || '00:00');
    }
    // handle overnight display if end <= start when numeric
    if (typeof sh.start === 'number' && typeof sh.end === 'number' && sh.end <= sh.start) {
        endText += ' (+1d)';
    }
    return `${startText} — ${endText}`;
}

const ROTATION_ORDER = ['morning', 'night', 'afternoon'];
const ANCHOR_DATE = '2026-01-18'; // YYYY-MM-DD
const SHIFT_DEFS = {
    morning: { start: '07:30', end: '19:30', duration: 12, overtime: 4 },
    night: { start: '19:30', end: '07:30', duration: 12, overtime: 4 },
    afternoon: { start: '15:30', end: '23:30', duration: 8, overtime: 0 }
};

function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
    return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatLocalDate(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getWeekStartSunday(date) {
    const d = new Date(date.getTime());
    const day = d.getDay(); // 0 = Sunday
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getRotationIndex(shift) {
    const idx = ROTATION_ORDER.indexOf((shift || '').toLowerCase());
    return idx === -1 ? 0 : idx;
}

function computeAssignedShift(initialShift, weekStartDate) {
    const anchor = getWeekStartSunday(parseLocalDate(ANCHOR_DATE));
    const weeksSince = Math.floor((weekStartDate.getTime() - anchor.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const baseIdx = getRotationIndex(initialShift || 'morning');
    const idx = (baseIdx + (weeksSince % ROTATION_ORDER.length) + ROTATION_ORDER.length) % ROTATION_ORDER.length;
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

function buildSyntheticWorkerScheduleDocs(workers, startDateStr, endDateStr) {
    const start = parseLocalDate(startDateStr);
    const end = parseLocalDate(endDateStr);
    const out = [];

    (workers || []).forEach(w => {
        const data = w.data || {};
        const workerId = w.id;
        const initialShift = data.initialShift || data.currentShift || 'morning';
        const rotationEnabled = data.rotationEnabled !== false;
        const manualOverrides = data.manualOverrides || {};
        const days = {};

        for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
            const dateStr = formatLocalDate(d);
            const weekStart = getWeekStartSunday(d);
            let assignedShift = initialShift;
            if (rotationEnabled) {
                assignedShift = computeAssignedShift(initialShift, weekStart);
            }
            const baseDay = buildDayEntry(dateStr, assignedShift);
            const override = manualOverrides[dateStr];
            days[dateStr] = mergeOverride(baseDay, override);
        }

        out.push({
            id: workerId,
            data: {
                workerId,
                assignedShift: initialShift,
                days
            }
        });
    });

    return out;
}

function getWeekStartStringsInRange(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return [];
    const start = parseLocalDate(startDateStr);
    const end = parseLocalDate(endDateStr);
    if (start.getTime() > end.getTime()) return [];

    const set = new Set();
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
        const weekStart = getWeekStartSunday(d);
        set.add(formatLocalDate(weekStart));
    }
    return Array.from(set);
}

function buildScheduleMetaMap(scheduleDocs) {
    const meta = {};
    (scheduleDocs || []).forEach(d => {
        const data = d.data || {};
        const dateStr = data.date || d.id;
        if (!dateStr) return;
        if (!meta[dateStr]) meta[dateStr] = {};
        const shifts = Array.isArray(data.shifts) ? data.shifts : [];
        shifts.forEach(sh => {
            const name = normalizeShiftName(sh.shift || sh.shiftName || '');
            if (!name) return;
            const start = (typeof sh.start === 'number') ? minutesToHHMM(sh.start) : String(sh.start || '');
            const end = (typeof sh.end === 'number') ? minutesToHHMM(sh.end) : String(sh.end || '');
            meta[dateStr][name] = {
                start,
                end,
                duration: (typeof sh.duration === 'number') ? sh.duration : undefined,
                overtime: (typeof sh.overtime === 'number') ? sh.overtime : undefined
            };
        });
    });
    return meta;
}

function buildWorkerScheduleDayMap(workers, dateKeys) {
    const dayMap = {};
    (dateKeys || []).forEach(dateStr => {
        dayMap[dateStr] = [];
    });

    (workers || []).forEach(w => {
        const data = w.data || {};
        const workerId = w.id;
        const workerName = data.name || workerId;
        const shift = (data.currentShift || '').toLowerCase();
        const status = data.status || '';

        Object.keys(dayMap).forEach(dateStr => {
            dayMap[dateStr].push({
                workerId,
                workerName,
                shift,
                status,
                start: '',
                end: '',
                duration: undefined,
                overtime: undefined
            });
        });
    });

    return dayMap;
}

function buildShiftBuckets(entries) {
    const buckets = {
        morning: [],
        afternoon: [],
        night: [],
        off: [],
        other: []
    };
    (entries || []).forEach(entry => {
        const status = (entry.status || '').toLowerCase();
        if (status === 'off') {
            buckets.off.push(entry);
            return;
        }
        const shift = (entry.shift || '').toLowerCase();
        if (shift === 'morning') buckets.morning.push(entry);
        else if (shift === 'afternoon') buckets.afternoon.push(entry);
        else if (shift === 'night') buckets.night.push(entry);
        else buckets.other.push(entry);
    });
    return buckets;
}

function getShiftLabelAndTimes(shiftKey, entries, scheduleMeta) {
    const key = (shiftKey || '').toLowerCase();
    if (scheduleMeta && scheduleMeta[key]) {
        return {
            label: key,
            start: scheduleMeta[key].start,
            end: scheduleMeta[key].end,
            duration: scheduleMeta[key].duration,
            overtime: scheduleMeta[key].overtime
        };
    }
    return { label: key || 'other', start: '', end: '', duration: undefined, overtime: undefined };
}

function renderWorkerScheduleTable(workers, startDateStr, endDateStr, scheduleDocs) {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    container.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'schedule-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Date</th><th>Weekday</th><th>Shifts</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    let dateKeys = [];
    if (scheduleDocs && scheduleDocs.length > 0) {
        dateKeys = scheduleDocs
            .map(d => (d.data && d.data.date) ? String(d.data.date) : d.id)
            .filter(Boolean);
    }
    if (!dateKeys || dateKeys.length === 0) {
        const start = parseLocalDate(startDateStr);
        const end = parseLocalDate(endDateStr);
        for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
            dateKeys.push(formatLocalDate(d));
        }
    }

    const dayMap = buildWorkerScheduleDayMap(workers, dateKeys);
    const scheduleMetaMap = buildScheduleMetaMap(scheduleDocs);
    const sortedDateKeys = Object.keys(dayMap).sort();

    if (!sortedDateKeys || sortedDateKeys.length === 0) {
        const r = document.createElement('tr');
        r.innerHTML = '<td colspan="3" style="text-align:center;color:#718096;padding:12px;">No worker schedules found for range.</td>';
        tbody.appendChild(r);
    } else {
        sortedDateKeys.forEach(dateStr => {
            const row = document.createElement('tr');
            const dateCell = document.createElement('td');
            dateCell.textContent = dateStr;

            const weekdayCell = document.createElement('td');
            const weekday = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
            weekdayCell.textContent = weekday;

            const shiftsCell = document.createElement('td');
            const entries = dayMap[dateStr] || [];
            if (entries.length === 0) {
                shiftsCell.textContent = '—';
            } else {
                const buckets = buildShiftBuckets(entries);
                const ordered = [
                    { key: 'morning', label: 'Morning' },
                    { key: 'afternoon', label: 'Afternoon' },
                    { key: 'night', label: 'Night' },
                    { key: 'off', label: 'Off' },
                    { key: 'other', label: 'Other' }
                ];

                ordered.forEach(({ key, label }) => {
                    const list = buckets[key] || [];
                    if (list.length === 0) return;

                    const details = document.createElement('details');
                    details.className = `shift-group shift-${key}`;
                    details.style.marginBottom = '6px';

                    const summary = document.createElement('summary');
                    summary.className = 'shift-summary';

                    const title = document.createElement('span');
                    title.className = 'shift-summary-title';
                    title.textContent = `${label} (${list.length})`;

                    const meta = document.createElement('span');
                    meta.className = 'shift-summary-meta';

                    const timeMeta = getShiftLabelAndTimes(key, list, scheduleMetaMap[dateStr]);
                    if (timeMeta.start && timeMeta.end) {
                        let metaText = `${timeMeta.start} — ${timeMeta.end}`;
                        if (typeof timeMeta.duration === 'number') {
                            metaText += ` • ${timeMeta.duration}h`;
                        }
                        if (typeof timeMeta.overtime === 'number' && timeMeta.overtime > 0) {
                            metaText += ` (+${timeMeta.overtime}h OT)`;
                        }
                        meta.textContent = metaText;
                    } else if (key === 'off') {
                        meta.textContent = 'Off';
                    } else {
                        meta.textContent = '—';
                    }

                    summary.appendChild(title);
                    summary.appendChild(meta);
                    details.appendChild(summary);

                    const listWrap = document.createElement('div');
                    listWrap.style.marginTop = '6px';

                    list.forEach(entry => {
                        const div = document.createElement('div');
                        div.className = 'shift-row';

                        const nameSpan = document.createElement('span');
                        nameSpan.className = 'shift-name';
                        nameSpan.textContent = entry.workerName;

                        const timeSpan = document.createElement('span');
                        timeSpan.className = 'shift-time-inline';

                        let detailsText = '';
                        const scheduleMeta = (scheduleMetaMap[dateStr] && scheduleMetaMap[dateStr][(entry.shift || '').toLowerCase()]) || null;
                        if (entry.status && entry.status.toLowerCase() === 'off') {
                            detailsText = 'Off';
                        } else if (scheduleMeta && scheduleMeta.start && scheduleMeta.end) {
                            detailsText = `${scheduleMeta.start} — ${scheduleMeta.end}`;
                        } else {
                            detailsText = '';
                        }

                        timeSpan.textContent = detailsText;

                        div.appendChild(nameSpan);
                        div.appendChild(document.createTextNode(' '));
                        div.appendChild(timeSpan);

                        if (entry.overtime && Number(entry.overtime) > 0) {
                            div.classList.add('overtime');
                        }

                        listWrap.appendChild(div);
                    });

                    details.appendChild(listWrap);
                    shiftsCell.appendChild(details);
                });
            }

            row.appendChild(dateCell);
            row.appendChild(weekdayCell);
            row.appendChild(shiftsCell);
            tbody.appendChild(row);
        });
    }

    table.appendChild(tbody);
    container.appendChild(table);
}

async function fetchSchedulesRangeAndRender(startDate, endDate) {
    try {
        const [docs, workers] = await Promise.all([
            fetchSchedulesByDateRange(startDate, endDate),
            fetchAllWorkers()
        ]);

        state.lastFetchedDocs = docs;
        state.lastWorkerDocs = workers;

        renderWorkerScheduleTable(workers || [], startDate, endDate, docs);

        return { schedules: docs, workers };
    } catch (err) {
        console.error('Error loading schedules for range', err);
        state.fetchErrors = state.fetchErrors || [];
        state.fetchErrors.push({ range: [startDate, endDate], message: err.message });
        renderWorkerScheduleTable([], startDate, endDate, []);
        throw err;
    }
}

async function loadWorkersFromFirestore() {
    try {
        const workers = await fetchAllWorkers();
        state.workers = (workers || []).map(w => {
            const data = w.data || {};
            return {
                id: w.id,
                name: data.name || w.id,
                role: data.role || 'Worker',
                assignedMachine: data.assignedMachine || null,
                currentShift: data.currentShift,
                initialShift: data.initialShift,
                rotationEnabled: data.rotationEnabled,
                manualOverrides: data.manualOverrides,
                status: data.status,
                _data: data
            };
        });
        renderWorkersList();
        updateStats();
    } catch (err) {
        console.error('Error loading workers', err);
    }
}

function renderScheduleTable(docs) {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    container.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'schedule-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Date</th><th>Weekday</th><th>Shifts</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    if (!docs || docs.length === 0) {
        const r = document.createElement('tr');
        r.innerHTML = '<td colspan="3" style="text-align:center;color:#718096;padding:12px;">No schedules found for range.</td>';
        tbody.appendChild(r);
    } else {
        docs.forEach(d => {
            const row = document.createElement('tr');
            const dateCell = document.createElement('td');
            dateCell.textContent = d.data.date || d.id;

            const weekdayCell = document.createElement('td');
            const weekday = d.data.weekday || new Date((d.data && d.data.date) ? d.data.date + 'T00:00:00' : d.id).toLocaleDateString('en-US', { weekday: 'long' });
            const trWeekday = d.data.weekdayTurkish || (d.data.shifts && d.data.shifts[0] && d.data.shifts[0].weekdayTurkish) || '';
            weekdayCell.textContent = weekday + (trWeekday ? (' / ' + trWeekday) : '');

            const shiftsCell = document.createElement('td');
            if (Array.isArray(d.data.shifts) && d.data.shifts.length > 0) {
                d.data.shifts.forEach((sh, i) => {
                    const div = document.createElement('div');
                    div.className = 'shift-row';
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'shift-name';
                    nameSpan.textContent = sh.shift || sh.shiftName || ('Shift ' + (i+1));

                    const timeSpan = document.createElement('span');
                    timeSpan.className = 'shift-time-inline';
                    timeSpan.textContent = formatShiftForDisplay(d.data.date, sh);

                    div.appendChild(nameSpan);
                    div.appendChild(document.createTextNode(' '));
                    div.appendChild(timeSpan);

                    if (sh.overtime && Number(sh.overtime) > 0) {
                        div.classList.add('overtime');
                    }

                    shiftsCell.appendChild(div);
                });
            } else {
                shiftsCell.textContent = '—';
            }

            row.appendChild(dateCell);
            row.appendChild(weekdayCell);
            row.appendChild(shiftsCell);
            tbody.appendChild(row);
        });
    }

    table.appendChild(tbody);
    container.appendChild(table);
}

async function loadCurrentShiftFromFirestore() {
    const now = new Date();
    const prevShiftName = state.currentShiftName;
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // fetch surrounding days to handle overnight shifts stored on adjacent docs
    const docs = await fetchSchedulesForDates([yesterday, today, tomorrow]);
    let instances = buildShiftInstances(docs);

    // If no docs returned or fetch errors occurred, fall back to a local schedule heuristic
    if ((!docs || docs.length === 0) || (state.fetchErrors && state.fetchErrors.length > 0)) {
        const fallback = buildFallbackInstances();
        instances = instances.concat(fallback);
    }

    const nowTs = now.getTime();
    // find active shift
    const active = instances.find(inst => nowTs >= inst.start.getTime() && nowTs <= inst.end.getTime());
    if (active) {
        state.shiftStartTime = active.start.getTime();
        state.shiftEndTime = active.end.getTime();
        // regular and overtime (hours) come from raw (coerce strings to numbers)
        const regularHours = (active.raw && !isNaN(Number(active.raw.duration))) ? Number(active.raw.duration) : Math.round((active.end.getTime() - active.start.getTime()) / (1000*60*60));
        const overtimeHours = (active.raw && !isNaN(Number(active.raw.overtime))) ? Number(active.raw.overtime) : 0;
        state.shiftRegularMs = regularHours * 60 * 60 * 1000;
        state.shiftOvertimeMs = overtimeHours * 60 * 60 * 1000;
        state.shiftTotalMs = state.shiftRegularMs + state.shiftOvertimeMs;
        state.shiftDurationHours = Math.max(1, Math.round(state.shiftTotalMs / (1000 * 60 * 60)));
        state.currentShiftName = active.name;
        state.currentShiftKey = normalizeShiftName((active.raw && (active.raw.shift || active.raw.shiftName)) || active.name || '');
    } else {
        // no active shift; clear
        state.currentShiftName = null;
        state.currentShiftKey = '';
        state.shiftRegularMs = 0;
        state.shiftOvertimeMs = 0;
        state.shiftTotalMs = 0;
    }

    if (state.shiftInitialized) {
        if (state.currentShiftName && state.currentShiftName !== prevShiftName) {
            state.shiftOverlayShiftStart = null;
        }
    } else {
        state.shiftInitialized = true;
    }
    syncShiftOverlayForWindow();
    // Update debug panel with fetch info and selected instance
    const debugEl = document.getElementById('shiftDebug');
    const debugPre = document.getElementById('shiftDebugPre');
    if (debugEl && debugPre) {
        const info = {
            now: new Date().toString(),
            fetchedDocs: state.lastFetchedDocs || [],
            fetchErrors: state.fetchErrors || []
        };
        if (active) info.selected = { name: active.name, start: active.start.toString(), end: active.end.toString(), raw: active.raw };
        debugPre.textContent = JSON.stringify(info, null, 2);
        // show debug only on errors by default
        debugEl.style.display = (info.fetchErrors && info.fetchErrors.length > 0) ? 'block' : 'none';
        const closeBtn = document.getElementById('shiftDebugClose');
        if (closeBtn) {
            closeBtn.onclick = () => { debugEl.style.display = 'none'; };
        }
    }

    // Diagnostic log: always print fetched docs and selected shift to console
    try {
        console.log('Schedule fetch result:', { fetched: state.lastFetchedDocs, errors: state.fetchErrors, active: (instances.find(inst => now.getTime() >= inst.start.getTime() && now.getTime() <= inst.end.getTime()) || null) });
    } catch (e) {
        console.error('Error logging schedule debug', e);
    }

    updateShiftProgress();
    renderWorkersList();
    updateStats();
}

// Build a small set of fallback shift instances based on local time ranges so UI can still render
function buildFallbackInstances() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const instances = [];
    // Morning: 07:30 - 15:30
    instances.push({ name: 'Morning Shift', start: parseTimeForDate(todayStr, '07:30'), end: parseTimeForDate(todayStr, '15:30'), raw: { duration: 8, overtime: 0 } });
    // Afternoon: 15:30 - 23:30
    instances.push({ name: 'Afternoon Shift', start: parseTimeForDate(todayStr, '15:30'), end: parseTimeForDate(todayStr, '23:30'), raw: { duration: 8, overtime: 0 } });
    // Night (overnight): yesterday 19:30 -> today 07:30
    instances.push({ name: 'Night Shift', start: parseTimeForDate(yesterdayStr, '19:30'), end: parseTimeForDate(todayStr, '07:30'), raw: { duration: 8, overtime: 4 } });

    return instances;
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderRooms() {
    const container = document.getElementById('roomsContainer');
    if (!container || rooms.length === 0) return;
    container.innerHTML = '';
    
    rooms.forEach((room, index) => {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room-box';
        roomDiv.style.left = room.x + '%';
        roomDiv.style.top = room.y + '%';
        roomDiv.style.width = room.width + '%';
        roomDiv.style.height = room.height + '%';
        container.appendChild(roomDiv);
    });
}

function renderMachines() {
    const map = document.getElementById('mapContent') || document.getElementById('factoryFloorMap');
    
    // Remove existing machines
    map.querySelectorAll('.machine-marker').forEach(el => el.remove());
    
    state.machines.forEach(machine => {
        const marker = createMachineMarker(machine);
        map.appendChild(marker);
    });
}

function createMachineMarker(machine) {
    const marker = document.createElement('div');
    marker.className = 'machine-marker';
    marker.dataset.id = machine.id;
    marker.style.left = machine.position.x + '%';
    marker.style.top = machine.position.y + '%';
    marker.style.cursor = state.isEditMode ? 'move' : 'pointer';
    
    const content = document.createElement('div');
    content.className = 'machine-content';
    
    const info = document.createElement('div');
    info.className = 'machine-info';
    
    // Status icon or brand icon
    const icon = document.createElement('div');
    icon.className = 'machine-status-icon';
    if (machine.icon) {
        icon.innerHTML = getBrandIconSvg(machine.brand || machine.type || 'M');
    } else {
        icon.innerHTML = getStatusIcon(machine.status);
        icon.style.color = getStatusColor(machine.status);
    }
    
    // Machine name
    const name = document.createElement('div');
    name.className = 'machine-name';
    name.textContent = machine.name;
    
    info.appendChild(icon);
    info.appendChild(name);
    
    // Worker count
    if (machine.workers.length > 0) {
        const workers = document.createElement('div');
        workers.className = 'machine-workers';
        workers.textContent = machine.workers.length + ' worker' + (machine.workers.length !== 1 ? 's' : '');
        info.appendChild(workers);
    }
    
    content.appendChild(info);
    
    // Pulse animation for running machines
    if (machine.status === 'running') {
        const pulse = document.createElement('div');
        pulse.className = 'machine-pulse';
        pulse.style.backgroundColor = getStatusColor(machine.status);
        content.appendChild(pulse);
    }
    
    marker.appendChild(content);
    
    // Event listeners
    marker.addEventListener('mousedown', handleMachineMouseDown);
    marker.addEventListener('click', handleMachineClick);
    
    return marker;
}

function getBrandIconSvg(label) {
    const text = String(label || 'M').trim().toUpperCase().slice(0, 3);
    return `
        <svg class="machine-brand-icon" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="3" y="5" width="26" height="22" rx="5" fill="currentColor" opacity="0.12"></rect>
            <rect x="6" y="9" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
            <circle cx="10" cy="16" r="2" fill="currentColor"></circle>
            <path d="M14 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            <text x="20" y="15" text-anchor="middle" dominant-baseline="middle" font-size="7" font-weight="700" fill="currentColor" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">${text}</text>
        </svg>
    `;
}

function getStatusIcon(status) {
    const icons = {
        running: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
        idle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m5.4-14.4-4.2 4.2m-2.4 2.4-4.2 4.2m14.4 0-4.2-4.2m-2.4-2.4-4.2-4.2"></path></svg>',
        maintenance: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        offline: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    };
    return icons[status] || icons.idle;
}

function renderTags() {
    const map = document.getElementById('mapContent') || document.getElementById('factoryFloorMap');
    
    // Remove existing tags
    map.querySelectorAll('.tag-marker').forEach(el => el.remove());
    
    state.tags.forEach(tag => {
        const marker = createTagMarker(tag);
        map.appendChild(marker);
    });
}

// ============================================================================
// MAP ZOOM + PAN (MOUSE, TOUCH, KEYBOARD)
// ============================================================================

const mapViewState = {
    scale: 1,
    x: 0,
    y: 0,
    minScale: 0.5,
    maxScale: 2.8,
    baseWidth: 1200,
    baseHeight: 1240,
    panPadding: 80
};

let mapPanState = {
    isPanning: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
};

const activePointers = new Map();
let pinchStart = null;

function getMapElements() {
    const viewport = document.getElementById('mapViewport');
    const content = document.getElementById('mapContent');
    const map = document.getElementById('factoryFloorMap');
    return { map, viewport, content };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getPanBounds(scale, rect) {
    const contentWidth = mapViewState.baseWidth * scale;
    const contentHeight = mapViewState.baseHeight * scale;
    const padding = mapViewState.panPadding;

    let minX;
    let maxX;
    let minY;
    let maxY;

    if (contentWidth <= rect.width) {
        const centeredX = (rect.width - contentWidth) / 2;
        minX = centeredX - padding;
        maxX = centeredX + padding;
    } else {
        minX = rect.width - contentWidth - padding;
        maxX = padding;
    }

    if (contentHeight <= rect.height) {
        const centeredY = (rect.height - contentHeight) / 2;
        minY = centeredY - padding;
        maxY = centeredY + padding;
    } else {
        minY = rect.height - contentHeight - padding;
        maxY = padding;
    }

    return { minX, maxX, minY, maxY };
}

function applyMapTransform() {
    const { viewport, content } = getMapElements();
    if (!viewport || !content) return;
    const rect = viewport.getBoundingClientRect();
    const bounds = getPanBounds(mapViewState.scale, rect);
    mapViewState.x = clamp(mapViewState.x, bounds.minX, bounds.maxX);
    mapViewState.y = clamp(mapViewState.y, bounds.minY, bounds.maxY);
    content.style.transform = `translate3d(${mapViewState.x}px, ${mapViewState.y}px, 0) scale(${mapViewState.scale})`;
}

function syncMapBaseSize() {
    const { content } = getMapElements();
    if (!content) return;
    content.style.width = `${mapViewState.baseWidth}px`;
    content.style.height = `${mapViewState.baseHeight}px`;
}

function centerMap() {
    const { viewport } = getMapElements();
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const fitScale = Math.min(rect.width / mapViewState.baseWidth, rect.height / mapViewState.baseHeight);
    mapViewState.scale = Math.min(mapViewState.maxScale, Math.max(mapViewState.minScale, fitScale));
    mapViewState.x = (rect.width - mapViewState.baseWidth * mapViewState.scale) / 2;
    mapViewState.y = (rect.height - mapViewState.baseHeight * mapViewState.scale) / 2;
    applyMapTransform();
}

function nudgeMap(dx, dy) {
    mapViewState.x += dx;
    mapViewState.y += dy;
    applyMapTransform();
}

function zoomAt(clientX, clientY, nextScale) {
    const { viewport } = getMapElements();
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const scale = clamp(nextScale, mapViewState.minScale, mapViewState.maxScale);
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const worldX = (offsetX - mapViewState.x) / mapViewState.scale;
    const worldY = (offsetY - mapViewState.y) / mapViewState.scale;

    mapViewState.scale = scale;
    mapViewState.x = offsetX - worldX * scale;
    mapViewState.y = offsetY - worldY * scale;
    applyMapTransform();
}

function setScaleBy(delta, clientX, clientY) {
    const nextScale = mapViewState.scale * delta;
    zoomAt(clientX, clientY, nextScale);
}

function shouldIgnoreMapPan(target) {
    return target && target.closest && target.closest('.machine-marker, .tag-marker, .machine-content, .tag-content');
}

function handleWheelZoom(e) {
    const { viewport } = getMapElements();
    if (!viewport || !viewport.contains(e.target)) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    setScaleBy(delta, e.clientX, e.clientY);
}

function handlePointerDown(e) {
    const { viewport } = getMapElements();
    if (!viewport || !viewport.contains(e.target)) return;

    if (shouldIgnoreMapPan(e.target)) return;
    if (e.button !== undefined && e.button !== 0 && e.button !== 2) return;
    if (e.button === 2) e.preventDefault();

    viewport.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
        mapPanState.isPanning = true;
        mapPanState.startX = e.clientX;
        mapPanState.startY = e.clientY;
        mapPanState.originX = mapViewState.x;
        mapPanState.originY = mapViewState.y;
    } else if (activePointers.size === 2) {
        const points = Array.from(activePointers.values());
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        pinchStart = {
            distance: Math.hypot(dx, dy),
            scale: mapViewState.scale,
            centerX: (points[0].x + points[1].x) / 2,
            centerY: (points[0].y + points[1].y) / 2
        };
        mapPanState.isPanning = false;
    }
}

function handlePointerMove(e) {
    const { viewport } = getMapElements();
    if (!viewport || !viewport.hasPointerCapture(e.pointerId)) return;
    if (!activePointers.has(e.pointerId)) return;

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && pinchStart) {
        const points = Array.from(activePointers.values());
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        const distance = Math.hypot(dx, dy) || 1;
        const centerX = (points[0].x + points[1].x) / 2;
        const centerY = (points[0].y + points[1].y) / 2;
        const scaleFactor = distance / pinchStart.distance;
        zoomAt(centerX, centerY, pinchStart.scale * scaleFactor);
        pinchStart.centerX = centerX;
        pinchStart.centerY = centerY;
        return;
    }

    if (mapPanState.isPanning) {
        const dx = e.clientX - mapPanState.startX;
        const dy = e.clientY - mapPanState.startY;
        mapViewState.x = mapPanState.originX + dx;
        mapViewState.y = mapPanState.originY + dy;
        applyMapTransform();
    }
}

function handlePointerUp(e) {
    const { viewport } = getMapElements();
    if (!viewport) return;
    if (viewport.hasPointerCapture(e.pointerId)) {
        viewport.releasePointerCapture(e.pointerId);
    }
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
        pinchStart = null;
    }
    mapPanState.isPanning = false;
}

function handleMapKeyDown(e) {
    const { map, viewport } = getMapElements();
    if (!map || !viewport || document.activeElement !== map) return;

    const step = e.shiftKey ? 120 : 40;
    let handled = true;

    switch (e.key) {
        case '+':
        case '=':
            zoomAt(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2, mapViewState.scale * 1.1);
            break;
        case '-':
        case '_':
            zoomAt(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2, mapViewState.scale * 0.9);
            break;
        case '0':
            mapViewState.scale = 1;
            mapViewState.x = 0;
            mapViewState.y = 0;
            applyMapTransform();
            break;
        case 'ArrowLeft':
            mapViewState.x += step;
            applyMapTransform();
            break;
        case 'ArrowRight':
            mapViewState.x -= step;
            applyMapTransform();
            break;
        case 'ArrowUp':
            mapViewState.y += step;
            applyMapTransform();
            break;
        case 'ArrowDown':
            mapViewState.y -= step;
            applyMapTransform();
            break;
        case 'w':
        case 'W':
            mapViewState.y += step;
            applyMapTransform();
            break;
        case 's':
        case 'S':
            mapViewState.y -= step;
            applyMapTransform();
            break;
        case 'a':
        case 'A':
            mapViewState.x += step;
            applyMapTransform();
            break;
        case 'd':
        case 'D':
            mapViewState.x -= step;
            applyMapTransform();
            break;
        default:
            handled = false;
    }

    if (handled) {
        e.preventDefault();
    }
}

function initMapInteractions() {
    const { viewport, map } = getMapElements();
    if (!viewport || !map) return;

    syncMapBaseSize();
    centerMap();
    viewport.addEventListener('wheel', handleWheelZoom, { passive: false });
    viewport.addEventListener('pointerdown', handlePointerDown);
    viewport.addEventListener('pointermove', handlePointerMove);
    viewport.addEventListener('pointerup', handlePointerUp);
    viewport.addEventListener('pointercancel', handlePointerUp);
    viewport.addEventListener('contextmenu', (e) => e.preventDefault());
    map.addEventListener('keydown', handleMapKeyDown);

    const controlButtons = map.querySelectorAll('.map-control-btn');
    controlButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const dir = btn.dataset.pan;
            const step = 60;
            if (dir === 'up') nudgeMap(0, step);
            if (dir === 'down') nudgeMap(0, -step);
            if (dir === 'left') nudgeMap(step, 0);
            if (dir === 'right') nudgeMap(-step, 0);
        });
    });

    window.addEventListener('resize', () => {
        syncMapBaseSize();
        centerMap();
    });
}

function createTagMarker(tag) {
    const marker = document.createElement('div');
    marker.className = 'tag-marker';
    marker.dataset.id = tag.id;
    marker.style.left = tag.position.x + '%';
    marker.style.top = tag.position.y + '%';
    marker.style.cursor = state.isEditMode ? 'move' : 'default';
    
    const content = document.createElement('div');
    content.className = 'tag-content';
    
    const icon = document.createElement('div');
    icon.className = 'tag-icon';
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
    
    const text = document.createElement('span');
    text.className = 'tag-text';
    text.textContent = tag.text;
    
    content.appendChild(icon);
    content.appendChild(text);
    marker.appendChild(content);
    
    // Event listeners
    marker.addEventListener('mousedown', handleTagMouseDown);
    text.addEventListener('click', () => editTag(tag.id));
    
    return marker;
}

function renderMachinesList() {
    const container = document.getElementById('machinesList');
    container.innerHTML = '';
    
    state.machines.forEach(machine => {
        const item = createMachineListItem(machine);
        container.appendChild(item);
    });
}

function createMachineListItem(machine) {
    const item = document.createElement('div');
    item.className = 'machine-list-item';
    
    // Header
    const header = document.createElement('div');
    header.className = 'machine-list-header';
    
    const title = document.createElement('div');
    title.className = 'machine-list-title';
    
    const status = document.createElement('div');
    status.className = 'machine-list-status';
    status.style.backgroundColor = getStatusColor(machine.status);
    
    const name = document.createElement('div');
    name.className = 'machine-list-name';
    name.textContent = machine.name;
    
    title.appendChild(status);
    title.appendChild(name);
    
    const expandIcon = document.createElement('div');
    expandIcon.className = 'expand-icon';
    expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    
    header.appendChild(title);
    header.appendChild(expandIcon);
    
    // Details
    const details = document.createElement('div');
    details.className = 'machine-list-details';
    
    const typeRow = createDetailRow('Type', machine.type);
    const statusRow = createDetailRow('Status', machine.status.charAt(0).toUpperCase() + machine.status.slice(1));
    const efficiencyRow = createDetailRow('Efficiency', machine.efficiency + '%');
    const workersRow = createDetailRow('Workers', machine.workers.length);
    
    details.appendChild(typeRow);
    details.appendChild(statusRow);
    details.appendChild(efficiencyRow);
    details.appendChild(workersRow);
    
    // To-do list
    const todoSection = createTodoSection(machine);
    details.appendChild(todoSection);
    
    item.appendChild(header);
    item.appendChild(details);
    
    // Toggle expand
    header.addEventListener('click', () => {
        details.classList.toggle('expanded');
        expandIcon.classList.toggle('expanded');
    });
    
    return item;
}

function createDetailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'machine-detail-row';
    
    const labelEl = document.createElement('span');
    labelEl.className = 'machine-detail-label';
    labelEl.textContent = label + ':';
    
    const valueEl = document.createElement('span');
    valueEl.className = 'machine-detail-value';
    valueEl.textContent = value;
    
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    
    return row;
}

function createTodoSection(machine) {
    const section = document.createElement('div');
    section.className = 'todo-section';
    
    const header = document.createElement('div');
    header.className = 'todo-header';
    
    const title = document.createElement('div');
    title.className = 'todo-title';
    title.textContent = 'Tasks';
    
    const addBtn = document.createElement('button');
    addBtn.className = 'add-todo-btn';
    addBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    addBtn.addEventListener('click', () => addMachineTodo(machine.id));
    
    header.appendChild(title);
    header.appendChild(addBtn);
    
    const list = document.createElement('div');
    list.className = 'todo-list';
    
    machine.todos.forEach(todo => {
        const todoItem = createTodoItem(machine.id, todo);
        list.appendChild(todoItem);
    });
    
    section.appendChild(header);
    section.appendChild(list);
    
    return section;
}

function createTodoItem(machineId, todo) {
    const item = document.createElement('div');
    item.className = 'todo-item';
    
    const checkbox = document.createElement('div');
    checkbox.className = 'todo-checkbox' + (todo.completed ? ' checked' : '');
    if (todo.completed) {
        checkbox.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }
    checkbox.addEventListener('click', () => toggleTodo(machineId, todo.id));
    
    const text = document.createElement('div');
    text.className = 'todo-text' + (todo.completed ? ' completed' : '');
    text.textContent = todo.text;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'todo-delete';
    deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    deleteBtn.addEventListener('click', () => deleteTodo(machineId, todo.id));
    
    item.appendChild(checkbox);
    item.appendChild(text);
    item.appendChild(deleteBtn);
    
    return item;
}

function renderWorkersList(keepSearchFocus = false, caretPos = null) {
    const container = document.getElementById('workersList');
    container.innerHTML = '';

    const visibleWorkers = getCurrentShiftWorkers();
    const shiftLabel = getCurrentShiftKey();

    const toolbar = document.createElement('div');
    toolbar.className = 'workers-toolbar';

    const info = document.createElement('div');
    info.className = 'workers-toolbar-info';
    const shiftText = shiftLabel ? `${shiftLabel.charAt(0).toUpperCase() + shiftLabel.slice(1)} shift` : 'All shifts';
    info.textContent = `${shiftText} • ${visibleWorkers.length} worker${visibleWorkers.length !== 1 ? 's' : ''}`;

    const controls = document.createElement('div');
    controls.className = 'workers-toolbar-controls';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'workers-search';
    searchWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search workers';
    searchInput.value = state.workersSearch || '';
    searchInput.addEventListener('input', (e) => {
        const nextValue = e.target.value;
        const nextCaret = e.target.selectionStart;
        state.workersSearch = nextValue;
        renderWorkersList(true, nextCaret);
    });
    searchWrap.appendChild(searchInput);

    const filters = document.createElement('div');
    filters.className = 'workers-filters';
    ['all', 'assigned', 'unassigned'].forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'filter-chip' + (state.workersFilter === key ? ' active' : '');
        btn.textContent = key === 'all' ? 'All' : (key === 'assigned' ? 'Assigned' : 'Unassigned');
        btn.addEventListener('click', () => {
            state.workersFilter = key;
            renderWorkersList();
        });
        filters.appendChild(btn);
    });

    controls.appendChild(filters);
    controls.appendChild(searchWrap);
    toolbar.appendChild(info);
    toolbar.appendChild(controls);
    container.appendChild(toolbar);

    if (keepSearchFocus) {
        setTimeout(() => {
            searchInput.focus();
            if (typeof caretPos === 'number') {
                searchInput.setSelectionRange(caretPos, caretPos);
            }
        }, 0);
    }

    let filteredWorkers = [...visibleWorkers];
    if (state.workersFilter === 'assigned') {
        filteredWorkers = filteredWorkers.filter(w => !!w.assignedMachine);
    } else if (state.workersFilter === 'unassigned') {
        filteredWorkers = filteredWorkers.filter(w => !w.assignedMachine);
    }
    const query = (state.workersSearch || '').trim().toLowerCase();
    if (query) {
        filteredWorkers = filteredWorkers.filter(w => {
            const hay = `${w.name || ''} ${w.role || ''}`.toLowerCase();
            return hay.includes(query);
        });
    }

    if (!filteredWorkers || filteredWorkers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = query || state.workersFilter !== 'all'
            ? 'No workers match the current filters.'
            : 'No workers scheduled for the current shift.';
        container.appendChild(empty);
        return;
    }

    filteredWorkers.forEach(worker => {
        const item = createWorkerListItem(worker);
        container.appendChild(item);
    });
}

function createWorkerListItem(worker) {
    const item = document.createElement('div');
    item.className = 'worker-list-item';
    
    // Header
    const header = document.createElement('div');
    header.className = 'worker-list-header';

    const main = document.createElement('div');
    main.className = 'worker-list-main';

    const avatar = document.createElement('div');
    avatar.className = 'worker-avatar';
    avatar.textContent = getWorkerInitials(worker.name);
    avatar.style.background = getAvatarColor(worker.name || worker.id);
    avatar.title = 'Copy name';
    avatar.addEventListener('click', (e) => {
        e.stopPropagation();
        copyWorkerName(worker.name);
    });
    
    const info = document.createElement('div');
    info.className = 'worker-list-info';
    
    const nameRow = document.createElement('div');
    nameRow.className = 'worker-list-name-row';

    const name = document.createElement('div');
    name.className = 'worker-list-name';
    name.textContent = worker.name;

    const chips = document.createElement('div');
    chips.className = 'worker-chips';

    const shiftChip = document.createElement('span');
    const shiftLabel = getShiftLabelForWorker(worker);
    shiftChip.className = 'worker-chip shift' + (shiftLabel === 'Off' ? ' off' : '');
    shiftChip.textContent = shiftLabel;

    const statusChip = document.createElement('span');
    const isAssigned = !!worker.assignedMachine;
    statusChip.className = 'worker-chip status ' + (isAssigned ? 'assigned' : 'unassigned');
    statusChip.textContent = isAssigned ? 'Assigned' : 'Unassigned';

    chips.appendChild(shiftChip);
    chips.appendChild(statusChip);

    nameRow.appendChild(name);
    nameRow.appendChild(chips);

    const roleRow = document.createElement('div');
    roleRow.className = 'worker-list-role-row';
    roleRow.innerHTML = '<span class="worker-role-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 4-7 8-7s8 3 8 7"></path></svg></span>';

    const role = document.createElement('div');
    role.className = 'worker-list-role';
    role.textContent = worker.role || 'Worker';

    roleRow.appendChild(role);

    info.appendChild(nameRow);
    info.appendChild(roleRow);
    
    const expandIcon = document.createElement('div');
    expandIcon.className = 'expand-icon';
    expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    main.appendChild(avatar);
    main.appendChild(info);

    header.appendChild(main);
    header.appendChild(expandIcon);
    
    // Details
    const details = document.createElement('div');
    details.className = 'worker-list-details';
    
    const assignment = document.createElement('div');
    assignment.className = 'worker-assignment';

    if (worker.assignedMachine) {
        const machine = getMachineById(worker.assignedMachine);
        assignment.innerHTML = `<span class="worker-detail-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18v10H3z"></path><path d="M7 7V5h10v2"></path><path d="M7 17v2h10v-2"></path></svg></span><strong>Assigned to:</strong> ${machine ? machine.name : 'Unknown'}`;
    } else {
        assignment.innerHTML = '<span class="worker-detail-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg></span><strong>Status:</strong> Unassigned';
    }
    
    const actions = document.createElement('div');
    actions.className = 'worker-actions';
    
    const assignBtn = document.createElement('button');
    assignBtn.className = 'worker-btn worker-btn-primary';
    assignBtn.innerHTML = `<span class="worker-btn-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg></span>${worker.assignedMachine ? 'Reassign' : 'Assign'}`;
    assignBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        assignWorker(worker.id);
    });

    const focusBtn = document.createElement('button');
    focusBtn.className = 'worker-btn worker-btn-secondary';
    focusBtn.innerHTML = '<span class="worker-btn-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M22 12h-4"></path><path d="M6 12H2"></path><path d="M12 2v4"></path><path d="M12 22v-4"></path></svg></span>Locate';
    focusBtn.disabled = !worker.assignedMachine;
    focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (worker.assignedMachine) focusMachineMarker(worker.assignedMachine);
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'worker-btn worker-btn-ghost';
    copyBtn.innerHTML = '<span class="worker-btn-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><rect x="2" y="2" width="13" height="13" rx="2"></rect></svg></span>Copy';
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyWorkerName(worker.name);
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'worker-btn worker-btn-danger';
    deleteBtn.innerHTML = '<span class="worker-btn-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path></svg></span>Remove';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteWorker(worker.id);
    });
    
    actions.appendChild(assignBtn);
    actions.appendChild(focusBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);
    
    details.appendChild(assignment);
    details.appendChild(actions);
    
    item.appendChild(header);
    item.appendChild(details);
    
    // Toggle expand
    header.addEventListener('click', () => {
        details.classList.toggle('expanded');
        expandIcon.classList.toggle('expanded');
    });
    
    return item;
}

// ============================================================================
// MACHINE DRAG AND DROP
// ============================================================================

let dragState = {
    isDragging: false,
    element: null,
    startX: 0,
    startY: 0,
    type: null
};

function handleMachineMouseDown(e) {
    if (!state.isEditMode || e.button !== 0) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    dragState.isDragging = true;
    dragState.element = e.currentTarget;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.type = 'machine';
    
    dragState.element.classList.add('dragging');
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

function handleTagMouseDown(e) {
    if (!state.isEditMode || e.button !== 0) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    dragState.isDragging = true;
    dragState.element = e.currentTarget;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.type = 'tag';
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e) {
    if (!dragState.isDragging) return;
    
    const map = document.getElementById('factoryFloorMap');
    const rect = map.getBoundingClientRect();
    const scale = mapViewState.scale || 1;
    
    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    
    const id = dragState.element.dataset.id;
    
    if (dragState.type === 'machine') {
        const machine = getMachineById(id);
        if (!machine) return;
        
        const newX = machine.position.x + (deltaX / (mapViewState.baseWidth * scale)) * 100;
        const newY = machine.position.y + (deltaY / (mapViewState.baseHeight * scale)) * 100;
        
        machine.position.x = Math.max(0, Math.min(100, newX));
        machine.position.y = Math.max(0, Math.min(100, newY));
        
        dragState.element.style.left = machine.position.x + '%';
        dragState.element.style.top = machine.position.y + '%';
    } else if (dragState.type === 'tag') {
        const tag = state.tags.find(t => t.id === id);
        if (!tag) return;
        
        const newX = tag.position.x + (deltaX / (mapViewState.baseWidth * scale)) * 100;
        const newY = tag.position.y + (deltaY / (mapViewState.baseHeight * scale)) * 100;
        
        tag.position.x = Math.max(0, Math.min(100, newX));
        tag.position.y = Math.max(0, Math.min(100, newY));
        
        dragState.element.style.left = tag.position.x + '%';
        dragState.element.style.top = tag.position.y + '%';
    }
    
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
}

function handleMouseUp() {
    if (dragState.element) {
        dragState.element.classList.remove('dragging');
    }
    
    dragState.isDragging = false;
    dragState.element = null;
    dragState.type = null;
    
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
}

// ============================================================================
// MACHINE MENU
// ============================================================================

let openMenuId = null;

function handleMachineClick(e) {
    if (dragState.isDragging) return;
    
    e.stopPropagation();
    
    const machineId = e.currentTarget.dataset.id;
    
    if (openMenuId === machineId) {
        closeMachineMenu();
    } else {
        closeMachineMenu();
        openMachineMenu(machineId);
    }
}

function openMachineMenu(machineId) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    const marker = document.querySelector(`.machine-marker[data-id="${machineId}"]`);
    if (!marker) return;
    
    marker.classList.add('menu-open');
    marker.querySelector('.machine-content').classList.add('pressed');
    
    const menu = document.createElement('div');
    menu.className = 'machine-menu';
    menu.dataset.machineId = machineId;
    
    // Status section
    const statusSection = document.createElement('div');
    statusSection.className = 'menu-section';
    
    const statusLabel = document.createElement('label');
    statusLabel.className = 'menu-label';
    statusLabel.textContent = 'Status';
    
    const statusButtons = document.createElement('div');
    statusButtons.className = 'status-buttons';
    
    ['running', 'idle', 'maintenance', 'offline'].forEach(status => {
        const btn = document.createElement('button');
        btn.className = 'status-btn ' + status;
        if (machine.status === status) {
            btn.classList.add('active');
        }
        btn.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        btn.addEventListener('click', () => updateMachineStatus(machineId, status));
        statusButtons.appendChild(btn);
    });
    
    statusSection.appendChild(statusLabel);
    statusSection.appendChild(statusButtons);
    
    // Efficiency section
    const efficiencySection = document.createElement('div');
    efficiencySection.className = 'menu-section';
    
    const efficiencyLabel = document.createElement('label');
    efficiencyLabel.className = 'menu-label';
    efficiencyLabel.textContent = 'Efficiency (%)';
    
    const efficiencyInput = document.createElement('input');
    efficiencyInput.type = 'number';
    efficiencyInput.className = 'menu-input';
    efficiencyInput.value = machine.efficiency;
    efficiencyInput.min = 0;
    efficiencyInput.max = 100;
    efficiencyInput.addEventListener('change', (e) => {
        const value = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
        updateMachineEfficiency(machineId, value);
    });
    
    efficiencySection.appendChild(efficiencyLabel);
    efficiencySection.appendChild(efficiencyInput);
    
    // Assign worker section
    const workerSection = document.createElement('div');
    workerSection.className = 'menu-section';
    
    const workerLabel = document.createElement('label');
    workerLabel.className = 'menu-label';
    workerLabel.textContent = 'Assign Worker';
    
    const workerSelect = document.createElement('select');
    workerSelect.className = 'menu-select';
    workerSelect.multiple = true;
    workerSelect.size = 4;
    
    state.workers.forEach(worker => {
        const option = document.createElement('option');
        option.value = worker.id;
        option.textContent = `${worker.name} (${worker.role})`;
        option.selected = machine.workers.includes(worker.id);
        workerSelect.appendChild(option);
    });
    
    workerSelect.addEventListener('change', () => {
        const selectedWorkers = Array.from(workerSelect.selectedOptions).map(opt => opt.value);
        updateMachineWorkers(machineId, selectedWorkers);
    });
    
    workerSection.appendChild(workerLabel);
    workerSection.appendChild(workerSelect);
    
    // Delete button
    const deleteSection = document.createElement('div');
    deleteSection.className = 'menu-section';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete Machine';
    deleteBtn.addEventListener('click', () => deleteMachine(machineId));
    
    deleteSection.appendChild(deleteBtn);
    
    menu.appendChild(statusSection);
    menu.appendChild(efficiencySection);
    menu.appendChild(workerSection);
    menu.appendChild(deleteSection);
    
    marker.appendChild(menu);
    
    openMenuId = machineId;
}

function closeMachineMenu() {
    if (!openMenuId) return;
    
    const marker = document.querySelector(`.machine-marker[data-id="${openMenuId}"]`);
    if (marker) {
        marker.classList.remove('menu-open');
        const content = marker.querySelector('.machine-content');
        if (content) {
            content.classList.remove('pressed');
        }
        const menu = marker.querySelector('.machine-menu');
        if (menu) {
            menu.remove();
        }
    }
    
    openMenuId = null;
}

function updateMachineStatus(machineId, status) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    machine.status = status;
    
    // Update efficiency based on status
    if (status !== 'running') {
        machine.efficiency = 0;
    } else if (machine.efficiency === 0) {
        machine.efficiency = 75;
    }
    
    closeMachineMenu();
    renderMachines();
    renderMachinesList();
    updateStats();
}

function updateMachineEfficiency(machineId, efficiency) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    machine.efficiency = efficiency;
    renderMachinesList();
    updateStats();
}

function updateMachineWorkers(machineId, workerIds) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    // Update machine workers
    const oldWorkers = [...machine.workers];
    machine.workers = workerIds;
    
    // Update worker assignments
    oldWorkers.forEach(workerId => {
        if (!workerIds.includes(workerId)) {
            const worker = getWorkerById(workerId);
            if (worker && worker.assignedMachine === machineId) {
                worker.assignedMachine = null;
            }
        }
    });
    
    workerIds.forEach(workerId => {
        const worker = getWorkerById(workerId);
        if (worker) {
            worker.assignedMachine = machineId;
        }
    });
    
    renderMachines();
    renderMachinesList();
    renderWorkersList();
    updateStats();
}

function deleteMachine(machineId) {
    if (!confirm('Are you sure you want to delete this machine?')) return;
    
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    // Unassign workers
    machine.workers.forEach(workerId => {
        const worker = getWorkerById(workerId);
        if (worker) {
            worker.assignedMachine = null;
        }
    });
    
    state.machines = state.machines.filter(m => m.id !== machineId);
    
    closeMachineMenu();
    renderMachines();
    renderMachinesList();
    renderWorkersList();
    updateStats();
}

// ============================================================================
// TODO FUNCTIONS
// ============================================================================

function addMachineTodo(machineId) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    const text = prompt('Enter task description:');
    if (!text || !text.trim()) return;
    
    const todo = {
        id: generateId(),
        text: text.trim(),
        completed: false
    };
    
    machine.todos.push(todo);
    renderMachinesList();
}

function toggleTodo(machineId, todoId) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    const todo = machine.todos.find(t => t.id === todoId);
    if (!todo) return;
    
    todo.completed = !todo.completed;
    renderMachinesList();
}

function deleteTodo(machineId, todoId) {
    const machine = getMachineById(machineId);
    if (!machine) return;
    
    machine.todos = machine.todos.filter(t => t.id !== todoId);
    renderMachinesList();
}

// ============================================================================
// TAG FUNCTIONS
// ============================================================================

function editTag(tagId) {
    const tag = state.tags.find(t => t.id === tagId);
    if (!tag) return;
    
    const newText = prompt('Edit tag:', tag.text);
    if (newText !== null && newText.trim()) {
        tag.text = newText.trim();
        renderTags();
    }
}

function deleteTag(tagId) {
    if (!confirm('Delete this tag?')) return;
    
    state.tags = state.tags.filter(t => t.id !== tagId);
    renderTags();
}

// ============================================================================
// WORKER FUNCTIONS
// ============================================================================

function assignWorker(workerId) {
    const worker = getWorkerById(workerId);
    if (!worker) return;
    
    // Show modal with machine list
    const machineId = prompt(
        'Enter machine ID to assign (or leave empty to unassign):\n\n' +
        state.machines.map(m => `${m.id}: ${m.name}`).join('\n')
    );
    
    if (machineId === null) return;
    
    if (machineId.trim() === '') {
        // Unassign
        if (worker.assignedMachine) {
            const machine = getMachineById(worker.assignedMachine);
            if (machine) {
                machine.workers = machine.workers.filter(w => w !== workerId);
            }
        }
        worker.assignedMachine = null;
    } else {
        // Assign
        const machine = getMachineById(machineId.trim());
        if (!machine) {
            alert('Machine not found!');
            return;
        }
        
        // Remove from old machine
        if (worker.assignedMachine) {
            const oldMachine = getMachineById(worker.assignedMachine);
            if (oldMachine) {
                oldMachine.workers = oldMachine.workers.filter(w => w !== workerId);
            }
        }
        
        // Add to new machine
        if (!machine.workers.includes(workerId)) {
            machine.workers.push(workerId);
        }
        worker.assignedMachine = machineId.trim();
    }
    
    renderMachines();
    renderMachinesList();
    renderWorkersList();
    updateStats();
}

function deleteWorker(workerId) {
    if (!confirm('Are you sure you want to remove this worker?')) return;
    
    const worker = getWorkerById(workerId);
    if (!worker) return;
    
    // Remove from assigned machine
    if (worker.assignedMachine) {
        const machine = getMachineById(worker.assignedMachine);
        if (machine) {
            machine.workers = machine.workers.filter(w => w !== workerId);
        }
    }
    
    state.workers = state.workers.filter(w => w.id !== workerId);
    
    renderMachines();
    renderMachinesList();
    renderWorkersList();
    updateStats();
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function setupEventListeners() {
    // Edit mode toggle
    document.getElementById('editModeToggle').addEventListener('click', () => {
        state.isEditMode = !state.isEditMode;
        
        const toggle = document.getElementById('editModeToggle');
        const icon = document.getElementById('editIcon');
        const text = document.getElementById('editModeText');
        
        if (state.isEditMode) {
            toggle.classList.add('pressed');
            icon.classList.add('active');
            text.classList.add('active');
            text.textContent = 'ON';
        } else {
            toggle.classList.remove('pressed');
            icon.classList.remove('active');
            text.classList.remove('active');
            text.textContent = 'OFF';
        }
        
        renderMachines();
        renderTags();
    });
    
    // Add machine
    const addMachineBtn = document.getElementById('addMachineBtn');
    const addMachineForm = document.getElementById('addMachineForm');
    const addMachineCard = document.getElementById('addMachineCard');
    const machineBrandSelect = document.getElementById('machineBrand');
    const machineModelSelect = document.getElementById('machineModel');

    // brands -> models mapping
    const brandModels = {
        jsw: ['JSW-1'],
        bmb: ['BMB-H1']
    };

    // populate model select based on brand
    function populateModelsForBrand(brand) {
        const models = brandModels[brand] || [];
        machineModelSelect.innerHTML = '';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            machineModelSelect.appendChild(opt);
        });
    }
    
    addMachineBtn.addEventListener('click', () => {
        addMachineBtn.style.display = 'none';
        addMachineForm.style.display = 'flex';
        addMachineCard.classList.add('pressed');
    });
    
    machineBrandSelect.addEventListener('change', () => {
        populateModelsForBrand(machineBrandSelect.value);
    });
    // initial populate
    populateModelsForBrand(machineBrandSelect.value);
    
    document.getElementById('addMachineConfirm').addEventListener('click', () => {
        const name = document.getElementById('machineName').value.trim();
        const brand = machineBrandSelect.value;
        let type = machineModelSelect.value;
        
        if (!name) {
            alert('Please enter a machine name');
            return;
        }
        
        const iconPath = `assets/icons/machine-icons/${brand}-icon-e.png`;

        const newMachine = {
            id: generateId(),
            name: name,
            type: type,
            brand: brand,
            icon: iconPath,
            status: 'idle',
            position: { x: 50, y: 50 },
            workers: [],
            efficiency: 0,
            lastMaintenance: new Date().toISOString().split('T')[0],
            todos: []
        };
        
        state.machines.push(newMachine);
        
        document.getElementById('machineName').value = '';
        // reset brand/model selects to defaults
        machineBrandSelect.value = Object.keys(brandModels)[0] || 'jsw';
        populateModelsForBrand(machineBrandSelect.value);
        machineModelSelect.selectedIndex = 0;
        addMachineBtn.style.display = 'flex';
        addMachineForm.style.display = 'none';
        addMachineCard.classList.remove('pressed');
        
        renderMachines();
        renderMachinesList();
        updateStats();
    });
    
    document.getElementById('addMachineCancel').addEventListener('click', () => {
        document.getElementById('machineName').value = '';
        machineBrandSelect.value = Object.keys(brandModels)[0] || 'jsw';
        populateModelsForBrand(machineBrandSelect.value);
        machineModelSelect.selectedIndex = 0;
        addMachineBtn.style.display = 'flex';
        addMachineForm.style.display = 'none';
        addMachineCard.classList.remove('pressed');
    });
    
    // Add tag
    document.getElementById('addTagBtn').addEventListener('click', () => {
        state.isAddingTag = !state.isAddingTag;
        const btn = document.getElementById('addTagBtn');
        const text = document.getElementById('addTagText');
        
        if (state.isAddingTag) {
            btn.classList.add('active');
            text.textContent = 'Click to Place Tag';
        } else {
            btn.classList.remove('active');
            text.textContent = 'Add Tag';
        }
    });
    
    // Map click for adding tags
    document.getElementById('factoryFloorMap').addEventListener('click', (e) => {
        if (!state.isAddingTag) return;
        
        const map = document.getElementById('factoryFloorMap');
        const rect = map.getBoundingClientRect();
        const scale = mapViewState.scale || 1;
        const localX = (e.clientX - rect.left - mapViewState.x) / scale;
        const localY = (e.clientY - rect.top - mapViewState.y) / scale;
        const x = Math.max(0, Math.min(100, (localX / mapViewState.baseWidth) * 100));
        const y = Math.max(0, Math.min(100, (localY / mapViewState.baseHeight) * 100));
        
        const newTag = {
            id: generateId(),
            position: { x, y },
            text: 'New Tag'
        };
        
        state.tags.push(newTag);
        state.isAddingTag = false;
        
        const btn = document.getElementById('addTagBtn');
        const text = document.getElementById('addTagText');
        btn.classList.remove('active');
        text.textContent = 'Add Tag';
        
        renderTags();
    });
    
    // Add worker
    document.getElementById('addWorkerBtn').addEventListener('click', () => {
        const name = prompt('Enter worker name:');
        if (!name || !name.trim()) return;
        
        const role = prompt('Enter role:\n- Operator\n- Technician\n- Chief Operator\n- Electrician\n- Maintenance\n- Quality Inspector\n- Custom (enter your own)');
        if (!role || !role.trim()) return;
        
        const newWorker = {
            id: generateId(),
            name: name.trim(),
            role: role.trim(),
            assignedMachine: null
        };
        
        state.workers.push(newWorker);
        renderWorkersList();
        updateStats();
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.machine-marker') && !e.target.closest('.machine-menu')) {
            closeMachineMenu();
        }
    });

    // Schedule loader controls (date range)
    const scheduleLoadBtn = document.getElementById('loadScheduleBtn');
    const scheduleStart = document.getElementById('scheduleStart');
    const scheduleEnd = document.getElementById('scheduleEnd');
    const scheduleToggleBtn = document.getElementById('scheduleToggleBtn');
    const schedulePanel = document.getElementById('schedulePanel');
    const scheduleIcon = document.getElementById('scheduleIcon');
    if (scheduleToggleBtn && schedulePanel) {
        if (scheduleLoadBtn) {
            scheduleLoadBtn.style.display = (schedulePanel.style.display !== 'none') ? 'inline-flex' : 'none';
        }
        scheduleToggleBtn.addEventListener('click', () => {
            const open = schedulePanel.style.display !== 'none';
            if (open) {
                schedulePanel.style.display = 'none';
                scheduleToggleBtn.setAttribute('aria-expanded', 'false');
                if (scheduleIcon) scheduleIcon.querySelectorAll('*').forEach(el=>el.setAttribute('stroke','#3b82f6'));
                if (scheduleLoadBtn) scheduleLoadBtn.style.display = 'none';
            } else {
                schedulePanel.style.display = 'block';
                scheduleToggleBtn.setAttribute('aria-expanded', 'true');
                if (scheduleIcon) scheduleIcon.querySelectorAll('*').forEach(el=>el.setAttribute('stroke','#fb923c'));
                if (scheduleLoadBtn) scheduleLoadBtn.style.display = 'inline-flex';
            }
        });
    }
    if (scheduleLoadBtn && scheduleStart && scheduleEnd) {
        scheduleLoadBtn.addEventListener('click', async () => {
            const s = scheduleStart.value;
            const e = scheduleEnd.value;
            if (!s || !e) {
                alert('Please select both start and end dates');
                return;
            }
            scheduleLoadBtn.disabled = true;
            try {
                await fetchSchedulesRangeAndRender(s, e);
            } catch (err) {
                console.error('Failed to load schedules', err);
                alert('Failed to load schedules: ' + (err.message || err));
            } finally {
                scheduleLoadBtn.disabled = false;
            }
        });
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
    renderRooms();
    renderMachines();
    renderTags();
    renderMachinesList();
    renderWorkersList();
    updateStats();
    updateShiftProgress();
    initMapInteractions();
    loadWorkersFromFirestore();
    // Load shift info from Firestore and refresh periodically
    try {
        loadCurrentShiftFromFirestore();
        setInterval(loadCurrentShiftFromFirestore, 5 * 60 * 1000);
    } catch (err) {
        console.error('Error loading shift from Firestore', err);
    }
    setupEventListeners();
    // Initialize schedule inputs to a 7-day range and load
    try {
        const startEl = document.getElementById('scheduleStart');
        const endEl = document.getElementById('scheduleEnd');
        if (startEl && endEl) {
            const today = new Date();
            const toISODate = d => d.toISOString().split('T')[0];
            startEl.value = toISODate(today);
            const endDate = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
            endEl.value = toISODate(endDate);
            fetchSchedulesRangeAndRender(startEl.value, endEl.value).catch(() => {});
        }
    } catch (e) {
        console.error('Error initializing schedule range', e);
    }
    
    // Update shift progress every second (real-time countdown)
    setInterval(updateShiftProgress, 1000);

    // Demo overlay once after load so it is visible for testing
    setTimeout(() => {
        if (state.shiftOverlayDemoShown) return;
        if (isShiftOverlayActive()) return;
        state.shiftOverlayDemoShown = true;
        const demoName = state.currentShiftName || 'Shift Starting';
        triggerShiftTransitionOverlay(demoName, 12 * 1000);
    }, 1800);
}

// Start the app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
