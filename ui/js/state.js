/**
 * Global application state
 */

export const state = {
    initialized: false,
    awaitingInit: false,
    inMap: false,
    displayMode: 'session',
    currentMap: null,
    displayMap: null,
    session: null,
    viewingSessionId: null,
    // session viewer only: 'drops' (session-wide list) or 'maps' (per-map accordion)
    viewerSubView: 'drops',
    // session viewer only: which map's drops are expanded in the accordion (null = none)
    expandedMapIndex: null
};

export const settings = {
    tax_enabled: true,
    overlay_opacity: 0.9,
    show_map_value: false,
    efficiency_per_map: false,
    investment_per_map: 0
};

// Allow settings to be replaced entirely (for loadSettings)
export function updateSettings(newSettings) {
    Object.assign(settings, newSettings);
}
