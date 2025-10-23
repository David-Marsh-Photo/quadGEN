import { InputValidator } from './validation.js';
import { getStateManager } from './state-manager.js';
import { TOTAL } from './state.js';

const locks = new Map();
const listeners = new Map();

function notify(channelName) {
    const state = locks.get(channelName);
    const channelListeners = listeners.get(channelName);
    if (channelListeners) {
        channelListeners.forEach((fn) => {
            try {
                fn({ ...state });
            } catch (error) {
                console.warn('[channel-locks] listener failed for', channelName, error);
            }
        });
    }
}

function derivePercentFromEnd(endValue) {
    const clampedEnd = InputValidator.clampEnd(endValue);
    if (clampedEnd <= 0) {
        return 0;
    }
    return InputValidator.clampPercent(InputValidator.computePercentFromEnd(clampedEnd));
}

function resolveInitialState(channelName, defaults = {}) {
    const manager = getStateManager?.();
    const stateFromMap = locks.get(channelName);
    if (stateFromMap) {
        return stateFromMap;
    }

    const state = {
        locked: false,
        percentLimit: 100,
        endValue: TOTAL
    };

    if (manager) {
        const locked = manager.get(`printer.channelStates.${channelName}.locked`);
        const limitPercent = manager.get(`printer.channelStates.${channelName}.limitPercent`);
        const endValue = manager.get(`printer.channelStates.${channelName}.limitEndValue`);
        if (typeof locked === 'boolean') {
            state.locked = locked;
        }
        if (Number.isFinite(limitPercent)) {
            state.percentLimit = InputValidator.clampPercent(limitPercent);
        }
        if (Number.isFinite(endValue)) {
            state.endValue = InputValidator.clampEnd(endValue);
        } else if (state.percentLimit !== undefined) {
            state.endValue = InputValidator.clampEnd(Math.round((state.percentLimit / 100) * TOTAL));
        }
    }

    if (typeof defaults.locked === 'boolean') {
        state.locked = defaults.locked;
    }
    if (Number.isFinite(defaults.percentLimit)) {
        state.percentLimit = InputValidator.clampPercent(defaults.percentLimit);
    }
    if (Number.isFinite(defaults.endValue)) {
        state.endValue = InputValidator.clampEnd(defaults.endValue);
    } else if (!Number.isFinite(state.endValue) || state.endValue <= 0) {
        state.endValue = InputValidator.clampEnd(Math.round((state.percentLimit / 100) * TOTAL));
    }

    return state;
}

function syncStateManager(channelName) {
    const manager = getStateManager?.();
    if (!manager) return;
    const state = locks.get(channelName);
    if (!state) return;
    manager.set(`printer.channelStates.${channelName}.locked`, !!state.locked, { allowDuringRestore: true, skipHistory: true });
    manager.set(`printer.channelStates.${channelName}.limitPercent`, InputValidator.clampPercent(state.percentLimit), { allowDuringRestore: true, skipHistory: true });
    manager.set(`printer.channelStates.${channelName}.limitEndValue`, InputValidator.clampEnd(state.endValue), { allowDuringRestore: true, skipHistory: true });
}

export function ensureChannelLock(channelName, defaults = {}) {
    if (!channelName) return null;
    if (!locks.has(channelName)) {
        const initial = resolveInitialState(channelName, defaults);
        locks.set(channelName, initial);
        syncStateManager(channelName);
    } else if (defaults && Object.keys(defaults).length) {
        const current = locks.get(channelName);
        const next = { ...current };
        if (typeof defaults.locked === 'boolean') next.locked = defaults.locked;
        if (Number.isFinite(defaults.percentLimit)) next.percentLimit = InputValidator.clampPercent(defaults.percentLimit);
        if (Number.isFinite(defaults.endValue)) {
            next.endValue = InputValidator.clampEnd(defaults.endValue);
        }
        locks.set(channelName, next);
        syncStateManager(channelName);
        notify(channelName);
    }
    return { ...locks.get(channelName) };
}

export function setChannelLock(channelName, locked, options = {}) {
    if (!channelName) return;
    const current = ensureChannelLock(channelName);
    const next = { ...current, locked: !!locked };
    if (locked) {
        const percent = Number.isFinite(options.percentLimit) ? InputValidator.clampPercent(options.percentLimit) : derivePercentFromEnd(options.endValue ?? current.endValue);
        const endValue = Number.isFinite(options.endValue) ? InputValidator.clampEnd(options.endValue) : InputValidator.clampEnd(Math.round((percent / 100) * TOTAL));
        next.percentLimit = percent;
        next.endValue = endValue;
    } else if (Number.isFinite(options.percentLimit) || Number.isFinite(options.endValue)) {
        const percent = Number.isFinite(options.percentLimit) ? InputValidator.clampPercent(options.percentLimit) : derivePercentFromEnd(options.endValue ?? current.endValue);
        const endValue = Number.isFinite(options.endValue) ? InputValidator.clampEnd(options.endValue) : InputValidator.clampEnd(Math.round((percent / 100) * TOTAL));
        next.percentLimit = percent;
        next.endValue = endValue;
    }
    locks.set(channelName, next);
    syncStateManager(channelName);
    notify(channelName);
}

export function isChannelLocked(channelName) {
    const state = ensureChannelLock(channelName);
    return !!state?.locked;
}

export function updateChannelLockBounds(channelName, { percent, endValue } = {}) {
    if (!channelName) return;
    const current = ensureChannelLock(channelName);
    const next = { ...current };
    if (Number.isFinite(percent)) {
        next.percentLimit = InputValidator.clampPercent(percent);
    }
    if (Number.isFinite(endValue)) {
        next.endValue = InputValidator.clampEnd(endValue);
    } else if (Number.isFinite(percent)) {
        next.endValue = InputValidator.clampEnd(Math.round((next.percentLimit / 100) * TOTAL));
    }
    locks.set(channelName, next);
    syncStateManager(channelName);
    notify(channelName);
}

export function getChannelLockInfo(channelName) {
    const state = ensureChannelLock(channelName) || { locked: false, percentLimit: 100, endValue: TOTAL };
    return {
        locked: !!state.locked,
        percentLimit: InputValidator.clampPercent(state.percentLimit ?? 100),
        endValue: InputValidator.clampEnd(state.endValue ?? TOTAL)
    };
}

export function clampAbsoluteToChannelLock(channelName, absolutePercent) {
    const info = getChannelLockInfo(channelName);
    let value = InputValidator.clampPercent(Number(absolutePercent) || 0);
    if (!info.locked) {
        return { value, clamped: false, limit: info.percentLimit };
    }
    const limit = InputValidator.clampPercent(info.percentLimit ?? 100);
    if (value > limit) {
        value = limit;
        return { value, clamped: true, limit };
    }
    return { value, clamped: false, limit };
}

export function subscribeToChannelLock(channelName, callback) {
    if (!channelName || typeof callback !== 'function') {
        return () => {};
    }
    if (!listeners.has(channelName)) {
        listeners.set(channelName, new Set());
    }
    const set = listeners.get(channelName);
    set.add(callback);
    return () => {
        const bucket = listeners.get(channelName);
        if (bucket) {
            bucket.delete(callback);
        }
    };
}

export function initializeChannelLocks(defaults = {}) {
    locks.clear();
    listeners.clear();
    if (defaults && typeof defaults === 'object') {
        Object.entries(defaults).forEach(([channelName, data]) => {
            ensureChannelLock(channelName, data || {});
        });
    }
}

export function getChannelLockEditMessage(channelName, actionDescription = 'editing points') {
    const label = channelName || 'Channel';
    return `${label} is locked. Unlock before ${actionDescription}.`;
}

export function getLockedChannels(channelNames = []) {
    if (Array.isArray(channelNames) && channelNames.length) {
        return channelNames.filter((name) => ensureChannelLock(name)?.locked);
    }
    const locked = [];
    locks.forEach((state, name) => {
        if (state?.locked) {
            locked.push(name);
        }
    });
    return locked;
}

export function areAnyChannelsLocked(channelNames = []) {
    return getLockedChannels(channelNames).length > 0;
}

export function getGlobalScaleLockMessage(lockedChannels = []) {
    if (!Array.isArray(lockedChannels) || lockedChannels.length === 0) {
        return '';
    }
    if (lockedChannels.length === 1) {
        return `${lockedChannels[0]} is locked. Unlock to adjust global scale.`;
    }
    if (lockedChannels.length === 2) {
        return `${lockedChannels[0]} and ${lockedChannels[1]} are locked. Unlock them to adjust global scale.`;
    }
    return `${lockedChannels.length} channels are locked. Unlock them to adjust global scale.`;
}

// Expose channel lock functions on window for AI integration
if (typeof window !== 'undefined') {
    if (typeof window.setChannelLock !== 'function') {
        window.setChannelLock = (channelName, locked, options) => setChannelLock(channelName, locked, options);
    }

    if (typeof window.isChannelLocked !== 'function') {
        window.isChannelLocked = (channelName) => isChannelLocked(channelName);
    }

    if (typeof window.getChannelLockInfo !== 'function') {
        window.getChannelLockInfo = (channelName) => getChannelLockInfo(channelName);
    }

    if (typeof window.getLockedChannels !== 'function') {
        window.getLockedChannels = (channelNames) => getLockedChannels(channelNames);
    }
}
