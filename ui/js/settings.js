/**
 * Settings management
 */

import { elements } from './elements.js';
import { settings, updateSettings } from './state.js';
import { showStatus, hideStatus } from './utils.js';
import { closeModal } from './modals.js';

// Query all toggles with data-setting attribute
const getToggles = () => document.querySelectorAll('.toggle-checkbox[data-setting]');

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
}

export function initToggleListeners() {
    getToggles().forEach(toggle => {
        toggle.addEventListener('change', () => updateToggleVisual(toggle));
    });
}

export async function loadSettings() {
    try {
        const newSettings = await api('get_settings');
        updateSettings(newSettings);

        // Load all toggles from settings
        getToggles().forEach(toggle => {
            const key = toggle.dataset.setting;
            toggle.checked = settings[key] || false;
        });

        // Load non-toggle settings
        elements.settingOpacity.value = (settings.overlay_opacity || 0.9) * 100;
        elements.opacityValue.textContent = elements.settingOpacity.value + '%';
        elements.settingInvestment.value = settings.investment_per_map || 0;

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
    settings.overlay_opacity = elements.settingOpacity.value / 100;
    settings.investment_per_map = parseInt(elements.settingInvestment.value) || 0;

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
