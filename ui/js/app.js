/**
 * TLI Tracker - Frontend Application
 *
 * Communicates with Python backend via QWebChannel bridge (PySide6).
 * The api() and waitForApi() functions are provided by qt_bridge.js.
 */

// Global state
let state = {
    initialized: false,
    inMap: false,
    displayMode: 'value',
    currentMap: null,
    session: null,
    drops: []
};

let settings = {
    tax_enabled: false,
    overlay_opacity: 0.9,
    show_map_value: false
};

// DOM Elements
const elements = {
    statusBanner: document.getElementById('status-banner'),
    statusText: document.getElementById('status-text'),
    statMapTime: document.getElementById('stat-map-time'),
    statMapValue: document.getElementById('stat-map-value'),
    statSessionMapping: document.getElementById('stat-session-mapping'),
    statSessionTotal: document.getElementById('stat-session-total'),
    statSessionValue: document.getElementById('stat-session-value'),
    statRate: document.getElementById('stat-rate'),
    statMapCount: document.getElementById('stat-map-count'),
    dropsList: document.getElementById('drops-list'),
    initStatus: document.getElementById('init-status'),
    btnInitialize: document.getElementById('btn-initialize'),
    btnReset: document.getElementById('btn-reset'),
    btnModeValue: document.getElementById('btn-mode-value'),
    btnModeItems: document.getElementById('btn-mode-items'),
    btnSettings: document.getElementById('btn-settings'),
    btnHistory: document.getElementById('btn-history'),
    btnOverlay: document.getElementById('btn-overlay'),
    settingsModal: document.getElementById('settings-modal'),
    historyModal: document.getElementById('history-modal'),
    settingTax: document.getElementById('setting-tax'),
    settingMapValue: document.getElementById('setting-map-value'),
    settingOpacity: document.getElementById('setting-opacity'),
    opacityValue: document.getElementById('opacity-value')
};

// Note: api() and waitForApi() are provided by qt_bridge.js

// ============ Event Handlers from Python ============

/**
 * Global event handler called from Python
 */
window.onPythonEvent = function(eventType, data) {
    console.log('Python event:', eventType, data);

    switch (eventType) {
        case 'ready':
            onReady();
            break;
        case 'error':
            showStatus(data.message, 'error');
            break;
        case 'state':
            updateState(data);
            break;
        case 'drop':
            addDrop(data);
            break;
        case 'map_enter':
            onMapEnter();
            break;
        case 'map_exit':
            onMapExit();
            break;
        case 'initialized':
            onInitialized(data.item_count);
            break;
        case 'price_update':
            // Could show a notification
            break;
        case 'session_reset':
            state.drops = [];
            renderDrops();
            break;
    }
};

// ============ State Management ============

function updateState(data) {
    state.initialized = data.initialized;
    state.inMap = data.in_map;
    state.displayMode = data.display_mode;
    state.currentMap = data.current_map;
    state.session = data.session;

    // Update drops from session (includes all maps + current map)
    if (data.session && data.session.drops) {
        state.drops = data.session.drops;
    } else {
        state.drops = [];
    }

    renderUI();
}

function renderUI() {
    // Update map stats
    if (state.currentMap) {
        elements.statMapTime.textContent = formatTime(state.currentMap.duration);
        elements.statMapValue.textContent = formatValue(state.currentMap.value);
        elements.statMapValue.className = state.currentMap.value >= 0
            ? 'text-lg text-success'
            : 'text-lg text-danger';
    } else {
        elements.statMapTime.textContent = '--:--';
        elements.statMapValue.textContent = '+0';
    }

    // Update session stats
    if (state.session) {
        elements.statSessionMapping.textContent = formatTime(state.session.duration_mapping);
        elements.statSessionTotal.textContent = formatTime(state.session.duration_total);
        elements.statSessionValue.textContent = formatValue(state.session.value);
        elements.statRate.textContent = formatRate(state.session.value_per_hour);
        elements.statMapCount.textContent = state.session.map_count;
    } else {
        elements.statSessionMapping.textContent = '0:00';
        elements.statSessionTotal.textContent = '0:00';
        elements.statSessionValue.textContent = '+0';
        elements.statRate.textContent = '0/hr';
        elements.statMapCount.textContent = '0';
    }

    // Update init status
    updateInitStatus();

    // Render drops
    renderDrops();
}

function updateInitStatus() {
    if (state.initialized) {
        if (state.inMap) {
            elements.initStatus.textContent = '🟢 In map - tracking drops';
            elements.initStatus.className = 'mt-3 text-center text-sm text-success';
        } else {
            elements.initStatus.textContent = '✓ Initialized - waiting for map';
            elements.initStatus.className = 'mt-3 text-center text-sm text-gray-400';
        }
    } else {
        elements.initStatus.textContent = 'Not initialized - Click "Initialize Bag" then sort your inventory';
        elements.initStatus.className = 'mt-3 text-center text-sm text-warning';
    }
}

// ============ Drop Rendering ============

function addDrop(dropData) {
    // Add to beginning of list
    state.drops.unshift(dropData);

    // Re-render
    renderDrops();
}

function renderDrops() {
    if (state.drops.length === 0) {
        elements.dropsList.innerHTML = `
            <div class="p-4 text-center text-gray-500">
                No drops yet
            </div>
        `;
        return;
    }

    // Sort by most recent first (already should be, but ensure)
    const drops = [...state.drops].slice(0, 50); // Limit to 50 most recent

    if (state.displayMode === 'items') {
        // Group by item and show quantities
        renderItemsMode(drops);
    } else {
        // Show individual drops with values
        renderValueMode(drops);
    }
}

function renderValueMode(drops) {
    // Aggregate by item
    const itemTotals = {};
    drops.forEach(drop => {
        if (!itemTotals[drop.item_id]) {
            itemTotals[drop.item_id] = {
                name: drop.item_name,
                quantity: 0,
                value: 0,
                price_status: drop.price_status
            };
        }
        itemTotals[drop.item_id].quantity += drop.quantity;
        if (drop.value !== null) {
            itemTotals[drop.item_id].value += drop.value;
        }
    });

    // Sort by total quantity (highest first) and take top 5
    const sorted = Object.entries(itemTotals)
        .sort((a, b) => Math.abs(b[1].quantity) - Math.abs(a[1].quantity))
        .slice(0, 5);

    const html = sorted.map(([id, item]) => {
        const valueClass = item.value >= 0 ? 'positive' : 'negative';
        const valueText = item.value !== 0
            ? formatValue(item.value)
            : '(no price)';

        return `
            <div class="drop-item">
                <div class="drop-item-name">
                    <span class="price-status ${item.price_status || 'unknown'}"></span>
                    <span>${item.name}</span>
                    <span class="text-gray-400">x${Math.abs(item.quantity)}</span>
                </div>
                <div class="drop-item-value ${valueClass}">${valueText}</div>
            </div>
        `;
    }).join('');

    elements.dropsList.innerHTML = html || '<div class="p-4 text-center text-gray-500">No drops yet</div>';
}

function renderItemsMode(drops) {
    // Aggregate by item
    const itemCounts = {};
    drops.forEach(drop => {
        if (!itemCounts[drop.item_id]) {
            itemCounts[drop.item_id] = {
                name: drop.item_name,
                quantity: 0,
                price_status: drop.price_status
            };
        }
        itemCounts[drop.item_id].quantity += drop.quantity;
    });

    // Sort by quantity (highest first) and take top 5
    const sorted = Object.entries(itemCounts)
        .sort((a, b) => b[1].quantity - a[1].quantity)
        .slice(0, 5);

    const html = sorted.map(([id, item]) => {
        const valueClass = item.quantity >= 0 ? 'positive' : 'negative';
        return `
            <div class="drop-item">
                <div class="drop-item-name">
                    <span class="price-status ${item.price_status || 'unknown'}"></span>
                    <span>${item.name}</span>
                </div>
                <div class="drop-item-quantity ${valueClass}">x${item.quantity}</div>
            </div>
        `;
    }).join('');

    elements.dropsList.innerHTML = html || '<div class="p-4 text-center text-gray-500">No drops yet</div>';
}

// ============ Event Handlers ============

function onReady() {
    showStatus('Connected to game', 'success');
    setTimeout(() => hideStatus(), 3000);

    // Load initial state
    api('get_stats').then(updateState);
}

function onInitialized(itemCount) {
    showStatus(`Initialized with ${itemCount} items`, 'success');
    setTimeout(() => hideStatus(), 3000);
}

function onMapEnter() {
    // Drops are tracked at session level, no need to clear
    renderDrops();
}

function onMapExit() {
    // State update will handle the UI
}

// ============ UI Actions ============

async function initialize() {
    elements.btnInitialize.disabled = true;
    elements.btnInitialize.textContent = 'Waiting...';

    try {
        const result = await api('request_initialization');
        showStatus(result.message, 'info');
    } catch (e) {
        showStatus('Initialization failed', 'error');
    }

    elements.btnInitialize.disabled = false;
    elements.btnInitialize.textContent = 'Initialize Bag';
}

async function resetSession() {
    if (!confirm('Reset current session?')) return;

    try {
        await api('reset_session');
        state.drops = [];
        renderDrops();
        showStatus('Session reset', 'success');
        setTimeout(() => hideStatus(), 2000);
    } catch (e) {
        showStatus('Reset failed', 'error');
    }
}

function setDisplayMode(mode) {
    state.displayMode = mode;

    // Update button styles
    if (mode === 'value') {
        elements.btnModeValue.className = 'px-3 py-1 text-sm rounded-md bg-primary text-white transition';
        elements.btnModeItems.className = 'px-3 py-1 text-sm rounded-md text-gray-400 hover:text-white transition';
    } else {
        elements.btnModeItems.className = 'px-3 py-1 text-sm rounded-md bg-primary text-white transition';
        elements.btnModeValue.className = 'px-3 py-1 text-sm rounded-md text-gray-400 hover:text-white transition';
    }

    api('set_display_mode', mode);
    renderDrops();
}

let overlayVisible = false;

async function toggleOverlay() {
    try {
        const result = await api('toggle_overlay');
        if (result.status === 'ok') {
            overlayVisible = result.visible;
            updateOverlayButton();
        } else {
            showStatus('Failed to toggle overlay', 'error');
            setTimeout(() => hideStatus(), 2000);
        }
    } catch (e) {
        console.error('Overlay toggle failed:', e);
        showStatus('Overlay not available', 'error');
        setTimeout(() => hideStatus(), 2000);
    }
}

function updateOverlayButton() {
    if (overlayVisible) {
        elements.btnOverlay.textContent = 'Hide Overlay';
        elements.btnOverlay.classList.add('bg-primary', 'border-primary');
    } else {
        elements.btnOverlay.textContent = 'Overlay';
        elements.btnOverlay.classList.remove('bg-primary', 'border-primary');
    }
}

// ============ Settings ============

function applyMapValueVisibility() {
    if (settings.show_map_value) {
        elements.statMapValue.classList.remove('hidden');
        elements.statSessionValue.classList.remove('hidden');
    } else {
        elements.statMapValue.classList.add('hidden');
        elements.statSessionValue.classList.add('hidden');
    }
}

async function loadSettings() {
    try {
        settings = await api('get_settings');
        elements.settingTax.checked = settings.tax_enabled || false;
        elements.settingMapValue.checked = settings.show_map_value || false;
        elements.settingOpacity.value = (settings.overlay_opacity || 0.9) * 100;
        elements.opacityValue.textContent = elements.settingOpacity.value + '%';
        applyMapValueVisibility();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function saveSettings() {
    settings.tax_enabled = elements.settingTax.checked;
    settings.show_map_value = elements.settingMapValue.checked;
    settings.overlay_opacity = elements.settingOpacity.value / 100;

    try {
        await api('save_settings', settings);
        applyMapValueVisibility();
        closeModal('settings');
        showStatus('Settings saved', 'success');
        setTimeout(() => hideStatus(), 2000);
    } catch (e) {
        showStatus('Failed to save settings', 'error');
    }
}

// ============ History ============

async function loadHistory() {
    try {
        const sessions = await api('get_session_history');
        const summary = await api('get_session_summary');

        // Update summary
        document.getElementById('history-total-value').textContent = formatValue(summary.total_value);
        document.getElementById('history-total-maps').textContent = summary.total_maps;
        document.getElementById('history-avg-rate').textContent = formatRate(summary.average_value_per_hour);

        // Render sessions list
        const listEl = document.getElementById('history-list');

        if (sessions.length === 0) {
            listEl.innerHTML = '<div class="text-center text-gray-500 py-4">No sessions yet</div>';
            return;
        }

        listEl.innerHTML = sessions.slice(0, 20).map(session => `
            <div class="session-item">
                <div class="session-item-date">
                    ${formatDate(session.started_at)}
                </div>
                <div class="session-item-stats">
                    <span>${formatTime(session.total_duration)}</span>
                    <span>${session.map_count} maps</span>
                </div>
                <div class="session-item-value">${formatValue(session.total_value)}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

// ============ Modals ============

function openModal(name) {
    const modal = document.getElementById(`${name}-modal`);
    if (modal) {
        modal.classList.remove('hidden');

        if (name === 'settings') loadSettings();
        if (name === 'history') loadHistory();
    }
}

function closeModal(name) {
    const modal = document.getElementById(`${name}-modal`);
    if (modal) modal.classList.add('hidden');
}

// ============ Status Banner ============

function showStatus(message, type = 'info') {
    elements.statusBanner.className = `mb-4 p-3 rounded-lg text-sm status-${type}`;
    elements.statusText.textContent = message;
    elements.statusBanner.classList.remove('hidden');
}

function hideStatus() {
    elements.statusBanner.classList.add('hidden');
}

// ============ Formatting Utilities ============

function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hrs}h ${remainMins}m`;
    }

    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatValue(value) {
    if (value === null || value === undefined) return '+0';

    const prefix = value >= 0 ? '+' : '';
    const absValue = Math.abs(value);

    if (absValue >= 1000000) {
        return prefix + (value / 1000000).toFixed(1) + 'M';
    } else if (absValue >= 1000) {
        return prefix + (value / 1000).toFixed(1) + 'k';
    }

    return prefix + Math.round(value);
}

function formatRate(value) {
    if (!value) return '0/hr';

    if (value >= 1000000) {
        return (value / 1000000).toFixed(1) + 'M/hr';
    } else if (value >= 1000) {
        return (value / 1000).toFixed(1) + 'k/hr';
    }

    return Math.round(value) + '/hr';
}

function formatDate(isoString) {
    try {
        const date = new Date(isoString);
        const now = new Date();

        if (date.toDateString() === now.toDateString()) {
            return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }

        return date.toLocaleDateString();
    } catch (e) {
        return isoString;
    }
}

// ============ Timer Update Loop ============

let timerInterval = null;

function startTimerLoop() {
    if (timerInterval) return;

    timerInterval = setInterval(() => {
        if (state.inMap && state.currentMap) {
            // Increment current map duration
            state.currentMap.duration += 1;
            elements.statMapTime.textContent = formatTime(state.currentMap.duration);
        }

        if (state.session) {
            // Always increment session total (stopwatch)
            state.session.duration_total += 1;
            elements.statSessionTotal.textContent = formatTime(state.session.duration_total);

            // Session mapping is updated from backend on zone changes only
            // (don't increment locally to avoid sync issues)
        }
    }, 1000);
}

// ============ Initialization ============

function init() {
    // Bind event listeners
    elements.btnInitialize.addEventListener('click', initialize);
    elements.btnReset.addEventListener('click', resetSession);
    elements.btnModeValue.addEventListener('click', () => setDisplayMode('value'));
    elements.btnModeItems.addEventListener('click', () => setDisplayMode('items'));
    elements.btnSettings.addEventListener('click', () => openModal('settings'));
    elements.btnHistory.addEventListener('click', () => openModal('history'));
    elements.btnOverlay.addEventListener('click', toggleOverlay);

    // Settings modal
    document.getElementById('btn-close-settings').addEventListener('click', () => closeModal('settings'));
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

    // History modal
    document.getElementById('btn-close-history').addEventListener('click', () => closeModal('history'));

    // Opacity slider
    elements.settingOpacity.addEventListener('input', (e) => {
        elements.opacityValue.textContent = e.target.value + '%';
    });

    // Close modals on backdrop click
    document.querySelectorAll('[id$="-modal"]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // Load settings
    loadSettings();

    // Start timer loop
    startTimerLoop();

    // Initial UI render
    renderUI();

    console.log('TLI Tracker UI initialized');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
