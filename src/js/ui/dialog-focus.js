const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function resolveElement(value) {
  return typeof value === 'function' ? value() : value;
}

function getFocusableElements(dialog) {
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

export function createDialogFocusController({
  dialog,
  initialFocus,
  fallbackFocus,
  onEscape
}) {
  let returnFocusElement = null;

  function focusInitialControl() {
    const target = resolveElement(initialFocus);
    target?.focus?.({ preventScroll: true });
  }

  function containFocus(event) {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(dialog);
    if (!focusableElements.length) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    const movingBackwardPastStart = event.shiftKey
      && (activeElement === firstElement || !dialog.contains(activeElement));
    const movingForwardPastEnd = !event.shiftKey
      && (activeElement === lastElement || !dialog.contains(activeElement));

    if (movingBackwardPastStart || movingForwardPastEnd) {
      event.preventDefault();
      const target = movingBackwardPastStart ? lastElement : firstElement;
      target.focus({ preventScroll: true });
    }
  }

  function handleKeydown(event) {
    if (dialog.classList.contains('hidden')) return;

    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      onEscape?.();
      return;
    }

    containFocus(event);
  }

  function open({ returnFocusTarget = document.activeElement } = {}) {
    if (!dialog.classList.contains('hidden')) {
      focusInitialControl();
      return;
    }

    returnFocusElement = returnFocusTarget;
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', handleKeydown);
    focusInitialControl();
  }

  function close({ returnFocus = true } = {}) {
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', handleKeydown);

    const connectedReturnTarget = returnFocusElement?.isConnected
      ? returnFocusElement
      : null;
    const focusTarget = connectedReturnTarget || resolveElement(fallbackFocus);
    returnFocusElement = null;

    if (returnFocus) {
      focusTarget?.focus?.({ preventScroll: true });
    }
  }

  return { open, close };
}
