// Bell Apex Shift Controls (Edit Panel)
// Manages the Edit Mode bell-apex UI and ties it to controller/state events.

import { elements, getChannelShapeMeta, getEditModeFlag } from '../core/state.js';
import { applyBellShiftTarget, nudgeBellShift, getBellShiftStep } from '../core/bell-shift-controller.js';

let initialized = false;

function getRefs() {
    return {
        container: elements.editBellShiftContainer || document.getElementById('editBellShiftContainer'),
        input: elements.editBellShiftInput || document.getElementById('editBellShiftInput'),
        dec: elements.editBellShiftDec || document.getElementById('editBellShiftDec'),
        inc: elements.editBellShiftInc || document.getElementById('editBellShiftInc')
    };
}

function resolveSelectedChannel() {
    const select = elements.editChannelSelect || document.getElementById('editChannelSelect');
    const value = select?.value?.trim();
    return value || null;
}

function disableControls(refs, message) {
    if (!refs?.input) return;
    refs.input.value = '';
    refs.input.placeholder = message || '—';
    refs.input.disabled = true;
    if (refs.dec) refs.dec.disabled = true;
    if (refs.inc) refs.inc.disabled = true;
}

function enableControls(refs) {
    if (!refs?.input) return;
    refs.input.placeholder = '';
    refs.input.disabled = false;
    if (refs.dec) refs.dec.disabled = false;
    if (refs.inc) refs.inc.disabled = false;
}

function submitInput(channelName, input) {
    if (!channelName || !input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
        updateBellShiftControl(channelName);
        return;
    }
    applyBellShiftTarget(channelName, value);
}

function attachHandlers() {
    if (initialized) return;
    const refs = getRefs();
    if (!refs.container || !refs.input) return;

    const resolveChannel = () => resolveSelectedChannel();
    const handleSubmit = () => {
        const channel = resolveChannel();
        submitInput(channel, refs.input);
    };

    refs.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleSubmit();
        }
    });
    refs.input.addEventListener('blur', handleSubmit);

    const handleNudge = (direction, event) => {
        const channel = resolveChannel();
        if (!channel) {
            return;
        }
        const multiplier = event.shiftKey ? 4 : 1;
        const step = getBellShiftStep() * direction * multiplier;
        nudgeBellShift(channel, step);
    };

    refs.dec?.addEventListener('click', (event) => {
        event.preventDefault();
        handleNudge(-1, event);
    });
    refs.inc?.addEventListener('click', (event) => {
        event.preventDefault();
        handleNudge(1, event);
    });

    initialized = true;
}

export function initializeBellShiftControls() {
    attachHandlers();
}

export function updateBellShiftControl(channelName = null) {
    if (typeof document === 'undefined') return;
    attachHandlers();
    const refs = getRefs();
    if (!refs.container) return;

    const targetChannel = channelName || resolveSelectedChannel();
    const editEnabled = getEditModeFlag();

    if (!editEnabled || !targetChannel) {
        refs.container.classList.add('hidden');
        disableControls(refs, 'Enable Edit Mode to shift bell apex');
        return;
    }

    const meta = getChannelShapeMeta(targetChannel);
    if (!meta || meta.classification !== 'bell' || !meta.bellShift) {
        refs.container.classList.add('hidden');
        disableControls(refs, 'Select a bell-classified channel');
        return;
    }

    refs.container.classList.remove('hidden');
    enableControls(refs);

    const apex = Number.isFinite(meta.bellShift.shiftedApexInputPercent)
        ? meta.bellShift.shiftedApexInputPercent
        : meta.apexInputPercent;

    if (Number.isFinite(apex) && refs.input) {
        refs.input.value = apex.toFixed(1);
    }

    if (!Number.isFinite(apex)) {
        refs.input.value = '';
        refs.input.placeholder = '—';
    }
}
