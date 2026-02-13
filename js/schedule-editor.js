import { db, doc, setDoc, updateDoc, deleteField, fetchAllWorkers, fetchWorkerSchedulesByWeekStarts } from './firabase.js';

const ROTATION_ORDER = ['morning', 'night', 'afternoon'];
const ANCHOR_DATE = '2026-01-18';
const SHIFT_DEFS = {
  morning: { start: '07:30', end: '19:30', duration: 12, overtime: 4 },
  night: { start: '19:30', end: '07:30', duration: 12, overtime: 4 },
  afternoon: { start: '15:30', end: '23:30', duration: 8, overtime: 0 }
};

const state = {
  workers: [],
  scheduleMap: {},
  weekStartStr: '',
  weekDates: [],
  selected: null,
  selectedCells: [],
  filter: '',
  sortBy: 'name',
  shiftFilter: 'all'
};

const elements = {
  plannerGrid: document.getElementById('plannerGrid'),
  weekPicker: document.getElementById('weekPicker'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn'),
  loadWeekBtn: document.getElementById('loadWeekBtn'),
  workerSearch: document.getElementById('workerSearch'),
  plannerStatus: document.getElementById('plannerStatus'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  sortBy: document.getElementById('sortBy'),
  shiftFilter: document.getElementById('shiftFilter'),
  selectionCount: document.getElementById('selectionCount'),
  clearSelectionBtn: document.getElementById('clearSelectionBtn'),
  detailsPanel: document.getElementById('detailsPanel'),
  detailWorker: document.getElementById('detailWorker'),
  detailDate: document.getElementById('detailDate'),
  editScope: document.getElementById('editScope'),
  detailStatus: document.getElementById('detailStatus'),
  detailShift: document.getElementById('detailShift'),
  detailStart: document.getElementById('detailStart'),
  detailEnd: document.getElementById('detailEnd'),
  detailDuration: document.getElementById('detailDuration'),
  detailOvertime: document.getElementById('detailOvertime'),
  detailNotes: document.getElementById('detailNotes'),
  closeDetails: document.getElementById('closeDetails'),
  saveDetailsBtn: document.getElementById('saveDetailsBtn'),
  resetOverrideBtn: document.getElementById('resetOverrideBtn')
};

function showLoading(show) {
  elements.loadingOverlay.classList.toggle('show', show);
  elements.loadingOverlay.setAttribute('aria-hidden', (!show).toString());
}

function setStatus(text) {
  elements.plannerStatus.textContent = text;
}

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

function computeAssignedShift(initialShift, weekStartDate) {
  const anchor = getWeekStartSunday(parseDate(ANCHOR_DATE));
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

function buildBaseDay(worker, dateStr, weekStartDate) {
  const data = worker.data || {};
  const initialShift = data.initialShift || data.currentShift || 'morning';
  const rotationEnabled = data.rotationEnabled !== false;
  const assignedShift = rotationEnabled ? computeAssignedShift(initialShift, weekStartDate) : initialShift;
  return buildDayEntry(dateStr, assignedShift);
}

function buildDayForWorker(worker, scheduleDays, dateStr, weekStartDate) {
  const base = (scheduleDays && scheduleDays[dateStr]) ? scheduleDays[dateStr] : buildBaseDay(worker, dateStr, weekStartDate);
  const overrides = (worker.data && worker.data.manualOverrides) || {};
  return mergeOverride(base, overrides[dateStr]);
}

function getWorkerWeekShift(worker, weekStartDate) {
  const data = worker.data || {};
  const initialShift = data.initialShift || data.currentShift || 'morning';
  const rotationEnabled = data.rotationEnabled !== false;
  return rotationEnabled ? computeAssignedShift(initialShift, weekStartDate) : initialShift;
}

function formatDayLabel(dateStr) {
  const date = parseDate(dateStr);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { weekday, dayNum };
}

function normalizeShift(shift) {
  const value = (shift || '').toLowerCase();
  if (value === 'morning' || value === 'afternoon' || value === 'night') return value;
  return value ? 'custom' : 'custom';
}

function buildWeekDates(weekStartStr) {
  const weekStart = parseDate(weekStartStr);
  return Array.from({ length: 7 }, (_, idx) => formatDate(addDays(weekStart, idx)));
}

function renderGrid() {
  const grid = elements.plannerGrid;
  grid.innerHTML = '';

  const headerEmpty = document.createElement('div');
  headerEmpty.className = 'grid-header';
  headerEmpty.textContent = 'Worker';
  grid.appendChild(headerEmpty);

  state.weekDates.forEach((dateStr, index) => {
    const header = document.createElement('div');
    header.className = 'grid-header';
    header.dataset.colIndex = String(index + 1);
    const { weekday, dayNum } = formatDayLabel(dateStr);
    header.innerHTML = `${weekday}<br><small>${dayNum}</small>`;
    const day = parseDate(dateStr).getDay();
    if (day === 0 || day === 6) header.classList.add('is-weekend');
    grid.appendChild(header);
  });

  const weekStartDate = parseDate(state.weekStartStr);
  const filteredWorkers = state.workers.filter(worker => {
    const name = (worker.data && worker.data.name) || worker.id;
    if (state.filter && !name.toLowerCase().includes(state.filter)) return false;
    if (state.shiftFilter !== 'all') {
      const weekShift = getWorkerWeekShift(worker, weekStartDate);
      if ((weekShift || '').toLowerCase() !== state.shiftFilter) return false;
    }
    return true;
  });

  const sortedWorkers = filteredWorkers.slice().sort((a, b) => {
    if (state.sortBy === 'shift') {
      const shiftA = getWorkerWeekShift(a, weekStartDate);
      const shiftB = getWorkerWeekShift(b, weekStartDate);
      const order = { morning: 1, afternoon: 2, night: 3 };
      const rankA = order[(shiftA || '').toLowerCase()] || 9;
      const rankB = order[(shiftB || '').toLowerCase()] || 9;
      if (rankA !== rankB) return rankA - rankB;
    }
    const nameA = (a.data && a.data.name) || a.id;
    const nameB = (b.data && b.data.name) || b.id;
    return nameA.localeCompare(nameB);
  });

  if (sortedWorkers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state-grid';
    empty.textContent = 'No workers match the current filters.';
    grid.appendChild(empty);
    updateSelectionUI();
    return;
  }

  sortedWorkers.forEach(worker => {
    const rowLabel = document.createElement('div');
    rowLabel.className = 'grid-worker';
    rowLabel.textContent = (worker.data && worker.data.name) || worker.id;
    rowLabel.dataset.workerId = worker.id;
    grid.appendChild(rowLabel);

    state.weekDates.forEach((dateStr, colIndex) => {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.workerId = worker.id;
      cell.dataset.dateStr = dateStr;
      cell.dataset.colIndex = String(colIndex + 1);
      const day = parseDate(dateStr).getDay();
      if (day === 0 || day === 6) cell.classList.add('is-weekend');

      const dayData = (state.scheduleMap[worker.id] && state.scheduleMap[worker.id][dateStr]) || {};
      const status = (dayData.status || '').toLowerCase();

      if (status === 'off') {
        const badge = document.createElement('div');
        badge.className = 'cell-badge badge-off';
        badge.textContent = 'OFF';
        cell.appendChild(badge);
      } else if (dayData.shift || dayData.start || dayData.end) {
        const shiftKey = normalizeShift(dayData.shift);
        const badge = document.createElement('div');
        badge.className = `cell-badge badge-${shiftKey}`;
        const label = shiftKey === 'custom' ? 'Custom' : shiftKey.charAt(0).toUpperCase() + shiftKey.slice(1);
        const timeText = dayData.start && dayData.end ? `${dayData.start} — ${dayData.end}` : 'Time TBD';
        const meta = [];
        if (typeof dayData.duration === 'number') meta.push(`${dayData.duration}h`);
        if (typeof dayData.overtime === 'number' && dayData.overtime > 0) meta.push(`+${dayData.overtime}h OT`);

        badge.innerHTML = `${label}<span class="cell-meta">${timeText}${meta.length ? ` • ${meta.join(' ')}` : ''}</span>`;
        cell.appendChild(badge);
      } else {
        cell.textContent = '—';
      }

      cell.addEventListener('click', (event) => handleCellClick(event, worker.id, dateStr, cell));
      cell.addEventListener('mouseenter', () => highlightRowAndColumn(worker.id, colIndex + 1, true));
      cell.addEventListener('mouseleave', () => highlightRowAndColumn(worker.id, colIndex + 1, false));
      grid.appendChild(cell);
    });
  });
}

function highlightRowAndColumn(workerId, colIndex, on) {
  const rowCells = document.querySelectorAll(`.grid-cell[data-worker-id="${workerId}"]`);
  rowCells.forEach(cell => cell.classList.toggle('row-highlight', on));
  const rowLabel = document.querySelector(`.grid-worker[data-worker-id="${workerId}"]`);
  if (rowLabel) rowLabel.classList.toggle('row-highlight', on);

  const colCells = document.querySelectorAll(`.grid-cell[data-col-index="${colIndex}"]`);
  colCells.forEach(cell => cell.classList.toggle('col-highlight', on));
  const colHeader = document.querySelector(`.grid-header[data-col-index="${colIndex}"]`);
  if (colHeader) colHeader.classList.toggle('col-highlight', on);
}

function updateSelectionUI() {
  const count = state.selectedCells.length;
  if (count === 0) {
    elements.selectionCount.textContent = 'No cells selected';
    if (elements.editScope) elements.editScope.textContent = 'Editing 1 day';
  } else if (count === 1) {
    elements.selectionCount.textContent = '1 cell selected';
    if (elements.editScope) elements.editScope.textContent = 'Editing 1 day';
  } else {
    elements.selectionCount.textContent = `${count} cells selected`;
    if (elements.editScope) elements.editScope.textContent = `Editing ${count} days`;
  }
}

function clearSelection() {
  state.selectedCells = [];
  document.querySelectorAll('.grid-cell.selected').forEach(cell => cell.classList.remove('selected'));
  updateSelectionUI();
}

function toggleCellSelection(cell, workerId, dateStr) {
  const key = `${workerId}__${dateStr}`;
  const idx = state.selectedCells.findIndex(item => item.key === key);
  if (idx >= 0) {
    state.selectedCells.splice(idx, 1);
    cell.classList.remove('selected');
  } else {
    state.selectedCells.push({ key, workerId, dateStr });
    cell.classList.add('selected');
  }
  updateSelectionUI();
}

function handleCellClick(event, workerId, dateStr, cell) {
  const multi = event.ctrlKey || event.metaKey || event.shiftKey;
  if (!multi) {
    clearSelection();
  }
  toggleCellSelection(cell, workerId, dateStr);
  openDetails(workerId, dateStr);
}

function openDetails(workerId, dateStr) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;
  const dayData = (state.scheduleMap[workerId] && state.scheduleMap[workerId][dateStr]) || {};

  state.selected = { workerId, dateStr };
  elements.detailWorker.textContent = (worker.data && worker.data.name) || workerId;
  elements.detailDate.textContent = dateStr;

  const status = (dayData.status || 'scheduled').toLowerCase();
  elements.detailStatus.value = status === 'off' ? 'off' : 'scheduled';

  const shiftKey = normalizeShift(dayData.shift || worker.data?.currentShift || 'morning');
  elements.detailShift.value = shiftKey === 'custom' ? 'custom' : shiftKey;

  elements.detailStart.value = dayData.start || '';
  elements.detailEnd.value = dayData.end || '';
  elements.detailDuration.value = typeof dayData.duration === 'number' ? dayData.duration : '';
  elements.detailOvertime.value = typeof dayData.overtime === 'number' ? dayData.overtime : '';
  elements.detailNotes.value = dayData.notes || '';

  toggleDetailFields(status === 'off');
  elements.detailsPanel.classList.add('open');
  elements.detailsPanel.setAttribute('aria-hidden', 'false');
  updateSelectionUI();
}

function closeDetails() {
  elements.detailsPanel.classList.remove('open');
  elements.detailsPanel.setAttribute('aria-hidden', 'true');
  state.selected = null;
}

function toggleDetailFields(isOff) {
  elements.detailShift.disabled = isOff;
  elements.detailStart.disabled = isOff;
  elements.detailEnd.disabled = isOff;
  elements.detailDuration.disabled = isOff;
  elements.detailOvertime.disabled = isOff;
}

function cleanOverride(override) {
  const cleaned = {};
  Object.entries(override).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    cleaned[key] = value;
  });
  return cleaned;
}

async function saveDetails() {
  if (!state.selected) return;
  const targets = state.selectedCells.length > 0 ? state.selectedCells : [state.selected];

  const status = elements.detailStatus.value;
  const shiftValue = elements.detailShift.value;

  setStatus('Saving...');
  try {
    const batchUpdates = [];
    const weekStartDate = parseDate(state.weekStartStr);
    for (const target of targets) {
      const { workerId, dateStr } = target;
      const worker = state.workers.find(w => w.id === workerId);
      if (!worker) continue;

      let override = {};
      if (status === 'off') {
        override = { status: 'off' };
      } else {
        override = {
          status: 'scheduled',
          shift: shiftValue === 'custom' ? 'custom' : shiftValue,
          start: elements.detailStart.value || undefined,
          end: elements.detailEnd.value || undefined,
          duration: elements.detailDuration.value ? Number(elements.detailDuration.value) : undefined,
          overtime: elements.detailOvertime.value ? Number(elements.detailOvertime.value) : undefined,
          notes: elements.detailNotes.value || undefined
        };
      }

      override = cleanOverride(override);
      const baseDay = buildBaseDay(worker, dateStr, weekStartDate);
      const mergedDay = mergeOverride(baseDay, override);

      state.scheduleMap[workerId] = state.scheduleMap[workerId] || {};
      state.scheduleMap[workerId][dateStr] = mergedDay;

      const workerRef = doc(db, 'workers', workerId);
      batchUpdates.push(updateDoc(workerRef, {
        [`manualOverrides.${dateStr}`]: override
      }));

      const scheduleDocId = `${workerId}_${state.weekStartStr}`;
      const scheduleRef = doc(db, 'workerSchedules', scheduleDocId);
      batchUpdates.push(setDoc(scheduleRef, {
        workerId,
        weekStart: state.weekStartStr,
        days: {
          [dateStr]: mergedDay
        }
      }, { merge: true }));
    }

    await Promise.all(batchUpdates);

    setStatus('Saved');
    renderGrid();
    clearSelection();
    closeDetails();
  } catch (err) {
    console.error('Failed to save schedule', err);
    setStatus('Save failed');
  }
}

async function resetOverride() {
  if (!state.selected) return;
  const targets = state.selectedCells.length > 0 ? state.selectedCells : [state.selected];

  setStatus('Resetting...');
  try {
    const batchUpdates = [];
    const weekStartDate = parseDate(state.weekStartStr);
    for (const target of targets) {
      const { workerId, dateStr } = target;
      const worker = state.workers.find(w => w.id === workerId);
      if (!worker) continue;
      const baseDay = buildBaseDay(worker, dateStr, weekStartDate);

      state.scheduleMap[workerId] = state.scheduleMap[workerId] || {};
      state.scheduleMap[workerId][dateStr] = baseDay;

      const workerRef = doc(db, 'workers', workerId);
      batchUpdates.push(updateDoc(workerRef, {
        [`manualOverrides.${dateStr}`]: deleteField()
      }));

      const scheduleDocId = `${workerId}_${state.weekStartStr}`;
      const scheduleRef = doc(db, 'workerSchedules', scheduleDocId);
      batchUpdates.push(setDoc(scheduleRef, {
        workerId,
        weekStart: state.weekStartStr,
        days: {
          [dateStr]: baseDay
        }
      }, { merge: true }));
    }

    await Promise.all(batchUpdates);

    setStatus('Reset');
    renderGrid();
    clearSelection();
    closeDetails();
  } catch (err) {
    console.error('Failed to reset override', err);
    setStatus('Reset failed');
  }
}

async function loadWeek(weekStartStr) {
  if (!weekStartStr) return;
  showLoading(true);
  setStatus('Loading...');
  try {
    const weekStartDate = parseDate(weekStartStr);
    state.weekStartStr = formatDate(getWeekStartSunday(weekStartDate));
    state.weekDates = buildWeekDates(state.weekStartStr);

    const [workers, scheduleDocs] = await Promise.all([
      fetchAllWorkers(),
      fetchWorkerSchedulesByWeekStarts([state.weekStartStr])
    ]);

    state.workers = workers || [];

    const scheduleByWorker = {};
    (scheduleDocs || []).forEach(docData => {
      const data = docData.data || {};
      if (!data.workerId) return;
      scheduleByWorker[data.workerId] = data.days || {};
    });

    state.scheduleMap = {};
    state.workers.forEach(worker => {
      state.scheduleMap[worker.id] = {};
      state.weekDates.forEach(dateStr => {
        const day = buildDayForWorker(worker, scheduleByWorker[worker.id], dateStr, parseDate(state.weekStartStr));
        state.scheduleMap[worker.id][dateStr] = day;
      });
    });

    elements.weekPicker.value = state.weekStartStr;
    renderGrid();
    setStatus('Loaded');
  } catch (err) {
    console.error('Failed to load week', err);
    setStatus('Load failed');
  } finally {
    showLoading(false);
  }
}

function handleShiftChange() {
  if (elements.detailStatus.value === 'off') return;
  const shiftKey = elements.detailShift.value;
  if (!SHIFT_DEFS[shiftKey]) return;
  const def = SHIFT_DEFS[shiftKey];
  elements.detailStart.value = def.start;
  elements.detailEnd.value = def.end;
  elements.detailDuration.value = def.duration;
  elements.detailOvertime.value = def.overtime;
}

function init() {
  const today = new Date();
  const weekStart = getWeekStartSunday(today);
  elements.weekPicker.value = formatDate(weekStart);
  loadWeek(formatDate(weekStart));

  elements.prevWeekBtn.addEventListener('click', () => {
    const current = parseDate(elements.weekPicker.value || formatDate(weekStart));
    const prev = addDays(current, -7);
    loadWeek(formatDate(prev));
  });

  elements.nextWeekBtn.addEventListener('click', () => {
    const current = parseDate(elements.weekPicker.value || formatDate(weekStart));
    const next = addDays(current, 7);
    loadWeek(formatDate(next));
  });

  elements.loadWeekBtn.addEventListener('click', () => {
    if (!elements.weekPicker.value) return;
    loadWeek(elements.weekPicker.value);
  });

  elements.workerSearch.addEventListener('input', (event) => {
    state.filter = event.target.value.toLowerCase();
    renderGrid();
  });

  elements.sortBy.addEventListener('change', (event) => {
    state.sortBy = event.target.value;
    renderGrid();
  });

  elements.shiftFilter.addEventListener('change', (event) => {
    state.shiftFilter = event.target.value;
    renderGrid();
  });

  elements.detailStatus.addEventListener('change', () => {
    toggleDetailFields(elements.detailStatus.value === 'off');
  });

  elements.detailShift.addEventListener('change', handleShiftChange);
  elements.closeDetails.addEventListener('click', closeDetails);
  elements.saveDetailsBtn.addEventListener('click', saveDetails);
  elements.resetOverrideBtn.addEventListener('click', resetOverride);
  elements.clearSelectionBtn.addEventListener('click', clearSelection);
}

init();
