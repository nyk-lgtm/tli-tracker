/**
 * Widget Manager
 *
 * Handles widget lifecycle, rendering, and state management for the overlay.
 * Mirrors the Python widget_registry.py definitions.
 */

const WidgetManager = {
    EDIT_HINT_MARGIN: 16,
    EDIT_HINT_GAP: 14,

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
        editHintDismissed: false,
        editModeHotkey: 'Ctrl+F9',
    },

    editHintLayoutFrame: null,
    lastEditHintRegion: null,
    editHintResizeBound: false,

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

        // Show first-run edit-mode hint if not yet dismissed
        this.maybeShowEditHint();

        if (!this.editHintResizeBound) {
            this.editHintResizeBound = true;
            window.addEventListener('resize', () => this.scheduleEditHintLayoutUpdate());
        }

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
            this.settings.editHintDismissed = settings.overlay_edit_hint_dismissed ?? false;
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

        this.scheduleEditHintLayoutUpdate();
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

        // In-map indicator — amber when paused, teal when in-map, gray otherwise
        const paused = this.state.session?.paused;
        const indicator = container.querySelector('[data-el="indicator"]');
        if (indicator) {
            indicator.classList.toggle('paused', !!paused);
            indicator.classList.toggle('inactive', !this.state.inMap && !paused);
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

        // Reuse existing structure if present, otherwise create it
        let chartContainer = container.querySelector('.chart-widget-inner');
        let chartContent = container.querySelector('.chart-content');

        if (!chartContainer) {
            chartContainer = document.createElement('div');
            chartContainer.className = 'chart-widget-inner';

            const title = document.createElement('div');
            title.className = 'chart-title';
            title.textContent = 'Value/Map';
            chartContainer.appendChild(title);

            chartContent = document.createElement('div');
            chartContent.className = 'chart-content';
            chartContainer.appendChild(chartContent);

            container.replaceChildren(chartContainer);
        }

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

        // Reuse existing structure if present, otherwise create it
        let chartContainer = container.querySelector('.chart-widget-inner');
        let chartContent = container.querySelector('.chart-content');

        if (!chartContainer) {
            chartContainer = document.createElement('div');
            chartContainer.className = 'chart-widget-inner';

            const title = document.createElement('div');
            title.className = 'chart-title';
            title.textContent = 'Efficiency';
            chartContainer.appendChild(title);

            chartContent = document.createElement('div');
            chartContent.className = 'chart-content';
            chartContainer.appendChild(chartContent);

            container.replaceChildren(chartContainer);
        }

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
        const categoryTotals = session?.category_totals || [];

        // Reuse existing structure if present, otherwise create it
        let chartContainer = container.querySelector('.chart-widget-inner');
        let chartContent = container.querySelector('.chart-content');

        if (!chartContainer) {
            chartContainer = document.createElement('div');
            chartContainer.className = 'chart-widget-inner';

            const title = document.createElement('div');
            title.className = 'chart-title';
            title.textContent = 'Loot Distribution';
            chartContainer.appendChild(title);

            chartContent = document.createElement('div');
            chartContent.className = 'chart-content';
            chartContainer.appendChild(chartContent);

            container.replaceChildren(chartContainer);
        }

        if (typeof TLI !== 'undefined' && TLI.charts) {
            TLI.charts.renderDonut(chartContent, categoryTotals);
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
        const paused = !!this.state.session?.paused;

        for (const widget of this.widgets) {
            if (!widget.enabled) continue;

            const el = document.getElementById(widget.id);
            if (!el) continue;

            const content = el.querySelector('.widget-content');
            if (!content) continue;

            content.classList.toggle('paused', paused);

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
                    // Only update time-sensitive widgets (stats bar, efficiency chart)
                    // Pulse and donut charts only change when data arrives, not on timer
                    this.updateTimerWidgets();
                }
            }
        }, 1000);
    },

    /**
     * Update only time-sensitive widgets (called by timer loop)
     */
    updateTimerWidgets() {
        for (const widget of this.widgets) {
            if (!widget.enabled) continue;

            const el = document.getElementById(widget.id);
            if (!el) continue;

            const content = el.querySelector('.widget-content');
            if (!content) continue;

            // Only update stats bar and efficiency chart on timer tick
            if (widget.type === 'stats_bar') {
                this.updateStatsBar(content);
            } else if (widget.type === 'efficiency_chart') {
                this.renderWidgetContent(widget, content);
            }
            // Skip pulse_chart and donut_chart - they only change on data updates
        }
    },

    /**
     * Handle settings update
     */
    async onSettingsUpdate() {
        await this.loadWidgets();
        this.renderAll();
        this.updateAllWidgets();
        this.updateHotkeyLabel();
        this.maybeShowEditHint();
        this.scheduleEditHintLayoutUpdate();
    },

    /**
     * Update the edit mode hotkey label
     */
    updateHotkeyLabel() {
        const label = document.getElementById('edit-mode-hotkey');
        if (label && this.settings.editModeHotkey) {
            label.textContent = this.settings.editModeHotkey;
        }
        const hintKey = document.getElementById('edit-hint-hotkey');
        if (hintKey && this.settings.editModeHotkey) {
            hintKey.textContent = this.settings.editModeHotkey;
        }
    },

    EDIT_HINT_STORAGE_KEY: 'tli_overlay_edit_hint_dismissed',

    /**
     * Show the first-run edit-mode hint badge unless previously dismissed.
     */
    maybeShowEditHint() {
        const badge = document.getElementById('edit-hint-badge');
        if (!badge) return;

        let dismissed = this.settings.editHintDismissed;
        try {
            const legacyDismissed = localStorage.getItem(this.EDIT_HINT_STORAGE_KEY) === '1';
            if (legacyDismissed && !dismissed) {
                dismissed = true;
                this.settings.editHintDismissed = true;
                this.persistEditHintDismissal(true);
            }
        } catch (e) {
            // storage unavailable — rely on config-backed dismissal state
        }

        const hasWidgets = this.widgets.some(w => w.enabled);
        if (dismissed || !hasWidgets) {
            badge.classList.add('hidden');
            this.lastEditHintRegion = null;
            this.syncEditHintRegion(null);
            return;
        }

        badge.classList.remove('hidden');
        this.scheduleEditHintLayoutUpdate();

        const close = document.getElementById('edit-hint-close');
        if (close && !close.dataset.bound) {
            close.dataset.bound = '1';
            close.addEventListener('click', () => this.dismissEditHint());
        }
    },

    /**
     * Hide and persist dismissal of the first-run edit-mode hint.
     */
    dismissEditHint() {
        const badge = document.getElementById('edit-hint-badge');
        if (badge) badge.classList.add('hidden');
        this.settings.editHintDismissed = true;
        this.lastEditHintRegion = null;
        this.syncEditHintRegion(null);
        this.persistEditHintDismissal(true);
        try {
            localStorage.setItem(this.EDIT_HINT_STORAGE_KEY, '1');
        } catch (e) {
            // storage unavailable — badge will reappear next session
        }
    },

    persistEditHintDismissal(dismissed) {
        if (typeof api === 'undefined') return;

        api('set_overlay_edit_hint_dismissed', dismissed).catch((error) => {
            console.error('[WidgetManager] Failed to persist edit hint dismissal:', error);
        });
    },

    /**
     * Reposition the edit hint near the active widget cluster.
     */
    scheduleEditHintLayoutUpdate() {
        if (this.editHintLayoutFrame) return;

        this.editHintLayoutFrame = window.requestAnimationFrame(() => {
            this.editHintLayoutFrame = null;
            this.updateEditHintLayout();
        });
    },

    updateEditHintLayout() {
        const badge = document.getElementById('edit-hint-badge');
        if (!badge || badge.classList.contains('hidden')) {
            this.syncEditHintRegion(null);
            return;
        }

        const anchor = this.getEnabledWidgetBounds();
        if (!anchor) {
            badge.classList.add('hidden');
            this.lastEditHintRegion = null;
            this.syncEditHintRegion(null);
            return;
        }

        const badgeSize = this.measureEditHintBadge(badge);
        const placement = this.computeEditHintPlacement(anchor, badgeSize, {
            width: window.innerWidth,
            height: window.innerHeight,
        });

        badge.style.left = `${placement.x}px`;
        badge.style.top = `${placement.y}px`;
        badge.style.bottom = 'auto';
        badge.style.transform = 'none';
        badge.dataset.placement = placement.placement;

        this.syncEditHintRegion({
            x: placement.x,
            y: placement.y,
            width: badgeSize.width,
            height: badgeSize.height,
        });
    },

    measureEditHintBadge(badge) {
        const prevLeft = badge.style.left;
        const prevTop = badge.style.top;
        const prevBottom = badge.style.bottom;
        const prevTransform = badge.style.transform;
        const prevVisibility = badge.style.visibility;

        badge.style.left = '0px';
        badge.style.top = '0px';
        badge.style.bottom = 'auto';
        badge.style.transform = 'none';
        badge.style.visibility = 'hidden';

        const rect = badge.getBoundingClientRect();

        badge.style.left = prevLeft;
        badge.style.top = prevTop;
        badge.style.bottom = prevBottom;
        badge.style.transform = prevTransform;
        badge.style.visibility = prevVisibility;

        return {
            width: Math.ceil(rect.width),
            height: Math.ceil(rect.height),
        };
    },

    getEnabledWidgetBounds() {
        const elements = this.widgets
            .filter(widget => widget.enabled)
            .map(widget => document.getElementById(widget.id))
            .filter(Boolean);

        if (elements.length === 0) return null;

        return elements.reduce((bounds, el) => {
            const rect = el.getBoundingClientRect();
            return {
                left: Math.min(bounds.left, rect.left),
                top: Math.min(bounds.top, rect.top),
                right: Math.max(bounds.right, rect.right),
                bottom: Math.max(bounds.bottom, rect.bottom),
            };
        }, {
            left: Number.POSITIVE_INFINITY,
            top: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            bottom: Number.NEGATIVE_INFINITY,
        });
    },

    computeEditHintPlacement(anchor, badgeSize, viewport) {
        const margin = this.EDIT_HINT_MARGIN;
        const gap = this.EDIT_HINT_GAP;
        const anchorCenterX = (anchor.left + anchor.right) / 2;
        const anchorCenterY = (anchor.top + anchor.bottom) / 2;

        const candidates = [
            {
                placement: 'above',
                x: anchorCenterX - (badgeSize.width / 2),
                y: anchor.top - badgeSize.height - gap,
            },
            {
                placement: 'below',
                x: anchorCenterX - (badgeSize.width / 2),
                y: anchor.bottom + gap,
            },
            {
                placement: 'right',
                x: anchor.right + gap,
                y: anchorCenterY - (badgeSize.height / 2),
            },
            {
                placement: 'left',
                x: anchor.left - badgeSize.width - gap,
                y: anchorCenterY - (badgeSize.height / 2),
            },
        ];

        const fits = (candidate) => (
            candidate.x >= margin
            && candidate.y >= margin
            && (candidate.x + badgeSize.width) <= (viewport.width - margin)
            && (candidate.y + badgeSize.height) <= (viewport.height - margin)
        );

        const chosen = candidates.find(fits) || candidates[0];

        return {
            placement: chosen.placement,
            x: this.clampEditHintCoordinate(chosen.x, margin, viewport.width - badgeSize.width - margin),
            y: this.clampEditHintCoordinate(chosen.y, margin, viewport.height - badgeSize.height - margin),
        };
    },

    clampEditHintCoordinate(value, min, max) {
        if (max < min) return min;
        return Math.max(min, Math.min(max, value));
    },

    syncEditHintRegion(rect) {
        const payload = rect
            ? {
                visible: true,
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                },
            }
            : { visible: false };

        const nextRegion = JSON.stringify(payload);
        if (this.lastEditHintRegion === nextRegion) return;
        this.lastEditHintRegion = nextRegion;

        if (typeof api === 'undefined') return;

        api('update_overlay_hint_region', payload).catch((error) => {
            console.error('[WidgetManager] Failed to sync edit hint region:', error);
        });
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
    waitForApi().then(async () => {
        await WidgetManager.init();
        if (window.__PREVIEW__?.enabled) {
            WidgetManager.updateState(window.__PREVIEW__.state);
            window.onPythonEvent = () => {};
        }
    });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        // Fallback: wait a bit for API
        setTimeout(() => WidgetManager.init(), 500);
    });
}
