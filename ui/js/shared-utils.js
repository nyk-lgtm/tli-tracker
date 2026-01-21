/**
 * TLI Shared Utilities
 * Non-module script providing formatting functions for both main UI and overlay.
 * Must be loaded before ES6 modules (main UI) and inline scripts (overlay).
 */
window.TLI = window.TLI || {};

/**
 * Format seconds into human-readable time (mm:ss or Xh Ym)
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time string
 */
TLI.formatTime = function(seconds) {
    if (!seconds || seconds < 0) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hrs}h ${remainMins}m`;
    }

    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Format value with +/- prefix and compact suffix (k, M)
 * @param {number} value - Numeric value
 * @returns {string} Formatted value with sign prefix
 */
TLI.formatValue = function(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '+0';

    const prefix = value >= 0 ? '+' : '';
    const absValue = Math.abs(value);

    if (absValue >= 1000000) {
        return prefix + (value / 1000000).toFixed(1) + 'M';
    } else if (absValue >= 1000) {
        return prefix + (value / 1000).toFixed(1) + 'k';
    }

    return prefix + Math.round(value);
};

/**
 * Format large numbers compactly without sign prefix (e.g., 1.2M, 45k)
 * @param {number} value - Numeric value
 * @returns {string} Compact formatted number
 */
TLI.formatCompact = function(value) {
    if (!value) return '0';
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
    return Math.round(value).toString();
};

/**
 * Tick timers by 1 second. Mutates state objects in place.
 * @param {Object} state - State object with inMap, currentMap, session
 * @returns {Object} What was ticked: { mapTicked: boolean, sessionTicked: boolean }
 */
TLI.tickTimers = function(state) {
    const result = { mapTicked: false, sessionTicked: false };

    if (state.inMap && state.currentMap) {
        state.currentMap.duration += 1;
        result.mapTicked = true;
    }

    if (state.session) {
        state.session.duration_total += 1;
        result.sessionTicked = true;
    }

    return result;
};
