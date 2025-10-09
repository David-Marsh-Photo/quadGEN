import { debounce } from './ui-utils.js';

let tooltipEl = null;
let currentTrigger = null;
let rafId = null;
let observer = null;

function getTriggerFromEvent(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') {
        return null;
    }
    return target.closest('.tooltip-trigger');
}

function createTooltipElement() {
    if (tooltipEl) return tooltipEl;

    const el = document.createElement('div');
    el.id = 'floatingTooltip';
    el.className = 'floating-tooltip hidden';
    el.setAttribute('role', 'tooltip');
    el.style.position = 'fixed';
    el.style.zIndex = '4000';
    document.body.appendChild(el);
    tooltipEl = el;
    return tooltipEl;
}

function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.add('hidden');
    tooltipEl.textContent = '';
    tooltipEl.style.left = '-9999px';
    tooltipEl.style.top = '-9999px';
    tooltipEl.style.maxWidth = '';
    tooltipEl.style.width = '';
    tooltipEl.setAttribute('aria-hidden', 'true');
    currentTrigger = null;
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

function clampToViewport(position, size, margin = 8) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    const clamped = { ...position };

    if (clamped.left < margin) {
        clamped.left = margin;
    }

    const maxLeft = viewportWidth - size.width - margin;
    if (clamped.left > maxLeft) {
        clamped.left = Math.max(margin, maxLeft);
    }

    if (clamped.top < margin) {
        clamped.top = margin;
    }

    const maxTop = viewportHeight - size.height - margin;
    if (clamped.top > maxTop) {
        clamped.top = Math.max(margin, maxTop);
    }

    return clamped;
}

function positionTooltip(trigger) {
    if (!tooltipEl || !trigger || !document.body.contains(trigger)) {
        hideTooltip();
        return;
    }

    const rect = trigger.getBoundingClientRect();
    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';
    tooltipEl.style.maxWidth = `${Math.min(320, Math.max(180, window.innerWidth - 32))}px`;
    tooltipEl.style.width = 'auto';

    const tooltipRect = tooltipEl.getBoundingClientRect();
    const preferred = {
        left: rect.left + (rect.width / 2) - (tooltipRect.width / 2),
        top: rect.top - tooltipRect.height - 10
    };

    let position = clampToViewport(preferred, tooltipRect);

    // If the tooltip would overlap the trigger, flip below
    if (position.top + tooltipRect.height + 6 > rect.top && rect.top - tooltipRect.height - 10 < 8) {
        position = clampToViewport({
            left: preferred.left,
            top: rect.bottom + 10
        }, tooltipRect);
    }

    tooltipEl.style.left = `${Math.round(position.left)}px`;
    tooltipEl.style.top = `${Math.round(position.top)}px`;
}

const repositionTooltip = debounce(() => {
    if (currentTrigger && tooltipEl && !tooltipEl.classList.contains('hidden')) {
        positionTooltip(currentTrigger);
    }
}, 16);

function handlePointerEnter(event) {
    const trigger = getTriggerFromEvent(event);
    if (!trigger) return;
    showTooltip(trigger);
}

function handlePointerLeave(event) {
    const trigger = getTriggerFromEvent(event);
    if (!trigger) return;
    if (currentTrigger === trigger) {
        hideTooltip();
    }
}

function handleFocus(event) {
    const trigger = getTriggerFromEvent(event);
    if (!trigger) return;
    showTooltip(trigger);
}

function handleBlur(event) {
    const trigger = getTriggerFromEvent(event);
    if (!trigger) return;
    if (currentTrigger === trigger) {
        hideTooltip();
    }
}

function showTooltip(trigger) {
    const message = trigger?.getAttribute('data-tooltip');
    if (!message) return;

    createTooltipElement();
    tooltipEl.textContent = message;
    tooltipEl.classList.remove('hidden');
    tooltipEl.setAttribute('aria-hidden', 'false');

    currentTrigger = trigger;
    positionTooltip(trigger);

    if (!observer && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => repositionTooltip());
        observer.observe(trigger);
    }
}

function handleScroll() {
    if (!currentTrigger) return;
    if (!document.body.contains(currentTrigger)) {
        hideTooltip();
        return;
    }
    if (rafId) {
        cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
        positionTooltip(currentTrigger);
    });
}

export function initializeTooltipSystem() {
    if (typeof document === 'undefined') return;

    document.addEventListener('pointerenter', handlePointerEnter, true);
    document.addEventListener('pointerleave', handlePointerLeave, true);
    document.addEventListener('focusin', handleFocus, true);
    document.addEventListener('focusout', handleBlur, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', repositionTooltip, true);
}

export function teardownTooltipSystem() {
    document.removeEventListener('pointerenter', handlePointerEnter, true);
    document.removeEventListener('pointerleave', handlePointerLeave, true);
    document.removeEventListener('focusin', handleFocus, true);
    document.removeEventListener('focusout', handleBlur, true);
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('resize', repositionTooltip, true);
    hideTooltip();
}
