/**
 * Background update state management and rendering.
 */

import { elements } from './elements.js';

const DEFAULT_UPDATE_STATE = Object.freeze({
    status: 'idle',
    current_version: '',
    new_version: '',
    progress_percent: 0,
    error: '',
    trigger: '',
    last_checked_at: '',
    release_notes: ''
});

let currentUpdateState = { ...DEFAULT_UPDATE_STATE };
let applyInFlight = false;
let dismissedForVersion = '';

const MANUAL_FADE_DELAY_MS = 3000;
const FADE_TRANSITION_MS = 400;
let fadeDelayTimer = null;
let fadeHideTimer = null;
let manualStatusConsumed = false;

export function normalizeUpdateState(snapshot = {}) {
    return {
        ...DEFAULT_UPDATE_STATE,
        ...snapshot,
        status: typeof snapshot?.status === 'string' ? snapshot.status : 'idle',
        current_version: typeof snapshot?.current_version === 'string' ? snapshot.current_version : '',
        new_version: typeof snapshot?.new_version === 'string' ? snapshot.new_version : '',
        progress_percent: Number.isFinite(snapshot?.progress_percent)
            ? Math.max(0, Math.min(100, Math.round(snapshot.progress_percent)))
            : 0,
        error: typeof snapshot?.error === 'string' ? snapshot.error : '',
        trigger: typeof snapshot?.trigger === 'string' ? snapshot.trigger : '',
        last_checked_at: typeof snapshot?.last_checked_at === 'string' ? snapshot.last_checked_at : '',
        release_notes: typeof snapshot?.release_notes === 'string' ? snapshot.release_notes : ''
    };
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

export function parseReleaseNotes(text) {
    if (!text) return '';
    const lines = escapeHtml(text).split('\n');
    const html = [];
    let inList = false;

    const applyBold = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const closeList = () => {
        if (inList) {
            html.push('</ul>');
            inList = false;
        }
    };

    for (const raw of lines) {
        const line = raw.trim();
        if (line.startsWith('- ')) {
            if (!inList) {
                html.push('<ul>');
                inList = true;
            }
            html.push(`<li>${applyBold(line.slice(2))}</li>`);
            continue;
        }

        closeList();
        if (line === '') continue;

        const content = applyBold(line);
        if (/^<strong>.*<\/strong>$/.test(content)) {
            html.push(`<div class="notes-heading">${content}</div>`);
        } else {
            html.push(`<p>${content}</p>`);
        }
    }
    closeList();
    return html.join('');
}

export function formatRelativeTime(iso, now = Date.now()) {
    if (!iso) return '';
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return '';
    const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
}

export function buildUpdateViewModel(snapshot, { applyPending = false } = {}) {
    const state = normalizeUpdateState(snapshot);
    const view = {
        buttonText: 'Check Now',
        buttonDisabled: false,
        statusMessage: '',
        statusType: 'info'
    };

    if (applyPending) {
        view.buttonText = 'Restarting...';
        view.buttonDisabled = true;
        view.statusMessage = state.new_version
            ? `Applying v${state.new_version}...`
            : 'Applying update...';
        return view;
    }

    switch (state.status) {
        case 'checking':
            view.buttonText = 'Checking...';
            view.buttonDisabled = true;
            break;
        case 'downloading':
            view.buttonText = 'Downloading...';
            view.buttonDisabled = true;
            view.statusMessage = state.new_version
                ? `Downloading v${state.new_version}... ${state.progress_percent}%`
                : `Downloading update... ${state.progress_percent}%`;
            break;
        case 'downloaded':
            view.buttonText = 'Update';
            view.statusMessage = state.new_version
                ? `Update ready: v${state.new_version}`
                : 'Update ready to install';
            view.statusType = 'success';
            break;
        case 'up_to_date':
            if (state.trigger === 'manual') {
                view.statusMessage = "You're running the latest version!";
                view.statusType = 'success';
            }
            break;
        case 'error':
            if (state.trigger === 'manual' && state.error) {
                view.statusMessage = state.error;
                view.statusType = 'error';
            }
            break;
    }

    return view;
}

function cancelStatusFade() {
    if (fadeDelayTimer) {
        clearTimeout(fadeDelayTimer);
        fadeDelayTimer = null;
    }
    if (fadeHideTimer) {
        clearTimeout(fadeHideTimer);
        fadeHideTimer = null;
    }
    elements.updateStatus?.classList.remove('fading-out');
}

function scheduleStatusFade() {
    const el = elements.updateStatus;
    if (!el) return;

    cancelStatusFade();
    fadeDelayTimer = setTimeout(() => {
        fadeDelayTimer = null;
        el.classList.add('fading-out');
        fadeHideTimer = setTimeout(() => {
            fadeHideTimer = null;
            el.textContent = '';
            el.classList.add('hidden');
            el.classList.remove('fading-out', 'status-info', 'status-success', 'status-error');
            manualStatusConsumed = true;
        }, FADE_TRANSITION_MS);
    }, MANUAL_FADE_DELAY_MS);
}

function renderUpdateStatus(message = '', type = 'info') {
    const el = elements.updateStatus;
    if (!el) return;

    cancelStatusFade();

    if (!message) {
        el.textContent = '';
        el.classList.add('hidden');
        el.classList.remove('status-info', 'status-success', 'status-error');
        return;
    }

    el.textContent = message;
    el.classList.remove('hidden', 'status-info', 'status-success', 'status-error');
    el.classList.add(`status-${type}`);
}

function renderCheckUpdatesTooltip() {
    const label = elements.checkUpdatesLabel;
    if (!label) return;

    const version = currentUpdateState.current_version;
    const parts = [];
    if (version) parts.push(`Current: v${version}`);
    const rel = formatRelativeTime(currentUpdateState.last_checked_at);
    if (rel) parts.push(`Last checked ${rel}`);

    if (parts.length === 0) {
        delete label.dataset.tooltip;
    } else {
        label.dataset.tooltip = parts.join(' · ');
    }
}

function renderUpdateControls() {
    const button = elements.btnCheckUpdates;
    if (!button) return;

    renderCheckUpdatesTooltip();

    const view = buildUpdateViewModel(currentUpdateState, { applyPending: applyInFlight });
    button.textContent = view.buttonText;
    button.disabled = view.buttonDisabled;

    if (currentUpdateState.status === 'downloaded' && !applyInFlight) {
        button.setAttribute('data-tooltip', 'Restarts the app to install the update');
    } else {
        button.removeAttribute('data-tooltip');
    }

    // auto-download status is surfaced on the main window, not settings
    if (currentUpdateState.trigger !== 'manual'
        && (currentUpdateState.status === 'downloaded' || applyInFlight)) {
        renderUpdateStatus('', 'info');
        return;
    }

    const suppressConsumed = manualStatusConsumed
        && currentUpdateState.trigger === 'manual'
        && !applyInFlight;
    const message = suppressConsumed ? '' : view.statusMessage;
    renderUpdateStatus(message, view.statusType);

    const shouldFade = !applyInFlight
        && !suppressConsumed
        && currentUpdateState.trigger === 'manual'
        && (currentUpdateState.status === 'up_to_date' || currentUpdateState.status === 'downloaded')
        && !!view.statusMessage;
    if (shouldFade) {
        scheduleStatusFade();
    }
}

function renderReleaseNotes(show) {
    const notes = elements.updateNotificationNotes;
    const body = elements.updateNotificationNotesBody;
    if (!notes || !body) return;

    const html = show ? parseReleaseNotes(currentUpdateState.release_notes) : '';
    if (!html) {
        notes.classList.add('hidden');
        body.innerHTML = '';
        return;
    }
    body.innerHTML = html;
    notes.classList.remove('hidden');
}

function renderUpdateNotification() {
    const el = elements.updateNotification;
    const text = elements.updateNotificationText;
    const btn = elements.btnUpdateRestart;
    const dismissBtn = elements.btnUpdateDismiss;
    if (!el || !text || !btn) return;

    // manual checks stay entirely in the settings modal
    if (currentUpdateState.trigger === 'manual') {
        el.classList.add('hidden');
        renderReleaseNotes(false);
        return;
    }

    // dismiss is meaningless once the user has committed to applying
    if (dismissBtn) dismissBtn.classList.toggle('hidden', applyInFlight);

    if (applyInFlight) {
        el.classList.remove('hidden');
        text.textContent = currentUpdateState.new_version
            ? `Applying v${currentUpdateState.new_version}...`
            : 'Applying update...';
        btn.textContent = 'Restarting...';
        btn.disabled = true;
        renderReleaseNotes(false);
        return;
    }

    if (currentUpdateState.status === 'downloaded') {
        if (dismissedForVersion && dismissedForVersion === currentUpdateState.new_version) {
            el.classList.add('hidden');
            renderReleaseNotes(false);
            return;
        }
        el.classList.remove('hidden');
        text.textContent = currentUpdateState.new_version
            ? `Update ready: v${currentUpdateState.new_version}`
            : 'Update ready to install';
        btn.textContent = 'Restart to Update';
        btn.disabled = false;
        renderReleaseNotes(true);
        return;
    }

    el.classList.add('hidden');
    renderReleaseNotes(false);
}

export function handleUpdateState(snapshot) {
    currentUpdateState = normalizeUpdateState(snapshot);
    if (currentUpdateState.status !== 'downloaded') {
        applyInFlight = false;
    }
    renderUpdateControls();
    renderUpdateNotification();
}

export async function loadUpdateState() {
    try {
        const snapshot = await api('get_update_state');
        handleUpdateState(snapshot);
        return currentUpdateState;
    } catch (error) {
        console.error('Failed to load update state:', error);
        return currentUpdateState;
    }
}

async function startUpdateFlow(trigger) {
    const snapshot = await api('start_update_flow', trigger);
    handleUpdateState(snapshot);
    return snapshot;
}

export async function applyDownloadedUpdate() {
    applyInFlight = true;
    renderUpdateControls();
    renderUpdateNotification();

    try {
        const result = await api('apply_downloaded_update');
        if (result.status === 'error') {
            applyInFlight = false;
            await loadUpdateState();
            return;
        }

        window.bridge.quit_app();
    } catch (error) {
        console.error('Failed to apply update:', error);
        applyInFlight = false;
        await loadUpdateState();
    }
}

export function dismissUpdateBanner() {
    dismissedForVersion = currentUpdateState.new_version || '';
    renderUpdateNotification();
}

export async function checkForUpdates() {
    if (applyInFlight) {
        return;
    }

    if (currentUpdateState.status === 'downloaded') {
        await applyDownloadedUpdate();
        return;
    }

    try {
        manualStatusConsumed = false;
        await startUpdateFlow('manual');
    } catch (error) {
        console.error('Update flow failed:', error);
        handleUpdateState({
            ...currentUpdateState,
            status: 'error',
            error: 'Update check failed',
            trigger: 'manual'
        });
    }
}

export async function checkForUpdatesOnStartup() {
    try {
        await startUpdateFlow('startup');
    } catch (error) {
        console.error('Startup update check failed:', error);
    }
}
