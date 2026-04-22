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
    // toggle between the session-wide drop list ('drops') and the per-map
    // accordion ('maps'). shown whenever a session is active, in both live
    // recording and the session viewer.
    subView: 'drops',
    // which map's drops are expanded in the accordion (null = none). in live
    // mode this auto-follows the current map on map_enter.
    expandedMapIndex: null,
    // session drops panel: search + category filter controls. session-scoped,
    // reset to defaults on a fresh session via resetSessionDropsFilters().
    // filterCategories is multi-select; empty array = show all categories.
    sessionDrops: {
        searchOpen: false,
        searchTerm: '',
        filterOpen: false,
        filterCategories: [],
    }
};

export function resetSessionDropsFilters() {
    state.sessionDrops.searchOpen = false;
    state.sessionDrops.searchTerm = '';
    state.sessionDrops.filterOpen = false;
    state.sessionDrops.filterCategories = [];
}

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
