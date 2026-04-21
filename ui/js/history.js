/**
 * Session history functionality
 */

import { elements } from './elements.js';
import { state, settings } from './state.js';
import { formatValue, formatTime, formatRate, formatDate, showStatus } from './utils.js';
import { closeModal, showConfirmDialog } from './modals.js';
import { updateState } from './renderers.js';

// ============ History ============

export async function loadHistory() {
    try {
        const sessions = await api('get_session_history');
        const summary = await api('get_session_summary');

        // Update summary
        elements.historyTotalValue.textContent = formatValue(summary.total_value);
        elements.historyTotalMaps.textContent = summary.total_maps;
        const avgEfficiency = settings.efficiency_per_map
            ? summary.average_value_per_map
            : summary.average_value_per_hour;
        elements.historyAvgRate.innerHTML = formatRate(avgEfficiency, settings.efficiency_per_map);

        if (sessions.length === 0) {
            elements.historyList.innerHTML = '<div class="text-center text-gray-500 py-4">No sessions yet</div>';
            return;
        }

        elements.historyList.innerHTML = sessions.map(session => `
            <div class="session-item" data-session-id="${session.id}" data-session-date="${formatDate(session.started_at)}" title="Click to view this session">
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
                <button class="session-delete-btn" data-session-id="${session.id}" title="Delete session">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6"/>
                        <path d="M14 11v6"/>
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        `).join('');

        elements.historyList.querySelectorAll('.session-export-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.sessionId;
                await exportSession(sessionId);
            });
        });

        elements.historyList.querySelectorAll('.session-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.sessionId;
                const item = btn.closest('.session-item');
                const date = item?.dataset.sessionDate || '';
                await deleteSession(sessionId, date);
            });
        });

        elements.historyList.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => {
                const sessionId = item.dataset.sessionId;
                const date = item.dataset.sessionDate;
                void viewSession(sessionId, date);
            });
        });
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

export async function viewSession(sessionId, date) {
    try {
        const stats = await api('get_session_as_stats', sessionId);
        if (stats.status === 'error') {
            showStatus(stats.message || 'Session not found', 'error', 3000);
            return;
        }
        state.viewingSessionId = sessionId;
        state.viewerSubView = 'drops';
        state.expandedMapIndex = null;
        updateState(stats);
        if (elements.sessionViewerBanner) {
            elements.sessionViewerDate.textContent = date || '';
            elements.sessionViewerBanner.classList.remove('hidden');
        }
        closeModal('history');
    } catch (e) {
        console.error('Failed to load session:', e);
        showStatus('Failed to load session', 'error', 3000);
    }
}

export function exitSessionViewing() {
    if (!state.viewingSessionId) return;
    state.viewingSessionId = null;
    state.viewerSubView = 'drops';
    state.expandedMapIndex = null;
    if (elements.sessionViewerBanner) {
        elements.sessionViewerBanner.classList.add('hidden');
    }
    void api('get_stats').then(updateState);
}

async function deleteSession(sessionId, date) {
    const confirmed = await showConfirmDialog(
        'Delete Session',
        `Delete the session from ${date || 'this date'}? This cannot be undone.`,
        'Delete',
        'Cancel'
    );
    if (!confirmed) return;

    try {
        const result = await api('delete_session', sessionId);
        if (result.status !== 'ok') {
            showStatus('Delete failed', 'error', 3000);
            return;
        }
        if (state.viewingSessionId === sessionId) {
            state.viewingSessionId = null;
            state.viewerSubView = 'drops';
            state.expandedMapIndex = null;
            if (elements.sessionViewerBanner) {
                elements.sessionViewerBanner.classList.add('hidden');
            }
            void api('get_stats').then(updateState);
        }
        await loadHistory();
        showStatus('Session deleted', 'success', 2000);
    } catch (e) {
        console.error('Delete error:', e);
        showStatus('Delete failed', 'error', 3000);
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
