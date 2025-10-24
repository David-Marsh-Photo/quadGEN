// quadGEN Tab Manager
// Handles tabbed interface switching and state persistence
// Supports two independent tab groups: horizontal (bottom) and vertical (right panel)

const STORAGE_KEY_HORIZONTAL = 'quadgen.activeTabHorizontal';
const STORAGE_KEY_VERTICAL = 'quadgen.activeTabVertical';
const DEFAULT_HORIZONTAL_TAB = 'channels';
const DEFAULT_VERTICAL_TAB = 'edit';

let activeHorizontalTab = DEFAULT_HORIZONTAL_TAB;
let activeVerticalTab = null; // Vertical tabs can be null (none active)
let horizontalTabButtons = [];
let verticalTabButtons = [];
let tabContents = [];

/**
 * Initialize the tab system
 */
export function initializeTabs() {
    // Separate horizontal and vertical tab buttons
    horizontalTabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    verticalTabButtons = Array.from(document.querySelectorAll('.tab-btn-vertical'));
    tabContents = Array.from(document.querySelectorAll('.tab-content'));

    if ((horizontalTabButtons.length === 0 && verticalTabButtons.length === 0) || tabContents.length === 0) {
        console.warn('[TabManager] No tabs found in DOM');
        return;
    }

    // Initialize horizontal tabs (bottom panel)
    initializeHorizontalTabs();

    // Initialize vertical tabs (right panel)
    initializeVerticalTabs();

    console.log(`[TabManager] Initialized ${horizontalTabButtons.length} horizontal tabs and ${verticalTabButtons.length} vertical tabs`);
}

/**
 * Initialize horizontal tab group (bottom panel)
 */
function initializeHorizontalTabs() {
    if (horizontalTabButtons.length === 0) return;

    // Determine initial active horizontal tab
    const savedTab = getSavedHorizontalTab();
    const htmlActiveBtn = horizontalTabButtons.find(btn => btn.classList.contains('active'));

    if (savedTab && horizontalTabButtons.some(btn => btn.dataset.tab === savedTab)) {
        activeHorizontalTab = savedTab;
    } else if (htmlActiveBtn && htmlActiveBtn.dataset.tab) {
        activeHorizontalTab = htmlActiveBtn.dataset.tab;
    } else {
        activeHorizontalTab = DEFAULT_HORIZONTAL_TAB;
    }

    // Attach click listeners
    horizontalTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            if (tabName) {
                switchHorizontalTab(tabName);
            }
        });
    });

    // Keyboard navigation (left/right arrows)
    horizontalTabButtons.forEach((btn, index) => {
        btn.addEventListener('keydown', (e) => {
            let targetIndex = -1;

            if (e.key === 'ArrowRight') {
                targetIndex = (index + 1) % horizontalTabButtons.length;
                e.preventDefault();
            } else if (e.key === 'ArrowLeft') {
                targetIndex = (index - 1 + horizontalTabButtons.length) % horizontalTabButtons.length;
                e.preventDefault();
            }

            if (targetIndex >= 0) {
                horizontalTabButtons[targetIndex].focus();
                const targetTab = horizontalTabButtons[targetIndex].dataset.tab;
                if (targetTab) {
                    switchHorizontalTab(targetTab);
                }
            }
        });
    });

    // Apply initial state
    switchHorizontalTab(activeHorizontalTab, false);
}

/**
 * Initialize vertical tab group (right panel)
 */
function initializeVerticalTabs() {
    if (verticalTabButtons.length === 0) return;

    // Determine initial active vertical tab (can be null)
    const savedTab = getSavedVerticalTab();
    const htmlActiveBtn = verticalTabButtons.find(btn => btn.classList.contains('active'));

    if (savedTab && verticalTabButtons.some(btn => btn.dataset.tab === savedTab)) {
        activeVerticalTab = savedTab;
    } else if (htmlActiveBtn && htmlActiveBtn.dataset.tab) {
        activeVerticalTab = htmlActiveBtn.dataset.tab;
    } else {
        // No vertical tab active by default
        activeVerticalTab = null;
    }

    // Attach click listeners
    verticalTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            if (tabName) {
                switchVerticalTab(tabName);
            }
        });
    });

    // Keyboard navigation (up/down arrows)
    verticalTabButtons.forEach((btn, index) => {
        btn.addEventListener('keydown', (e) => {
            let targetIndex = -1;

            if (e.key === 'ArrowDown') {
                targetIndex = (index + 1) % verticalTabButtons.length;
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                targetIndex = (index - 1 + verticalTabButtons.length) % verticalTabButtons.length;
                e.preventDefault();
            }

            if (targetIndex >= 0) {
                verticalTabButtons[targetIndex].focus();
                const targetTab = verticalTabButtons[targetIndex].dataset.tab;
                if (targetTab) {
                    switchVerticalTab(targetTab);
                }
            }
        });
    });

    // Apply initial state if a tab should be active
    if (activeVerticalTab) {
        switchVerticalTab(activeVerticalTab, false);
    }
}

/**
 * Switch to a specific horizontal tab (bottom panel)
 * @param {string} tabName - Name of the tab to switch to
 * @param {boolean} saveState - Whether to save state to localStorage (default: true)
 */
function switchHorizontalTab(tabName, saveState = true) {
    if (!tabName) return;

    const targetButton = horizontalTabButtons.find(btn => btn.dataset.tab === tabName);
    const targetContent = tabContents.find(content => content.dataset.tabContent === tabName);

    if (!targetButton || !targetContent) {
        console.warn(`[TabManager] Horizontal tab not found: ${tabName}`);
        return;
    }

    // Deactivate all horizontal tabs (only within this group)
    horizontalTabButtons.forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });

    // Deactivate all horizontal tab contents (only those belonging to horizontal tabs)
    const horizontalTabNames = horizontalTabButtons.map(btn => btn.dataset.tab);
    tabContents.forEach(content => {
        if (horizontalTabNames.includes(content.dataset.tabContent)) {
            content.classList.remove('active');
            content.setAttribute('hidden', '');
        }
    });

    // Activate the target tab
    targetButton.classList.add('active');
    targetButton.setAttribute('aria-selected', 'true');
    targetContent.classList.add('active');
    targetContent.removeAttribute('hidden');

    // Update active tab state
    activeHorizontalTab = tabName;

    // Save to localStorage
    if (saveState) {
        persistHorizontalTabState(tabName);
    }

    console.log(`[TabManager] Switched to horizontal tab: ${tabName}`);
}

/**
 * Switch to a specific vertical tab (right panel)
 * @param {string} tabName - Name of the tab to switch to
 * @param {boolean} saveState - Whether to save state to localStorage (default: true)
 */
function switchVerticalTab(tabName, saveState = true) {
    if (!tabName) return;

    const targetButton = verticalTabButtons.find(btn => btn.dataset.tab === tabName);
    const targetContent = tabContents.find(content => content.dataset.tabContent === tabName);

    if (!targetButton || !targetContent) {
        console.warn(`[TabManager] Vertical tab not found: ${tabName}`);
        return;
    }

    // Deactivate all vertical tabs (only within this group)
    verticalTabButtons.forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });

    // Deactivate all vertical tab contents (only those belonging to vertical tabs)
    const verticalTabNames = verticalTabButtons.map(btn => btn.dataset.tab);
    tabContents.forEach(content => {
        if (verticalTabNames.includes(content.dataset.tabContent)) {
            content.classList.remove('active');
            content.setAttribute('hidden', '');
        }
    });

    // Activate the target tab
    targetButton.classList.add('active');
    targetButton.setAttribute('aria-selected', 'true');
    targetContent.classList.add('active');
    targetContent.removeAttribute('hidden');

    // Update active tab state
    activeVerticalTab = tabName;

    // Save to localStorage
    if (saveState) {
        persistVerticalTabState(tabName);
    }

    console.log(`[TabManager] Switched to vertical tab: ${tabName}`);
}

/**
 * Switch to a specific tab (auto-detect which group)
 * @param {string} tabName - Name of the tab to switch to
 * @param {boolean} saveState - Whether to save state to localStorage (default: true)
 */
export function switchTab(tabName, saveState = true) {
    // Check if it's a horizontal tab
    const isHorizontal = horizontalTabButtons.some(btn => btn.dataset.tab === tabName);
    if (isHorizontal) {
        switchHorizontalTab(tabName, saveState);
        return;
    }

    // Check if it's a vertical tab
    const isVertical = verticalTabButtons.some(btn => btn.dataset.tab === tabName);
    if (isVertical) {
        switchVerticalTab(tabName, saveState);
        return;
    }

    console.warn(`[TabManager] Tab not found in any group: ${tabName}`);
}

/**
 * Get the currently active horizontal tab name
 * @returns {string} Active horizontal tab name
 */
export function getActiveTab() {
    return activeHorizontalTab;
}

/**
 * Get the currently active vertical tab name
 * @returns {string|null} Active vertical tab name or null
 */
export function getActiveVerticalTab() {
    return activeVerticalTab;
}

/**
 * Get saved horizontal tab from localStorage
 * @returns {string|null} Saved tab name or null
 */
function getSavedHorizontalTab() {
    try {
        return localStorage.getItem(STORAGE_KEY_HORIZONTAL);
    } catch (error) {
        console.warn('[TabManager] Failed to read horizontal tab from localStorage:', error);
        return null;
    }
}

/**
 * Get saved vertical tab from localStorage
 * @returns {string|null} Saved tab name or null
 */
function getSavedVerticalTab() {
    try {
        return localStorage.getItem(STORAGE_KEY_VERTICAL);
    } catch (error) {
        console.warn('[TabManager] Failed to read vertical tab from localStorage:', error);
        return null;
    }
}

/**
 * Save horizontal tab state to localStorage
 * @param {string} tabName - Tab name to save
 */
function persistHorizontalTabState(tabName) {
    try {
        localStorage.setItem(STORAGE_KEY_HORIZONTAL, tabName);
    } catch (error) {
        console.warn('[TabManager] Failed to save horizontal tab to localStorage:', error);
    }
}

/**
 * Save vertical tab state to localStorage
 * @param {string} tabName - Tab name to save
 */
function persistVerticalTabState(tabName) {
    try {
        localStorage.setItem(STORAGE_KEY_VERTICAL, tabName);
    } catch (error) {
        console.warn('[TabManager] Failed to save vertical tab to localStorage:', error);
    }
}

/**
 * Expose tab manager functions to window for debugging
 */
if (typeof window !== 'undefined') {
    window.TabManager = {
        switchTab,
        getActiveTab,
        getActiveVerticalTab,
        switchHorizontalTab: (tab) => switchHorizontalTab(tab, true),
        switchVerticalTab: (tab) => switchVerticalTab(tab, true)
    };
}
