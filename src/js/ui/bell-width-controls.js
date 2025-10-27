// Bell Width Scale Controls
// Manages the Edit Mode UI for widening/tightening bell-shaped channels.

import { elements, getChannelShapeMeta, getEditModeFlag } from '../core/state.js';
import {
    applyBellWidthScale,
    nudgeBellWidthSide,
    resetBellWidthScale,
    setBellWidthLink
} from '../core/bell-width-controller.js';

const DEFAULT_PERCENT = 100;
const DEFAULT_STEP = 2;
const MIN_PERCENT = 40;
const MAX_PERCENT = 250;
const INPUT_DEBOUNCE_MS = 180;

let initialized = false;
let isProgrammaticUpdate = false;
const pendingLinkState = new Map(); // channel -> { linked, timestamp }
const inputTimers = {
    left: null,
    right: null
};

function getRefs() {
    return {
        container: elements.editBellWidthContainer || document.getElementById('editBellWidthContainer'),
        leftInput: elements.bellWidthLeftInput || document.getElementById('bellWidthLeftInput'),
        rightInput: elements.bellWidthRightInput || document.getElementById('bellWidthRightInput'),
        leftDec: elements.bellWidthLeftDec || document.getElementById('bellWidthLeftDec'),
        leftInc: elements.bellWidthLeftInc || document.getElementById('bellWidthLeftInc'),
        rightDec: elements.bellWidthRightDec || document.getElementById('bellWidthRightDec'),
        rightInc: elements.bellWidthRightInc || document.getElementById('bellWidthRightInc'),
        linkToggle: elements.bellWidthLinkToggle || document.getElementById('bellWidthLinkToggle'),
        resetBtn: elements.bellWidthResetBtn || document.getElementById('bellWidthResetBtn'),
        channelSelect: elements.editChannelSelect || document.getElementById('editChannelSelect')
    };
}

function resolveSelectedChannel(refs) {
    const value = refs.channelSelect?.value?.trim();
    return value || null;
}

function getLinkedState(refs) {
    return refs.linkToggle?.getAttribute('aria-pressed') !== 'false';
}

function clampPercent(value) {
    if (!Number.isFinite(value)) return DEFAULT_PERCENT;
    return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}

function formatPercentFromFactor(value) {
    const numeric = Number.isFinite(value) ? value : 1;
    const percent = numeric * 100;
    if (Math.abs(percent - Math.round(percent)) < 0.01) {
        return String(Math.round(percent));
    }
    return percent.toFixed(1);
}

function formatPercentValue(value) {
    if (!Number.isFinite(value)) {
        return String(DEFAULT_PERCENT);
    }
    if (Math.abs(value - Math.round(value)) < 0.01) {
        return String(Math.round(value));
    }
    return value.toFixed(1);
}

function parsePercentFromInput(input) {
    if (!input) return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
}

function beginProgrammaticUpdate(fn) {
    isProgrammaticUpdate = true;
    try {
        fn();
    } finally {
        isProgrammaticUpdate = false;
    }
}

function setLinkState(refs, linked) {
    if (!refs.linkToggle) return;
    refs.linkToggle.setAttribute('aria-pressed', linked ? 'true' : 'false');
    refs.linkToggle.classList.toggle('bg-slate-600', linked);
    refs.linkToggle.classList.toggle('hover:bg-slate-500', linked);
    refs.linkToggle.classList.toggle('text-white', linked);
    refs.linkToggle.classList.toggle('border-slate-600', linked);
    refs.linkToggle.classList.toggle('bg-white', !linked);
    refs.linkToggle.classList.toggle('hover:bg-gray-50', !linked);
    refs.linkToggle.classList.toggle('text-gray-600', !linked);
    refs.linkToggle.classList.toggle('border-gray-300', !linked);
    const icon = refs.linkToggle.querySelector('span[aria-hidden="true"]');
    const label = refs.linkToggle.querySelector('span:not([aria-hidden])');
    if (icon) {
        icon.textContent = linked ? '⛓' : '⛓︎';
    }
    if (label) {
        label.textContent = linked ? 'Linked' : 'Un-linked';
    }
}

function disableControls(refs, message) {
    if (!refs.container) return;
    clearInputTimer('left');
    clearInputTimer('right');
    refs.container.classList.add('hidden');
    if (refs.leftInput) {
        refs.leftInput.value = '';
        refs.leftInput.placeholder = message || '—';
        refs.leftInput.disabled = true;
    }
    if (refs.rightInput) {
        refs.rightInput.value = '';
        refs.rightInput.placeholder = message || '—';
        refs.rightInput.disabled = true;
    }
    [
        refs.leftDec,
        refs.leftInc,
        refs.rightDec,
        refs.rightInc,
        refs.linkToggle,
        refs.resetBtn
    ].forEach((button) => {
        if (button) button.disabled = true;
    });
}

function enableControls(refs) {
    if (!refs.container) return;
    refs.container.classList.remove('hidden');
    [
        refs.leftInput,
        refs.rightInput,
        refs.leftDec,
        refs.leftInc,
        refs.rightDec,
        refs.rightInc,
        refs.linkToggle,
        refs.resetBtn
    ].forEach((el) => {
        if (el) el.disabled = false;
    });
}

function setNudgeButtonsDisabled(refs, disabled) {
    [
        refs.leftDec,
        refs.leftInc,
        refs.rightDec,
        refs.rightInc
    ].forEach((button) => {
        if (button) {
            button.disabled = disabled;
        }
    });
    if (disabled) {
        refs.container?.classList.add('opacity-90');
    } else {
        refs.container?.classList.remove('opacity-90');
    }
}

function runWidthMutation(channel, refs, mutation) {
    setNudgeButtonsDisabled(refs, true);
    try {
        mutation();
    } finally {
        requestAnimationFrame(() => {
            setNudgeButtonsDisabled(refs, false);
            updateBellWidthControls(channel);
        });
    }
}

function clampAndWriteInputs(refs, leftPercent, rightPercent) {
    beginProgrammaticUpdate(() => {
        if (refs.leftInput) {
            refs.leftInput.value = formatPercentValue(leftPercent);
            refs.leftInput.placeholder = '';
        }
        if (refs.rightInput) {
            refs.rightInput.value = formatPercentValue(rightPercent);
            refs.rightInput.placeholder = '';
        }
    });
}

function clearInputTimer(side) {
    if (inputTimers[side]) {
        clearTimeout(inputTimers[side]);
        inputTimers[side] = null;
    }
}

function scheduleInputCommit(side, refs) {
    if (isProgrammaticUpdate) return;
    clearInputTimer(side);
    inputTimers[side] = setTimeout(() => {
        inputTimers[side] = null;
        commitWidthValues(refs, side);
    }, INPUT_DEBOUNCE_MS);
}

function commitWidthValues(refs, side) {
    if (isProgrammaticUpdate) return;
    const channel = resolveSelectedChannel(refs);
    if (!channel) return;
    const rawLeft = parsePercentFromInput(refs.leftInput);
    const rawRight = parsePercentFromInput(refs.rightInput);
    const leftPercent = clampPercent(rawLeft ?? DEFAULT_PERCENT);
    const rightPercent = clampPercent(rawRight ?? DEFAULT_PERCENT);
    clampAndWriteInputs(refs, leftPercent, rightPercent);

    const linked = getLinkedState(refs);
    runWidthMutation(channel, refs, () => {
        if (linked) {
            const target = side === 'right' ? rightPercent : leftPercent;
            applyBellWidthScale(channel, { leftPercent: target, rightPercent: target, linked });
        } else {
            applyBellWidthScale(channel, { leftPercent, rightPercent, linked });
        }
    });
}

function handleNudge(side, direction, event, refs) {
    const channel = resolveSelectedChannel(refs);
    if (!channel) return;
    const step = (event?.shiftKey ? 5 : DEFAULT_STEP) * direction;
    const linked = getLinkedState(refs);
    runWidthMutation(channel, refs, () => {
        nudgeBellWidthSide(channel, linked ? 'both' : side, step, { linked });
    });
}

function handleReset(refs) {
    const channel = resolveSelectedChannel(refs);
    if (!channel) return;
    runWidthMutation(channel, refs, () => {
        resetBellWidthScale(channel);
    });
}

function recordPendingLink(channel, linked) {
    pendingLinkState.set(channel, { linked, timestamp: Date.now() });
}

function resolveLinkedState(channel, reported) {
    const pending = pendingLinkState.get(channel);
    if (!pending) {
        return reported;
    }
    if (reported === pending.linked || Date.now() - pending.timestamp > 1500) {
        pendingLinkState.delete(channel);
        return reported;
    }
    return pending.linked;
}

export function updateBellWidthControls(channelName = null) {
    const refs = getRefs();
    if (!refs.container) return;
    const channel = channelName || resolveSelectedChannel(refs);
    const editEnabled = getEditModeFlag();
    if (!editEnabled || !channel) {
        disableControls(refs, 'Enable Edit Mode to adjust width');
        return;
    }
    const meta = getChannelShapeMeta(channel);
    if (!meta || meta.classification !== 'bell') {
        disableControls(refs, 'Select a bell-classified channel');
        return;
    }

    enableControls(refs);
    const leftFactor = Number.isFinite(meta?.bellWidthScale?.leftFactor) ? meta.bellWidthScale.leftFactor : 1;
    const rightFactor = Number.isFinite(meta?.bellWidthScale?.rightFactor) ? meta.bellWidthScale.rightFactor : 1;
    const linked = typeof meta?.bellWidthScale?.linked === 'boolean' ? meta.bellWidthScale.linked : true;
    const effectiveLinked = resolveLinkedState(channel, linked);

    clampAndWriteInputs(
        refs,
        leftFactor * 100,
        rightFactor * 100
    );
    setLinkState(refs, effectiveLinked);
}

function attachHandlers() {
    if (initialized) return;
    const refs = getRefs();
    if (!refs.container) return;

    const commitLeft = () => {
        clearInputTimer('left');
        commitWidthValues(refs, 'left');
    };
    const commitRight = () => {
        clearInputTimer('right');
        commitWidthValues(refs, 'right');
    };

    refs.leftInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitLeft();
        }
    });
    refs.leftInput?.addEventListener('blur', commitLeft);
    refs.leftInput?.addEventListener('input', (event) => {
        if (isProgrammaticUpdate) return;
        if (event.target?.value === '') return;
        scheduleInputCommit('left', refs);
    });

    refs.rightInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitRight();
        }
    });
    refs.rightInput?.addEventListener('blur', commitRight);
    refs.rightInput?.addEventListener('input', (event) => {
        if (isProgrammaticUpdate) return;
        if (event.target?.value === '') return;
        scheduleInputCommit('right', refs);
    });

    refs.leftDec?.addEventListener('click', (event) => {
        event.preventDefault();
        handleNudge('left', -1, event, refs);
    });
    refs.leftInc?.addEventListener('click', (event) => {
        event.preventDefault();
        handleNudge('left', 1, event, refs);
    });
    refs.rightDec?.addEventListener('click', (event) => {
        event.preventDefault();
        handleNudge('right', -1, event, refs);
    });
    refs.rightInc?.addEventListener('click', (event) => {
        event.preventDefault();
        handleNudge('right', 1, event, refs);
    });

    refs.resetBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        handleReset(refs);
    });

    refs.linkToggle?.addEventListener('click', (event) => {
        event.preventDefault();
        const channel = resolveSelectedChannel(refs);
        if (!channel) return;
        const nextLinked = !getLinkedState(refs);
        setLinkState(refs, nextLinked);
        recordPendingLink(channel, nextLinked);
        setBellWidthLink(channel, nextLinked);
    });

    initialized = true;
}

export function initializeBellWidthControls() {
    attachHandlers();
}
