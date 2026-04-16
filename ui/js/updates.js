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
    trigger: ''
});

let currentUpdateState = { ...DEFAULT_UPDATE_STATE };
let applyInFlight = false;

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
        trigger: typeof snapshot?.trigger === 'string' ? snapshot.trigger : ''
    };
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

function renderUpdateStatus(message = '', type = 'info') {
    const el = elements.updateStatus;
    if (!el) return;

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

function renderUpdateControls() {
    const button = elements.btnCheckUpdates;
    if (!button) return;

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

    renderUpdateStatus(view.statusMessage, view.statusType);
}

function renderUpdateNotification() {
    const el = elements.updateNotification;
    const text = elements.updateNotificationText;
    const btn = elements.btnUpdateRestart;
    if (!el || !text || !btn) return;

    // manual checks stay entirely in the settings modal
    if (currentUpdateState.trigger === 'manual') {
        el.classList.add('hidden');
        return;
    }

    if (applyInFlight) {
        el.classList.remove('hidden');
        text.textContent = currentUpdateState.new_version
            ? `Applying v${currentUpdateState.new_version}...`
            : 'Applying update...';
        btn.textContent = 'Restarting...';
        btn.disabled = true;
        return;
    }

    if (currentUpdateState.status === 'downloaded') {
        el.classList.remove('hidden');
        text.textContent = currentUpdateState.new_version
            ? `Update ready: v${currentUpdateState.new_version}`
            : 'Update ready to install';
        btn.textContent = 'Restart to Update';
        btn.disabled = false;
        return;
    }

    el.classList.add('hidden');
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

export async function checkForUpdates() {
    if (applyInFlight) {
        return;
    }

    if (currentUpdateState.status === 'downloaded') {
        await applyDownloadedUpdate();
        return;
    }

    try {
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
