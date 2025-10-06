import { elements } from '../core/state.js';
import { APP_DISPLAY_VERSION } from '../core/version.js';
import {
  downloadSampleLabData,
  downloadSampleCubeFile,
  SAMPLE_DATA
} from '../files/file-operations.js';
import {
  getHelpReadmeHTML,
  getHelpGlossaryHTML,
  getHelpHistoryHTML,
  getHelpWorkflowHTML
} from './help-content.js';
import {
  getCurrentScale,
  getScalingStateAudit,
  resetScalingStateAudit,
  validateScalingStateSync,
  SCALING_STATE_FLAG_EVENT,
  SCALING_STATE_AUDIT_EVENT
} from '../core/scaling-utils.js';

let currentHelpTab = 'readme';
let scalingDebugListenersAttached = false;

function getHelpDebugPanel() {
  return elements.helpDebugPanel || null;
}

function getHelpDebugField(name) {
  const panel = getHelpDebugPanel();
  if (!panel) return null;
  return panel.querySelector(`[data-scaling-debug-field="${name}"]`);
}

function formatNumber(value, fractionDigits = 2) {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : '—';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
}

function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return '—';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}

function formatMismatchDetail(detail) {
  if (!detail) return '—';
  try {
    return JSON.stringify(detail, null, 2);
  } catch (error) {
    return String(detail);
  }
}

function updateHelpDebugPanel(eventLike = null) {
  const panel = getHelpDebugPanel();
  if (!panel) {
    return;
  }

  const eventDetail = eventLike && typeof eventLike === 'object' && 'detail' in eventLike ? eventLike.detail : eventLike;
  const detail = (eventDetail && typeof eventDetail === 'object') ? eventDetail : {};
  const auditFromEvent = detail && typeof detail === 'object' && detail.audit ? detail.audit : null;
  const audit = auditFromEvent || getScalingStateAudit() || null;
  const flagEnabled = typeof window !== 'undefined' ? !!window.__USE_SCALING_STATE : false;

  const statusText = detail && typeof detail.status === 'string' ? detail.status : (flagEnabled ? 'idle' : 'flag-disabled');
  const reasonText = detail && typeof detail.reason === 'string' && detail.reason.trim() ? detail.reason : (audit?.lastCheckReason || (flagEnabled ? 'parity-check' : 'flag-disabled'));
  const auditTimestamp = audit?.lastCheckTimestamp ?? (audit?.lastCheckTimestampIso ? Date.parse(audit.lastCheckTimestampIso) : Number.NaN);

  const statusField = getHelpDebugField('status');
  if (statusField) {
    statusField.textContent = `status: ${statusText}`;
  }

  const flagField = getHelpDebugField('flag');
  if (flagField) {
    flagField.textContent = flagEnabled ? 'Enabled' : 'Disabled';
  }

  const scaleField = getHelpDebugField('scalePercent');
  if (scaleField) {
    const currentScale = Number(getCurrentScale());
    scaleField.textContent = formatPercent(currentScale);
  }

  const totalChecksField = getHelpDebugField('totalChecks');
  if (totalChecksField) {
    totalChecksField.textContent = String(audit?.totalChecks ?? 0);
  }

  const mismatchCountField = getHelpDebugField('mismatchCount');
  if (mismatchCountField) {
    mismatchCountField.textContent = String(audit?.mismatchCount ?? 0);
  }

  const reasonField = getHelpDebugField('lastReason');
  if (reasonField) {
    reasonField.textContent = reasonText || '—';
  }

  const lastCheckField = getHelpDebugField('lastCheck');
  if (lastCheckField) {
    lastCheckField.textContent = formatTimestamp(auditTimestamp);
  }

  const expectedField = getHelpDebugField('expectedMaxAllowed');
  if (expectedField) {
    expectedField.textContent = formatNumber(audit?.lastExpectedMaxAllowed, 0);
  }

  const observedField = getHelpDebugField('observedMaxAllowed');
  if (observedField) {
    observedField.textContent = formatNumber(audit?.lastObservedMaxAllowed, 0);
  }

  const deltaField = getHelpDebugField('lastMismatchDelta');
  if (deltaField) {
    deltaField.textContent = formatNumber(audit?.lastMismatchDelta, 4);
  }

  const detailField = getHelpDebugField('lastMismatchDetail');
  if (detailField) {
    detailField.textContent = formatMismatchDetail(audit?.lastMismatchDetail);
  }

  const shouldShow = currentHelpTab === 'history';
  panel.classList.toggle('hidden', !shouldShow);
}

function handleHelpDebugRefresh(event) {
  event?.preventDefault?.();
  try {
    validateScalingStateSync({ throwOnMismatch: false, reason: 'help-refresh' });
  } catch (error) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Help] scaling audit refresh failed', error);
    }
  }
  updateHelpDebugPanel({ status: 'refresh', reason: 'help-refresh' });
}

function handleHelpDebugReset(event) {
  event?.preventDefault?.();
  resetScalingStateAudit('help-reset');
  updateHelpDebugPanel({ status: 'reset', reason: 'help-reset' });
}

function wireHelpDebugPanel() {
  const panel = getHelpDebugPanel();
  if (!panel || panel.dataset.wired === 'true') {
    return;
  }

  if (elements.helpDebugRefreshBtn) {
    elements.helpDebugRefreshBtn.addEventListener('click', handleHelpDebugRefresh);
  }

  if (elements.helpDebugResetBtn) {
    elements.helpDebugResetBtn.addEventListener('click', handleHelpDebugReset);
  }

  panel.dataset.wired = 'true';
}

function ensureScalingDebugListeners() {
  if (scalingDebugListenersAttached || typeof window === 'undefined') {
    return;
  }

  window.addEventListener(SCALING_STATE_FLAG_EVENT, (event) => {
    const enabled = !!(event && event.detail && event.detail.enabled);
    updateHelpDebugPanel({ status: enabled ? 'flag-enabled' : 'flag-disabled', reason: enabled ? 'flag-enabled' : 'flag-disabled' });
  });

  window.addEventListener(SCALING_STATE_AUDIT_EVENT, (event) => {
    updateHelpDebugPanel(event);
  });

  scalingDebugListenersAttached = true;
}

function lockBodyScroll() {
  try {
    document.body.style.overflow = 'hidden';
  } catch (error) {
    if (console && console.warn) console.warn('Unable to lock body scroll', error);
  }
}

function unlockBodyScrollIfNoHelpOpen() {
  try {
    const popups = [
      elements.helpPopup,
      elements.globalCorrectionHelpPopup,
      elements.editModeHelpPopup,
      elements.intentHelpPopup
    ];
    const anyOpen = popups.some((popup) => popup && !popup.classList.contains('hidden'));
    if (!anyOpen) {
      document.body.style.overflow = '';
    }
  } catch (error) {
    if (console && console.warn) console.warn('Unable to unlock body scroll', error);
  }
}

function updateTabButton(button, isActive) {
  if (!button) return;
  button.classList.toggle('text-gray-800', isActive);
  button.classList.toggle('border-slate-700', isActive);
  button.classList.toggle('text-gray-500', !isActive);
  button.classList.toggle('border-transparent', !isActive);
  button.setAttribute('aria-selected', isActive ? 'true' : 'false');
}

function wireSampleButtons() {
  const helpLoadLab = document.getElementById('helpLoadSampleLab');
  if (helpLoadLab && !helpLoadLab.dataset.wired) {
    helpLoadLab.addEventListener('click', () => {
      const actions = window?.quadGenActions;
      if (actions && typeof actions.loadLabData === 'function') {
        const result = actions.loadLabData(SAMPLE_DATA.colorMuse, true);
        if (result?.success) {
          window?.showStatus?.('Loaded sample LAB correction');
        } else {
          const message = result?.message || 'Unable to load sample LAB data';
          window?.showStatus?.(message);
        }
      } else {
        window?.showStatus?.('Sample LAB loading is not yet available in this build');
      }
    });
    helpLoadLab.dataset.wired = 'true';
  }

  const helpLoadCube = document.getElementById('helpLoadSampleCube');
  if (helpLoadCube && !helpLoadCube.dataset.wired) {
    helpLoadCube.addEventListener('click', () => {
      window?.showStatus?.('Sample LUT loading is not yet available in the modular build.');
    });
    helpLoadCube.dataset.wired = 'true';
  }

  const helpDownloadLab = document.getElementById('helpDownloadSampleLab');
  if (helpDownloadLab && !helpDownloadLab.dataset.wired) {
    helpDownloadLab.addEventListener('click', (event) => {
      event.preventDefault();
      downloadSampleLabData();
    });
    helpDownloadLab.dataset.wired = 'true';
  }

  const helpDownloadCube = document.getElementById('helpDownloadSampleCube');
  if (helpDownloadCube && !helpDownloadCube.dataset.wired) {
    helpDownloadCube.addEventListener('click', (event) => {
      event.preventDefault();
      downloadSampleCubeFile();
    });
    helpDownloadCube.dataset.wired = 'true';
  }
}

function setHelpActiveTab(tab) {
  currentHelpTab = tab;
  updateTabButton(elements.helpTabReadme, tab === 'readme');
  updateTabButton(elements.helpTabGlossary, tab === 'glossary');
  updateTabButton(elements.helpTabWorkflow, tab === 'workflow');
  updateTabButton(elements.helpTabHistory, tab === 'history');

  let html = '';
  switch (tab) {
    case 'glossary':
      html = getHelpGlossaryHTML();
      break;
    case 'history':
      html = getHelpHistoryHTML();
      break;
    case 'workflow':
      html = getHelpWorkflowHTML();
      break;
    case 'readme':
    default:
      html = getHelpReadmeHTML();
      break;
  }

  if (elements.helpContent) {
    elements.helpContent.innerHTML = html;
    wireSampleButtons();
  }

  wireHelpDebugPanel();
  updateHelpDebugPanel();
}

function openHelpPopup(defaultTab = 'readme') {
  populateHelp(defaultTab);
  if (elements.helpPopup) {
    elements.helpPopup.classList.remove('hidden');
    lockBodyScroll();
  }
}

function closeHelpPopup() {
  if (elements.helpPopup) {
    elements.helpPopup.classList.add('hidden');
    unlockBodyScrollIfNoHelpOpen();
  }
}

function populateHelp(defaultTab = 'readme') {
  if (elements.helpAppVersion) {
    elements.helpAppVersion.textContent = APP_DISPLAY_VERSION;
  }
  setHelpActiveTab(defaultTab);
}

function showEditModeHelp() {
  openHelpPopup('workflow');
  setTimeout(() => {
    document.getElementById('helpEditModeSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

function getIntentVsCorrectionHTML() {
  return `
    <div class="grid gap-4">
      <div class="border border-gray-200 rounded-lg p-4">
        <h3 class="font-semibold text-base mb-3">Making Corrections Overview</h3>
        <p class="text-sm mb-3">
          The correction process involves: 1) Load a .quad file, 2) Test print and measure results, 3) Load measurement data to create corrections, 4) Export corrected .quad and repeat until the printer tracks your target.
        </p>
        <p class="text-xs">
          For complete step-by-step guidance, see
          <button type="button" class="underline hover:text-gray-800" data-open-workflow-help>Detailed Workflow in the main Help</button>.
        </p>
      </div>

      <div class="border border-gray-200 rounded-lg p-4">
        <h3 class="font-semibold text-base mb-3">When Intent Takes Effect</h3>
        <p class="text-sm mb-3">
          <strong>Intent only affects linearization data</strong> (LAB measurements or manual L* entries - not existing .quad curves). If changing Intent does nothing, load measurement data first so quadGEN has something to remap.
        </p>
        <ul class="text-sm space-y-2">
          <li><strong>Intent works with:</strong> LAB .txt files, Manual L* entries</li>
          <li><strong>Intent does not affect:</strong> Loaded .quad files or pre-shaped curves</li>
          <li><strong>To modify existing curves:</strong> Load them as corrections with "Load Data File"</li>
        </ul>
      </div>

      <div class="border border-gray-200 rounded-lg p-4">
        <h3 class="font-semibold text-base mb-3">Understanding the Difference</h3>
        <p class="mb-4">
          Choose a target tonal intent (Linear, Filmic, etc.) to shape how linearization data is applied. Intent guides the correction but does not directly modify an imported curve. To apply an ACV/LUT as a correction, use <span class="font-semibold">Global Corrections -> Load Data File</span>.
        </p>

        <div class="space-y-4">
          <div>
            <h4 class="font-semibold mb-2">Correction = the tuning process.</h4>
            <p class="text-sm">
              Before the performance, every instrument is tuned to an even scale so pitches are objectively accurate. That neutral, linear foundation mirrors how we linearize a printer in L*.
            </p>
          </div>

          <div>
            <h4 class="font-semibold mb-2">Intent = the interpretation.</h4>
            <p class="text-sm mb-3">
              Once tuned, the orchestra can interpret the score in different styles - similar to choosing a Linear, Filmic, or custom intent after the printer is calibrated.
            </p>
            <ul class="list-disc list-inside text-sm space-y-1 ml-4">
              <li><span class="italic font-medium">Literalist</span> - plays the score exactly, no liberties.</li>
              <li><span class="italic font-medium">Rubato</span> - stretches/compresses tempo for expression.</li>
              <li><span class="italic font-medium">Marcato</span> - marked, accented phrasing.</li>
            </ul>
          </div>

          <div class="bg-gray-50 rounded p-3">
            <p class="text-sm italic">
              Changing the intent adjusts the rendered image, but it still rests on a calibration that was tuned to a linear target first.
            </p>
          </div>

          <div class="bg-gray-50 rounded p-3">
            <p class="text-sm">
              Another way to think about intent is as an image filter layered on top of a calibrated baseline: you need the neutral baseline before you can apply a stylized interpretation confidently.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireIntentHelpContent() {
  const workflowLink = elements.intentHelpContent?.querySelector('[data-open-workflow-help]');
  if (workflowLink && !workflowLink.dataset.wired) {
    workflowLink.addEventListener('click', () => {
      closeIntentHelpPopup({ skipUnlock: true });
      openHelpPopup('workflow');
    });
    workflowLink.dataset.wired = 'true';
  }
}

function openIntentHelpPopup() {
  if (!elements.intentHelpPopup) {
    return;
  }

  if (elements.intentHelpContent) {
    elements.intentHelpContent.innerHTML = getIntentVsCorrectionHTML();
    wireIntentHelpContent();
  }

  elements.intentHelpPopup.classList.remove('hidden');
  lockBodyScroll();
}

function closeIntentHelpPopup(options = {}) {
  if (!elements.intentHelpPopup) {
    return;
  }

  elements.intentHelpPopup.classList.add('hidden');
  if (!options.skipUnlock) {
    unlockBodyScrollIfNoHelpOpen();
  }
}

export function initializeHelpSystem() {
  if (!elements.helpContent) {
    return;
  }

  wireHelpDebugPanel();
  ensureScalingDebugListeners();
  updateHelpDebugPanel();

  if (elements.helpBtn && elements.helpPopup) {
    elements.helpBtn.addEventListener('click', () => openHelpPopup('readme'));
  }

  if (elements.closeHelpBtn) {
    elements.closeHelpBtn.addEventListener('click', () => closeHelpPopup());
  }

  if (elements.helpPopup) {
    elements.helpPopup.addEventListener('click', (event) => {
      if (event.target === elements.helpPopup) {
        closeHelpPopup();
      }
    });
  }

  if (elements.helpTabReadme) {
    elements.helpTabReadme.addEventListener('click', () => setHelpActiveTab('readme'));
  }

  if (elements.helpTabGlossary) {
    elements.helpTabGlossary.addEventListener('click', () => setHelpActiveTab('glossary'));
  }

  if (elements.helpTabWorkflow) {
    elements.helpTabWorkflow.addEventListener('click', () => setHelpActiveTab('workflow'));
  }

  if (elements.helpTabHistory) {
    elements.helpTabHistory.addEventListener('click', () => setHelpActiveTab('history'));
  }

  const editModeHelpLink = document.getElementById('editModeHelpLink');
  if (editModeHelpLink) {
    editModeHelpLink.addEventListener('click', () => {
      showEditModeHelp();
    });
  }

  if (elements.editModeHelpBtn) {
    elements.editModeHelpBtn.addEventListener('click', () => {
      showEditModeHelp();
    });
  }

  if (elements.globalCorrectionHelpBtn) {
    elements.globalCorrectionHelpBtn.addEventListener('click', () => {
      openHelpPopup('workflow');
    });
  }

  if (elements.intentHelpBtn && elements.intentHelpPopup && elements.intentHelpContent) {
    elements.intentHelpBtn.addEventListener('click', () => openIntentHelpPopup());
  }

  if (elements.closeIntentHelpBtn) {
    elements.closeIntentHelpBtn.addEventListener('click', () => closeIntentHelpPopup());
  }

  if (elements.intentHelpPopup) {
    elements.intentHelpPopup.addEventListener('click', (event) => {
      if (event.target === elements.intentHelpPopup) {
        closeIntentHelpPopup();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (elements.helpPopup && !elements.helpPopup.classList.contains('hidden')) {
        closeHelpPopup();
      }
      if (elements.intentHelpPopup && !elements.intentHelpPopup.classList.contains('hidden')) {
        closeIntentHelpPopup();
      }
    }
  });

  // Prime default content so keyboard activation works immediately
  populateHelp('readme');
}

export function refreshHelpTab() {
  setHelpActiveTab(currentHelpTab);
}
