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
    expandedItemId: null,
    activeRangeKey: DEFAULT_PRICE_HISTORY_RANGE_KEY,
    visibleEntry: null
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

function getDefaultEntry(itemId = null, rangeKey = historyState.activeRangeKey) {
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
    return (
        historyState.expandedItemId === normalizeItemId(itemId)
        && historyState.activeRangeKey === normalizeRangeKey(rangeKey)
    );
}

function storeVisibleEntry(itemId, rangeKey, entry) {
    if (!isVisibleHistoryTarget(itemId, rangeKey)) {
        return entry;
    }

    historyState.visibleEntry = normalizePriceHistoryEntry(entry, itemId, rangeKey);
    return historyState.visibleEntry;
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

export function getPriceHistoryRange(rangeKey = historyState.activeRangeKey) {
    return getRangeConfig(rangeKey);
}

export function getActivePriceHistoryRangeKey() {
    return historyState.activeRangeKey;
}

export function setActivePriceHistoryRangeKey(rangeKey) {
    const nextRangeKey = normalizeRangeKey(rangeKey);
    historyState.activeRangeKey = nextRangeKey;

    if (historyState.visibleEntry?.rangeKey !== nextRangeKey) {
        historyState.visibleEntry = null;
    }

    return historyState.activeRangeKey;
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
    rangeKey = historyState.activeRangeKey
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
    rangeKey = historyState.activeRangeKey
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

export function getExpandedPriceHistoryItemId() {
    return historyState.expandedItemId;
}

export function toggleExpandedPriceHistoryItem(itemId) {
    const normalizedItemId = normalizeItemId(itemId);
    if (!normalizedItemId) {
        historyState.expandedItemId = null;
        historyState.visibleEntry = null;
        return null;
    }

    historyState.expandedItemId = historyState.expandedItemId === normalizedItemId
        ? null
        : normalizedItemId;
    historyState.visibleEntry = null;
    return historyState.expandedItemId;
}

export function collapseExpandedPriceHistory() {
    historyState.expandedItemId = null;
    historyState.visibleEntry = null;
}

export function syncExpandedPriceHistory(itemIds) {
    if (!historyState.expandedItemId) {
        return;
    }

    const validItemIds = new Set(
        (itemIds || [])
            .map((itemId) => normalizeItemId(itemId))
            .filter(Boolean)
    );
    if (!validItemIds.has(historyState.expandedItemId)) {
        historyState.expandedItemId = null;
        historyState.visibleEntry = null;
    }
}

export function getPriceHistoryEntry(itemId, rangeKey = historyState.activeRangeKey) {
    if (
        historyState.visibleEntry
        && historyState.visibleEntry.itemId === normalizeItemId(itemId)
        && historyState.visibleEntry.rangeKey === normalizeRangeKey(rangeKey)
    ) {
        return historyState.visibleEntry;
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

    historyState.visibleEntry = normalizedEntry;
    return normalizedEntry;
}

export function resetPriceHistoryState() {
    historyState.expandedItemId = null;
    historyState.activeRangeKey = DEFAULT_PRICE_HISTORY_RANGE_KEY;
    historyState.visibleEntry = null;
}

export async function ensurePriceHistory(
    itemId,
    rangeKeyOrApiCall = historyState.activeRangeKey,
    apiCall = globalThis.api
) {
    let rangeKey = rangeKeyOrApiCall;
    if (typeof rangeKeyOrApiCall === 'function') {
        apiCall = rangeKeyOrApiCall;
        rangeKey = historyState.activeRangeKey;
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
