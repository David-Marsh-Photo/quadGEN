import { elements } from '../core/state.js';

const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

function isElementVisible(el) {
    return !!el && !el.classList.contains('hidden');
}

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

function containOptionsFocus(event) {
    const { optionsModal } = elements;
    if (!optionsModal || event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(optionsModal);
    if (!focusableElements.length) {
        event.preventDefault();
        return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    const movingBackwardPastStart = event.shiftKey
        && (activeElement === firstElement || !optionsModal.contains(activeElement));
    const movingForwardPastEnd = !event.shiftKey
        && (activeElement === lastElement || !optionsModal.contains(activeElement));

    if (movingBackwardPastStart || movingForwardPastEnd) {
        event.preventDefault();
        const target = movingBackwardPastStart ? lastElement : firstElement;
        target.focus({ preventScroll: true });
    }
}

function getModalPeers() {
    return [
        elements.helpPopup,
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
                return;
            }
            containOptionsFocus(event);
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
