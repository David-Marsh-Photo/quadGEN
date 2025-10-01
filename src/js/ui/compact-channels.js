/**
 * Compact Channels Display
 * Manages hiding disabled channels and showing them in compact chip view
 * Also handles "No channels enabled" empty state message
 */

import { elements, INK_COLORS } from '../core/state.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers } from '../legacy/legacy-helpers.js';

/**
 * Check if all channels are disabled and show/hide the "No channels enabled" message
 */
export function updateNoChannelsMessage() {
    if (!elements.rows) return;

    const rows = Array.from(elements.rows.children);
    const noChannelsRow = document.getElementById('noChannelsRow');

    if (!noChannelsRow) return;

    // Get actual channel rows (excluding the noChannelsRow itself)
    const channelRows = rows.filter(tr => tr.id !== 'noChannelsRow');

    // Check if all channel rows have end value of 0
    const allDisabled = channelRows.length > 0 && channelRows.every(tr => {
        const endInput = tr.querySelector('.end-input');
        return parseInt(endInput.value) === 0;
    });

    if (allDisabled) {
        noChannelsRow.classList.remove('hidden');
    } else {
        noChannelsRow.classList.add('hidden');
    }
}

/**
 * Update compact channels list display
 * Handles showing/hiding disabled channels and creates compact chip view
 */

export function updateCompactChannelsList() {
    const compactContainer = document.getElementById('disabledChannelsCompact');
    const compactRow = document.getElementById('disabledChannelsRow');

    if (!compactContainer || !compactRow || !elements.rows) return;

    compactRow.innerHTML = '';

    const channelRows = elements.rows
        ? Array.from(elements.rows.children).filter(tr => tr.getAttribute('data-channel'))
        : [];

    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.log('[chips] building', channelRows.length);
    }

    if (channelRows.length === 0) {
        compactContainer.classList.remove('show');
        return;
    }

    compactContainer.classList.add('show');

    channelRows.forEach((tr) => {
        const channelName = tr.getAttribute('data-channel');
        const percentInput = tr.querySelector('.percent-input');
        const enableCheckbox = tr._virtualCheckbox || { checked: !tr.hasAttribute('data-user-disabled') };
        if (!channelName || !percentInput) return;

        const channelColor = INK_COLORS[channelName] || '#000000';
        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[chips] chip', channelName, {
                checked: enableCheckbox.checked,
                compact: tr.getAttribute('data-compact')
            });
        }

        const chip = document.createElement('div');
        chip.className = 'disabled-channel-chip';
        chip.dataset.channel = channelName;
        if (enableCheckbox.checked) chip.classList.add('active');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'channel-checkbox';
        checkbox.checked = !!enableCheckbox.checked;

        const colorSwatch = document.createElement('span');
        colorSwatch.className = 'channel-color';
        colorSwatch.style.backgroundColor = channelColor;

        const nameLabel = document.createElement('span');
        nameLabel.className = 'channel-name';
        nameLabel.textContent = channelName;

        chip.appendChild(checkbox);
        chip.appendChild(colorSwatch);
        chip.appendChild(nameLabel);

        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();

            if (tr._virtualCheckbox) {
                tr._virtualCheckbox.checked = checkbox.checked;
                tr._virtualCheckbox.dispatchEvent(new Event('change'));
            }

            chip.classList.toggle('active', checkbox.checked);
        });

        chip.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        compactRow.appendChild(chip);
    });
}

/**
 * Update channel compact state based on whether it's at zero
 * @param {HTMLElement} tr - Channel row element
 * @param {boolean} isAtZero - Whether channel is at zero (disabled)
 */
export function updateChannelCompactState(tr, isAtZero) {
    if (!tr) return;

    if (isAtZero) {
        // Hide from main table and show in compact view
        tr.setAttribute('data-compact', 'true');
        updateCompactChannelsList();
    } else {
        // Show in main table and remove from compact view
        tr.setAttribute('data-compact', 'false');
        updateCompactChannelsList();
    }
}

registerLegacyHelpers({
    updateCompactChannelsList,
    updateChannelCompactState,
    updateNoChannelsMessage
});

registerDebugNamespace('compactChannels', {
    updateCompactChannelsList,
    updateChannelCompactState,
    updateNoChannelsMessage
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['updateCompactChannelsList', 'updateChannelCompactState']
});
