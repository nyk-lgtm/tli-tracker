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

// Valid keys for hotkey capture (F-keys, letters, numbers, special keys)
const VALID_HOTKEYS = [
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'Escape', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
];

/**
 * Initialize widget overlay UI (opacity slider, hotkey selectors)
 */
export function initWidgetOverlayListeners() {
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

    // Hotkey modifier dropdown - update hint when changed
    if (elements.settingHotkeyModifier) {
        elements.settingHotkeyModifier.addEventListener('change', updateHotkeyHint);
    }

    // Hotkey key capture input
    if (elements.settingHotkeyKey) {
        const input = elements.settingHotkeyKey;

        input.addEventListener('focus', () => {
            input.classList.add('listening');
            input.value = '';
            input.placeholder = 'Press key...';
        });

        input.addEventListener('blur', () => {
            input.classList.remove('listening');
            // If no valid key was captured, restore previous value
            if (!input.value || !VALID_HOTKEYS.includes(input.value)) {
                const hotkey = parseHotkey(settings.overlay_edit_mode_hotkey || 'Ctrl+F9');
                input.value = hotkey.key;
            }
            input.placeholder = '';
        });

        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Normalize key (uppercase for letters)
            let key = e.key;
            if (key.length === 1) {
                key = key.toUpperCase();
            }

            // Check if it's a valid key
            if (VALID_HOTKEYS.includes(key)) {
                input.value = key;
                input.classList.remove('listening');
                input.blur();
                updateHotkeyHint();
            }
        });
    }
}

/**
 * Update the hotkey hint display based on current dropdown values
 */
function updateHotkeyHint() {
    if (elements.editHotkeyHint && elements.settingHotkeyModifier && elements.settingHotkeyKey) {
        const modifier = elements.settingHotkeyModifier.value;
        const key = elements.settingHotkeyKey.value;
        elements.editHotkeyHint.textContent = `${modifier}+${key}`;
    }
}

/**
 * Parse hotkey string into modifier and key parts
 */
function parseHotkey(hotkeyStr) {
    const parts = hotkeyStr.split('+');
    if (parts.length === 2) {
        return { modifier: parts[0], key: parts[1] };
    }
    // Default
    return { modifier: 'Ctrl', key: 'F9' };
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

        // Hotkey settings
        if (elements.settingHotkeyModifier && elements.settingHotkeyKey) {
            const hotkey = parseHotkey(newSettings.overlay_edit_mode_hotkey || 'Ctrl+F9');
            elements.settingHotkeyModifier.value = hotkey.modifier;
            elements.settingHotkeyKey.value = hotkey.key;  // Works for both select and input
            updateHotkeyHint();
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
    settings.investment_per_map = parseFloat(elements.settingInvestment.value) || 0;

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

    // Save hotkey configuration and update at runtime
    if (elements.settingHotkeyModifier && elements.settingHotkeyKey) {
        const modifier = elements.settingHotkeyModifier.value;
        const key = elements.settingHotkeyKey.value;
        const newHotkey = `${modifier}+${key}`;
        settings.overlay_edit_mode_hotkey = newHotkey;

        // Update hotkey at runtime (no restart needed)
        try {
            await api('update_edit_mode_hotkey', newHotkey);
        } catch (e) {
            console.warn('Failed to update hotkey at runtime:', e);
        }
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
