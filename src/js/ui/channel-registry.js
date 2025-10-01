/**
 * Channel row registry keeps a live map of <tr> elements keyed by channel name.
 * The registry helps UI layers share lookups without re-querying the DOM.
 */

const channelRowMap = new Map();

function isUsableRow(row) {
  return row && typeof row === 'object' && 'isConnected' in row ? row.isConnected : !!row;
}

export function registerChannelRow(channelName, element) {
  if (!channelName || !element) return;
  channelRowMap.set(channelName, element);
}

export function unregisterChannelRow(channelName) {
  if (!channelName) return;
  channelRowMap.delete(channelName);
}

export function resetChannelRegistry(rootElement) {
  channelRowMap.clear();
  if (!rootElement) return;
  const rows = rootElement.querySelectorAll('tr.channel-row[data-channel]');
  rows.forEach((row) => {
    const key = row.getAttribute('data-channel');
    if (key) channelRowMap.set(key, row);
  });
}

export function getChannelRow(channelName) {
  if (!channelName) return null;
  const existing = channelRowMap.get(channelName);
  if (isUsableRow(existing)) {
    return existing;
  }
  channelRowMap.delete(channelName);
  if (typeof document === 'undefined') return null;
  const fallback = document.querySelector(`tr.channel-row[data-channel="${channelName}"]`);
  if (fallback) channelRowMap.set(channelName, fallback);
  return fallback;
}

export function getChannelRows() {
  const rows = [];
  channelRowMap.forEach((row, channelName) => {
    if (isUsableRow(row)) {
      rows.push(row);
    } else {
      channelRowMap.delete(channelName);
    }
  });
  return rows;
}

export function getChannelRowMap() {
  const normalized = new Map();
  channelRowMap.forEach((row, channelName) => {
    if (isUsableRow(row)) {
      normalized.set(channelName, row);
    } else {
      channelRowMap.delete(channelName);
    }
  });
  return normalized;
}
