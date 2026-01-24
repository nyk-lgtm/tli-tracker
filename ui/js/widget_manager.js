/**
 * Widget Manager
 *
 * Handles widget lifecycle, rendering, and state management for the overlay.
 * Mirrors the Python widget_registry.py definitions.
 */

const WidgetManager = {
    // Widget type definitions (mirrors Python widget_registry.py)
    WIDGET_TYPES: {
        stats_bar: {
            type: 'stats_bar',
            label: 'Stats Bar',
            defaultSize: { width: 330, height: 50 },
            minSize: { width: 250, height: 40 },
            maxSize: { width: 500, height: 80 },
        },
        pulse_chart: {
            type: 'pulse_chart',
            label: 'Value/Map Chart',
            defaultSize: { width: 160, height: 120 },
            minSize: { width: 150, height: 80 },
            maxSize: { width: 300, height: 200 },
        },
        efficiency_chart: {
            type: 'efficiency_chart',
            label: 'Efficiency Chart',
            defaultSize: { width: 160, height: 120 },
            minSize: { width: 140, height: 80 },
            maxSize: { width: 300, height: 200 },
        },
        donut_chart: {
            type: 'donut_chart',
            label: 'Loot Distribution',
            defaultSize: { width: 280, height: 120 },
            minSize: { width: 220, height: 100 },
            maxSize: { width: 400, height: 200 },
        },
    },

    // Active widget instances
    widgets: [],

    // Current state from tracker
    state: {
        inMap: false,
        currentMap: null,
        session: null,
    },

    // Settings
    settings: {
        opacity: 0.9,
        showMapValue: true,
        efficiencyPerMap: false,
        editModeHotkey: 'Ctrl+F9',
    },

    /**
     * Initialize the widget manager
     */
    async init() {
        console.log('[WidgetManager] Initializing...');

        // Load widgets from settings
        await this.loadWidgets();

        // Render all enabled widgets
        this.renderAll();

        // Update hotkey label
        this.updateHotkeyLabel();

        // Start timer loop for live updates
        this.startTimerLoop();

        console.log('[WidgetManager] Initialized with', this.widgets.length, 'widgets');
    },

    /**
     * Load widget configuration from Python backend
     */
    async loadWidgets() {
        if (typeof api === 'undefined') {
            console.warn('[WidgetManager] API not available');
            return;
        }

        try {
            const settings = await api('get_settings');
            this.widgets = settings.widgets || [];
            this.settings.opacity = settings.overlay_opacity ?? 0.9;
            this.settings.showMapValue = settings.show_map_value ?? true;
            this.settings.efficiencyPerMap = settings.efficiency_per_map ?? false;
            this.settings.editModeHotkey = settings.overlay_edit_mode_hotkey ?? 'Ctrl+F9';

            // Apply opacity
            document.documentElement.style.setProperty('--bg-opacity', this.settings.opacity);
        } catch (e) {
            console.error('[WidgetManager] Failed to load widgets:', e);
        }
    },

    /**
     * Render all enabled widgets
     */
    renderAll() {
        const canvas = document.getElementById('widget-canvas');
        if (!canvas) return;

        // Clear existing widgets (keep edit mode overlay and snap guides)
        const existingWidgets = canvas.querySelectorAll('.widget');
        existingWidgets.forEach(w => w.remove());

        // Render each enabled widget
        for (const widget of this.widgets) {
            if (widget.enabled) {
                this.renderWidget(widget);
            }
        }
    },

    /**
     * Render a single widget
     */
    renderWidget(widget) {
        const canvas = document.getElementById('widget-canvas');
        if (!canvas) return;

        // Create widget container
        const el = document.createElement('div');
        el.id = widget.id;
        el.className = 'widget';
        el.dataset.type = widget.type;
        el.style.left = `${widget.position.x}px`;
        el.style.top = `${widget.position.y}px`;
        el.style.width = `${widget.size.width}px`;
        el.style.height = `${widget.size.height}px`;

        // Create inner content container
        const content = document.createElement('div');
        content.className = 'widget-content';
        el.appendChild(content);

        // Add resize handles (hidden until edit mode)
        const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
        for (const handle of handles) {
            const handleEl = document.createElement('div');
            handleEl.className = `widget-resize-handle ${handle}`;
            el.appendChild(handleEl);
        }

        canvas.appendChild(el);

        // Render widget content
        this.renderWidgetContent(widget, content);
    },

    /**
     * Render the content of a specific widget type
     */
    renderWidgetContent(widget, container) {
        switch (widget.type) {
            case 'stats_bar':
                this.renderStatsBar(container);
                break;
            case 'pulse_chart':
                this.renderPulseChart(container);
                break;
            case 'efficiency_chart':
                this.renderEfficiencyChart(container);
                break;
            case 'donut_chart':
                this.renderDonutChart(container);
                break;
            default:
                container.innerHTML = `<div class="widget-unknown">Unknown: ${widget.type}</div>`;
        }
    },

    /**
     * Render stats bar widget (initial DOM structure)
     */
    renderStatsBar(container) {
        container.innerHTML = `
            <div class="stats-bar-content">
                <div class="stat-group">
                    <div class="in-map-dot" data-el="indicator"></div>
                    <div class="stat">
                        <span class="stat-value" data-el="map-time">-:-</span>
                    </div>
                    <div class="stat" data-el="map-value-container">
                        <span class="stat-value" data-el="map-value">+0</span>
                    </div>
                </div>
                <div class="divider"></div>
                <div class="stat-section">
                    <span class="stat-value" data-el="rate">0</span>
                    <span class="stat-label" data-el="rate-suffix">/hr</span>
                </div>
                <div class="divider"></div>
                <div class="stat-section">
                    <span class="stat-label">#</span>
                    <span class="stat-value" data-el="map-count">0</span>
                </div>
            </div>
        `;
        // Apply initial values
        this.updateStatsBar(container);
    },

    /**
     * Update stats bar values (targeted textContent updates)
     */
    updateStatsBar(container) {
        const { currentMap, session } = this.state;

        // Map time
        const timeEl = container.querySelector('[data-el="map-time"]');
        if (timeEl) {
            timeEl.textContent = currentMap ? TLI.formatTime(currentMap.duration) : '-:-';
        }

        // Map value
        const valueEl = container.querySelector('[data-el="map-value"]');
        const valueContainer = container.querySelector('[data-el="map-value-container"]');
        if (valueEl) {
            const value = currentMap?.value ?? 0;
            valueEl.textContent = currentMap ? TLI.formatValue(value) : '+0';
            valueEl.classList.toggle('positive', value >= 0);
            valueEl.classList.toggle('negative', value < 0);
        }
        if (valueContainer) {
            valueContainer.style.display = this.settings.showMapValue ? 'flex' : 'none';
        }

        // In-map indicator
        const indicator = container.querySelector('[data-el="indicator"]');
        if (indicator) {
            indicator.classList.toggle('inactive', !this.state.inMap);
        }

        // Rate
        const rateEl = container.querySelector('[data-el="rate"]');
        const rateSuffixEl = container.querySelector('[data-el="rate-suffix"]');
        if (rateEl) {
            const rate = session
                ? TLI.formatCompact(this.settings.efficiencyPerMap ? session.value_per_map : session.value_per_hour)
                : '0';
            rateEl.textContent = rate;
        }
        if (rateSuffixEl) {
            rateSuffixEl.textContent = this.settings.efficiencyPerMap ? '/map' : '/hr';
        }

        // Map count
        const countEl = container.querySelector('[data-el="map-count"]');
        if (countEl) {
            countEl.textContent = session?.map_count ?? 0;
        }
    },

    /**
     * Render pulse chart widget
     */
    renderPulseChart(container) {
        const { session, currentMap } = this.state;
        const maps = session?.maps || [];

        // Create chart structure with title
        const chartContainer = document.createElement('div');
        chartContainer.className = 'chart-widget-inner';

        const title = document.createElement('div');
        title.className = 'chart-title';
        title.textContent = 'Value/Map';
        chartContainer.appendChild(title);

        const chartContent = document.createElement('div');
        chartContent.className = 'chart-content';
        chartContainer.appendChild(chartContent);

        container.innerHTML = '';
        container.appendChild(chartContainer);

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderPulse(chartContent, maps, currentMap);
        } else {
            chartContent.innerHTML = '<div class="chart-loading">Loading...</div>';
        }
    },

    /**
     * Render efficiency chart widget
     */
    renderEfficiencyChart(container) {
        const { session } = this.state;
        const maps = session?.maps || [];
        const sessionDuration = session?.duration_total || 0;
        const currentValue = session?.value || 0;

        // Create chart structure with title
        const chartContainer = document.createElement('div');
        chartContainer.className = 'chart-widget-inner';

        const title = document.createElement('div');
        title.className = 'chart-title';
        title.textContent = 'Efficiency';
        chartContainer.appendChild(title);

        const chartContent = document.createElement('div');
        chartContent.className = 'chart-content';
        chartContainer.appendChild(chartContent);

        container.innerHTML = '';
        container.appendChild(chartContainer);

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderEfficiency(chartContent, maps, sessionDuration, currentValue);
        } else {
            chartContent.innerHTML = '<div class="chart-loading">Loading...</div>';
        }
    },

    /**
     * Render donut chart widget
     */
    renderDonutChart(container) {
        const { session } = this.state;
        const drops = session?.drops || [];

        // Create chart structure with title
        const chartContainer = document.createElement('div');
        chartContainer.className = 'chart-widget-inner';

        const title = document.createElement('div');
        title.className = 'chart-title';
        title.textContent = 'Loot Distribution';
        chartContainer.appendChild(title);

        const chartContent = document.createElement('div');
        chartContent.className = 'chart-content';
        chartContainer.appendChild(chartContent);

        container.innerHTML = '';
        container.appendChild(chartContainer);

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderDonut(chartContent, drops);
        } else {
            chartContent.innerHTML = '<div class="chart-loading">Loading...</div>';
        }
    },

    /**
     * Update state from tracker
     */
    updateState(data) {
        this.state.inMap = data.in_map;
        this.state.currentMap = data.current_map;
        this.state.session = data.session;
        this.updateAllWidgets();
    },

    /**
     * Update all widget contents (without re-rendering containers)
     */
    updateAllWidgets() {
        for (const widget of this.widgets) {
            if (!widget.enabled) continue;

            const el = document.getElementById(widget.id);
            if (!el) continue;

            const content = el.querySelector('.widget-content');
            if (!content) continue;

            // Use targeted updates for stats bar, full re-render for charts
            if (widget.type === 'stats_bar') {
                this.updateStatsBar(content);
            } else {
                this.renderWidgetContent(widget, content);
            }
        }
    },

    /**
     * Start timer loop for live updates (map time ticking)
     */
    startTimerLoop() {
        setInterval(() => {
            if (typeof TLI !== 'undefined') {
                const { mapTicked, sessionTicked } = TLI.tickTimers(this.state);
                if (mapTicked || sessionTicked) {
                    this.updateAllWidgets();
                }
            }
        }, 1000);
    },

    /**
     * Handle settings update
     */
    async onSettingsUpdate() {
        await this.loadWidgets();
        this.renderAll();
        this.updateHotkeyLabel();
    },

    /**
     * Update the edit mode hotkey label
     */
    updateHotkeyLabel() {
        const label = document.getElementById('edit-mode-hotkey');
        if (label && this.settings.editModeHotkey) {
            label.textContent = this.settings.editModeHotkey;
        }
    },

    /**
     * Get widget by ID
     */
    getWidget(id) {
        return this.widgets.find(w => w.id === id);
    },

    /**
     * Get widget element by ID
     */
    getWidgetElement(id) {
        return document.getElementById(id);
    },
};

// Settings channel for cross-window updates
const settingsChannel = new BroadcastChannel('tli_settings_channel');
settingsChannel.onmessage = (event) => {
    if (event.data === 'update') {
        console.log('[WidgetManager] Settings update received');
        WidgetManager.onSettingsUpdate();
    }
};

// Python event handler
window.onPythonEvent = function(eventType, data) {
    if (eventType === 'state') {
        WidgetManager.updateState(data);
    }
    if (eventType === 'settings_reset' || eventType === 'settings_update') {
        WidgetManager.onSettingsUpdate();
    }
};

// Initialize when API is ready
if (typeof waitForApi !== 'undefined') {
    waitForApi().then(() => WidgetManager.init());
} else {
    document.addEventListener('DOMContentLoaded', () => {
        // Fallback: wait a bit for API
        setTimeout(() => WidgetManager.init(), 500);
    });
}
