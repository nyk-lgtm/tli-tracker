const DEFAULT_PRICE_HISTORY_RANGE_KEY = '7d';
const PRICE_HISTORY_RANGE_CONFIG = Object.freeze({
    '7d': Object.freeze({ key: '7d', label: '7D', interval: '1h' }),
    '30d': Object.freeze({ key: '30d', label: '30D', interval: '1d' })
});

export const PRICE_HISTORY_RANGE_OPTIONS = Object.freeze([
    PRICE_HISTORY_RANGE_CONFIG['7d'],
    PRICE_HISTORY_RANGE_CONFIG['30d']
]);

const VALID_ENTRY_STATUSES = new Set(['ready', 'empty', 'loading', 'error', 'missing']);

const historyState = {
    // each panel ('drops' or 'maps') tracks its own expanded item so the
    // user can have two charts open at once — e.g. an item scoped to a
    // specific map on the left and a different session-wide item on the right
    expandedByPanel: { drops: null, maps: null },
    // and each panel tracks its own active range (7d/30d) so switching
    // ranges on one chart doesn't flip the other
    activeRangeByPanel: {
        drops: DEFAULT_PRICE_HISTORY_RANGE_KEY,
        maps: DEFAULT_PRICE_HISTORY_RANGE_KEY
    },
    // cache of currently-visible chart entries keyed by `itemId:rangeKey`.
    // multi-slot (was single) so two open charts don't overwrite each other:
    // a post-fetch event for one panel must not knock the other panel's
    // cached entry back to a default "missing" (loading) state.
    visibleEntries: new Map()
};

function normalizeItemId(itemId) {
    if (itemId === null || itemId === undefined) {
        return null;
    }

    const normalizedItemId = String(itemId).trim();
    return normalizedItemId || null;
}

function normalizeRangeKey(rangeKey) {
    return PRICE_HISTORY_RANGE_CONFIG[rangeKey]
        ? rangeKey
        : DEFAULT_PRICE_HISTORY_RANGE_KEY;
}

function getRangeConfig(rangeKey) {
    return PRICE_HISTORY_RANGE_CONFIG[normalizeRangeKey(rangeKey)];
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toPointTimestamp(rawTimestamp, fallbackIndex) {
    if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
        return rawTimestamp > 9999999999 ? rawTimestamp : rawTimestamp * 1000;
    }

    if (typeof rawTimestamp === 'string' && rawTimestamp.trim()) {
        const parsedNumber = Number(rawTimestamp);
        if (Number.isFinite(parsedNumber)) {
            return parsedNumber > 9999999999 ? parsedNumber : parsedNumber * 1000;
        }

        const parsedDate = Date.parse(rawTimestamp);
        if (Number.isFinite(parsedDate)) {
            return parsedDate;
        }
    }

    return fallbackIndex;
}

function getPointValue(rawPoint) {
    if (rawPoint && typeof rawPoint === 'object') {
        return (
            rawPoint.value
            ?? rawPoint.price
            ?? rawPoint.avg
            ?? rawPoint.close
            ?? rawPoint.current
        );
    }

    return null;
}

function getPointTimestampValue(rawPoint) {
    if (rawPoint && typeof rawPoint === 'object') {
        return (
            rawPoint.timestamp
            ?? rawPoint.ts
            ?? rawPoint.date
            ?? rawPoint.day
            ?? rawPoint.time
        );
    }

    return null;
}

function pickRawPoints(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (!payload || typeof payload !== 'object') {
        return [];
    }

    if (Array.isArray(payload.points)) {
        return payload.points;
    }

    if (Array.isArray(payload.history)) {
        return payload.history;
    }

    if (Array.isArray(payload.data)) {
        return payload.data;
    }

    if (payload.data && typeof payload.data === 'object') {
        return pickRawPoints(payload.data);
    }

    return [];
}

function buildHistoryStats(points) {
    if (points.length === 0) {
        return {
            latest: null,
            min: null,
            max: null,
            deltaPercent: null,
            startTimestamp: null,
            endTimestamp: null,
            pointCount: 0
        };
    }

    const values = points.map((point) => point.value);
    const latest = values[values.length - 1];
    const first = values[0];

    return {
        latest,
        min: Math.min(...values),
        max: Math.max(...values),
        deltaPercent: first > 0 ? ((latest - first) / first) * 100 : null,
        startTimestamp: points[0].timestamp,
        endTimestamp: points[points.length - 1].timestamp,
        pointCount: points.length
    };
}

function getDefaultEntry(itemId = null, rangeKey = historyState.activeRangeByPanel.drops) {
    return {
        itemId: normalizeItemId(itemId),
        rangeKey: normalizeRangeKey(rangeKey),
        status: 'missing',
        stale: false,
        data: null,
        errorMessage: ''
    };
}

function isValidEntryStatus(status) {
    return typeof status === 'string' && VALID_ENTRY_STATUSES.has(status);
}

function isVisibleHistoryTarget(itemId, rangeKey) {
    const id = normalizeItemId(itemId);
    const normalizedRange = normalizeRangeKey(rangeKey);
    // this entry is "visible" if either panel has it open at the same range.
    // when the panels can diverge in range, only the matching panel counts.
    return (
        (historyState.expandedByPanel.drops === id
            && historyState.activeRangeByPanel.drops === normalizedRange)
        || (historyState.expandedByPanel.maps === id
            && historyState.activeRangeByPanel.maps === normalizedRange)
    );
}

function visibleCacheKey(itemId, rangeKey) {
    return `${normalizeItemId(itemId)}:${normalizeRangeKey(rangeKey)}`;
}

function storeVisibleEntry(itemId, rangeKey, entry) {
    if (!isVisibleHistoryTarget(itemId, rangeKey)) {
        return entry;
    }

    const normalized = normalizePriceHistoryEntry(entry, itemId, rangeKey);
    historyState.visibleEntries.set(
        visibleCacheKey(normalized.itemId, normalized.rangeKey),
        normalized
    );
    return normalized;
}

function requestPriceHistoryRefresh(itemId, rangeKey, apiCall) {
    const normalizedItemId = normalizeItemId(itemId);
    if (!normalizedItemId) {
        return Promise.resolve({
            status: 'error',
            message: 'This item does not have a history id.'
        });
    }

    if (typeof apiCall !== 'function') {
        return Promise.resolve({
            status: 'error',
            message: 'This app environment cannot load item history.'
        });
    }

    return Promise.resolve(
        apiCall('request_price_history', normalizedItemId, normalizeRangeKey(rangeKey))
    )
        .catch((error) => {
            console.error('[PriceHistory] refresh request failed:', itemId, rangeKey, error);
            return {
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to request item history.'
            };
        });
}

export function getPriceHistoryRange(rangeKey) {
    // resolves to drops-panel's active key when no explicit key is given.
    // callers that know their panel should pass getActivePriceHistoryRangeKey(panel).
    const key = rangeKey !== undefined
        ? rangeKey
        : historyState.activeRangeByPanel.drops;
    return getRangeConfig(key);
}

export function getActivePriceHistoryRangeKey(panel = 'drops') {
    return historyState.activeRangeByPanel[normalizePanel(panel)];
}

export function setActivePriceHistoryRangeKey(rangeKey, panel = 'drops') {
    const key = normalizePanel(panel);
    const nextRangeKey = normalizeRangeKey(rangeKey);
    historyState.activeRangeByPanel[key] = nextRangeKey;
    // no cache invalidation — entries are keyed per (itemId, rangeKey)
    // so a range switch simply surfaces a different already-cached entry
    return nextRangeKey;
}

export function formatPriceHistoryValue(value) {
    if (!Number.isFinite(value)) {
        return '0';
    }

    const absolute = Math.abs(value);

    if (absolute >= 1000) {
        return absolute >= 1000000
            ? `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`
            : `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }

    if (absolute >= 100) {
        return value.toFixed(1).replace(/\.0$/, '');
    }

    if (absolute >= 10) {
        return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    }

    if (absolute >= 1) {
        return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    }

    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export function normalizePriceHistoryResponse(
    payload,
    expectedItemId = null,
    rangeKey = historyState.activeRangeByPanel.drops
) {
    const range = getRangeConfig(rangeKey);
    const rawPoints = pickRawPoints(payload);

    const normalizedPoints = rawPoints
        .map((rawPoint, index) => {
            const value = toFiniteNumber(getPointValue(rawPoint));
            if (value === null) {
                return null;
            }

            return {
                timestamp: toPointTimestamp(getPointTimestampValue(rawPoint), index),
                value
            };
        })
        .filter(Boolean)
        .sort((pointA, pointB) => pointA.timestamp - pointB.timestamp);

    return {
        itemId: normalizeItemId(payload?.item_id ?? payload?.itemId ?? expectedItemId),
        rangeKey: range.key,
        interval: typeof payload?.interval === 'string' ? payload.interval : range.interval,
        points: normalizedPoints,
        stats: buildHistoryStats(normalizedPoints),
        fetchedAt: typeof payload?.fetchedAt === 'string' ? payload.fetchedAt : null
    };
}

export function normalizePriceHistoryEntry(
    entry,
    expectedItemId = null,
    rangeKey = historyState.activeRangeByPanel.drops
) {
    const normalizedRangeKey = normalizeRangeKey(entry?.rangeKey ?? rangeKey);
    const itemId = normalizeItemId(entry?.itemId ?? expectedItemId);
    const status = isValidEntryStatus(entry?.status) ? entry.status : 'missing';
    const stale = Boolean(entry?.stale);
    const data = entry?.data
        ? normalizePriceHistoryResponse(entry.data, itemId, normalizedRangeKey)
        : null;

    return {
        itemId,
        rangeKey: normalizedRangeKey,
        status,
        stale,
        data,
        errorMessage: typeof entry?.errorMessage === 'string' ? entry.errorMessage : ''
    };
}

function normalizePanel(panel) {
    return panel === 'maps' ? 'maps' : 'drops';
}

export function getExpandedPriceHistoryItemId(panel = 'drops') {
    return historyState.expandedByPanel[normalizePanel(panel)] || null;
}

export function toggleExpandedPriceHistoryItem(itemId, panel = 'drops') {
    const key = normalizePanel(panel);
    const normalizedItemId = normalizeItemId(itemId);
    if (!normalizedItemId) {
        historyState.expandedByPanel[key] = null;
        return null;
    }

    historyState.expandedByPanel[key] = historyState.expandedByPanel[key] === normalizedItemId
        ? null
        : normalizedItemId;
    return historyState.expandedByPanel[key];
}

export function collapseExpandedPriceHistory() {
    historyState.expandedByPanel.drops = null;
    historyState.expandedByPanel.maps = null;
    historyState.visibleEntries.clear();
}

export function syncExpandedPriceHistory(itemIds, panel = 'drops') {
    const key = normalizePanel(panel);
    if (!historyState.expandedByPanel[key]) {
        return;
    }

    const validItemIds = new Set(
        (itemIds || [])
            .map((itemId) => normalizeItemId(itemId))
            .filter(Boolean)
    );
    if (!validItemIds.has(historyState.expandedByPanel[key])) {
        historyState.expandedByPanel[key] = null;
    }
}

export function getPriceHistoryEntry(itemId, rangeKey = historyState.activeRangeByPanel.drops) {
    const cached = historyState.visibleEntries.get(
        visibleCacheKey(itemId, rangeKey)
    );
    if (cached) {
        return cached;
    }
    return getDefaultEntry(itemId, rangeKey);
}

export function applyPriceHistoryUpdate(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const normalizedEntry = normalizePriceHistoryEntry(entry, entry.itemId, entry.rangeKey);
    if (!isVisibleHistoryTarget(normalizedEntry.itemId, normalizedEntry.rangeKey)) {
        return normalizedEntry;
    }

    historyState.visibleEntries.set(
        visibleCacheKey(normalizedEntry.itemId, normalizedEntry.rangeKey),
        normalizedEntry
    );
    return normalizedEntry;
}

export function resetPriceHistoryState() {
    historyState.expandedByPanel.drops = null;
    historyState.expandedByPanel.maps = null;
    historyState.activeRangeByPanel.drops = DEFAULT_PRICE_HISTORY_RANGE_KEY;
    historyState.activeRangeByPanel.maps = DEFAULT_PRICE_HISTORY_RANGE_KEY;
    historyState.visibleEntries.clear();
}

export async function ensurePriceHistory(
    itemId,
    rangeKeyOrApiCall = historyState.activeRangeByPanel.drops,
    apiCall = globalThis.api
) {
    let rangeKey = rangeKeyOrApiCall;
    if (typeof rangeKeyOrApiCall === 'function') {
        apiCall = rangeKeyOrApiCall;
        rangeKey = historyState.activeRangeByPanel.drops;
    }

    const range = getRangeConfig(rangeKey);
    const normalizedItemId = normalizeItemId(itemId);

    if (!normalizedItemId) {
        return normalizePriceHistoryEntry({
            itemId: null,
            rangeKey: range.key,
            status: 'error',
            stale: false,
            data: null,
            errorMessage: 'This item does not have a history id.'
        }, null, range.key);
    }

    if (typeof apiCall !== 'function') {
        return storeVisibleEntry(normalizedItemId, range.key, {
            itemId: normalizedItemId,
            rangeKey: range.key,
            status: 'error',
            stale: false,
            data: null,
            errorMessage: 'This app environment cannot load item history.'
        });
    }

    const snapshot = normalizePriceHistoryEntry(
        await apiCall('get_price_history', normalizedItemId, range.key),
        normalizedItemId,
        range.key
    );

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
        const visibleEntry = storeVisibleEntry(normalizedItemId, range.key, snapshot);
        if (snapshot.stale) {
            void requestPriceHistoryRefresh(normalizedItemId, range.key, apiCall);
        }
        return visibleEntry ?? snapshot;
    }

    if (snapshot.status === 'missing' || snapshot.status === 'loading') {
        const loadingEntry = storeVisibleEntry(normalizedItemId, range.key, {
            itemId: normalizedItemId,
            rangeKey: range.key,
            status: 'loading',
            stale: false,
            data: null,
            errorMessage: ''
        });
        void requestPriceHistoryRefresh(normalizedItemId, range.key, apiCall);
        return loadingEntry ?? normalizePriceHistoryEntry(
            {
                itemId: normalizedItemId,
                rangeKey: range.key,
                status: 'loading',
                stale: false,
                data: null,
                errorMessage: ''
            },
            normalizedItemId,
            range.key
        );
    }

    return storeVisibleEntry(normalizedItemId, range.key, snapshot) ?? snapshot;
}
