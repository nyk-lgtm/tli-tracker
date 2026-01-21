/**
 * TLI Tracker - Charts Module
 * Wraps shared chart rendering for ES6 module consumers.
 * Requires shared-charts.js to be loaded first.
 */

// Re-export from shared-charts.js (window.TLI.charts namespace)
export const CHART_COLORS = window.TLI.charts.COLORS;
export const renderPulseChart = window.TLI.charts.renderPulse;
export const renderEfficiencyChart = window.TLI.charts.renderEfficiency;
export const renderDonutChart = window.TLI.charts.renderDonut;

/**
 * Update the charts container visibility and grid layout
 * @param {HTMLElement} container - The charts container
 * @param {Object} settings - Chart settings
 */
export function updateChartsLayout(container, settings) {
    if (!container) return;

    const enabledCount = [
        settings.chart_pulse_enabled,
        settings.chart_efficiency_enabled,
        settings.chart_donut_enabled
    ].filter(Boolean).length;

    // Remove all chart count classes
    container.classList.remove('charts-1', 'charts-2', 'charts-3');

    if (enabledCount === 0) {
        container.classList.remove('visible');
    } else {
        container.classList.add('visible', `charts-${enabledCount}`);
    }

    // Show/hide individual chart cards
    const pulseCard = container.querySelector('.chart-pulse');
    const efficiencyCard = container.querySelector('.chart-efficiency');
    const donutCard = container.querySelector('.chart-donut');

    if (pulseCard) pulseCard.classList.toggle('hidden', !settings.chart_pulse_enabled);
    if (efficiencyCard) efficiencyCard.classList.toggle('hidden', !settings.chart_efficiency_enabled);
    if (donutCard) donutCard.classList.toggle('hidden', !settings.chart_donut_enabled);
}

/**
 * Render all enabled charts
 * @param {Object} elements - DOM element references
 * @param {Object} state - Current state with session and currentMap data
 * @param {Object} settings - Chart settings
 */
export function renderCharts(elements, state, settings) {
    if (!elements.chartsContainer) return;

    updateChartsLayout(elements.chartsContainer, settings);

    const session = state.session;
    const maps = session?.maps || [];
    const drops = session?.drops || [];
    const sessionDuration = session?.duration_total || 0;
    const currentValue = session?.value || 0;
    const currentMap = state.currentMap;

    // Render enabled charts
    if (settings.chart_pulse_enabled && elements.chartPulse) {
        renderPulseChart(elements.chartPulse, maps, currentMap);
    }

    if (settings.chart_efficiency_enabled && elements.chartEfficiency) {
        renderEfficiencyChart(elements.chartEfficiency, maps, sessionDuration, currentValue);
    }

    if (settings.chart_donut_enabled && elements.chartDonut) {
        renderDonutChart(elements.chartDonut, drops);
    }
}
