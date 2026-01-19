/**
 * Update checking functionality
 */

import { elements } from './elements.js';
import { showConfirmDialog } from './modals.js';

// ============ Updates ============

export async function loadVersion() {
    try {
        const version = await api('get_version');
        if (version && elements.versionDisplay) {
            elements.versionDisplay.textContent = `v${version}`;
        }
    } catch (e) {
        console.error('Failed to load version:', e);
    }
}

export function showUpdateStatus(message, type = 'info') {
    const el = elements.updateStatus;
    const row = elements.updateRow;
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden', 'status-info', 'status-success', 'status-error');
    el.classList.add(`status-${type}`);
    if (row) row.classList.add('hidden');
}

export function hideUpdateStatus() {
    const el = elements.updateStatus;
    const row = elements.updateRow;
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('status-info', 'status-success', 'status-error');
    if (row) row.classList.remove('hidden');
}

export async function checkForUpdates() {
    const btn = elements.btnCheckUpdates;
    if (!btn) return;

    const originalText = btn.textContent;
    btn.textContent = 'Checking...';
    btn.disabled = true;
    hideUpdateStatus();

    try {
        const result = await api('check_for_update');

        if (result.status === 'error') {
            showUpdateStatus(`Update check failed: ${result.error}`, 'error');
            return;
        }

        if (!result.update_available) {
            showUpdateStatus("You're running the latest version!", 'success');
            setTimeout(() => hideUpdateStatus(), 3000);
            return;
        }

        // Update available - show confirmation
        hideUpdateStatus();
        const confirmed = await showConfirmDialog(
            'Update Available',
            `A new version is available!\n\nCurrent: v${result.current_version}\nNew: v${result.new_version}\n\nWould you like to download and install the update?`,
            'Update',
            'Later'
        );

        if (!confirmed) return;

        // Start download
        showUpdateStatus('Downloading update...', 'info');

        const downloadResult = await api('download_update', result.download_url, result.new_version);

        if (downloadResult.status === 'error') {
            showUpdateStatus(`Download failed: ${downloadResult.error}`, 'error');
            return;
        }

        // Launch installer
        showUpdateStatus('Launching installer...', 'info');

        const launchResult = await api('launch_installer', downloadResult.download_path);

        if (launchResult.status === 'error') {
            showUpdateStatus(`Failed to launch installer: ${launchResult.error}`, 'error');
            return;
        }

        // App will quit after launching installer
        showUpdateStatus('Update starting, closing app...', 'success');

        // Give user a moment to see the message, then quit
        setTimeout(() => {
            window.qt.quit_app();
        }, 1000);

        return; // Skip the finally block's button reset

    } catch (e) {
        console.error('Update check failed:', e);
        showUpdateStatus('Update check failed', 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}
