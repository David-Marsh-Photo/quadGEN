import { elements } from '../core/state.js';
import { APP_DISPLAY_VERSION } from '../core/version.js';
import { createDialogFocusController } from './dialog-focus.js';
import {
  getHelpReadmeHTML,
  getHelpGlossaryHTML,
  getHelpHistoryHTML,
  getHelpWorkflowHTML
} from './help-content.js';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

let currentHelpTab = 'readme';
let helpReturnFocusElement = null;
let intentDialogFocusController = null;

function lockBodyScroll() {
  try {
    document.body.style.overflow = 'hidden';
  } catch (error) {
    if (console && console.warn) console.warn('Unable to lock body scroll', error);
  }
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

function containHelpFocus(event) {
  const popup = elements.helpPopup;
  if (!popup || event.key !== 'Tab') return;

  const focusableElements = getFocusableElements(popup);
  if (!focusableElements.length) {
    event.preventDefault();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;
  const movingBackwardPastStart = event.shiftKey
    && (activeElement === firstElement || !popup.contains(activeElement));
  const movingForwardPastEnd = !event.shiftKey
    && (activeElement === lastElement || !popup.contains(activeElement));

  if (movingBackwardPastStart || movingForwardPastEnd) {
    event.preventDefault();
    const target = movingBackwardPastStart ? lastElement : firstElement;
    target.focus({ preventScroll: true });
  }
}

function unlockBodyScrollIfNoHelpOpen() {
  try {
    const popups = [
      elements.helpPopup,
      elements.editModeHelpPopup,
      elements.intentHelpPopup,
      elements.optionsModal
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
  }
}

function openHelpPopup(defaultTab = 'readme', returnFocusTarget = document.activeElement) {
  populateHelp(defaultTab);
  if (elements.helpPopup) {
    if (!elements.helpPopup.classList.contains('hidden')) {
      elements.closeHelpBtn?.focus({ preventScroll: true });
      return;
    }

    helpReturnFocusElement = returnFocusTarget;
    elements.helpPopup.classList.remove('hidden');
    elements.helpPopup.setAttribute('aria-hidden', 'false');
    lockBodyScroll();
    elements.closeHelpBtn?.focus({ preventScroll: true });
  }
}

function closeHelpPopup() {
  if (elements.helpPopup) {
    elements.helpPopup.classList.add('hidden');
    elements.helpPopup.setAttribute('aria-hidden', 'true');
    unlockBodyScrollIfNoHelpOpen();

    const focusTarget = helpReturnFocusElement?.isConnected
      ? helpReturnFocusElement
      : elements.helpBtn;
    helpReturnFocusElement = null;
    focusTarget?.focus({ preventScroll: true });
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
      closeIntentHelpPopup({ skipUnlock: true, returnFocus: false });
      openHelpPopup('workflow', elements.intentHelpBtn);
    });
    workflowLink.dataset.wired = 'true';
  }
}

function getIntentDialogFocusController() {
  if (!intentDialogFocusController && elements.intentHelpPopup) {
    intentDialogFocusController = createDialogFocusController({
      dialog: elements.intentHelpPopup,
      initialFocus: () => elements.closeIntentHelpBtn,
      fallbackFocus: () => elements.intentHelpBtn,
      onEscape: closeIntentHelpPopup
    });
  }
  return intentDialogFocusController;
}

function openIntentHelpPopup() {
  if (!elements.intentHelpPopup) {
    return;
  }

  if (elements.intentHelpContent) {
    elements.intentHelpContent.innerHTML = getIntentVsCorrectionHTML();
    wireIntentHelpContent();
  }

  getIntentDialogFocusController()?.open();
  lockBodyScroll();
}

function closeIntentHelpPopup(options = {}) {
  if (!elements.intentHelpPopup) {
    return;
  }

  getIntentDialogFocusController()?.close({ returnFocus: options.returnFocus !== false });
  if (!options.skipUnlock) {
    unlockBodyScrollIfNoHelpOpen();
  }
}

export function initializeHelpSystem() {
  if (!elements.helpContent) {
    return;
  }

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
    if (elements.helpPopup && !elements.helpPopup.classList.contains('hidden')) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        closeHelpPopup();
      }
      containHelpFocus(event);
      return;
    }

  });

  // Prime default content so keyboard activation works immediately
  populateHelp('readme');
}

export function refreshHelpTab() {
  setHelpActiveTab(currentHelpTab);
}
