import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyPriceHistoryUpdate,
    ensurePriceHistory,
    formatPriceHistoryValue,
    getActivePriceHistoryRangeKey,
    getExpandedPriceHistoryItemId,
    getPriceHistoryEntry,
    getPriceHistoryRange,
    normalizePriceHistoryEntry,
    normalizePriceHistoryResponse,
    resetPriceHistoryState,
    setActivePriceHistoryRangeKey,
    toggleExpandedPriceHistoryItem
} from './price-history.js';

test.afterEach(() => {
    resetPriceHistoryState();
});

function buildReadyEntry({
    itemId = '5028',
    rangeKey = '7d',
    stale = false,
    interval = rangeKey === '7d' ? '1h' : '1d',
    points = [
        { timestamp: 1775865600000, value: 0.038 },
        { timestamp: 1775952000000, value: 0.044 }
    ]
} = {}) {
    return {
        itemId,
        rangeKey,
        status: 'ready',
        stale,
        data: {
            itemId,
            rangeKey,
            interval,
            points
        },
        errorMessage: ''
    };
}

test('toggleExpandedPriceHistoryItem opens and closes one row at a time', () => {
    assert.equal(toggleExpandedPriceHistoryItem('1001'), '1001');
    assert.equal(getExpandedPriceHistoryItemId(), '1001');
    assert.equal(toggleExpandedPriceHistoryItem('1001'), null);
    assert.equal(getExpandedPriceHistoryItemId(), null);
    assert.equal(toggleExpandedPriceHistoryItem('1002'), '1002');
    assert.equal(getExpandedPriceHistoryItemId(), '1002');
});

test('normalizePriceHistoryResponse sorts timestamp-only points and preserves timestamps', () => {
    const normalized = normalizePriceHistoryResponse({
        item_id: '5028',
        interval: '1h',
        points: [
            { timestamp: 1776038400000, value: 0.044 },
            { timestamp: 1775865600000, value: 0.038 },
            { timestamp: 1775952000000, value: 0.041 }
        ]
    }, '5028', '7d');

    assert.equal(normalized.itemId, '5028');
    assert.equal(normalized.rangeKey, '7d');
    assert.equal(normalized.interval, '1h');
    assert.deepEqual(
        normalized.points.map((point) => point.timestamp),
        [1775865600000, 1775952000000, 1776038400000]
    );
    assert.equal(normalized.stats.latest, 0.044);
    assert.equal(normalized.stats.min, 0.038);
    assert.equal(normalized.stats.max, 0.044);
    assert.equal(normalized.stats.startTimestamp, 1775865600000);
    assert.equal(normalized.stats.endTimestamp, 1776038400000);
});

test('normalizers preserve null item ids for invalid history targets', () => {
    const response = normalizePriceHistoryResponse(
        { interval: '1h', points: [] },
        null,
        '7d'
    );
    const entry = normalizePriceHistoryEntry(
        { status: 'missing', stale: false, data: null },
        null,
        '7d'
    );

    assert.equal(response.itemId, null);
    assert.equal(entry.itemId, null);
    assert.equal(getPriceHistoryEntry(null, '7d').itemId, null);
});

test('active range defaults to 7D and reset restores it', () => {
    assert.equal(getActivePriceHistoryRangeKey(), '7d');
    assert.equal(getPriceHistoryRange().interval, '1h');

    setActivePriceHistoryRangeKey('30d');
    assert.equal(getActivePriceHistoryRangeKey(), '30d');
    assert.equal(getPriceHistoryRange().interval, '1d');

    resetPriceHistoryState();
    assert.equal(getActivePriceHistoryRangeKey(), '7d');
    assert.equal(getPriceHistoryRange().interval, '1h');
});

test('ensurePriceHistory shows loading for a missing cache and queues a bridge refresh', async () => {
    const calls = [];
    toggleExpandedPriceHistoryItem('5028');

    const apiStub = async (method, itemId, rangeKey) => {
        calls.push([method, itemId, rangeKey]);
        if (method === 'get_price_history') {
            return { itemId, rangeKey, status: 'missing', stale: false, data: null };
        }
        return { status: 'queued', itemId, rangeKey };
    };

    const entry = await ensurePriceHistory('5028', '7d', apiStub);

    assert.equal(entry.status, 'loading');
    assert.equal(getPriceHistoryEntry('5028', '7d').status, 'loading');
    assert.deepEqual(calls, [
        ['get_price_history', '5028', '7d'],
        ['request_price_history', '5028', '7d']
    ]);
});

test('ensurePriceHistory rejects null item ids without calling the bridge', async () => {
    let apiCalls = 0;

    const entry = await ensurePriceHistory(null, '7d', async () => {
        apiCalls += 1;
        throw new Error('bridge should not be called for null ids');
    });

    assert.equal(entry.itemId, null);
    assert.equal(entry.status, 'error');
    assert.equal(entry.errorMessage, 'This item does not have a history id.');
    assert.equal(apiCalls, 0);
});

test('ensurePriceHistory renders stale cached data immediately and refreshes in background', async () => {
    const calls = [];
    toggleExpandedPriceHistoryItem('5028');

    const apiStub = async (method, itemId, rangeKey) => {
        calls.push([method, itemId, rangeKey]);
        if (method === 'get_price_history') {
            return buildReadyEntry({ itemId, rangeKey, stale: true });
        }
        return { status: 'queued', itemId, rangeKey };
    };

    const entry = await ensurePriceHistory('5028', '7d', apiStub);

    assert.equal(entry.status, 'ready');
    assert.equal(entry.stale, true);
    assert.equal(entry.data.stats.latest, 0.044);
    assert.equal(getPriceHistoryEntry('5028', '7d').status, 'ready');
    assert.deepEqual(calls, [
        ['get_price_history', '5028', '7d'],
        ['request_price_history', '5028', '7d']
    ]);
});

test('applyPriceHistoryUpdate replaces the visible row entry when the backend event arrives', async () => {
    toggleExpandedPriceHistoryItem('5028');

    await ensurePriceHistory('5028', '7d', async (method, itemId, rangeKey) => {
        if (method === 'get_price_history') {
            return { itemId, rangeKey, status: 'missing', stale: false, data: null };
        }
        return { status: 'queued', itemId, rangeKey };
    });

    applyPriceHistoryUpdate(buildReadyEntry({
        itemId: '5028',
        rangeKey: '7d',
        points: [
            { timestamp: 1775865600000, value: 0.05 },
            { timestamp: 1775952000000, value: 0.055 }
        ]
    }));

    const entry = getPriceHistoryEntry('5028', '7d');
    assert.equal(entry.status, 'ready');
    assert.equal(entry.data.stats.latest, 0.055);
});

test('visible stale data stays rendered until a matching backend update replaces it', async () => {
    toggleExpandedPriceHistoryItem('5028');

    await ensurePriceHistory('5028', '7d', async (method, itemId, rangeKey) => {
        if (method === 'get_price_history') {
            return buildReadyEntry({ itemId, rangeKey, stale: true });
        }
        return { status: 'queued', itemId, rangeKey };
    });

    applyPriceHistoryUpdate(buildReadyEntry({
        itemId: '9001',
        rangeKey: '7d',
        points: [{ timestamp: 1775952000000, value: 9.9 }]
    }));

    const entry = getPriceHistoryEntry('5028', '7d');
    assert.equal(entry.status, 'ready');
    assert.equal(entry.stale, true);
    assert.equal(entry.data.stats.latest, 0.044);
});

test('late updates from a previous range do not replace the active range entry', async () => {
    toggleExpandedPriceHistoryItem('5028');

    await ensurePriceHistory('5028', '7d', async (method, itemId, rangeKey) => {
        if (method === 'get_price_history') {
            return { itemId, rangeKey, status: 'missing', stale: false, data: null };
        }
        return { status: 'queued', itemId, rangeKey };
    });

    setActivePriceHistoryRangeKey('30d');
    await ensurePriceHistory('5028', '30d', async (method, itemId, rangeKey) => {
        if (method === 'get_price_history') {
            return { itemId, rangeKey, status: 'missing', stale: false, data: null };
        }
        return { status: 'queued', itemId, rangeKey };
    });

    applyPriceHistoryUpdate(buildReadyEntry({
        itemId: '5028',
        rangeKey: '7d',
        points: [
            { timestamp: 1775865600000, value: 0.05 },
            { timestamp: 1775952000000, value: 0.055 }
        ]
    }));

    assert.equal(getPriceHistoryEntry('5028', '30d').status, 'loading');

    applyPriceHistoryUpdate(buildReadyEntry({
        itemId: '5028',
        rangeKey: '30d',
        interval: '1d',
        points: [
            { timestamp: 1773273600000, value: 0.51 },
            { timestamp: 1775865600000, value: 0.57 }
        ]
    }));

    const entry = getPriceHistoryEntry('5028', '30d');
    assert.equal(entry.status, 'ready');
    assert.equal(entry.data.interval, '1d');
    assert.equal(entry.data.stats.latest, 0.57);
});

test('missing cache failure becomes an inline error when the backend emits one', async () => {
    toggleExpandedPriceHistoryItem('5028');
    setActivePriceHistoryRangeKey('30d');

    await ensurePriceHistory('5028', '30d', async (method, itemId, rangeKey) => {
        if (method === 'get_price_history') {
            return { itemId, rangeKey, status: 'missing', stale: false, data: null };
        }
        return { status: 'queued', itemId, rangeKey };
    });

    applyPriceHistoryUpdate({
        itemId: '5028',
        rangeKey: '30d',
        status: 'error',
        stale: false,
        data: null,
        errorMessage: 'Failed to load price history.'
    });

    assert.equal(getPriceHistoryEntry('5028', '30d').status, 'error');
    assert.equal(
        getPriceHistoryEntry('5028', '30d').errorMessage,
        'Failed to load price history.'
    );
});

test('active range stays sticky while different rows are expanded', () => {
    setActivePriceHistoryRangeKey('30d');

    assert.equal(toggleExpandedPriceHistoryItem('1001'), '1001');
    assert.equal(getExpandedPriceHistoryItemId(), '1001');
    assert.equal(getActivePriceHistoryRangeKey(), '30d');

    assert.equal(toggleExpandedPriceHistoryItem('1002'), '1002');
    assert.equal(getExpandedPriceHistoryItemId(), '1002');
    assert.equal(getActivePriceHistoryRangeKey(), '30d');
    assert.equal(getPriceHistoryRange().interval, '1d');
});

test('formatPriceHistoryValue preserves useful decimal precision', () => {
    assert.equal(formatPriceHistoryValue(0.0495), '0.0495');
    assert.equal(formatPriceHistoryValue(1.23456), '1.235');
    assert.equal(formatPriceHistoryValue(1234), '1.2k');
});
