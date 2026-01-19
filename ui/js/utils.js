/**
 * Utility functions for formatting and status display
 */

import { elements } from './elements.js';

// ============ Formatting Utilities ============

export function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hrs}h ${remainMins}m`;
    }

    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatValue(value) {
    if (value === null || value === undefined) return '+0';

    const prefix = value >= 0 ? '+' : '';
    const absValue = Math.abs(value);

    if (absValue >= 1000000) {
        return prefix + (value / 1000000).toFixed(1) + 'M';
    } else if (absValue >= 1000) {
        return prefix + (value / 1000).toFixed(1) + 'k';
    }

    return prefix + Math.round(value);
}

export function formatRate(value) {
    let text = '0';

    if (value) {
        if (value >= 1000000) {
            text = (value / 1000000).toFixed(1) + 'M';
        } else if (value >= 1000) {
            text = (value / 1000).toFixed(1) + 'k';
        } else {
            text = Math.round(value).toString();
        }
    }

    return `${text}<span class="text-xs text-gray-400">/hr</span>`;
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
