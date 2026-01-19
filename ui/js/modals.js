/**
 * Modal and dialog handling
 */

// Callbacks for modal open events (set by app.js to avoid circular deps)
let onSettingsOpen = null;
let onHistoryOpen = null;

export function setModalCallbacks(callbacks) {
    onSettingsOpen = callbacks.onSettingsOpen;
    onHistoryOpen = callbacks.onHistoryOpen;
}

// ============ Modals ============

export function openModal(name) {
    const modal = document.getElementById(`${name}-modal`);
    if (modal) {
        modal.classList.remove('hidden');

        if (name === 'settings' && onSettingsOpen) onSettingsOpen();
        if (name === 'history' && onHistoryOpen) onHistoryOpen();
    }
}

export function closeModal(name) {
    const modal = document.getElementById(`${name}-modal`);
    if (modal) modal.classList.add('hidden');
}

// ============ Confirmation Dialog ============

export function showConfirmDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');

        titleEl.textContent = title;
        messageEl.textContent = message;
        btnOk.textContent = confirmText;
        btnCancel.textContent = cancelText;

        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            btnOk.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onBackdrop = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        };

        btnOk.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}
