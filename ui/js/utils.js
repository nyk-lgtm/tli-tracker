/**
 * Utility functions for formatting and status display
 */

import { elements } from './elements.js';

// ============ Formatting Utilities ============
// Re-export from shared-utils.js (window.TLI namespace)

export const formatTime = window.TLI.formatTime;
export const formatValue = window.TLI.formatValue;
export const formatCompact = window.TLI.formatCompact;
export const tickTimers = window.TLI.tickTimers;

export function formatRate(value, perMap = false) {
    const suffix = perMap ? '/map' : '/hr';
    return `${formatCompact(value)}<span class="text-xs text-gray-400">${suffix}</span>`;
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
let hideTimeout;

export function showStatus(message, type = 'info', duration = 0) {
    const el = elements.statusBanner;
    const text = elements.statusText;

    // Clear any pending timeouts
    if (statusTimeout) clearTimeout(statusTimeout);
    if (hideTimeout) clearTimeout(hideTimeout);

    // Set content and type
    text.textContent = message;
    el.classList.remove('hidden', 'show', 'status-info', 'status-success', 'status-warning', 'status-error');
    el.classList.add(`status-${type}`);

    // Trigger reflow to restart animation, then show
    void el.offsetWidth;
    el.classList.add('show');

    // Auto-hide after duration (if specified)
    if (duration > 0) {
        statusTimeout = setTimeout(hideStatus, duration);
    }
}

export function hideStatus() {
    const el = elements.statusBanner;

    if (hideTimeout) clearTimeout(hideTimeout);

    // Animate out
    el.classList.remove('show');

    // Hide after animation completes
    hideTimeout = setTimeout(() => {
        el.classList.add('hidden');
    }, 300);
}
