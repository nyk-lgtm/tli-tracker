/**
 * TLI Tracker - Frontend Application
 *
 * Main entry point. Communicates with Python backend via QWebChannel bridge (PySide6).
 * The api() and waitForApi() functions are provided by qt_bridge.js.
 */

import { state, settings, resetSessionDropsFilters } from './state.js';
import { elements, initElements } from './elements.js';
import { showStatus, tickTimers } from './utils.js';
import { openModal, closeModal, showConfirmDialog } from './modals.js';
import { loadSettings, loadThemesList, saveSettings, resetDefaults, initToggleListeners, initSettingsTabs, initWidgetOverlayListeners, initGamePathListeners, initAppearanceListeners } from './settings.js';
import { loadHistory, exitSessionViewing } from './history.js';
import { applyDownloadedUpdate, checkForUpdates, checkForUpdatesOnStartup, dismissUpdateBanner, handleUpdateState, loadUpdateState } from './updates.js';
import { updateState, renderUI, renderDrops, renderPanel, updateTimedStats, syncDisplayModeUI, setSubView, toggleExpandedMap } from './renderers.js';
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
            if (state.viewingSessionId) break;
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
            resetSessionDropsFilters();
            if (state.viewingSessionId) {
                state.viewingSessionId = null;
                state.subView = 'drops';
                state.expandedMapIndex = null;
                if (elements.sessionViewerBanner) {
                    elements.sessionViewerBanner.classList.add('hidden');
                }
            }
            state.session = null;
            state.currentMap = null;
            state.displayMap = null;
            state.inMap = false;
            renderUI();
            syncInitPolling();
            break;
        case 'update_state':
            handleUpdateState(data);
            break;
        case 'themes_update':
            // theme_manager.js re-applies the active theme; refresh the
            // appearance dropdown so the list/active selection stays in sync.
            void loadThemesList();
            break;
    }
};

// ============ Event Handlers ============

function onReady() {
    showStatus('Connected to the game', 'success', 3000);

    // Preview mode owns state; skip the live fetch or it wipes the fixture.
    if (window.__PREVIEW__?.enabled) return;

    api('get_stats').then(applyTrackerState);
}

function onInitialized(itemCount) {
    showStatus(`Initialized with ${itemCount} items`, 'success', 3000);
    void pollTrackerState();
}

function onMapEnter() {
    // auto-follow: expand the newly-started map in the accordion.
    // session.maps holds only completed maps, so the new live map's
    // synthesized index is one past the last completed one.
    const completedCount = state.session?.maps?.length || 0;
    state.expandedMapIndex = completedCount;
    // the subsequent 'state' event will trigger the render
}

function onMapExit() {
    // State update will handle the UI
}

function loadPriceHistoryForRange(itemId, rangeKey, panel = 'drops') {
    setActivePriceHistoryRangeKey(rangeKey, panel);
    const fetchPromise = ensurePriceHistory(itemId, rangeKey);
    // scoped render: only the panel the user clicked into gets touched.
    // keeps a cached chart on the other side from blanking/remounting while
    // the user waits on this side's fetch.
    renderPanel(panel);
    void fetchPromise.then((entry) => {
        console.debug('[PriceHistory]', itemId, rangeKey, panel, entry.status);
        renderPanel(panel);
        return entry;
    }).catch((error) => {
        console.error('[PriceHistory] request failed:', itemId, rangeKey, error);
        renderPanel(panel);
    });
    return fetchPromise;
}

let contextMenuEl = null;

function ensureContextMenu() {
    if (contextMenuEl) return contextMenuEl;
    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu hidden';
    document.body.appendChild(contextMenuEl);
    return contextMenuEl;
}

function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.classList.add('hidden');
}

function togglePreviewIgnore(itemId) {
    const session = window.__PREVIEW__?.state?.session;
    if (!session) return;
    const row = (session.item_rows || []).find((r) => r.item_id === itemId);
    if (!row) return;
    const delta = row.value || 0;
    row.ignored = !row.ignored;
    session.value = (session.value || 0) + (row.ignored ? -delta : delta);
    applyTrackerState(window.__PREVIEW__.state);
}

function showDropContextMenu(event, itemId, isIgnored) {
    event.preventDefault();
    const menu = ensureContextMenu();
    const label = isIgnored ? 'Un-ignore' : 'Ignore';
    menu.innerHTML = `<button type="button" class="context-menu-item" data-action="toggle-ignore">${label}</button>`;
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.classList.remove('hidden');

    const btn = menu.querySelector('[data-action="toggle-ignore"]');
    btn.onclick = async () => {
        hideContextMenu();
        if (state.viewingSessionId) return;
        if (window.__PREVIEW__?.enabled) {
            togglePreviewIgnore(itemId);
            return;
        }
        try {
            await api('toggle_ignore_item', itemId);
        } catch (e) {
            showStatus('Failed to toggle ignore', 'error', 2000);
        }
    };
}

function handleDropRowContextMenu(event) {
    const row = event.target.closest('[data-drop-row]');
    if (!row || !elements.dropsContainer.contains(row)) {
        hideContextMenu();
        return;
    }
    const itemId = row.dataset.itemId;
    if (!itemId) return;
    const isIgnored = row.dataset.ignored === 'true';
    showDropContextMenu(event, itemId, isIgnored);
}

async function handleDropRowClick(event) {
    // session drops panel controls (search toggle / clear, filter toggle,
    // category chips) — checked first so the row-click logic below isn't
    // reached when the user interacts with these
    const actionBtn = event.target.closest('[data-action]');
    if (actionBtn && elements.dropsContainer.contains(actionBtn)) {
        const action = actionBtn.dataset.action;
        if (action === 'toggle-search') {
            const opening = !state.sessionDrops.searchOpen;
            state.sessionDrops.searchOpen = opening;
            if (!opening) state.sessionDrops.searchTerm = '';
            renderDrops();
            if (opening) {
                const input = elements.dropsList?.querySelector('[data-drops-search]');
                input?.focus();
            }
            return;
        }
        if (action === 'toggle-filter') {
            state.sessionDrops.filterOpen = !state.sessionDrops.filterOpen;
            renderDrops();
            return;
        }
    }

    const chip = event.target.closest('[data-filter-category]');
    if (chip && elements.dropsContainer.contains(chip)) {
        const cat = chip.dataset.filterCategory;
        const selected = state.sessionDrops.filterCategories;
        if (cat === 'all') {
            // "All" is mutually exclusive — clears any specific selections
            state.sessionDrops.filterCategories = [];
        } else {
            // toggle: if already selected, remove; otherwise add
            const idx = selected.indexOf(cat);
            if (idx >= 0) selected.splice(idx, 1);
            else selected.push(cat);
        }
        renderDrops();
        return;
    }

    const rangeButton = event.target.closest('[data-price-history-range]');
    if (rangeButton && elements.dropsContainer.contains(rangeButton)) {
        const itemId = rangeButton.dataset.itemId;
        const rangeKey = rangeButton.dataset.priceHistoryRange;
        if (!itemId || !rangeKey) {
            return;
        }

        const rangePanel = rangeButton.closest('#drops-list-maps') ? 'maps' : 'drops';
        void loadPriceHistoryForRange(itemId, rangeKey, rangePanel);
        return;
    }

    const row = event.target.closest('[data-drop-row]');
    if (row && elements.dropsContainer.contains(row)) {
        const itemId = row.dataset.itemId;
        if (!itemId) {
            return;
        }

        // panel is inferred from ancestor container so clicks in the left
        // accordion and right drop list expand into independent slots
        const panel = row.closest('#drops-list-maps') ? 'maps' : 'drops';
        const expandedItemId = toggleExpandedPriceHistoryItem(itemId, panel);

        if (expandedItemId === itemId) {
            void loadPriceHistoryForRange(itemId, getActivePriceHistoryRangeKey(panel), panel);
            return;
        }

        renderPanel(panel);
        return;
    }

    const mapRow = event.target.closest('[data-map-row]');
    if (mapRow && elements.dropsContainer.contains(mapRow)) {
        const raw = mapRow.dataset.mapIndex;
        const index = Number(raw);
        if (Number.isFinite(index)) {
            toggleExpandedMap(index);
        }
    }
}

// ============ UI Actions ============

async function initialize() {
    elements.btnInitialize.disabled = true;
    setBtnLabel(elements.btnInitialize, 'Waiting...');

    try {
        const result = await api('request_initialization');
        showStatus(result.message, 'info');
        await pollTrackerState();
    } catch (e) {
        showStatus('Initialization failed', 'error');
        stopInitPolling();
        // Reset button on error
        elements.btnInitialize.disabled = false;
        setBtnLabel(elements.btnInitialize, 'Re-sync Bag');
    }
}

function setBtnLabel(btn, text) {
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = text;
    else btn.textContent = text;
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
        state.displayMap = null;
        state.inMap = false;
        renderUI();
        syncInitPolling();
        showStatus('Session reset', 'success', 2000);
    } catch (e) {
        showStatus('Reset failed', 'error', 3000);
    }
}

async function toggleEfficiencyUnit() {
    const next = !settings.efficiency_per_map;
    settings.efficiency_per_map = next;
    renderUI();
    const checkbox = document.getElementById('setting-efficiency-per-map');
    if (checkbox) checkbox.checked = next;
    try {
        await api('set_setting', 'efficiency_per_map', JSON.stringify(next));
        const bc = new BroadcastChannel('tli_settings_channel');
        bc.postMessage('update');
        bc.close();
    } catch (e) {
        console.error('Failed to persist efficiency unit:', e);
    }
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
    elements.btnOverlay.classList.toggle('active', overlayVisible);
}

// ============ Timer Update Loop ============

let timerInterval = null;

function startTimerLoop() {
    if (timerInterval) return;

    timerInterval = setInterval(() => {
        if (state.viewingSessionId) return;
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
    if (elements.btnViewDrops) {
        elements.btnViewDrops.addEventListener('click', () => setSubView('drops'));
    }
    if (elements.btnViewMaps) {
        elements.btnViewMaps.addEventListener('click', () => setSubView('maps'));
    }
    if (elements.statCardEfficiency) {
        elements.statCardEfficiency.addEventListener('click', toggleEfficiencyUnit);
    }
    elements.btnSettings.addEventListener('click', () => {
        openModal('settings');
        void loadSettings();
        void loadUpdateState();
    });
    elements.btnHistory.addEventListener('click', () => { openModal('history'); loadHistory(); });
    elements.btnOverlay.addEventListener('click', toggleOverlay);
    elements.btnResetSettings.addEventListener('click', resetDefaults);
    elements.dropsContainer.addEventListener('click', handleDropRowClick);
    elements.dropsContainer.addEventListener('contextmenu', handleDropRowContextMenu);
    elements.dropsContainer.addEventListener('input', (event) => {
        const input = event.target.closest('[data-drops-search]');
        if (!input) return;
        state.sessionDrops.searchTerm = input.value;
        renderDrops();
    });
    document.addEventListener('click', (e) => {
        if (!contextMenuEl || contextMenuEl.classList.contains('hidden')) return;
        if (!contextMenuEl.contains(e.target)) hideContextMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideContextMenu();
    });
    window.addEventListener('blur', hideContextMenu);

    // Settings modal
    elements.btnCloseSettings.addEventListener('click', () => closeModal('settings'));
    elements.btnSaveSettings.addEventListener('click', saveSettings);
    initToggleListeners();
    initSettingsTabs();
    initWidgetOverlayListeners();
    initGamePathListeners();
    initAppearanceListeners();

    // History modal
    elements.btnCloseHistory.addEventListener('click', () => closeModal('history'));

    // Session viewer banner exit
    if (elements.btnSessionViewerExit) {
        elements.btnSessionViewerExit.addEventListener('click', exitSessionViewing);
    }

    // Update check button (settings)
    if (elements.btnCheckUpdates) {
        elements.btnCheckUpdates.addEventListener('click', checkForUpdates);
    }

    // Update restart button (main window)
    if (elements.btnUpdateRestart) {
        elements.btnUpdateRestart.addEventListener('click', applyDownloadedUpdate);
    }

    // Update banner dismiss button (main window)
    if (elements.btnUpdateDismiss) {
        elements.btnUpdateDismiss.addEventListener('click', dismissUpdateBanner);
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
    void loadThemesList();
    void loadUpdateState();

    // Start timer loop
    startTimerLoop();

    // Initial UI render
    renderUI();

    // Auto-check for updates on startup (delay to avoid overwriting "Connected" message)
    setTimeout(() => checkForUpdatesOnStartup(), 4000);

    if (window.__PREVIEW__?.enabled) {
        applyTrackerState(window.__PREVIEW__.state);
        // Block live state pushes (would overwrite preview state) but let
        // everything else through so themes_update etc. still works.
        const originalHandler = window.onPythonEvent;
        window.onPythonEvent = (eventType, data) => {
            if (eventType === 'state') return;
            if (originalHandler) originalHandler(eventType, data);
        };
    }

    console.log('TLI Tracker UI initialized');
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
