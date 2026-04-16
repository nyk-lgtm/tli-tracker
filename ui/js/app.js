/**
 * TLI Tracker - Frontend Application
 *
 * Main entry point. Communicates with Python backend via QWebChannel bridge (PySide6).
 * The api() and waitForApi() functions are provided by qt_bridge.js.
 */

import { state } from './state.js';
import { elements, initElements } from './elements.js';
import { showStatus, tickTimers } from './utils.js';
import { openModal, closeModal, showConfirmDialog } from './modals.js';
import { loadSettings, saveSettings, resetDefaults, initToggleListeners, initSettingsTabs, initWidgetOverlayListeners, initGamePathListeners } from './settings.js';
import { loadHistory } from './history.js';
import { applyDownloadedUpdate, checkForUpdates, checkForUpdatesOnStartup, handleUpdateState, loadUpdateState } from './updates.js';
import { updateState, renderUI, renderDrops, updateTimedStats } from './renderers.js';
import {
    applyPriceHistoryUpdate,
    collapseExpandedPriceHistory,
    ensurePriceHistory,
    getActivePriceHistoryRangeKey,
    setActivePriceHistoryRangeKey,
    toggleExpandedPriceHistoryItem
} from './price-history.js';

let initPollInterval = null;
let initPollInFlight = false;

function stopInitPolling() {
    if (!initPollInterval) {
        return;
    }

    clearInterval(initPollInterval);
    initPollInterval = null;
}

function syncInitPolling() {
    if (!state.awaitingInit) {
        stopInitPolling();
        return;
    }

    if (initPollInterval) {
        return;
    }

    initPollInterval = setInterval(() => {
        void pollTrackerState();
    }, 400);
}

function applyTrackerState(data) {
    updateState(data);
    syncInitPolling();
}

async function pollTrackerState() {
    if (initPollInFlight) {
        return;
    }

    initPollInFlight = true;
    try {
        const nextState = await api('get_stats');
        applyTrackerState(nextState);
    } catch (error) {
        console.error('State poll failed:', error);
    } finally {
        initPollInFlight = false;
    }
}

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
            applyTrackerState(data);
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
        case 'price_history':
            applyPriceHistoryUpdate(data);
            renderDrops();
            break;
        case 'session_reset':
            collapseExpandedPriceHistory();
            state.session = null;
            state.currentMap = null;
            state.inMap = false;
            renderUI();
            syncInitPolling();
            break;
        case 'update_state':
            handleUpdateState(data);
            break;
    }
};

// ============ Event Handlers ============

function onReady() {
    showStatus('Connected to the game', 'success', 3000);

    // Load initial state
    api('get_stats').then(applyTrackerState);
}

function onInitialized(itemCount) {
    showStatus(`Initialized with ${itemCount} items`, 'success', 3000);
    void pollTrackerState();
}

function onMapEnter() {
    // Drops are tracked at session level, no need to clear
    renderDrops();
}

function onMapExit() {
    // State update will handle the UI
}

function loadPriceHistoryForRange(itemId, rangeKey) {
    setActivePriceHistoryRangeKey(rangeKey);
    const fetchPromise = ensurePriceHistory(itemId, rangeKey);
    renderDrops();
    void fetchPromise.then((entry) => {
        console.debug('[PriceHistory]', itemId, rangeKey, entry.status);
        renderDrops();
        return entry;
    }).catch((error) => {
        console.error('[PriceHistory] request failed:', itemId, rangeKey, error);
        renderDrops();
    });
    return fetchPromise;
}

async function handleDropRowClick(event) {
    const rangeButton = event.target.closest('[data-price-history-range]');
    if (rangeButton && elements.dropsList.contains(rangeButton)) {
        const itemId = rangeButton.dataset.itemId;
        const rangeKey = rangeButton.dataset.priceHistoryRange;
        if (!itemId || !rangeKey) {
            return;
        }

        void loadPriceHistoryForRange(itemId, rangeKey);
        return;
    }

    const row = event.target.closest('[data-drop-row]');
    if (!row || !elements.dropsList.contains(row)) {
        return;
    }

    const itemId = row.dataset.itemId;
    if (!itemId) {
        return;
    }

    const expandedItemId = toggleExpandedPriceHistoryItem(itemId);

    if (expandedItemId === itemId) {
        void loadPriceHistoryForRange(itemId, getActivePriceHistoryRangeKey());
        return;
    }

    renderDrops();
}

// ============ UI Actions ============

async function initialize() {
    elements.btnInitialize.disabled = true;
    elements.btnInitialize.textContent = 'Waiting...';

    try {
        const result = await api('request_initialization');
        showStatus(result.message, 'info');
        await pollTrackerState();
    } catch (e) {
        showStatus('Initialization failed', 'error');
        stopInitPolling();
        // Reset button on error
        elements.btnInitialize.disabled = false;
        elements.btnInitialize.textContent = 'Re-sync Bag';
    }
}

let pauseInFlight = false;
async function togglePause() {
    if (pauseInFlight) return;
    pauseInFlight = true;
    try {
        const result = await api('toggle_pause');
        if (result.status === 'ok') {
            showStatus(result.paused ? 'Tracking paused' : 'Tracking resumed', 'info', 2000);
        }
    } catch (e) {
        showStatus('Failed to toggle pause', 'error', 2000);
    } finally {
        pauseInFlight = false;
    }
}

async function resetSession() {
    const confirmed = await showConfirmDialog(
        'Reset Session',
        'The current session will be saved to history and a new session will start on next map entry.',
        'Reset',
        'Cancel'
    );
    if (!confirmed) return;

    try {
        await api('reset_session');
        collapseExpandedPriceHistory();
        state.session = null;
        state.currentMap = null;
        state.inMap = false;
        renderUI();
        syncInitPolling();
        showStatus('Session reset', 'success', 2000);
    } catch (e) {
        showStatus('Reset failed', 'error', 3000);
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
            showStatus('Failed to toggle overlay', 'error', 2000);
        }
    } catch (e) {
        console.error('Overlay toggle failed:', e);
        showStatus('Overlay not available', 'error', 2000);
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

// ============ Timer Update Loop ============

let timerInterval = null;

function startTimerLoop() {
    if (timerInterval) return;

    timerInterval = setInterval(() => {
        const { mapTicked, sessionTicked } = tickTimers(state);

        if (mapTicked || sessionTicked) {
            updateTimedStats();
        }
    }, 1000);
}

// ============ Initialization ============

function init() {
    // Initialize DOM element references
    initElements();

    // Bind event listeners
    elements.btnInitialize.addEventListener('click', initialize);
    elements.btnPause.addEventListener('click', togglePause);
    elements.btnReset.addEventListener('click', resetSession);
    elements.btnModeValue.addEventListener('click', () => setDisplayMode('value'));
    elements.btnModeItems.addEventListener('click', () => setDisplayMode('items'));
    elements.btnSettings.addEventListener('click', () => {
        openModal('settings');
        void loadSettings();
        void loadUpdateState();
    });
    elements.btnHistory.addEventListener('click', () => { openModal('history'); loadHistory(); });
    elements.btnOverlay.addEventListener('click', toggleOverlay);
    elements.btnResetSettings.addEventListener('click', resetDefaults);
    elements.dropsList.addEventListener('click', handleDropRowClick);

    // Settings modal
    elements.btnCloseSettings.addEventListener('click', () => closeModal('settings'));
    elements.btnSaveSettings.addEventListener('click', saveSettings);
    initToggleListeners();
    initSettingsTabs();
    initWidgetOverlayListeners();
    initGamePathListeners();

    // History modal
    elements.btnCloseHistory.addEventListener('click', () => closeModal('history'));

    // Update check button (settings)
    if (elements.btnCheckUpdates) {
        elements.btnCheckUpdates.addEventListener('click', checkForUpdates);
    }

    // Update restart button (main window)
    if (elements.btnUpdateRestart) {
        elements.btnUpdateRestart.addEventListener('click', applyDownloadedUpdate);
    }

    // Close modals on backdrop click
    document.querySelectorAll('[id$="-modal"]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // Load settings
    void loadSettings();
    void loadUpdateState();

    // Start timer loop
    startTimerLoop();

    // Initial UI render
    renderUI();

    // Auto-check for updates on startup (delay to avoid overwriting "Connected" message)
    setTimeout(() => checkForUpdatesOnStartup(), 4000);

    if (window.__PREVIEW__?.enabled) {
        applyTrackerState(window.__PREVIEW__.state);
        window.onPythonEvent = () => {};
    }

    console.log('TLI Tracker UI initialized');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
