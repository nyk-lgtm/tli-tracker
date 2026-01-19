/**
 * TLI Tracker - Frontend Application
 *
 * Communicates with Python backend via QWebChannel bridge (PySide6).
 * The api() and waitForApi() functions are provided by qt_bridge.js.
 */

// Global state
let state = {
    initialized: false,
    awaitingInit: false,
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
    overlay_pinned: false,
    use_real_time_stats: false
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
    settingRealTimeStats: document.getElementById('setting-real-time-stats'),
    settingOverlayPinned: document.getElementById('setting-overlay-pinned'),
    settingOpacity: document.getElementById('setting-opacity'),
    opacityValue: document.getElementById('opacity-value'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnResetSettings: document.getElementById('btn-reset-defaults'),
    versionDisplay: document.getElementById('version-display'),
    btnCheckUpdates: document.getElementById('btn-check-updates')
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
    state.awaitingInit = data.awaiting_init || false;
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
        elements.statMapTime.textContent = '-:-';
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
    if (state.awaitingInit) {
        // Waiting for user to sort bag
        elements.btnInitialize.textContent = 'Waiting...';
        elements.btnInitialize.disabled = true;
        elements.btnInitialize.classList.remove('hidden');
    } else if (state.initialized) {
        // Initialized - show re-sync option
        elements.btnInitialize.textContent = 'Re-sync Bag';
        elements.btnInitialize.disabled = false;
        elements.btnInitialize.classList.remove('hidden');
    } else {
        // Not yet initialized - hide button
        elements.btnInitialize.classList.add('hidden');
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

        if (state.awaitingInit) {
            // Scenario: Waiting for re-sync
            emptyHtml = `
                <div class="empty-state py-10">
                    <div class="text-base font-semibold text-gray-300 mb-2">Waiting for Re-sync</div>
                    <p class="text-sm text-gray-500">
                        Sort your inventory in-game to re-sync.
                    </p>
                </div>
            `;
        } else if (!state.initialized) {
            // Scenario: Not Initialized (Onboarding)
            emptyHtml = `
                <div class="empty-state py-10">
                    <div class="text-base font-semibold text-gray-300 mb-2">Inventory Not Tracked</div>
                    <p class="text-sm text-gray-500">
                        Sort your inventory in-game to start tracking.
                    </p>
                </div>
            `;
        } else {
            // Scenario: Initialized but empty (No drops)
            emptyHtml = `
                <div class="empty-state">
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
        const highValueClass = Math.abs(item.value) >= 10000 ? 'high-value' : '';
        const valueText = item.value !== 0
            ? formatValue(item.value)
            : '(no price)';

        return `
            <div class="drop-item">
                <div class="drop-item-name">
                    <span class="price-status ${item.price_status || 'unknown'}"></span>
                    <span>${item.name}</span>
                    <span class="text-gray-500 font-mono text-sm">×${Math.abs(item.quantity)}</span>
                </div>
                <div class="stat-value font-mono ${valueClass} ${highValueClass}">${valueText}</div>
            </div>
        `;
    }).join('');

    elements.dropsList.innerHTML = html || '<div class="empty-state">No drops yet</div>';
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
                <div class="drop-item-quantity font-mono ${valueClass}">×${item.quantity}</div>
            </div>
        `;
    }).join('');

    elements.dropsList.innerHTML = html || '<div class="empty-state">No drops yet</div>';
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
        // State update from backend will keep button in "Waiting..." state
    } catch (e) {
        showStatus('Initialization failed', 'error');
        // Reset button on error
        elements.btnInitialize.disabled = false;
        elements.btnInitialize.textContent = 'Re-sync Bag';
    }
}

async function resetSession() {
    const confirmed = await showConfirmDialog(
        'Reset Session',
        'The current session will be saved to history and a new session will start.',
        'Reset',
        'Cancel'
    );
    if (!confirmed) return;

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
        elements.btnModeValue.classList.add('active');
        elements.btnModeItems.classList.remove('active');
    } else {
        elements.btnModeItems.classList.add('active');
        elements.btnModeValue.classList.remove('active');
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
        elements.btnOverlay.classList.add('active');
    } else {
        elements.btnOverlay.textContent = 'Overlay';
        elements.btnOverlay.classList.remove('active');
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
        elements.settingRealTimeStats.checked = settings.use_real_time_stats || false;
        elements.settingOverlayPinned.checked = settings.overlay_pinned || false;
        elements.settingOpacity.value = (settings.overlay_opacity || 0.9) * 100;
        elements.opacityValue.textContent = elements.settingOpacity.value + '%';
        updateToggleVisual('setting-tax');
        updateToggleVisual('setting-map-value');
        updateToggleVisual('setting-real-time-stats');
        updateToggleVisual('setting-overlay-pinned');
        applyMapValueVisibility();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

async function saveSettings() {
    settings.tax_enabled = elements.settingTax.checked;
    settings.show_map_value = elements.settingMapValue.checked;
    settings.use_real_time_stats = elements.settingRealTimeStats.checked;
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

// ============ Updates ============

async function loadVersion() {
    try {
        const version = await api('get_version');
        if (version && elements.versionDisplay) {
            elements.versionDisplay.textContent = `v${version}`;
        }
    } catch (e) {
        console.error('Failed to load version:', e);
    }
}

async function checkForUpdates() {
    const btn = elements.btnCheckUpdates;
    if (!btn) return;

    const originalText = btn.textContent;
    btn.textContent = 'Checking...';
    btn.disabled = true;

    try {
        const result = await api('check_for_update');

        if (result.status === 'error') {
            showStatus(`Update check failed: ${result.error}`, 'error');
            return;
        }

        if (!result.update_available) {
            showStatus("You're running the latest version!", 'success');
            setTimeout(() => hideStatus(), 3000);
            return;
        }

        // Update available - show confirmation
        const confirmed = await showConfirmDialog(
            'Update Available',
            `A new version is available!\n\nCurrent: v${result.current_version}\nNew: v${result.new_version}\n\nWould you like to download and install the update?`,
            'Update',
            'Later'
        );

        if (!confirmed) return;

        // Start download
        showStatus('Downloading update...', 'info');

        const downloadResult = await api('download_update', result.download_url, result.new_version);

        if (downloadResult.status === 'error') {
            showStatus(`Download failed: ${downloadResult.error}`, 'error');
            return;
        }

        // Launch installer
        showStatus('Launching installer...', 'info');

        const launchResult = await api('launch_installer', downloadResult.download_path);

        if (launchResult.status === 'error') {
            showStatus(`Failed to launch installer: ${launchResult.error}`, 'error');
            return;
        }

        // App will quit after launching installer
        showStatus('Update starting, closing app...', 'success');

    } catch (e) {
        console.error('Update check failed:', e);
        showStatus('Update check failed', 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
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

        listEl.innerHTML = sessions.map(session => `
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

// ============ Confirmation Dialog ============

function showConfirmDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;
        btnOk.textContent = confirmText;
        btnCancel.textContent = cancelText;

        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnOk.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onBackdrop = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        };

        btnOk.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
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
    document.getElementById('setting-real-time-stats').addEventListener('change', () => {
        updateToggleVisual('setting-real-time-stats');
    });
    document.getElementById('setting-overlay-pinned').addEventListener('change', () => {
        updateToggleVisual('setting-overlay-pinned');
    });

    // History modal
    document.getElementById('btn-close-history').addEventListener('click', () => closeModal('history'));

    // Update check button
    if (elements.btnCheckUpdates) {
        elements.btnCheckUpdates.addEventListener('click', checkForUpdates);
    }

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

    // Load version display
    loadVersion();

    // Start timer loop
    startTimerLoop();

    // Initial UI render
    renderUI();

    console.log('TLI Tracker UI initialized');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
