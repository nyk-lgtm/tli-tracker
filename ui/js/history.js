/**
 * Session history functionality
 */

import { formatValue, formatTime, formatRate, formatDate } from './utils.js';

// ============ History ============

export async function loadHistory() {
    try {
        const sessions = await api('get_session_history');
        const summary = await api('get_session_summary');

        // Update summary
        document.getElementById('history-total-value').textContent = formatValue(summary.total_value);
        document.getElementById('history-total-maps').textContent = summary.total_maps;
        const rateEl = document.getElementById('history-avg-rate');
        if (rateEl) {
            rateEl.innerHTML = formatRate(summary.average_value_per_hour);
        }

        // Render sessions list
        const listEl = document.getElementById('history-list');

        if (sessions.length === 0) {
            listEl.innerHTML = '<div class="text-center text-gray-500 py-4">No sessions yet</div>';
            return;
        }

        listEl.innerHTML = sessions.map(session => `
            <div class="session-item">
                <div class="session-item-date">
                    ${formatDate(session.started_at)}
                </div>
                <div class="session-item-stats">
                    <span>${formatTime(session.total_duration)}</span>
                    <span>${session.map_count} maps</span>
                </div>
                <div class="session-item-value">${formatValue(session.total_value)}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}
