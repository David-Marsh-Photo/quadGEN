// UI Hooks Registry
// Provides registration and trigger helpers to decouple modules from window globals

const noop = () => {};

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
  return inkChartHandler();
}

export function registerProcessingDetailHandler(fn) {
  processingDetailHandler = typeof fn === 'function' ? fn : noop;
}

export function triggerProcessingDetail(channelName) {
  return processingDetailHandler(channelName);
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
  return previewHandler();
}
