// UI Hooks Registry
// Provides registration and trigger helpers to decouple modules from window globals

const noop = () => {};

// RAF batching state for chart updates
let inkChartRAFId = null;
let inkChartPendingUpdate = false;

// RAF batching state for processing detail updates
let processingDetailRAFId = null;
let processingDetailPendingChannels = new Set();

// RAF batching state for preview updates
let previewRAFId = null;
let previewPendingUpdate = false;

let inkChartHandler = noop;
let processingDetailHandler = noop;
let processingDetailAllHandler = noop;
let revertButtonsHandler = noop;
let sessionStatusHandler = noop;
let previewHandler = noop;

export function registerInkChartHandler(fn) {
  inkChartHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerInkChartUpdate() {
  // RAF batching: multiple calls in same frame = 1 render
  if (inkChartPendingUpdate) return;
  inkChartPendingUpdate = true;
  if (!inkChartRAFId) {
    inkChartRAFId = requestAnimationFrame(() => {
      inkChartRAFId = null;
      inkChartPendingUpdate = false;
      inkChartHandler();
    });
  }
}

export function registerProcessingDetailHandler(fn) {
  processingDetailHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerProcessingDetail(channelName) {
  // RAF batching: multiple calls in same frame = 1 render per channel
  if (channelName) {
    processingDetailPendingChannels.add(channelName);
  }
  if (!processingDetailRAFId) {
    processingDetailRAFId = requestAnimationFrame(() => {
      processingDetailRAFId = null;
      const channels = Array.from(processingDetailPendingChannels);
      processingDetailPendingChannels.clear();
      channels.forEach(ch => processingDetailHandler(ch));
    });
  }
}

export function registerProcessingDetailAllHandler(fn) {
  processingDetailAllHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerProcessingDetailAll() {
  return processingDetailAllHandler();
}

export function registerRevertButtonsHandler(fn) {
  revertButtonsHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerRevertButtonsUpdate() {
  return revertButtonsHandler();
}

export function registerSessionStatusHandler(fn) {
  sessionStatusHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerSessionStatusUpdate() {
  return sessionStatusHandler();
}

export function registerPreviewHandler(fn) {
  previewHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerPreviewUpdate() {
  // RAF batching: multiple calls in same frame = 1 render
  if (previewPendingUpdate) return;
  previewPendingUpdate = true;
  if (!previewRAFId) {
    previewRAFId = requestAnimationFrame(() => {
      previewRAFId = null;
      previewPendingUpdate = false;
      previewHandler();
    });
  }
}
