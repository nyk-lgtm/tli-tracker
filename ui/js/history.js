/**
 * Session history functionality
 */

import { elements } from './elements.js';
import { formatValue, formatTime, formatRate, formatDate } from './utils.js';

// ============ History ============

export async function loadHistory() {
    try {
        const sessions = await api('get_session_history');
        const summary = await api('get_session_summary');

        // Update summary
        elements.historyTotalValue.textContent = formatValue(summary.total_value);
        elements.historyTotalMaps.textContent = summary.total_maps;
        elements.historyAvgRate.innerHTML = formatRate(summary.average_value_per_hour);

        if (sessions.length === 0) {
            elements.historyList.innerHTML = '<div class="text-center text-gray-500 py-4">No sessions yet</div>';
            return;
        }

        elements.historyList.innerHTML = sessions.map(session => `
            <div class="session-item">
                <div class="session-item-date">
                    ${formatDate(session.started_at)}
                </div>
                <div class="session-item-stats">
                    <span>${formatTime(session.total_duration)}</span>
                    <span>${session.map_count} maps</span>
                </div>
                <div class="session-item-value">${formatValue(session.total_value)}</div>
                <button class="session-export-btn" data-session-id="${session.id}" title="Export to CSV">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
            </div>
        `).join('');

        // Add click handlers for export buttons
        elements.historyList.querySelectorAll('.session-export-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.sessionId;
                await exportSession(sessionId);
            });
        });
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

async function exportSession(sessionId) {
    try {
        const result = await api('export_session_csv', sessionId);
        if (result.status === 'ok') {
            console.log(`Exported ${result.rows} rows to ${result.path}`);
        } else if (result.status === 'cancelled') {
            // User cancelled the dialog
        } else {
            console.error('Export failed:', result.message);
        }
    } catch (e) {
        console.error('Export error:', e);
    }
}
