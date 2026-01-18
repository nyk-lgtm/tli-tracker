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
    drops: [],
    prices: {}
};

let settings = {
    tax_enabled: false,
    overlay_opacity: 0.9,
    show_map_value: false,
    overlay_pinned: false
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
    settingOverlayPinned: document.getElementById('setting-overlay-pinned'),
    settingOpacity: document.getElementById('setting-opacity'),
    opacityValue: document.getElementById('opacity-value'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnResetSettings: document.getElementById('btn-reset-defaults')
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
            if (data.item_id && data.price !== undefined) {
                const cleanId = String(data.item_id).trim();
                state.prices[cleanId] = data.price;
                console.log(`Updated price for [${cleanId}]: ${data.price}`);
                renderDrops();
            }
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
        elements.statMapValue.classList.add('text-lg'); // Ensure base class
        if (state.currentMap.value >= 0) {
            elements.statMapValue.classList.remove('text-danger');
            elements.statMapValue.classList.add('text-success');
        } else {
            elements.statMapValue.classList.remove('text-success');
            elements.statMapValue.classList.add('text-danger');
        }
    } else {
        elements.statMapTime.textContent = '--:--';
        elements.statMapValue.textContent = '+0';
        // Reset to default color
        elements.statMapValue.classList.remove('text-danger');
        elements.statMapValue.classList.add('text-success');
    }

    // Update session stats
    if (state.session) {
        elements.statSessionMapping.textContent = formatTime(state.session.duration_mapping);
        elements.statSessionTotal.textContent = formatTime(state.session.duration_total);
        elements.statSessionValue.textContent = formatValue(state.session.value);
        elements.statRate.innerHTML = formatRate(state.session.value_per_hour);
        elements.statMapCount.textContent = state.session.map_count;
    } else {
        elements.statSessionMapping.textContent = '0:00';
        elements.statSessionTotal.textContent = '0:00';
        elements.statSessionValue.textContent = '+0';
        elements.statRate.innerHTML = formatRate(0);
        elements.statMapCount.textContent = '0';
    }

    // Update init status (this also re-renders drops)
    updateInitStatus();
}

function updateInitStatus() {
    // Update button text based on initialization state
    if (state.initialized) {
        elements.btnInitialize.textContent = 'Re-Initialize';
    } else {
        elements.btnInitialize.textContent = 'Initialize Bag';
    }

    // Re-render drops to update empty state
    renderDrops();
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
        let emptyHtml = '';

        if (!state.initialized) {
            // Scenario: Not Initialized (Onboarding)
            emptyHtml = `
                <div class="flex flex-col items-center justify-center py-10 text-center space-y-2">
                    <div class="text-lg font-semibold text-gray-300">Inventory Not Tracked</div>
                    <p class="text-sm text-gray-500 max-w-xs">
                        Click <span class="text-primary">Initialize Bag</span> and sort your inventory in-game to start tracking.
                    </p>
                </div>
            `;
        } else {
            // Scenario: Initialized but empty (No drops)
            emptyHtml = `
                <div class="p-8 text-center text-gray-500">
                    No drops detected in this session
                </div>
            `;
        }

        elements.dropsList.innerHTML = emptyHtml;
        return;
    }

    const drops = [...state.drops].slice(0, 50); // Limit to 50 most recent

    if (state.displayMode === 'items') {
        renderItemsMode(drops);
    } else {
        renderValueMode(drops);
    }
}

function renderValueMode(drops) {
    // Aggregate by item
    const itemTotals = {};
    drops.forEach(drop => {
        const id = String(drop.item_id).trim();

        if (!itemTotals[id]) {
            itemTotals[id] = {
                id: id,
                name: drop.item_name,
                quantity: 0,
                value: 0,
                price_status: drop.price_status
            };
        }
        itemTotals[id].quantity += drop.quantity;
        if (drop.value !== null) {
            itemTotals[id].value += drop.value;
        }
    });

    Object.values(itemTotals).forEach(item => {
        const currentPrice = state.prices[item.id];
        if (currentPrice !== undefined) {
            item.value = item.quantity * currentPrice;
        }
    });

    // Sort by total quantity (highest first)
    // const sorted = Object.entries(itemTotals)
    //     .sort((a, b) => Math.abs(b[1].quantity) - Math.abs(a[1].quantity));
    const sorted = Object.entries(itemTotals)
        .sort((a, b) => {
            const itemA = a[1];
            const itemB = b[1];

            // Check if items have a valid price (value > 0)
            const hasPriceA = Math.abs(itemA.value) > 0;
            const hasPriceB = Math.abs(itemB.value) > 0;

            if (hasPriceA && !hasPriceB) return -1; // A comes first
            if (!hasPriceA && hasPriceB) return 1;  // B comes first

            if (hasPriceA) {
                // Both have prices: sort by Total Value (desc)
                return Math.abs(itemB.value) - Math.abs(itemA.value);
            } else {
                // Neither has price: sort by Quantity (desc)
                return Math.abs(itemB.quantity) - Math.abs(itemA.quantity);
            }
        });


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
                <div class="stat-value ${valueClass}">${valueText}</div>
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

    // Sort by quantity (highest first)
    const sorted = Object.entries(itemCounts)
        .sort((a, b) => b[1].quantity - a[1].quantity);

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
    showStatus('Connected to the game', 'success');
    setTimeout(() => hideStatus(), 3000);

    // Load initial state
    api('get_stats').then(updateState);

    // Initial fetch of price database to populate cache
    api('get_prices').then(data => {
        if (data) {
            Object.entries(data).forEach(([id, entry]) => {
                if (entry && entry.price !== undefined) {
                    const cleanId = String(id).trim();
                    state.prices[cleanId] = entry.price;
                }
            });
            // Re-render if drops are already loaded
            if (state.drops.length > 0) renderDrops();
        }
    });
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

function updateToggleVisual(checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) return;
    
    const label = checkbox.nextElementSibling;
    if (checkbox.checked) {
        label.classList.add('checked');
    } else {
        label.classList.remove('checked');
    }
}

async function loadSettings() {
    try {
        settings = await api('get_settings');
        elements.settingTax.checked = settings.tax_enabled || false;
        elements.settingMapValue.checked = settings.show_map_value || false;
        elements.settingOverlayPinned.checked = settings.overlay_pinned || false;
        elements.settingOpacity.value = (settings.overlay_opacity || 0.9) * 100;
        elements.opacityValue.textContent = elements.settingOpacity.value + '%';
        updateToggleVisual('setting-tax');
        updateToggleVisual('setting-map-value');
        updateToggleVisual('setting-overlay-pinned');
        applyMapValueVisibility();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function saveSettings() {
    settings.tax_enabled = elements.settingTax.checked;
    settings.show_map_value = elements.settingMapValue.checked;
    settings.overlay_pinned = elements.settingOverlayPinned.checked;
    settings.overlay_opacity = elements.settingOpacity.value / 100;

    try {
        await api('save_settings', settings);
        const bc = new BroadcastChannel('tli_settings_channel');
        bc.postMessage('update');
        bc.close();
        applyMapValueVisibility();
        closeModal('settings');
        showStatus('Settings saved', 'success');
        setTimeout(() => hideStatus(), 2000);
    } catch (e) {
        showStatus('Failed to save settings', 'error');
    }
}

async function resetDefaults() {
    try {
        const result = await api('default_settings');
        
        if (result.status === 'ok') {
            await loadSettings();
            
            showStatus('Settings reset to defaults', 'success');
            setTimeout(() => hideStatus(), 2000);
        } else {
            showStatus('Error resetting settings', 'error');
        }
    } catch (e) {
        console.error('Reset defaults failed:', e);
        showStatus('Failed to reset settings', 'error');
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
        const rateEl = document.getElementById('history-avg-rate');
        if (rateEl) {
            rateEl.innerHTML = formatRate(summary.average_value_per_hour);
        }

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

let statusTimeout;

function showStatus(message, type = 'info') {
    const el = elements.statusBanner;
    const text = elements.statusText;

    if (statusTimeout) clearTimeout(statusTimeout);
    text.textContent = message;
    el.classList.remove('hidden', 'status-info', 'status-success', 'status-warning', 'status-error');
    el.classList.add(`status-${type}`);
    statusTimeout = setTimeout(hideStatus, 2000);
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
    let text = '0';

    if (value) {
        if (value >= 1000000) {
            text = (value / 1000000).toFixed(1) + 'M';
        } else if (value >= 1000) {
            text = (value / 1000).toFixed(1) + 'k';
        } else {
            text = Math.round(value).toString();
        }
    }

    return `${text}<span class="text-xs text-gray-400">/hr</span>`;
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
    elements.btnResetSettings.addEventListener('click', resetDefaults);

    // Settings modal
    document.getElementById('btn-close-settings').addEventListener('click', () => closeModal('settings'));
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('setting-tax').addEventListener('change', () => updateToggleVisual('setting-tax'));
    document.getElementById('setting-map-value').addEventListener('change', () => {
        updateToggleVisual('setting-map-value');
    });
    document.getElementById('setting-overlay-pinned').addEventListener('change', () => {
        updateToggleVisual('setting-overlay-pinned');
    });

    // History modal
    document.getElementById('btn-close-history').addEventListener('click', () => closeModal('history'));

    // Opacity slider
    elements.settingOpacity.addEventListener('input', (e) => {
        const val = e.target.value;
        elements.opacityValue.textContent = val + '%';
        api('set_overlay_opacity', val / 100);
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
