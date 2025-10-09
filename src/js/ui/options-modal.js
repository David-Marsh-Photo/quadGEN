import { elements } from '../core/state.js';

function isElementVisible(el) {
    return !!el && !el.classList.contains('hidden');
}

function getModalPeers() {
    return [
        elements.helpPopup,
        elements.globalCorrectionHelpPopup,
        elements.editModeHelpPopup,
        elements.intentHelpPopup,
        elements.lstarModal,
        elements.optionsModal
    ];
}

function lockBodyScroll() {
    try {
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.warn('Unable to lock body scroll for options modal', error);
    }
}

function unlockBodyScrollIfNoModalOpen() {
    try {
        const anyOpen = getModalPeers().some(isElementVisible);
        if (!anyOpen) {
            document.body.style.overflow = '';
        }
    } catch (error) {
        console.warn('Unable to unlock body scroll after closing options modal', error);
    }
}

let optionsKeydownHandler = null;
let lastFocusedTrigger = null;

function closeOptionsModal({ returnFocus = true } = {}) {
    const { optionsModal, closeOptionsBtn, optionsBtn } = elements;
    if (!optionsModal) return;

    optionsModal.classList.add('hidden');
    optionsModal.setAttribute('aria-hidden', 'true');

    if (optionsKeydownHandler) {
        document.removeEventListener('keydown', optionsKeydownHandler);
        optionsKeydownHandler = null;
    }

    unlockBodyScrollIfNoModalOpen();

    const focusTarget = returnFocus ? (lastFocusedTrigger || optionsBtn || closeOptionsBtn) : null;
    if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
    }
    lastFocusedTrigger = null;
}

function openOptionsModal() {
    const { optionsModal, closeOptionsBtn } = elements;
    if (!optionsModal) return;

    if (isElementVisible(optionsModal)) {
        if (closeOptionsBtn && typeof closeOptionsBtn.focus === 'function') {
            closeOptionsBtn.focus({ preventScroll: true });
        }
        return;
    }

    lastFocusedTrigger = document.activeElement;
    optionsModal.classList.remove('hidden');
    optionsModal.setAttribute('aria-hidden', 'false');
    lockBodyScroll();

    if (!optionsKeydownHandler) {
        optionsKeydownHandler = (event) => {
            if (event.key === 'Escape' || event.key === 'Esc') {
                event.preventDefault();
                closeOptionsModal();
            }
        };
        document.addEventListener('keydown', optionsKeydownHandler);
    }

    if (closeOptionsBtn && typeof closeOptionsBtn.focus === 'function') {
        closeOptionsBtn.focus({ preventScroll: true });
    }
}

function handleOverlayClick(event) {
    if (event.target === elements.optionsModal) {
        closeOptionsModal();
    }
}

export function initializeOptionsModal() {
    const { optionsBtn, optionsModal, closeOptionsBtn } = elements;
    if (!optionsModal || optionsModal.dataset.initialized === 'true') {
        return;
    }

    if (optionsBtn) {
        optionsBtn.addEventListener('click', (event) => {
            event.preventDefault();
            openOptionsModal();
        });
    }

    if (closeOptionsBtn) {
        closeOptionsBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeOptionsModal();
        });
    }

    optionsModal.addEventListener('click', handleOverlayClick);
    optionsModal.dataset.initialized = 'true';

    return {
        open: openOptionsModal,
        close: closeOptionsModal
    };
}

export function openOptions() {
    openOptionsModal();
}

export function closeOptions() {
    closeOptionsModal();
}
