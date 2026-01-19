/**
 * DOM element references
 * Initialized after DOMContentLoaded
 */

export let elements = {};

export function initElements() {
    elements = {
        statusBanner: document.getElementById('status-banner'),
        statusText: document.getElementById('status-text'),
        statMapTime: document.getElementById('stat-map-time'),
        statMapValue: document.getElementById('stat-map-value'),
        statSessionMapping: document.getElementById('stat-session-mapping'),
        statSessionTotal: document.getElementById('stat-session-total'),
        statSessionValue: document.getElementById('stat-session-value'),
        statRate: document.getElementById('stat-rate'),
        statMapCount: document.getElementById('stat-map-count'),
        dropsList: document.getElementById('drops-list'),
        btnInitialize: document.getElementById('btn-initialize'),
        btnReset: document.getElementById('btn-reset'),
        btnModeValue: document.getElementById('btn-mode-value'),
        btnModeItems: document.getElementById('btn-mode-items'),
        btnSettings: document.getElementById('btn-settings'),
        btnHistory: document.getElementById('btn-history'),
        btnOverlay: document.getElementById('btn-overlay'),
        settingsModal: document.getElementById('settings-modal'),
        historyModal: document.getElementById('history-modal'),
        settingTax: document.getElementById('setting-tax'),
        settingMapValue: document.getElementById('setting-map-value'),
        settingRealTimeStats: document.getElementById('setting-real-time-stats'),
        settingOverlayPinned: document.getElementById('setting-overlay-pinned'),
        settingOpacity: document.getElementById('setting-opacity'),
        opacityValue: document.getElementById('opacity-value'),
        btnSaveSettings: document.getElementById('btn-save-settings'),
        btnResetSettings: document.getElementById('btn-reset-defaults'),
        versionDisplay: document.getElementById('version-display'),
        btnCheckUpdates: document.getElementById('btn-check-updates'),
        updateStatus: document.getElementById('update-status'),
        updateRow: document.getElementById('update-row'),
        // Settings tabs
        settingsTabs: document.querySelectorAll('.settings-tab'),
        tabGeneral: document.getElementById('tab-general'),
        tabOverlay: document.getElementById('tab-overlay'),
        // Chart settings
        settingChartPulse: document.getElementById('setting-chart-pulse'),
        settingChartEfficiency: document.getElementById('setting-chart-efficiency'),
        settingChartDonut: document.getElementById('setting-chart-donut')
    };
}
