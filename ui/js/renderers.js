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

    renderBestMapCard();

    // Update init status (this also re-renders drops)
    updateInitStatus();
}

function renderBestMapCard() {
    const card = elements.statCardBestMap;
    const profitEl = elements.statBestMapProfit;
    const contextEl = elements.statBestMapContext;
    if (!card || !profitEl || !contextEl) return;

    const completedMaps = Array.isArray(state.session?.maps) ? state.session.maps : [];
    if (completedMaps.length === 0) {
        profitEl.textContent = '—';
        contextEl.textContent = 'No completed maps';
        card.classList.add('disabled');
        delete card.dataset.mapIndex;
        return;
    }

    // best = highest profit; stable for ties by preferring the earliest map
    // (reduce keeps the accumulator unless the candidate strictly wins)
    const best = completedMaps.reduce((acc, map) =>
        (map.total_value || 0) > (acc.total_value || 0) ? map : acc,
        completedMaps[0]
    );

    const label = best.map_name && best.map_name.length > 0
        ? best.map_name
        : `Map ${best.index + 1}`;
    // split trailing "(tier)" — mirrors the map accordion rendering so the
    // card's tier lead + muted name matches the row it points to
    const tierMatch = label.match(/^(.*?)\s+\(([^)]+)\)$/);
    const name = tierMatch ? tierMatch[1] : label;
    const tier = tierMatch ? tierMatch[2] : '';

    card.classList.remove('disabled');
    card.dataset.mapIndex = String(best.index);
    profitEl.textContent = formatValue(best.total_value || 0);

    const duration = formatTime(best.duration_seconds || 0);
    contextEl.innerHTML = tier
        ? `<span class="best-map-tier">${escapeHtml(tier)}</span> <span class="best-map-name">${escapeHtml(name)}</span> <span class="best-map-duration">· ${escapeHtml(duration)}</span>`
        : `<span class="best-map-tier">${escapeHtml(name)}</span> <span class="best-map-duration">· ${escapeHtml(duration)}</span>`;
}

function renderPauseButton() {
    const btn = elements.btnPause;
    if (!btn) return;

    if (state.session) {
        btn.classList.remove('hidden');
        const label = btn.querySelector('.btn-label') || btn;
        if (state.session.paused) {
            label.textContent = 'Resume';
            btn.classList.add('active');
        } else {
            label.textContent = 'Pause';
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
    const btn = elements.btnInitialize;
    const label = btn.querySelector('.btn-label') || btn;
    if (state.awaitingInit) {
        // Waiting for user to sort bag
        label.textContent = 'Waiting...';
        btn.disabled = true;
        btn.classList.remove('hidden');
    } else if (state.initialized) {
        // Initialized - show re-sync option
        label.textContent = 'Re-sync Bag';
        btn.disabled = false;
        btn.classList.remove('hidden');
    } else {
        // Not yet initialized - hide button
        btn.classList.add('hidden');
    }

    // Re-render drops to update empty state
    renderDrops();
}

// ============ Drop Rendering ============

export function renderDrops() {
    const hasSession = !!state.session;

    if (!hasSession) {
        // no session yet — both panels show header + empty state so wide-mode
        // users can see the map-breakdown column exists before they start playing
        elements.dropsList.innerHTML = dropsPanelHeaderHtml() + renderDropsEmptyState();
        if (elements.dropsListMaps) {
            elements.dropsListMaps.innerHTML = mapsPanelHeaderHtml()
                + `<div class="empty-state">No maps yet</div>`;
        }
        syncExpandedPriceHistory([]);
        return;
    }

    // session active (live or viewer): both panels rendered unconditionally.
    // CSS controls visibility based on narrow/wide layout + toggle state,
    // so a resize never shows an empty panel.
    const sessionRows = state.session?.item_rows || [];
    syncExpandedPriceHistory(sessionRows.map((item) => item.item_id), 'drops');
    syncExpandedPriceHistory(expandedMapVisibleItemIds(), 'maps');
    renderMapsAccordion();
    renderSessionDropsPanel(sessionRows);
}

function expandedMapVisibleItemIds() {
    // items visible inside whatever map the accordion currently has expanded.
    // if nothing is expanded the set is empty, which lets the sync function
    // clean up a stale maps-panel chart expansion from a previous render.
    if (state.expandedMapIndex === null) return [];
    const completed = Array.isArray(state.session?.maps) ? state.session.maps : [];
    const liveMap = state.displayMap?.is_live
        ? { index: completed.length, item_rows: state.displayMap.item_rows || [] }
        : null;
    const allMaps = liveMap ? [...completed, liveMap] : completed;
    const map = allMaps.find((m) => m.index === state.expandedMapIndex);
    return (map?.item_rows || []).map((item) => item.item_id);
}

function dropsPanelHeaderHtml(availableCategories = []) {
    const { searchOpen, searchTerm, filterOpen, filterCategories } = state.sessionDrops;
    const searchHasTerm = searchTerm.trim().length > 0;
    const filterActive = filterCategories.length > 0;
    const showControls = availableCategories.length > 0;

    // inline-expandable search (icon ↔ input field) + filter toggle button
    const controlsHtml = showControls ? `
        <div class="drops-panel-controls">
            <div class="drops-search" data-expanded="${searchOpen ? 'true' : 'false'}">
                <button type="button"
                    class="drops-search-toggle ${searchHasTerm || searchOpen ? 'active' : ''}"
                    data-action="toggle-search"
                    aria-label="Search items"
                    aria-expanded="${searchOpen ? 'true' : 'false'}">
                    ${window.TLI.icons.iconSvg('search')}
                </button>
                <input type="search"
                    class="drops-search-input"
                    data-drops-search
                    placeholder="Search items…"
                    value="${escapeHtml(searchTerm)}">
            </div>
            <button type="button"
                class="drops-filter-toggle ${filterActive || filterOpen ? 'active' : ''}"
                data-action="toggle-filter"
                aria-label="Filter by category"
                aria-expanded="${filterOpen ? 'true' : 'false'}">
                ${window.TLI.icons.iconSvg('filter')}
            </button>
        </div>
    ` : '';

    // chips are multi-select: click toggles a category in/out of the set.
    // "All" is mutually exclusive with the rest — clicking it clears the set;
    // it reads active when no categories are selected (default state).
    const chipsHtml = showControls && filterOpen ? `
        <div class="drops-filter-chips">
            <button type="button"
                class="drops-filter-chip ${!filterActive ? 'active' : ''}"
                data-filter-category="all">All</button>
            ${availableCategories.map((cat) => `
                <button type="button"
                    class="drops-filter-chip ${filterCategories.includes(cat) ? 'active' : ''}"
                    data-filter-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
            `).join('')}
        </div>
    ` : '';

    return `
        <div class="drops-panel-titlerow">
            <div class="drops-panel-title">Session Drops</div>
            ${controlsHtml}
        </div>
        ${chipsHtml}
        <div class="drops-panel-header">
            <span class="stat-label">Item</span>
            <span class="stat-label">Value</span>
        </div>
    `;
}

function applySessionDropsFilters(itemRows) {
    const { searchTerm, filterCategories } = state.sessionDrops;
    const term = searchTerm.trim().toLowerCase();
    return itemRows.filter((row) => {
        if (filterCategories.length > 0) {
            const rowCat = row.item_type || 'Other';
            if (!filterCategories.includes(rowCat)) return false;
        }
        if (term && !(row.item_name || '').toLowerCase().includes(term)) {
            return false;
        }
        return true;
    });
}

function collectDropCategories(itemRows) {
    const seen = new Set();
    for (const row of itemRows) {
        seen.add(row.item_type || 'Other');
    }
    return Array.from(seen).sort();
}

function mapsPanelHeaderHtml(showControls = false) {
    const { searchOpen, searchTerm } = state.mapsPanel;
    const searchHasTerm = searchTerm.trim().length > 0;

    const controlsHtml = showControls ? `
        <div class="drops-panel-controls">
            <div class="drops-search" data-expanded="${searchOpen ? 'true' : 'false'}">
                <button type="button"
                    class="drops-search-toggle ${searchHasTerm || searchOpen ? 'active' : ''}"
                    data-action="toggle-maps-search"
                    aria-label="Search maps"
                    aria-expanded="${searchOpen ? 'true' : 'false'}">
                    ${window.TLI.icons.iconSvg('search')}
                </button>
                <input type="text"
                    class="drops-search-input"
                    data-maps-search
                    placeholder="Search maps…"
                    value="${escapeHtml(searchTerm)}">
            </div>
        </div>
    ` : '';

    return `
        <div class="drops-panel-titlerow">
            <div class="drops-panel-title">Drops Per Map</div>
            ${controlsHtml}
        </div>
        <div class="drops-panel-header">
            <span class="stat-label">Map</span>
            <span class="map-accordion-stats">
                <span class="stat-label">Total</span>
                <span class="stat-label">Profit</span>
                <span class="stat-label">Duration</span>
            </span>
        </div>
    `;
}

function renderSessionDropsPanel(itemRows) {
    if (itemRows.length === 0) {
        elements.dropsList.innerHTML = dropsPanelHeaderHtml() + renderDropsEmptyState();
        return;
    }
    renderValueMode(itemRows);
}

function renderDropsEmptyState() {
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
    return `<div class="empty-state">No drops detected in this session</div>`;
}

export function syncDisplayModeUI() {
    const hasSession = !!state.session;

    if (elements.dropsModeToggle) {
        elements.dropsModeToggle.classList.toggle('hidden', !hasSession);
    }

    // layout classes drive CSS: `session-active` flips the drops area into
    // two-column when the viewport is wide and hides the toggle (nothing
    // left to switch since both panels are on screen). `mode-maps` picks
    // which single panel shows in narrow mode.
    const appRoot = document.getElementById('app');
    if (appRoot) {
        appRoot.classList.toggle('session-active', hasSession);
    }
    if (elements.dropsContainer) {
        elements.dropsContainer.classList.toggle(
            'mode-maps',
            hasSession && state.subView === 'maps'
        );
    }

    if (elements.btnViewDrops) {
        elements.btnViewDrops.classList.toggle('active', state.subView !== 'maps');
    }
    if (elements.btnViewMaps) {
        elements.btnViewMaps.classList.toggle('active', state.subView === 'maps');
    }
}

export function setSubView(view) {
    state.subView = view === 'maps' ? 'maps' : 'drops';
    if (state.subView !== 'maps') {
        state.expandedMapIndex = null;
    }
    renderDrops();
    syncDisplayModeUI();
}

export function toggleExpandedMap(index) {
    state.expandedMapIndex = state.expandedMapIndex === index ? null : index;
    // only the maps panel changes — redraw the drops panel separately only
    // if the sync needs to clean up a stale chart expansion there
    syncExpandedPriceHistory(expandedMapVisibleItemIds(), 'maps');
    renderPanel('maps');
}

// renders only the requested side so the other panel's DOM (including any
// open price-history chart) stays untouched. used to avoid remounting a
// cached chart on the unaffected side when the user clicks into just one.
export function renderPanel(panel) {
    if (panel === 'maps') {
        renderMapsAccordion();
        return;
    }
    const sessionRows = state.session?.item_rows || [];
    renderSessionDropsPanel(sessionRows);
}

function sumGrossValue(itemRows) {
    if (!Array.isArray(itemRows)) return 0;
    return itemRows.reduce((acc, row) => acc + (row.value || 0), 0);
}

function renderMapsAccordion() {
    const completed = Array.isArray(state.session?.maps) ? state.session.maps : [];
    // live view: synthesize a row for the in-progress map so it appears in
    // the accordion while the player is still running it. session.maps only
    // holds completed runs, so the live entry's index lines up with what
    // its completed index will be once the map ends.
    const liveMap = state.displayMap?.is_live
        ? {
            index: completed.length,
            total_value: state.displayMap.value || 0,
            duration_seconds: state.displayMap.duration || 0,
            item_rows: state.displayMap.item_rows || [],
            // carry through the backend-resolved name so the live row
            // reads "Glacial Abyss (T8-0)" from the moment the map starts
            // rather than staying on "Map N" until the run ends.
            map_name: state.displayMap.map_name || '',
            is_live: true
        }
        : null;
    const maps = liveMap ? [...completed, liveMap] : completed;

    if (maps.length === 0) {
        elements.dropsListMaps.innerHTML = mapsPanelHeaderHtml(false)
            + `<div class="empty-state">No maps yet</div>`;
        return;
    }

    // chronological order: most recent map at top (live map always sits
    // first since its synthesized index is highest)
    const ordered = [...maps].sort((a, b) => (b.index || 0) - (a.index || 0));

    // apply maps-panel search — substring match against the full
    // "Name (Tier)" label so typing "profound" or "t8" narrows as well
    const { searchTerm } = state.mapsPanel;
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
        ? ordered.filter((map) => {
            const label = map.map_name && map.map_name.length > 0
                ? map.map_name
                : `Map ${map.index + 1}`;
            return label.toLowerCase().includes(term);
        })
        : ordered;

    const expandedIndex = state.expandedMapIndex;

    // preserve focus/cursor on the maps search input across re-renders
    // (backend updates fire frequently during live sessions)
    const prevInput = elements.dropsListMaps.querySelector('[data-maps-search]');
    const wasFocused = prevInput && document.activeElement === prevInput;
    const selStart = prevInput?.selectionStart ?? null;
    const selEnd = prevInput?.selectionEnd ?? null;

    const headerHtml = mapsPanelHeaderHtml(true);

    if (filtered.length === 0) {
        elements.dropsListMaps.innerHTML = headerHtml
            + `<div class="empty-state">No maps match the current search</div>`;
        if (wasFocused) {
            const next = elements.dropsListMaps.querySelector('[data-maps-search]');
            if (next) {
                next.focus();
                if (selStart !== null) {
                    try { next.setSelectionRange(selStart, selEnd); } catch (_) {}
                }
            }
        }
        return;
    }

    const rowsHtml = filtered.map((map) => {
        const isExpanded = expandedIndex === map.index;
        // backend-resolved name when PR#4 captured beacon + level_id; falls
        // back to numbered placeholder for legacy sessions or any capture miss
        const mapLabel = map.map_name && map.map_name.length > 0
            ? map.map_name
            : `Map ${map.index + 1}`;
        // lead with the tier ("T8-1", "T8 Profound", …) so it always stays
        // visible even when the name has to truncate; fall back to just the
        // name when the backend didn't resolve a tier (e.g. "Deep Space")
        const tierMatch = mapLabel.match(/^(.*?)\s+\(([^)]+)\)$/);
        const mapNamePart = tierMatch ? tierMatch[1] : mapLabel;
        const mapTierPart = tierMatch ? tierMatch[2] : '';
        const gross = sumGrossValue(map.item_rows);
        const profit = map.total_value || 0;
        const profitClass = profit >= 0 ? 'positive' : 'negative';
        const dropsHtml = isExpanded
            ? renderMapAccordionDrops(map.item_rows || [])
            : '';
        return `
            <div class="map-accordion-row${isExpanded ? ' expanded' : ''}">
                <button
                    type="button"
                    class="map-accordion-header"
                    data-map-row
                    data-map-index="${map.index}"
                    aria-expanded="${isExpanded ? 'true' : 'false'}"
                >
                    <span class="map-accordion-name">
                        ${window.TLI.icons.iconSvg('chevron-right', { className: 'tli-icon-chevron' })}
                        <span class="map-accordion-label">
                            ${mapTierPart
                                ? `<span class="map-accordion-label-tier">${escapeHtml(mapTierPart)}</span>
                                   <span class="map-accordion-label-name">${escapeHtml(mapNamePart)}</span>`
                                : `<span class="map-accordion-label-tier">${escapeHtml(mapNamePart)}</span>`}
                        </span>
                    </span>
                    <span class="map-accordion-stats">
                        <span title="Total value picked up">${formatValue(gross)}</span>
                        <span class="${profitClass}" title="Profit (net)">${formatValue(profit)}</span>
                        <span title="Duration">${formatTime(map.duration_seconds)}</span>
                    </span>
                </button>
                ${isExpanded ? `<div class="map-accordion-body">${dropsHtml}</div>` : ''}
            </div>
        `;
    }).join('');

    elements.dropsListMaps.innerHTML = headerHtml + rowsHtml;

    if (wasFocused) {
        const next = elements.dropsListMaps.querySelector('[data-maps-search]');
        if (next) {
            next.focus();
            if (selStart !== null) {
                try { next.setSelectionRange(selStart, selEnd); } catch (_) {}
            }
        }
    }

    mountPriceHistoryCharts(elements.dropsListMaps);
}

function renderMapAccordionDrops(itemRows) {
    if (itemRows.length === 0) {
        return `<div class="empty-state">No drops in this map</div>`;
    }
    const sorted = [...itemRows]
        .sort((itemA, itemB) => Math.abs(itemB.value || 0) - Math.abs(itemA.value || 0))
        .slice(0, 50);
    return sorted.map((item) => {
        const valueClass = item.value >= 0 ? 'positive' : 'negative';
        const highValueClass = Math.abs(item.value) >= 10000 ? 'high-value' : '';
        const valueText = item.value !== 0 ? formatValue(item.value) : '(no price)';
        return renderDropRow(item, {
            nameHtml: `
                <span class="drop-item-label">${escapeHtml(item.item_name)}</span>
                <span class="text-gray-500 font-mono text-sm">×${Math.abs(item.quantity)}</span>
            `,
            valueHtml: `<div class="stat-value font-mono ${valueClass} ${highValueClass}">${valueText}</div>`
        }, 'maps');
    }).join('');
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

function renderHistoryPanel(itemId, panel = 'drops') {
    const activeRange = getPriceHistoryRange(getActivePriceHistoryRangeKey(panel));
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

function renderDropRow(item, trailingHtml, panel = 'drops') {
    const itemId = String(item.item_id || '');
    const isExpanded = getExpandedPriceHistoryItemId(panel) === itemId;
    const isIgnored = !!item.ignored;
    const statusClass = item.price_status || 'unknown';
    const cloudClass = item.price_source === 'cloud' ? ' cloud' : '';
    const priceIndicator = `<span class="price-status ${statusClass}${cloudClass}"></span>`;
    const activeRange = getPriceHistoryRange(getActivePriceHistoryRangeKey(panel));
    const badgeHtml = itemId
        ? `<span class="drop-item-history-badge">${activeRange.label}</span>`
        : '';
    const ignoredBadge = isIgnored
        ? '<span class="drop-item-ignored-badge">IGNORED</span>'
        : '';

    const chevronHtml = window.TLI.icons.iconSvg('chevron-right', { className: 'tli-icon-chevron' });
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
                    ${chevronHtml}
                    ${priceIndicator}
                    ${trailingHtml.nameHtml}
                </div>
                <div class="drop-item-end">
                    ${ignoredBadge}
                    ${badgeHtml}
                    ${trailingHtml.valueHtml}
                </div>
            </div>
            ${isExpanded ? renderHistoryPanel(itemId, panel) : ''}
        </div>
    `;
}

function mountPriceHistoryCharts(root) {
    const scope = root || elements.dropsContainer;
    if (!scope) {
        return;
    }

    // derive the panel from the scope so we mount at the right active range
    const panel = scope === elements.dropsListMaps ? 'maps' : 'drops';
    const activeRangeKey = getActivePriceHistoryRangeKey(panel);
    scope.querySelectorAll('[data-price-history-chart]').forEach((container) => {
        const itemId = container.getAttribute('data-price-history-chart');
        const entry = getPriceHistoryEntry(itemId, activeRangeKey);
        if (entry.status === 'ready' && entry.data) {
            renderPriceHistoryChart(container, entry.data);
        }
    });
}

function renderValueMode(itemRows) {
    // derive filter-chip options from the full row set (pre-filter) so the
    // chips don't disappear under you as you narrow the list
    const categories = collectDropCategories(itemRows);
    const filtered = applySessionDropsFilters(itemRows);

    const sorted = [...filtered]
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

    const bodyHtml = sorted.length === 0
        ? `<div class="empty-state">No drops match the current filters</div>`
        : sorted.map((item) => {
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

    // preserve search-input focus + cursor across re-renders so typing during
    // a live backend update (new drop coming in) doesn't blur the input
    const prevInput = elements.dropsList.querySelector('[data-drops-search]');
    const wasFocused = prevInput && document.activeElement === prevInput;
    const selStart = prevInput?.selectionStart ?? null;
    const selEnd = prevInput?.selectionEnd ?? null;

    elements.dropsList.innerHTML = dropsPanelHeaderHtml(categories) + bodyHtml;

    if (wasFocused) {
        const next = elements.dropsList.querySelector('[data-drops-search]');
        if (next) {
            next.focus();
            if (selStart !== null) {
                try { next.setSelectionRange(selStart, selEnd); } catch (_) {}
            }
        }
    }

    mountPriceHistoryCharts(elements.dropsList);
}

