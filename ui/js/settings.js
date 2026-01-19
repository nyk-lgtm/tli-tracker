/**
 * Settings management
 */

import { elements } from './elements.js';
import { settings, updateSettings } from './state.js';
import { showStatus, hideStatus } from './utils.js';

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

export function updateToggleVisual(checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) return;

    const label = checkbox.nextElementSibling;
    if (checkbox.checked) {
        label.classList.add('checked');
    } else {
        label.classList.remove('checked');
    }
}

export async function loadSettings() {
    try {
        const newSettings = await api('get_settings');
        updateSettings(newSettings);
        elements.settingTax.checked = settings.tax_enabled || false;
        elements.settingMapValue.checked = settings.show_map_value || false;
        elements.settingRealTimeStats.checked = settings.use_real_time_stats || false;
        elements.settingOverlayPinned.checked = settings.overlay_pinned || false;
        elements.settingOpacity.value = (settings.overlay_opacity || 0.9) * 100;
        elements.opacityValue.textContent = elements.settingOpacity.value + '%';
        updateToggleVisual('setting-tax');
        updateToggleVisual('setting-map-value');
        updateToggleVisual('setting-real-time-stats');
        updateToggleVisual('setting-overlay-pinned');
        applyMapValueVisibility();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

export async function saveSettings() {
    settings.tax_enabled = elements.settingTax.checked;
    settings.show_map_value = elements.settingMapValue.checked;
    settings.use_real_time_stats = elements.settingRealTimeStats.checked;
    settings.overlay_pinned = elements.settingOverlayPinned.checked;
    settings.overlay_opacity = elements.settingOpacity.value / 100;

    try {
        await api('save_settings', settings);
        const bc = new BroadcastChannel('tli_settings_channel');
        bc.postMessage('update');
        bc.close();
        applyMapValueVisibility();
        // Close modal directly to avoid circular dependency
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.add('hidden');
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
