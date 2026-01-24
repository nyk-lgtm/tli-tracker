/**
 * TLI Tracker - Frontend Application
 *
 * Main entry point. Communicates with Python backend via QWebChannel bridge (PySide6).
 * The api() and waitForApi() functions are provided by qt_bridge.js.
 */

import { state } from './state.js';
import { elements, initElements } from './elements.js';
import { showStatus, hideStatus, formatTime, tickTimers } from './utils.js';
import { openModal, closeModal, showConfirmDialog } from './modals.js';
import { loadSettings, saveSettings, resetDefaults, initToggleListeners, initSettingsTabs, initWidgetOverlayListeners } from './settings.js';
import { loadHistory } from './history.js';
import { loadVersion, checkForUpdates, checkForUpdatesOnStartup } from './updates.js';
import { updateState, renderUI, renderDrops, addDrop } from './renderers.js';

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

// ============ Event Handlers ============

function onReady() {
    showStatus('Connected to the game', 'success', 3000);

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
    showStatus(`Initialized with ${itemCount} items`, 'success', 3000);
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

        if (mapTicked) {
            elements.statMapTime.textContent = formatTime(state.currentMap.duration);
        }

        if (sessionTicked) {
            elements.statSessionTotal.textContent = formatTime(state.session.duration_total);
        }
    }, 1000);
}

// ============ Initialization ============

function init() {
    // Initialize DOM element references
    initElements();

    // Bind event listeners
    elements.btnInitialize.addEventListener('click', initialize);
    elements.btnReset.addEventListener('click', resetSession);
    elements.btnModeValue.addEventListener('click', () => setDisplayMode('value'));
    elements.btnModeItems.addEventListener('click', () => setDisplayMode('items'));
    elements.btnSettings.addEventListener('click', () => { openModal('settings'); loadSettings(); });
    elements.btnHistory.addEventListener('click', () => { openModal('history'); loadHistory(); });
    elements.btnOverlay.addEventListener('click', toggleOverlay);
    elements.btnResetSettings.addEventListener('click', resetDefaults);

    // Settings modal
    elements.btnCloseSettings.addEventListener('click', () => closeModal('settings'));
    elements.btnSaveSettings.addEventListener('click', saveSettings);
    initToggleListeners();
    initSettingsTabs();
    initWidgetOverlayListeners();

    // History modal
    elements.btnCloseHistory.addEventListener('click', () => closeModal('history'));

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

    // Auto-check for updates on startup (delay to avoid overwriting "Connected" message)
    setTimeout(() => checkForUpdatesOnStartup(), 4000);

    console.log('TLI Tracker UI initialized');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
