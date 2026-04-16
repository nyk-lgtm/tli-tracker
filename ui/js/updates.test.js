import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUpdateViewModel, formatRelativeTime, normalizeUpdateState } from './updates.js';

test('normalizeUpdateState fills in defaults', () => {
    const state = normalizeUpdateState({ status: 'checking' });

    assert.equal(state.status, 'checking');
    assert.equal(state.current_version, '');
    assert.equal(state.new_version, '');
    assert.equal(state.progress_percent, 0);
    assert.equal(state.error, '');
    assert.equal(state.trigger, '');
});

test('manual up-to-date state shows a success message', () => {
    const view = buildUpdateViewModel({
        status: 'up_to_date',
        trigger: 'manual'
    });

    assert.equal(view.buttonText, 'Check Now');
    assert.equal(view.buttonDisabled, false);
    assert.equal(view.statusMessage, "You're running the latest version!");
    assert.equal(view.statusType, 'success');
});

test('downloading state renders progress and disables actions', () => {
    const view = buildUpdateViewModel({
        status: 'downloading',
        trigger: 'manual',
        new_version: '0.2.3',
        progress_percent: 67
    });

    assert.equal(view.buttonText, 'Downloading...');
    assert.equal(view.buttonDisabled, true);
    assert.equal(view.statusMessage, 'Downloading v0.2.3... 67%');
    assert.equal(view.statusType, 'info');
});

test('downloaded state switches the action to restart', () => {
    const view = buildUpdateViewModel({
        status: 'downloaded',
        trigger: 'startup',
        new_version: '0.2.3',
        progress_percent: 100
    });

    assert.equal(view.buttonText, 'Update');
    assert.equal(view.buttonDisabled, false);
    assert.equal(view.statusMessage, 'Update ready: v0.2.3');
    assert.equal(view.statusType, 'success');
});

test('busy states stay disabled while checking', () => {
    const view = buildUpdateViewModel({
        status: 'checking',
        trigger: 'manual'
    });

    assert.equal(view.buttonText, 'Checking...');
    assert.equal(view.buttonDisabled, true);
    assert.equal(view.statusMessage, '');
});

test('formatRelativeTime buckets seconds, minutes, hours, days', () => {
    const now = Date.parse('2026-04-16T12:00:00Z');

    assert.equal(formatRelativeTime('', now), '');
    assert.equal(formatRelativeTime('not-a-date', now), '');
    assert.equal(formatRelativeTime('2026-04-16T11:59:30Z', now), 'just now');
    assert.equal(formatRelativeTime('2026-04-16T11:55:00Z', now), '5m ago');
    assert.equal(formatRelativeTime('2026-04-16T09:00:00Z', now), '3h ago');
    assert.equal(formatRelativeTime('2026-04-14T12:00:00Z', now), '2d ago');
});

test('normalizeUpdateState carries last_checked_at through', () => {
    const state = normalizeUpdateState({ last_checked_at: '2026-04-16T12:00:00Z' });
    assert.equal(state.last_checked_at, '2026-04-16T12:00:00Z');
});

test('startup errors stay quiet while manual errors surface', () => {
    const startupView = buildUpdateViewModel({
        status: 'error',
        trigger: 'startup',
        error: 'Network down'
    });
    const manualView = buildUpdateViewModel({
        status: 'error',
        trigger: 'manual',
        error: 'Network down'
    });

    assert.equal(startupView.statusMessage, '');
    assert.equal(manualView.statusMessage, 'Network down');
    assert.equal(manualView.statusType, 'error');
});
