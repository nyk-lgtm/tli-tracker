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
        btnCloseSettings: document.getElementById('btn-close-settings'),
        historyModal: document.getElementById('history-modal'),
        btnCloseHistory: document.getElementById('btn-close-history'),
        historyTotalValue: document.getElementById('history-total-value'),
        historyTotalMaps: document.getElementById('history-total-maps'),
        historyAvgRate: document.getElementById('history-avg-rate'),
        historyList: document.getElementById('history-list'),
        // Settings (non-toggle)
        settingInvestment: document.getElementById('setting-investment'),
        btnSaveSettings: document.getElementById('btn-save-settings'),
        btnResetSettings: document.getElementById('btn-reset-defaults'),
        checkUpdatesLabel: document.getElementById('check-updates-label'),
        btnCheckUpdates: document.getElementById('btn-check-updates'),
        updateStatus: document.getElementById('update-status'),
        updateRow: document.getElementById('update-row'),
        // Settings tabs
        settingsTabs: document.querySelectorAll('.settings-tab'),
        tabGeneral: document.getElementById('tab-general'),
        tabOverlay: document.getElementById('tab-overlay'),
        // Overlay settings
        settingWidgetOpacity: document.getElementById('setting-widget-opacity'),
        widgetOpacityValue: document.getElementById('widget-opacity-value'),
        editHotkeyHint: document.getElementById('edit-hotkey-hint'),
        settingHotkeyModifier: document.getElementById('setting-hotkey-modifier'),
        settingHotkeyKey: document.getElementById('setting-hotkey-key'),
        // Widget toggles (queried dynamically via .widget-toggle class)
    };
}
