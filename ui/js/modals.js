/**
 * Modal and dialog handling
 */

// ============ Modals ============

export function openModal(name) {
    const modal = document.getElementById(`${name}-modal`);
    if (modal) {
        modal.classList.remove('hidden');
    }
}

export function closeModal(name) {
    const modal = document.getElementById(`${name}-modal`);
    if (modal) modal.classList.add('hidden');
}

// ============ Confirmation Dialog ============

export function showConfirmLoading(text = 'Loading...') {
    const modal = document.getElementById('confirm-modal');
    const loading = document.getElementById('confirm-loading');
    const loadingText = document.getElementById('confirm-loading-text');
    const body = document.getElementById('confirm-body');

    if (modal && loading && body) {
        modal.classList.remove('hidden');
        loadingText.textContent = text;
        body.classList.add('invisible');
        loading.classList.remove('hidden');
    }
}

export function hideConfirmLoading() {
    const loading = document.getElementById('confirm-loading');
    const body = document.getElementById('confirm-body');
    const modal = document.getElementById('confirm-modal');

    if (loading && body) {
        loading.classList.add('hidden');
        body.classList.remove('invisible');
    }
    if (modal) {
        modal.classList.add('hidden');
    }
}

export function updateConfirmLoading(text) {
    const loadingText = document.getElementById('confirm-loading-text');
    if (loadingText) {
        loadingText.textContent = text;
    }
}

export function showConfirmDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel', { showLoadingOnConfirm = false } = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const loading = document.getElementById('confirm-loading');
        const body = document.getElementById('confirm-body');

        // Reset state
        loading.classList.add('hidden');
        body.classList.remove('invisible');

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
            if (showLoadingOnConfirm) {
                // Show loading immediately, keep modal open
                loading.classList.remove('hidden');
                body.classList.add('invisible');
                btnOk.removeEventListener('click', onConfirm);
                btnCancel.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
            } else {
                cleanup();
            }
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
