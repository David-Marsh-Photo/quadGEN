// Legacy Linearization Bridge
// Provides safe accessors for legacy global linearization state.

const FALLBACK_SCOPE = {};

function resolveGlobalScope() {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return FALLBACK_SCOPE;
}

class LegacyLinearizationBridge {
  constructor() {
    this.scope = resolveGlobalScope();
  }

  getScope() {
    const resolved = resolveGlobalScope();
    if (resolved !== this.scope) {
      this.scope = resolved;
    }
    return this.scope;
  }

  getGlobalData() {
    const scope = this.getScope();
    return scope.linearizationData || null;
  }

  setGlobalData(data) {
    const scope = this.getScope();
    scope.linearizationData = data || null;
  }

  getGlobalApplied() {
    const scope = this.getScope();
    return scope.linearizationApplied === true;
  }

  setGlobalApplied(applied) {
    const scope = this.getScope();
    scope.linearizationApplied = applied === true;
  }

  setGlobalState(data, applied) {
    this.setGlobalData(data);
    if (typeof applied !== 'undefined') {
      this.setGlobalApplied(applied);
    }
  }

  getPerChannelData(channelName) {
    if (!channelName) return null;
    const scope = this.getScope();
    return scope.perChannelLinearization?.[channelName] || null;
  }

  setPerChannelData(channelName, data) {
    if (!channelName) return;
    const scope = this.getScope();
    const existing = scope.perChannelLinearization || {};
    if (!data) {
      if (existing[channelName]) {
        const clone = { ...existing };
        delete clone[channelName];
        scope.perChannelLinearization = clone;
      }
      return;
    }
    scope.perChannelLinearization = {
      ...existing,
      [channelName]: data
    };
  }

  isPerChannelEnabled(channelName) {
    if (!channelName) return false;
    const scope = this.getScope();
    return scope.perChannelEnabled?.[channelName] === true;
  }

  setPerChannelEnabled(channelName, enabled) {
    if (!channelName) return;
    const scope = this.getScope();
    const existing = scope.perChannelEnabled || {};
    if (!enabled && existing[channelName]) {
      const clone = { ...existing };
      delete clone[channelName];
      scope.perChannelEnabled = clone;
      return;
    }
    scope.perChannelEnabled = {
      ...existing,
      [channelName]: enabled === true
    };
  }

  setPerChannelBatch({ data = {}, enabled = {} } = {}) {
    const scope = this.getScope();
    scope.perChannelLinearization = { ...data };
    scope.perChannelEnabled = { ...enabled };
  }
}

let singletonBridge = null;

export function getLegacyLinearizationBridge() {
  if (!singletonBridge) {
    singletonBridge = new LegacyLinearizationBridge();
  }
  return singletonBridge;
}
