/**
 * Utility functions for formatting and status display
 */

import { elements } from './elements.js';

// ============ Formatting Utilities ============
// Re-export from shared-utils.js (window.TLI namespace)

export const formatTime = window.TLI.formatTime;
export const formatValue = window.TLI.formatValue;
export const formatCompact = window.TLI.formatCompact;

export function formatRate(value) {
    return `${formatCompact(value)}<span class="text-xs text-gray-400">/hr</span>`;
}

export function formatDate(isoString) {
    try {
        const date = new Date(isoString);
        const now = new Date();

        if (date.toDateString() === now.toDateString()) {
            return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }

        return date.toLocaleDateString();
    } catch (e) {
        return isoString;
    }
}

// ============ Status Banner ============

let statusTimeout;

export function showStatus(message, type = 'info') {
    const el = elements.statusBanner;
    const text = elements.statusText;

    if (statusTimeout) clearTimeout(statusTimeout);
    text.textContent = message;
    el.classList.remove('hidden', 'status-info', 'status-success', 'status-warning', 'status-error');
    el.classList.add(`status-${type}`);
    statusTimeout = setTimeout(hideStatus, 2000);
}

export function hideStatus() {
    elements.statusBanner.classList.add('hidden');
}
