/**
 * UI rendering functions for drops and stats
 */

import { state, settings } from './state.js';
import { elements } from './elements.js';
import { formatTime, formatValue, formatRate } from './utils.js';

// ============ State Management ============

export function updateState(data) {
    state.initialized = data.initialized;
    state.awaitingInit = data.awaiting_init || false;
    state.inMap = data.in_map;
    state.displayMode = data.display_mode;
    state.currentMap = data.current_map;
    state.session = data.session;

    // Update drops from session (includes all maps + current map)
    if (data.session && data.session.drops) {
        state.drops = data.session.drops;
    } else {
        state.drops = [];
    }

    renderUI();
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
        elements.statMapValue.textContent = '+0';
        // Reset to default color
        elements.statMapValue.classList.remove('text-danger');
        elements.statMapValue.classList.add('text-success');
    }

    // Update session stats
    if (state.session) {
        elements.statSessionMapping.textContent = formatTime(state.session.duration_mapping);
        elements.statSessionTotal.textContent = formatTime(state.session.duration_total);
        elements.statSessionValue.textContent = formatValue(state.session.value);
        // Apply color based on positive/negative value
        if (state.session.value >= 0) {
            elements.statSessionValue.classList.remove('text-danger');
            elements.statSessionValue.classList.add('text-success');
        } else {
            elements.statSessionValue.classList.remove('text-success');
            elements.statSessionValue.classList.add('text-danger');
        }
        const efficiencyValue = settings.efficiency_per_map
            ? state.session.value_per_map
            : state.session.value_per_hour;
        elements.statRate.innerHTML = formatRate(efficiencyValue, settings.efficiency_per_map);
        elements.statMapCount.textContent = state.session.map_count;
    } else {
        elements.statSessionMapping.textContent = '0:00';
        elements.statSessionTotal.textContent = '0:00';
        elements.statSessionValue.textContent = '+0';
        // Reset to default color
        elements.statSessionValue.classList.remove('text-danger');
        elements.statSessionValue.classList.add('text-success');
        elements.statRate.innerHTML = formatRate(0, settings.efficiency_per_map);
        elements.statMapCount.textContent = '0';
    }

    // Update init status (this also re-renders drops)
    updateInitStatus();
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

export function addDrop(dropData) {
    // Add to beginning of list
    state.drops.unshift(dropData);

    // Re-render
    renderDrops();
}

export function renderDrops() {
    if (state.drops.length === 0) {
        let emptyHtml = '';

        if (state.awaitingInit) {
            // Scenario: Waiting for re-sync
            emptyHtml = `
                <div class="empty-state py-10">
                    <div class="text-base font-semibold text-gray-300 mb-2">Waiting for Re-sync</div>
                    <p class="text-sm text-gray-500">
                        Sort your inventory in-game to re-sync.
                    </p>
                </div>
            `;
        } else if (!state.initialized) {
            // Scenario: Not Initialized (Onboarding)
            emptyHtml = `
                <div class="empty-state py-10">
                    <div class="text-base font-semibold text-gray-300 mb-2">Inventory Not Tracked</div>
                    <p class="text-sm text-gray-500">
                        In-game: Settings -> Enable Log<br>Then sort your inventory to start tracking.
                    </p>
                </div>
            `;
        } else {
            // Scenario: Initialized but empty (No drops)
            emptyHtml = `
                <div class="empty-state">
                    No drops detected in this session
                </div>
            `;
        }

        elements.dropsList.innerHTML = emptyHtml;
        return;
    }

    // Pass all drops - each render function will aggregate then limit to top 50 item types
    if (state.displayMode === 'items') {
        renderItemsMode(state.drops);
    } else {
        renderValueMode(state.drops);
    }
}

function renderValueMode(drops) {
    // Aggregate by item
    const itemTotals = {};
    drops.forEach(drop => {
        const id = String(drop.item_id).trim();

        if (!itemTotals[id]) {
            itemTotals[id] = {
                id: id,
                name: drop.item_name,
                quantity: 0,
                value: 0,
                price_status: drop.price_status
            };
        }
        itemTotals[id].quantity += drop.quantity;
        if (drop.value !== null) {
            itemTotals[id].value += drop.value;
        }
    });

    Object.values(itemTotals).forEach(item => {
        const currentPrice = state.prices[item.id];
        if (currentPrice !== undefined) {
            item.value = item.quantity * currentPrice;
        }
    });

    // Sort by value/quantity, then limit to top 50 item types
    const sorted = Object.entries(itemTotals)
        .sort((a, b) => {
            const itemA = a[1];
            const itemB = b[1];

            // Check if items have a valid price (value > 0)
            const hasPriceA = Math.abs(itemA.value) > 0;
            const hasPriceB = Math.abs(itemB.value) > 0;

            if (hasPriceA && !hasPriceB) return -1; // A comes first
            if (!hasPriceA && hasPriceB) return 1;  // B comes first

            if (hasPriceA) {
                // Both have prices: sort by Total Value (desc)
                return Math.abs(itemB.value) - Math.abs(itemA.value);
            } else {
                // Neither has price: sort by Quantity (desc)
                return Math.abs(itemB.quantity) - Math.abs(itemA.quantity);
            }
        })
        .slice(0, 50);

    const html = sorted.map(([id, item]) => {
        const valueClass = item.value >= 0 ? 'positive' : 'negative';
        const highValueClass = Math.abs(item.value) >= 10000 ? 'high-value' : '';
        const valueText = item.value !== 0
            ? formatValue(item.value)
            : '(no price)';

        return `
            <div class="drop-item">
                <div class="drop-item-name">
                    <span class="price-status ${item.price_status || 'unknown'}"></span>
                    <span>${item.name}</span>
                    <span class="text-gray-500 font-mono text-sm">×${Math.abs(item.quantity)}</span>
                </div>
                <div class="stat-value font-mono ${valueClass} ${highValueClass}">${valueText}</div>
            </div>
        `;
    }).join('');

    elements.dropsList.innerHTML = html || '<div class="empty-state">No drops yet</div>';
}

function renderItemsMode(drops) {
    // Aggregate by item
    const itemCounts = {};
    drops.forEach(drop => {
        if (!itemCounts[drop.item_id]) {
            itemCounts[drop.item_id] = {
                name: drop.item_name,
                quantity: 0,
                price_status: drop.price_status
            };
        }
        itemCounts[drop.item_id].quantity += drop.quantity;
    });

    // Sort by quantity (highest first), then limit to top 50 item types
    const sorted = Object.entries(itemCounts)
        .sort((a, b) => b[1].quantity - a[1].quantity)
        .slice(0, 50);

    const html = sorted.map(([id, item]) => {
        const valueClass = item.quantity >= 0 ? 'positive' : 'negative';
        return `
            <div class="drop-item">
                <div class="drop-item-name">
                    <span class="price-status ${item.price_status || 'unknown'}"></span>
                    <span>${item.name}</span>
                </div>
                <div class="drop-item-quantity font-mono ${valueClass}">×${item.quantity}</div>
            </div>
        `;
    }).join('');

    elements.dropsList.innerHTML = html || '<div class="empty-state">No drops yet</div>';
}
