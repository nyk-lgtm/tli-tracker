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
    efficiency_per_map: false,
    investment_per_map: 0
};

// Allow settings to be replaced entirely (for loadSettings)
export function updateSettings(newSettings) {
    Object.assign(settings, newSettings);
}
