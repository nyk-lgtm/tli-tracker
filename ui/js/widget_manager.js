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
            minSize: { width: 120, height: 80 },
            maxSize: { width: 300, height: 200 },
        },
        efficiency_chart: {
            type: 'efficiency_chart',
            label: 'Efficiency Chart',
            defaultSize: { width: 160, height: 120 },
            minSize: { width: 120, height: 80 },
            maxSize: { width: 300, height: 200 },
        },
        donut_chart: {
            type: 'donut_chart',
            label: 'Loot Distribution',
            defaultSize: { width: 280, height: 120 },
            minSize: { width: 200, height: 100 },
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
     * Render stats bar widget
     */
    renderStatsBar(container) {
        const { currentMap, session } = this.state;

        const mapTime = currentMap ? TLI.formatTime(currentMap.duration) : '-:-';
        const mapValue = currentMap ? TLI.formatValue(currentMap.value) : '+0';
        const mapValueClass = (currentMap?.value ?? 0) >= 0 ? 'positive' : 'negative';

        const rate = session
            ? TLI.formatCompact(this.settings.efficiencyPerMap ? session.value_per_map : session.value_per_hour)
            : '0';
        const rateSuffix = this.settings.efficiencyPerMap ? '/map' : '/hr';
        const mapCount = session?.map_count ?? 0;

        const mapValueDisplay = this.settings.showMapValue ? 'flex' : 'none';
        const indicatorClass = this.state.inMap ? 'in-map-dot' : 'in-map-dot inactive';

        container.innerHTML = `
            <div class="stats-bar-content">
                <div class="stat-group">
                    <div class="${indicatorClass}"></div>
                    <div class="stat">
                        <span class="stat-value">${mapTime}</span>
                    </div>
                    <div class="stat" style="display: ${mapValueDisplay}">
                        <span class="stat-value ${mapValueClass}">${mapValue}</span>
                    </div>
                </div>
                <div class="divider"></div>
                <div class="stat-section">
                    <span class="stat-value">${rate}</span>
                    <span class="stat-label">${rateSuffix}</span>
                </div>
                <div class="divider"></div>
                <div class="stat-section">
                    <span class="stat-label">#</span>
                    <span class="stat-value">${mapCount}</span>
                </div>
            </div>
        `;
    },

    /**
     * Render pulse chart widget
     */
    renderPulseChart(container) {
        const { session, currentMap } = this.state;
        const maps = session?.maps || [];

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderPulse(container, maps, currentMap);
        } else {
            container.innerHTML = '<div class="chart-loading">Loading...</div>';
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

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderEfficiency(container, maps, sessionDuration, currentValue);
        } else {
            container.innerHTML = '<div class="chart-loading">Loading...</div>';
        }
    },

    /**
     * Render donut chart widget
     */
    renderDonutChart(container) {
        const { session } = this.state;
        const drops = session?.drops || [];

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderDonut(container, drops);
        } else {
            container.innerHTML = '<div class="chart-loading">Loading...</div>';
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

            this.renderWidgetContent(widget, content);
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
