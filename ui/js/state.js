/**
 * Global application state
 */

export const state = {
    initialized: false,
    awaitingInit: false,
    inMap: false,
    displayMode: 'value',
    currentMap: null,
    session: null,
    drops: [],
    prices: {}
};

export const settings = {
    tax_enabled: false,
    overlay_opacity: 0.9,
    show_map_value: false,
    overlay_pinned: false,
    use_real_time_stats: false,
    efficiency_per_map: false,
    chart_pulse_enabled: false,
    chart_efficiency_enabled: false,
    chart_donut_enabled: false
};

// Allow settings to be replaced entirely (for loadSettings)
export function updateSettings(newSettings) {
    Object.assign(settings, newSettings);
}
