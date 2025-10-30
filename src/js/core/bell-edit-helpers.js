// Shared helpers for Bell Curve edit controls (apex shift + width scaling)

import { elements } from './state.js';

export function getBellEditSimplifyOptions() {
    const options = {};
    const errorInput = elements.editMaxError || document.getElementById?.('editMaxError');
    if (errorInput) {
        const value = Number(errorInput.value);
        if (Number.isFinite(value) && value > 0) {
            options.maxErrorPercent = value;
        }
    }
    const pointsInput = elements.editMaxPoints || document.getElementById?.('editMaxPoints');
    if (pointsInput) {
        const count = Number(pointsInput.value);
        if (Number.isInteger(count) && count >= 2) {
            options.maxPoints = count;
        }
    }
    return options;
}
