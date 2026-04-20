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
        statSessionTaxLabel: document.getElementById('stat-session-tax-label'),
        statRate: document.getElementById('stat-rate'),
        statMapCount: document.getElementById('stat-map-count'),
        statCardEfficiency: document.getElementById('stat-card-efficiency'),
        dropsList: document.getElementById('drops-list'),
        btnInitialize: document.getElementById('btn-initialize'),
        btnPause: document.getElementById('btn-pause'),
        btnReset: document.getElementById('btn-reset'),
        btnModeSession: document.getElementById('btn-mode-session'),
        btnModeMap: document.getElementById('btn-mode-map'),
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
        sessionViewerBanner: document.getElementById('session-viewer-banner'),
        sessionViewerDate: document.getElementById('session-viewer-date'),
        btnSessionViewerExit: document.getElementById('btn-session-viewer-exit'),
        // Game path settings
        btnBrowseGamePath: document.getElementById('btn-browse-game-path'),
        gamePathStatus: document.getElementById('game-path-status'),
        // Settings (non-toggle)
        settingInvestment: document.getElementById('setting-investment'),
        btnSaveSettings: document.getElementById('btn-save-settings'),
        btnResetSettings: document.getElementById('btn-reset-defaults'),
        checkUpdatesLabel: document.getElementById('check-updates-label'),
        btnCheckUpdates: document.getElementById('btn-check-updates'),
        updateStatus: document.getElementById('update-status'),
        updateRow: document.getElementById('update-row'),
        // Main window update notification
        updateNotification: document.getElementById('update-notification'),
        updateNotificationText: document.getElementById('update-notification-text'),
        btnUpdateRestart: document.getElementById('btn-update-restart'),
        btnUpdateDismiss: document.getElementById('btn-update-dismiss'),
        updateNotificationNotes: document.getElementById('update-notification-notes'),
        updateNotificationNotesBody: document.getElementById('update-notification-notes-body'),
        // Settings tabs
        settingsTabs: document.querySelectorAll('.settings-tab'),
        tabGeneral: document.getElementById('tab-general'),
        tabOverlay: document.getElementById('tab-overlay'),
        tabAppearance: document.getElementById('tab-appearance'),
        // Appearance tab
        settingTheme: document.getElementById('setting-theme'),
        btnOpenThemesFolder: document.getElementById('btn-open-themes-folder'),
        btnDuplicateTheme: document.getElementById('btn-duplicate-theme'),
        btnDeleteTheme: document.getElementById('btn-delete-theme'),
        appearanceDeleteRow: document.getElementById('appearance-delete-row'),
        // Overlay settings
        settingWidgetOpacity: document.getElementById('setting-widget-opacity'),
        widgetOpacityValue: document.getElementById('widget-opacity-value'),
        editHotkeyHint: document.getElementById('edit-hotkey-hint'),
        settingHotkeyModifier: document.getElementById('setting-hotkey-modifier'),
        settingHotkeyKey: document.getElementById('setting-hotkey-key'),
        // Widget toggles (queried dynamically via .widget-toggle class)
    };
}
