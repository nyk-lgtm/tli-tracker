/**
 * Settings management
 */

import { elements } from './elements.js';
import { settings, updateSettings } from './state.js';
import { showStatus, hideStatus } from './utils.js';
import { closeModal } from './modals.js';

// Query all toggles with data-setting attribute
const getToggles = () => document.querySelectorAll('.toggle-checkbox[data-setting]');

// Query all widget toggles
const getWidgetToggles = () => document.querySelectorAll('.toggle-checkbox.widget-toggle');

// ============ Settings Tabs ============

export function initSettingsTabs() {
    elements.settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchSettingsTab(tabName);
        });
    });
}

export function switchSettingsTab(tabName) {
    // Update tab buttons
    elements.settingsTabs.forEach(tab => {
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Update tab panels
    const panels = document.querySelectorAll('.settings-panel');
    panels.forEach(panel => {
        if (panel.id === `tab-${tabName}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });
}

// ============ Settings ============

export function applyMapValueVisibility() {
    if (settings.show_map_value) {
        elements.statMapValue.classList.remove('hidden');
        elements.statSessionValue.classList.remove('hidden');
    } else {
        elements.statMapValue.classList.add('hidden');
        elements.statSessionValue.classList.add('hidden');
    }
}

function updateToggleVisual(checkbox) {
    const label = checkbox.nextElementSibling;
    label.classList.toggle('checked', checkbox.checked);
}

function updateAllToggleVisuals() {
    getToggles().forEach(toggle => updateToggleVisual(toggle));
    getWidgetToggles().forEach(toggle => updateToggleVisual(toggle));
}

export function initToggleListeners() {
    getToggles().forEach(toggle => {
        toggle.addEventListener('change', () => updateToggleVisual(toggle));
    });

    // Widget toggles
    getWidgetToggles().forEach(toggle => {
        toggle.addEventListener('change', () => updateToggleVisual(toggle));
    });
}

/**
 * Initialize widget overlay UI (Edit Layout button, opacity slider)
 */
export function initWidgetOverlayListeners() {
    // Edit Layout button
    if (elements.btnEditLayout) {
        elements.btnEditLayout.addEventListener('click', async () => {
            try {
                await api('set_overlay_edit_mode', true);
                closeModal('settings');
            } catch (e) {
                console.error('Failed to enter edit mode:', e);
                showStatus('Failed to enter edit mode', 'error');
            }
        });
    }

    // Widget opacity slider
    if (elements.settingWidgetOpacity) {
        elements.settingWidgetOpacity.addEventListener('input', (e) => {
            const val = e.target.value;
            if (elements.widgetOpacityValue) {
                elements.widgetOpacityValue.textContent = val + '%';
            }
            api('set_overlay_opacity', val / 100);
        });
    }
}

export async function loadSettings() {
    try {
        const newSettings = await api('get_settings');
        updateSettings(newSettings);

        // Detect widget overlay mode
        const useWidgetOverlay = newSettings.use_widget_overlay || false;

        // Show/hide appropriate overlay settings section
        if (elements.widgetOverlaySettings && elements.legacyOverlaySettings) {
            if (useWidgetOverlay) {
                elements.widgetOverlaySettings.classList.remove('hidden');
                elements.legacyOverlaySettings.classList.add('hidden');
            } else {
                elements.widgetOverlaySettings.classList.add('hidden');
                elements.legacyOverlaySettings.classList.remove('hidden');
            }
        }

        // Load all toggles from settings
        getToggles().forEach(toggle => {
            const key = toggle.dataset.setting;
            toggle.checked = settings[key] || false;
        });

        // Load widget toggles from widgets array
        if (useWidgetOverlay && newSettings.widgets) {
            getWidgetToggles().forEach(toggle => {
                const widgetId = toggle.dataset.widgetId;
                const widget = newSettings.widgets.find(w => w.id === widgetId);
                toggle.checked = widget ? widget.enabled : false;
            });
        }

        // Load non-toggle settings
        elements.settingOpacity.value = (settings.overlay_opacity || 0.9) * 100;
        elements.opacityValue.textContent = elements.settingOpacity.value + '%';
        elements.settingInvestment.value = settings.investment_per_map || 0;

        // Widget overlay opacity slider
        if (elements.settingWidgetOpacity && elements.widgetOpacityValue) {
            elements.settingWidgetOpacity.value = (settings.overlay_opacity || 0.9) * 100;
            elements.widgetOpacityValue.textContent = elements.settingWidgetOpacity.value + '%';
        }

        updateAllToggleVisuals();
        applyMapValueVisibility();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

export async function saveSettings() {
    // Save all toggles to settings
    getToggles().forEach(toggle => {
        const key = toggle.dataset.setting;
        settings[key] = toggle.checked;
    });

    // Save non-toggle settings
    // Use widget opacity slider if in widget mode, otherwise legacy slider
    const useWidgetOverlay = settings.use_widget_overlay || false;
    if (useWidgetOverlay && elements.settingWidgetOpacity) {
        settings.overlay_opacity = elements.settingWidgetOpacity.value / 100;
    } else {
        settings.overlay_opacity = elements.settingOpacity.value / 100;
    }
    settings.investment_per_map = parseInt(elements.settingInvestment.value) || 0;

    // Save widget enabled states if in widget mode
    if (useWidgetOverlay && settings.widgets) {
        getWidgetToggles().forEach(toggle => {
            const widgetId = toggle.dataset.widgetId;
            const widget = settings.widgets.find(w => w.id === widgetId);
            if (widget) {
                widget.enabled = toggle.checked;
            }
        });
    }

    try {
        await api('save_settings', settings);
        const bc = new BroadcastChannel('tli_settings_channel');
        bc.postMessage('update');
        bc.close();
        applyMapValueVisibility();
        closeModal('settings');
        showStatus('Settings saved', 'success');
        setTimeout(() => hideStatus(), 2000);
    } catch (e) {
        showStatus('Failed to save settings', 'error');
    }
}

export async function resetDefaults() {
    try {
        const result = await api('default_settings');

        if (result.status === 'ok') {
            await loadSettings();

            showStatus('Settings reset to defaults', 'success');
            setTimeout(() => hideStatus(), 2000);
        } else {
            showStatus('Error resetting settings', 'error');
        }
    } catch (e) {
        console.error('Reset defaults failed:', e);
        showStatus('Failed to reset settings', 'error');
    }
}
