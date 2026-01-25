// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let state = {
    machines: [
        {
            id: '1',
            name: 'IM-V-01',
            type: 'Injection Molding - Vertical',
            status: 'running',
            position: { x: 20, y: 20 },
            workers: ['worker-1'],
            efficiency: 87,
            lastMaintenance: '2026-01-20',
            todos: [
                { id: 't1', text: 'Check hydraulic pressure', completed: false },
                { id: 't2', text: 'Clean mold cavity', completed: true }
            ]
        },
        {
            id: '2',
            name: 'IM-H-02',
            type: 'Injection Molding - Horizontal',
            status: 'idle',
            position: { x: 45, y: 30 },
            workers: [],
            efficiency: 0,
            lastMaintenance: '2026-01-18',
            todos: []
        },
        {
            id: '3',
            name: 'IM-R-03',
            type: 'Injection Molding - Rotary',
            status: 'maintenance',
            position: { x: 70, y: 45 },
            workers: ['worker-2'],
            efficiency: 0,
            lastMaintenance: '2026-01-25',
            todos: [
                { id: 't3', text: 'Replace worn parts', completed: false },
                { id: 't4', text: 'Lubricate moving components', completed: false }
            ]
        },
        {
            id: '4',
            name: 'IM-MC-04',
            type: 'Injection Molding - Multi-Component',
            status: 'running',
            position: { x: 30, y: 65 },
            workers: ['worker-3'],
            efficiency: 92,
            lastMaintenance: '2026-01-22',
            todos: []
        },
        {
            id: '5',
            name: 'INS-01',
            type: 'Insert Molding Machine',
            status: 'running',
            position: { x: 60, y: 75 },
            workers: ['worker-4'],
            efficiency: 78,
            lastMaintenance: '2026-01-19',
            todos: [
                { id: 't5', text: 'Inspect insert placement', completed: false }
            ]
        }
    ],
    workers: [
        { id: 'worker-1', name: 'John Smith', role: 'Operator', assignedMachine: '1' },
        { id: 'worker-2', name: 'Maria Garcia', role: 'Technician', assignedMachine: '3' },
        { id: 'worker-3', name: 'Robert Chen', role: 'Chief Operator', assignedMachine: '4' },
        { id: 'worker-4', name: 'Sarah Johnson', role: 'Electrician', assignedMachine: '5' },
        { id: 'worker-5', name: 'Ahmed Hassan', role: 'Maintenance', assignedMachine: null },
        { id: 'worker-6', name: 'Lisa Anderson', role: 'Quality Inspector', assignedMachine: null }
    ],
    tags: [
        { id: 'tag-1', position: { x: 10, y: 10 }, text: 'Production Area' },
        { id: 'tag-2', position: { x: 85, y: 15 }, text: 'Storage' }
    ],
    isEditMode: false,
    isAddingTag: false,
    shiftStartTime: new Date().setHours(8, 0, 0, 0),
    shiftDurationHours: 8
};

// Room layout matching the floor plan image
const rooms = [
    { x: 4, y: 6, width: 14, height: 30 }, // Left top room
    { x: 4, y: 38, width: 20, height: 30 }, // Left bottom room
    { x: 22, y: 38, width: 16, height: 30 }, // Center bottom left room
    { x: 23, y: 6, width: 31, height: 30 }, // Center large room
    { x: 56, y: 6, width: 18, height: 18 }, // Right top room
    { x: 76, y: 6, width: 19, height: 30 }, // Right room
    { x: 76, y: 38, width: 7, height: 12 }, // Small right room 1
    { x: 85, y: 38, width: 10, height: 12 }, // Small right room 2
    { x: 4, y: 70, width: 91, height: 26 } // Bottom large room
];

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

function updateStats() {
    const runningMachines = state.machines.filter(m => m.status === 'running').length;
    const totalWorkers = state.workers.length;
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

function updateShiftProgress() {
    const now = Date.now();
    const elapsed = now - state.shiftStartTime;
    const shiftDurationMs = state.shiftDurationHours * 60 * 60 * 1000;
    const progress = Math.min((elapsed / shiftDurationMs) * 100, 100);
    
    const elapsedHours = Math.floor(elapsed / (60 * 60 * 1000));
    const elapsedMinutes = Math.floor((elapsed % (60 * 60 * 1000)) / (60 * 1000));
    
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('shiftTime').textContent = 
        `${elapsedHours}:${elapsedMinutes.toString().padStart(2, '0')} / ${state.shiftDurationHours}:00`;
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderRooms() {
    const container = document.getElementById('roomsContainer');
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
    const map = document.getElementById('factoryFloorMap');
    
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
    
    // Status icon
    const icon = document.createElement('div');
    icon.className = 'machine-status-icon';
    icon.innerHTML = getStatusIcon(machine.status);
    icon.style.color = getStatusColor(machine.status);
    
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
    const map = document.getElementById('factoryFloorMap');
    
    // Remove existing tags
    map.querySelectorAll('.tag-marker').forEach(el => el.remove());
    
    state.tags.forEach(tag => {
        const marker = createTagMarker(tag);
        map.appendChild(marker);
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

function renderWorkersList() {
    const container = document.getElementById('workersList');
    container.innerHTML = '';
    
    state.workers.forEach(worker => {
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
    
    const info = document.createElement('div');
    info.className = 'worker-list-info';
    
    const name = document.createElement('div');
    name.className = 'worker-list-name';
    name.textContent = worker.name;
    
    const role = document.createElement('div');
    role.className = 'worker-list-role';
    role.textContent = worker.role;
    
    info.appendChild(name);
    info.appendChild(role);
    
    const expandIcon = document.createElement('div');
    expandIcon.className = 'expand-icon';
    expandIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    
    header.appendChild(info);
    header.appendChild(expandIcon);
    
    // Details
    const details = document.createElement('div');
    details.className = 'worker-list-details';
    
    const assignment = document.createElement('div');
    assignment.className = 'worker-assignment';
    
    if (worker.assignedMachine) {
        const machine = getMachineById(worker.assignedMachine);
        assignment.innerHTML = `<strong>Assigned to:</strong> ${machine ? machine.name : 'Unknown'}`;
    } else {
        assignment.innerHTML = '<strong>Status:</strong> Unassigned';
    }
    
    const actions = document.createElement('div');
    actions.className = 'worker-actions';
    
    const assignBtn = document.createElement('button');
    assignBtn.className = 'worker-btn worker-btn-primary';
    assignBtn.textContent = worker.assignedMachine ? 'Reassign' : 'Assign';
    assignBtn.addEventListener('click', () => assignWorker(worker.id));
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'worker-btn worker-btn-danger';
    deleteBtn.textContent = 'Remove';
    deleteBtn.addEventListener('click', () => deleteWorker(worker.id));
    
    actions.appendChild(assignBtn);
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
    
    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;
    
    const id = dragState.element.dataset.id;
    
    if (dragState.type === 'machine') {
        const machine = getMachineById(id);
        if (!machine) return;
        
        const newX = machine.position.x + (deltaX / rect.width) * 100;
        const newY = machine.position.y + (deltaY / rect.height) * 100;
        
        machine.position.x = Math.max(0, Math.min(100, newX));
        machine.position.y = Math.max(0, Math.min(100, newY));
        
        dragState.element.style.left = machine.position.x + '%';
        dragState.element.style.top = machine.position.y + '%';
    } else if (dragState.type === 'tag') {
        const tag = state.tags.find(t => t.id === id);
        if (!tag) return;
        
        const newX = tag.position.x + (deltaX / rect.width) * 100;
        const newY = tag.position.y + (deltaY / rect.height) * 100;
        
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
    const machineTypeSelect = document.getElementById('machineType');
    const customMachineTypeInput = document.getElementById('customMachineType');
    
    addMachineBtn.addEventListener('click', () => {
        addMachineBtn.style.display = 'none';
        addMachineForm.style.display = 'flex';
        addMachineCard.classList.add('pressed');
    });
    
    machineTypeSelect.addEventListener('change', () => {
        if (machineTypeSelect.value === 'Custom Machine') {
            customMachineTypeInput.style.display = 'block';
        } else {
            customMachineTypeInput.style.display = 'none';
        }
    });
    
    document.getElementById('addMachineConfirm').addEventListener('click', () => {
        const name = document.getElementById('machineName').value.trim();
        let type = machineTypeSelect.value;
        
        if (!name) {
            alert('Please enter a machine name');
            return;
        }
        
        if (type === 'Custom Machine') {
            const customType = customMachineTypeInput.value.trim();
            if (!customType) {
                alert('Please enter a custom machine type');
                return;
            }
            type = customType;
        }
        
        const newMachine = {
            id: generateId(),
            name: name,
            type: type,
            status: 'idle',
            position: { x: 50, y: 50 },
            workers: [],
            efficiency: 0,
            lastMaintenance: new Date().toISOString().split('T')[0],
            todos: []
        };
        
        state.machines.push(newMachine);
        
        document.getElementById('machineName').value = '';
        machineTypeSelect.value = 'Injection Molding - Vertical';
        customMachineTypeInput.value = '';
        customMachineTypeInput.style.display = 'none';
        addMachineBtn.style.display = 'flex';
        addMachineForm.style.display = 'none';
        addMachineCard.classList.remove('pressed');
        
        renderMachines();
        renderMachinesList();
        updateStats();
    });
    
    document.getElementById('addMachineCancel').addEventListener('click', () => {
        document.getElementById('machineName').value = '';
        machineTypeSelect.value = 'Injection Molding - Vertical';
        customMachineTypeInput.value = '';
        customMachineTypeInput.style.display = 'none';
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
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        
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
    setupEventListeners();
    
    // Update shift progress every minute
    setInterval(updateShiftProgress, 60000);
}

// Start the app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
