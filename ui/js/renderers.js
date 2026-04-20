/**
 * UI rendering functions for drops and stats
 */

import { state, settings } from './state.js';
import { elements } from './elements.js';
import { formatTime, formatValue, formatRate } from './utils.js';
import { renderPriceHistoryChart } from './charts.js';
import {
    PRICE_HISTORY_RANGE_OPTIONS,
    formatPriceHistoryValue,
    getActivePriceHistoryRangeKey,
    getExpandedPriceHistoryItemId,
    getPriceHistoryRange,
    getPriceHistoryEntry,
    syncExpandedPriceHistory
} from './price-history.js';

// ============ State Management ============

export function updateState(data) {
    state.initialized = data.initialized;
    state.awaitingInit = data.awaiting_init || false;
    state.inMap = data.in_map;
    state.displayMode = data.display_mode;
    state.currentMap = data.current_map;
    state.displayMap = data.display_map;
    state.session = data.session;

    renderUI();
    renderPauseButton();
    syncDisplayModeUI();
}

export function renderUI() {
    // Update map stats
    if (state.currentMap) {
        elements.statMapTime.textContent = formatTime(state.currentMap.duration);
        elements.statMapValue.textContent = formatValue(state.currentMap.value);
        elements.statMapValue.classList.add('text-lg'); // Ensure base class
        if (state.currentMap.value >= 0) {
            elements.statMapValue.classList.remove('text-danger');
            elements.statMapValue.classList.add('text-success');
        } else {
            elements.statMapValue.classList.remove('text-success');
            elements.statMapValue.classList.add('text-danger');
        }
    } else {
        elements.statMapTime.textContent = '-:-';
        elements.statMapValue.textContent = '0';
        // Reset to default color
        elements.statMapValue.classList.remove('text-danger');
        elements.statMapValue.classList.add('text-success');
    }

    // Update session stats
    if (state.session) {
        elements.statSessionMapping.textContent = formatTime(state.session.duration_mapping);
        elements.statSessionTotal.textContent = formatTime(state.session.duration_total);
        elements.statSessionValue.textContent = formatValue(state.session.value);
        const efficiencyValue = settings.efficiency_per_map
            ? state.session.value_per_map
            : state.session.value_per_hour;
        elements.statRate.innerHTML = formatRate(efficiencyValue, settings.efficiency_per_map);
        elements.statMapCount.textContent = state.session.map_count;
        if (elements.statSessionTaxLabel) {
            elements.statSessionTaxLabel.classList.toggle('hidden', !settings.tax_enabled);
        }
    } else {
        elements.statSessionMapping.textContent = '0:00';
        elements.statSessionTotal.textContent = '0:00';
        elements.statSessionValue.textContent = '0';
        elements.statRate.innerHTML = formatRate(0, settings.efficiency_per_map);
        elements.statMapCount.textContent = '0';
    }

    // Paused badge pinned to bottom of session card
    const sessionCard = elements.statSessionTotal.closest('.stat-card');
    let badge = sessionCard.querySelector('.paused-badge');
    if (state.session?.paused) {
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'paused-badge';
            badge.textContent = 'PAUSED';
            sessionCard.appendChild(badge);
        }
    } else if (badge) {
        badge.remove();
    }

    // Update init status (this also re-renders drops)
    updateInitStatus();
}

function renderPauseButton() {
    const btn = elements.btnPause;
    if (!btn) return;

    if (state.session) {
        btn.classList.remove('hidden');
        if (state.session.paused) {
            btn.textContent = 'Resume';
            btn.classList.add('active');
        } else {
            btn.textContent = 'Pause';
            btn.classList.remove('active');
        }
    } else {
        btn.classList.add('hidden');
    }
}

export function updateTimedStats() {
    if (state.currentMap) {
        elements.statMapTime.textContent = formatTime(state.currentMap.duration);
    }

    if (state.session) {
        elements.statSessionMapping.textContent = formatTime(
            state.session.duration_mapping
        );
        elements.statSessionTotal.textContent = formatTime(
            state.session.duration_total
        );
        const efficiencyValue = settings.efficiency_per_map
            ? state.session.value_per_map
            : state.session.value_per_hour;
        elements.statRate.innerHTML = formatRate(
            efficiencyValue,
            settings.efficiency_per_map
        );
    }
}

export function updateInitStatus() {
    if (state.awaitingInit) {
        // Waiting for user to sort bag
        elements.btnInitialize.textContent = 'Waiting...';
        elements.btnInitialize.disabled = true;
        elements.btnInitialize.classList.remove('hidden');
    } else if (state.initialized) {
        // Initialized - show re-sync option
        elements.btnInitialize.textContent = 'Re-sync Bag';
        elements.btnInitialize.disabled = false;
        elements.btnInitialize.classList.remove('hidden');
    } else {
        // Not yet initialized - hide button
        elements.btnInitialize.classList.add('hidden');
    }

    // Re-render drops to update empty state
    renderDrops();
}

// ============ Drop Rendering ============

export function renderDrops() {
    const isMapMode = state.displayMode === 'map';
    const source = isMapMode ? state.displayMap : state.session;
    const itemRows = source?.item_rows || [];
    syncExpandedPriceHistory(itemRows.map((item) => item.item_id));

    if (itemRows.length === 0) {
        elements.dropsList.innerHTML = renderDropsEmptyState(isMapMode);
        return;
    }

    renderValueMode(itemRows);
}

function renderDropsEmptyState(isMapMode) {
    if (state.awaitingInit) {
        return `
            <div class="empty-state py-10">
                <div class="text-base font-semibold text-gray-300 mb-2">Waiting for Re-sync</div>
                <p class="text-sm text-gray-500">
                    Sort your inventory in-game to re-sync.
                </p>
            </div>
        `;
    }
    if (!state.initialized) {
        return `
            <div class="empty-state py-10">
                <div class="text-base font-semibold text-gray-300 mb-2">Inventory Not Tracked</div>
                <p class="text-sm text-gray-500">
                    In-game: Settings -> Enable Log<br>Then sort your inventory to start tracking.
                </p>
            </div>
        `;
    }
    if (isMapMode) {
        if (!state.displayMap) {
            return `<div class="empty-state">No completed maps yet</div>`;
        }
        if (state.displayMap.is_live) {
            return `<div class="empty-state">No drops in this map yet</div>`;
        }
        return `<div class="empty-state">Last map had no drops</div>`;
    }
    return `<div class="empty-state">No drops detected in this session</div>`;
}

export function syncDisplayModeUI() {
    const isMapMode = state.displayMode === 'map';
    if (elements.btnModeSession) {
        elements.btnModeSession.classList.toggle('active', !isMapMode);
    }
    if (elements.btnModeMap) {
        elements.btnModeMap.classList.toggle('active', isMapMode);
        // label reflects whether we're showing the in-progress map or the last finished one
        const isLive = state.displayMap?.is_live !== false;
        elements.btnModeMap.textContent = isLive ? 'Current Map' : 'Last Map';
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatHistoryTimestamp(timestamp, rangeKey) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    if (rangeKey === '7d') {
        return date
            .toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            })
            .replace(',', '');
    }

    return date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric'
    });
}

function renderHistoryRangeToggle(itemId, activeRangeKey) {
    return `
        <div class="drop-item-history-toggle" role="group" aria-label="Price history range">
            ${PRICE_HISTORY_RANGE_OPTIONS.map((range) => `
                <button
                    type="button"
                    class="drop-item-history-toggle-btn${range.key === activeRangeKey ? ' active' : ''}"
                    data-price-history-range="${escapeHtml(range.key)}"
                    data-item-id="${escapeHtml(itemId)}"
                    aria-pressed="${range.key === activeRangeKey ? 'true' : 'false'}"
                >
                    ${range.label}
                </button>
            `).join('')}
        </div>
    `;
}

function renderHistoryPanel(itemId) {
    const activeRange = getPriceHistoryRange();
    const entry = getPriceHistoryEntry(itemId, activeRange.key);

    let contentHtml = '';
    let rangeHtml = '';

    if (entry.status === 'ready' && entry.data) {
        const { stats } = entry.data;
        const changeClass = stats.deltaPercent === null
            ? ''
            : stats.deltaPercent >= 0 ? 'positive' : 'negative';
        const changeLabel = stats.deltaPercent === null
            ? 'n/a'
            : `${stats.deltaPercent >= 0 ? '+' : ''}${stats.deltaPercent.toFixed(1)}%`;

        if (stats.startTimestamp !== null && stats.endTimestamp !== null) {
            rangeHtml = `
                <div class="drop-item-history-range">
                    ${escapeHtml(formatHistoryTimestamp(stats.startTimestamp, activeRange.key))}
                    -
                    ${escapeHtml(formatHistoryTimestamp(stats.endTimestamp, activeRange.key))}
                </div>
            `;
        }

        contentHtml = `
            <div class="drop-item-history-stats">
                <div class="drop-item-history-stat">
                    <span class="drop-item-history-label">Latest</span>
                    <span class="drop-item-history-value">${formatPriceHistoryValue(stats.latest)} FE</span>
                </div>
                <div class="drop-item-history-stat">
                    <span class="drop-item-history-label">High</span>
                    <span class="drop-item-history-value">${formatPriceHistoryValue(stats.max)} FE</span>
                </div>
                <div class="drop-item-history-stat">
                    <span class="drop-item-history-label">Low</span>
                    <span class="drop-item-history-value">${formatPriceHistoryValue(stats.min)} FE</span>
                </div>
                <div class="drop-item-history-stat" title="Percent change from the oldest to the newest price point in the selected timeframe">
                    <span class="drop-item-history-label">Change</span>
                    <span class="drop-item-history-value ${changeClass}">${changeLabel}</span>
                </div>
            </div>
            <div
                class="drop-item-history-chart"
                data-price-history-chart="${escapeHtml(itemId)}"
            ></div>
        `;
    } else if (entry.status === 'error') {
        contentHtml = `
            <div class="drop-item-panel-state error">
                ${escapeHtml(entry.errorMessage || `Failed to load ${activeRange.label} history.`)}
            </div>
        `;
    } else if (entry.status === 'empty') {
        contentHtml = `
            <div class="drop-item-panel-state">
                No ${activeRange.label} price history available for this item yet.
            </div>
        `;
    } else {
        contentHtml = `
            <div class="drop-item-panel-state loading">
                <span class="drop-item-panel-spinner" aria-hidden="true"></span>
                <span>Loading ${activeRange.label} history...</span>
            </div>
        `;
    }

    return `
        <div class="drop-item-panel">
            <div class="drop-item-history-meta">
                <div class="drop-item-history-meta-main">
                    <div class="drop-item-history-chip">${activeRange.label}</div>
                    ${rangeHtml}
                </div>
                ${renderHistoryRangeToggle(itemId, activeRange.key)}
            </div>
            ${contentHtml}
        </div>
    `;
}

function renderDropRow(item, trailingHtml) {
    const itemId = String(item.item_id || '');
    const isExpanded = getExpandedPriceHistoryItemId() === itemId;
    const isIgnored = !!item.ignored;
    const statusClass = item.price_status || 'unknown';
    const cloudClass = item.price_source === 'cloud' ? ' cloud' : '';
    const priceIndicator = `<span class="price-status ${statusClass}${cloudClass}"></span>`;
    const activeRange = getPriceHistoryRange();
    const badgeHtml = itemId
        ? `<span class="drop-item-history-badge">${activeRange.label}</span>`
        : '';
    const ignoredBadge = isIgnored
        ? '<span class="drop-item-ignored-badge">IGNORED</span>'
        : '';

    return `
        <div class="drop-row${isExpanded ? ' expanded' : ''}${isIgnored ? ' ignored' : ''}">
            <div
                class="drop-item drop-item-toggle"
                data-drop-row
                data-item-id="${escapeHtml(itemId)}"
                data-ignored="${isIgnored ? 'true' : 'false'}"
                aria-expanded="${isExpanded ? 'true' : 'false'}"
            >
                <div class="drop-item-name">
                    ${priceIndicator}
                    ${trailingHtml.nameHtml}
                </div>
                <div class="drop-item-end">
                    ${ignoredBadge}
                    ${badgeHtml}
                    ${trailingHtml.valueHtml}
                </div>
            </div>
            ${isExpanded ? renderHistoryPanel(itemId) : ''}
        </div>
    `;
}

function mountPriceHistoryCharts() {
    if (!elements.dropsList) {
        return;
    }

    const activeRangeKey = getActivePriceHistoryRangeKey();
    elements.dropsList.querySelectorAll('[data-price-history-chart]').forEach((container) => {
        const itemId = container.getAttribute('data-price-history-chart');
        const entry = getPriceHistoryEntry(itemId, activeRangeKey);
        if (entry.status === 'ready' && entry.data) {
            renderPriceHistoryChart(container, entry.data);
        }
    });
}

function renderValueMode(itemRows) {
    const sorted = [...itemRows]
        .sort((itemA, itemB) => {
            const valueA = itemA.value || 0;
            const valueB = itemB.value || 0;
            const hasPriceA = Math.abs(valueA) > 0;
            const hasPriceB = Math.abs(valueB) > 0;

            if (hasPriceA && !hasPriceB) return -1;
            if (!hasPriceA && hasPriceB) return 1;

            if (hasPriceA) {
                return Math.abs(valueB) - Math.abs(valueA);
            }

            return Math.abs(itemB.quantity) - Math.abs(itemA.quantity);
        })
        .slice(0, 50);

    const html = sorted.map((item) => {
        const valueClass = item.value >= 0 ? 'positive' : 'negative';
        const highValueClass = Math.abs(item.value) >= 10000 ? 'high-value' : '';
        const valueText = item.value !== 0
            ? formatValue(item.value)
            : '(no price)';

        return renderDropRow(item, {
            nameHtml: `
                <span class="drop-item-label">${escapeHtml(item.item_name)}</span>
                <span class="text-gray-500 font-mono text-sm">×${Math.abs(item.quantity)}</span>
            `,
            valueHtml: `<div class="stat-value font-mono ${valueClass} ${highValueClass}">${valueText}</div>`
        });
    }).join('');

    elements.dropsList.innerHTML = html;
    mountPriceHistoryCharts();
}

