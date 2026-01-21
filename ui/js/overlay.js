/**
 * TLI Overlay
 * Compact in-game overlay showing session stats and charts.
 * Requires: shared-utils.js, shared-charts.js, qwebchannel.js, qt_bridge.js
 */

// Overlay dimensions
const OVERLAY_WIDTH = 330;
const STATS_BAR_HEIGHT = 50;
const CHART_ROW_HEIGHT = 135;

// State
const state = {
    inMap: false,
    currentMap: null,
    session: null,
    pinned: false,
    showMapValue: true,
    efficiencyPerMap: false,
    chartPulseEnabled: false,
    chartEfficiencyEnabled: false,
    chartDonutEnabled: false
};

// DOM elements
const els = {
    wrapper: document.getElementById('overlay-wrapper'),
    container: document.getElementById('overlay-container'),
    mapIndicator: document.getElementById('map-indicator'),
    mapTime: document.getElementById('map-time'),
    mapValue: document.getElementById('map-value'),
    rate: document.getElementById('rate'),
    rateSuffix: document.getElementById('rate-suffix'),
    mapCount: document.getElementById('map-count'),
    chartsContainer: document.getElementById('charts-container'),
    chartPulse: document.getElementById('chart-pulse-content'),
    chartEfficiency: document.getElementById('chart-efficiency-content'),
    chartDonut: document.getElementById('chart-donut-content')
};

// ============ Settings Channel ============

const settingsChannel = new BroadcastChannel('tli_settings_channel');
settingsChannel.onmessage = (event) => {
    if (event.data === 'update') {
        console.log('Settings update received via BroadcastChannel');
        loadSettings();
    }
};

// ============ Python Event Handler ============

window.onPythonEvent = function(eventType, data) {
    if (eventType === 'state') updateState(data);
    if (eventType === 'settings_reset' || eventType === 'settings_update') {
        loadSettings();
    }
};

function updateState(data) {
    state.inMap = data.in_map;
    state.currentMap = data.current_map;
    state.session = data.session;
    render();
    renderCharts();
}

// ============ UI Rendering ============

function render() {
    // Map indicator
    els.mapIndicator.className = state.inMap ? 'in-map-dot' : 'in-map-dot inactive';

    // Map time and value
    if (state.currentMap) {
        els.mapTime.textContent = TLI.formatTime(state.currentMap.duration);
        els.mapValue.textContent = TLI.formatValue(state.currentMap.value);
        els.mapValue.className = state.currentMap.value >= 0
            ? 'stat-value positive'
            : 'stat-value negative';
    } else {
        els.mapTime.textContent = '-:-';
        els.mapValue.textContent = '+0';
        els.mapValue.className = 'stat-value positive';
    }

    // Session stats
    if (state.session) {
        const efficiencyValue = state.efficiencyPerMap
            ? state.session.value_per_map
            : state.session.value_per_hour;
        els.rate.textContent = TLI.formatCompact(efficiencyValue);
        els.mapCount.textContent = state.session.map_count;
    } else {
        els.rate.textContent = '0';
        els.mapCount.textContent = '0';
    }

    // Update rate suffix
    els.rateSuffix.textContent = state.efficiencyPerMap ? '/map' : '/hr';

    // Map value visibility
    const mapValueContainer = els.mapValue.closest('.stat');
    if (mapValueContainer) {
        mapValueContainer.style.display = state.showMapValue ? 'flex' : 'none';
    }
}

// ============ Chart Layout ============

// Track current layout to avoid unnecessary updates
let currentLayoutKey = '';

function updateChartsLayout() {
    const pulseEnabled = state.chartPulseEnabled;
    const efficiencyEnabled = state.chartEfficiencyEnabled;
    const donutEnabled = state.chartDonutEnabled;

    // Create a key representing current layout state
    const layoutKey = `${pulseEnabled}-${efficiencyEnabled}-${donutEnabled}`;
    if (layoutKey === currentLayoutKey) return; // No change
    currentLayoutKey = layoutKey;

    const smallChartsCount = (pulseEnabled ? 1 : 0) + (efficiencyEnabled ? 1 : 0);

    els.chartsContainer.classList.remove(
        'charts-1', 'charts-2', 'charts-3',
        'charts-small-1', 'charts-small-2', 'charts-donut-only', 'visible'
    );

    const pulseCard = els.chartsContainer.querySelector('.chart-pulse');
    const efficiencyCard = els.chartsContainer.querySelector('.chart-efficiency');
    const donutCard = els.chartsContainer.querySelector('.chart-donut');

    if (pulseCard) pulseCard.classList.toggle('hidden', !pulseEnabled);
    if (efficiencyCard) efficiencyCard.classList.toggle('hidden', !efficiencyEnabled);
    if (donutCard) donutCard.classList.toggle('hidden', !donutEnabled);

    // Calculate layout class and rows
    let rows = 0;
    if (donutEnabled && smallChartsCount === 0) {
        els.chartsContainer.classList.add('visible', 'charts-donut-only');
        rows = 1;
    } else if (donutEnabled && smallChartsCount > 0) {
        els.chartsContainer.classList.add('visible', `charts-small-${smallChartsCount}`);
        rows = 2;
    } else if (smallChartsCount > 0) {
        els.chartsContainer.classList.add('visible', `charts-small-${smallChartsCount}`);
        rows = 1;
    }

    // Calculate required height and resize
    let totalHeight = STATS_BAR_HEIGHT;
    if (rows > 0) {
        totalHeight += rows * CHART_ROW_HEIGHT;
    }

    if (typeof api !== 'undefined') {
        api('resize_overlay', OVERLAY_WIDTH, totalHeight);
    }
}

function renderCharts() {

    const session = state.session;
    const maps = session?.maps || [];
    const drops = session?.drops || [];
    const sessionDuration = session?.duration_total || 0;
    const currentValue = session?.value || 0;
    const currentMap = state.currentMap;

    try {
        if (state.chartPulseEnabled) {
            TLI.charts.renderPulse(els.chartPulse, maps, currentMap);
        }
        if (state.chartEfficiencyEnabled) {
            TLI.charts.renderEfficiency(els.chartEfficiency, maps, sessionDuration, currentValue);
        }
        if (state.chartDonutEnabled) {
            TLI.charts.renderDonut(els.chartDonut, drops);
        }
    } catch (e) {
        console.error('Chart render error:', e);
    }
}

// ============ Drag & Pin ============

function updatePinUI() {
    if (state.pinned) {
        els.wrapper.classList.remove('draggable');
    } else {
        els.wrapper.classList.add('draggable');
    }
}

function handleOverlayDrag(e) {
    if (state.pinned) return;
    if (e.button !== 0) return;
    if (typeof api !== 'undefined') {
        api('start_drag');
    }
    e.preventDefault();
}

// ============ Settings ============

async function loadSettings() {
    if (typeof api !== 'undefined') {
        try {
            const settings = await api('get_settings');
            state.pinned = settings.overlay_pinned !== undefined ? settings.overlay_pinned : false;
            state.showMapValue = settings.show_map_value !== undefined ? settings.show_map_value : true;
            state.efficiencyPerMap = settings.efficiency_per_map || false;
            state.chartPulseEnabled = settings.chart_pulse_enabled || false;
            state.chartEfficiencyEnabled = settings.chart_efficiency_enabled || false;
            state.chartDonutEnabled = settings.chart_donut_enabled || false;
            updatePinUI();
            updateChartsLayout();
            render();
            renderCharts();
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }
}

// ============ Initialize ============

els.wrapper.addEventListener('mousedown', handleOverlayDrag);

waitForApi().then(loadSettings);

// Timer loop for smooth updates (stats + all charts)
setInterval(() => {
    const { mapTicked, sessionTicked } = TLI.tickTimers(state);

    if (mapTicked) {
        els.mapTime.textContent = TLI.formatTime(state.currentMap.duration);
    }

    if (sessionTicked) {
        renderCharts();
    }
}, 1000);
