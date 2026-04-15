import test from 'node:test';
import assert from 'node:assert/strict';

function restoreGlobal(name, previousValue) {
    if (previousValue === undefined) {
        delete globalThis[name];
        return;
    }

    globalThis[name] = previousValue;
}

test('renderPriceHistory shows an empty state when no points are available', async () => {
    const previousWindow = globalThis.window;
    const previousTLI = globalThis.TLI;

    globalThis.window = {
        TLI: {
            formatCompact(value) {
                return String(value);
            }
        }
    };
    globalThis.TLI = globalThis.window.TLI;

    try {
        await import('./shared-charts.js');

        const container = {
            innerHTML: '',
            dataset: {}
        };

        globalThis.window.TLI.charts.renderPriceHistory(container, {
            points: [],
            rangeKey: '7d'
        });

        assert.match(container.innerHTML, /No history/);
    } finally {
        restoreGlobal('window', previousWindow);
        restoreGlobal('TLI', previousTLI);
    }
});
