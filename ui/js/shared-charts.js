/**
 * TLI Shared Charts
 * Non-module script providing chart rendering functions for both main UI and overlay.
 * Must be loaded after shared-utils.js.
 */
window.TLI = window.TLI || {};
TLI.charts = {};

// Chart color palette
TLI.charts.COLORS = [
    '#0d9488', '#22d3ee', '#38bdf8', '#818cf8',
    '#a78bfa', '#f472b6', '#fb7185', '#f59e0b', '#64748b'
];

/**
 * Render Pulse Chart (bar chart showing value per map)
 * @param {HTMLElement} container - The container element
 * @param {Array} maps - Array of map objects with total_value
 * @param {Object} currentMap - Current map object (optional, for live bar)
 */
TLI.charts.renderPulse = function(container, maps, currentMap) {
    if (!container) return;

    // Include current map as a live bar if in a map
    const allMaps = [...maps];
    if (currentMap) {
        allMaps.push({ total_value: currentMap.value || 0, isLive: true });
    }

    // Take last 15 maps for display
    const recentMaps = allMaps.slice(-15);

    if (recentMaps.length === 0) {
        container.innerHTML = '<div class="pulse-empty">No maps yet</div>';
        return;
    }

    // Calculate unified scale for both positive and negative values
    const values = recentMaps.map(m => m.total_value || 0);
    const maxPositive = Math.max(...values, 0);
    const maxNegative = Math.abs(Math.min(...values, 0));
    const hasNegative = maxNegative > 0;

    // Total range for unified scaling (both directions use same scale)
    const totalRange = (maxPositive + maxNegative) || 1;
    const negativeSpace = hasNegative ? (maxNegative / totalRange) * 100 : 0;

    // Build bars HTML (wrapped in wrapper divs for positioning)
    const barsHTML = recentMaps.map((map) => {
        const value = map.total_value || 0;
        const absValue = Math.abs(value);
        const isNegative = value < 0;

        // Scale height relative to total range (unified scale)
        const heightPercent = (absValue / totalRange) * 100;
        const minHeight = absValue > 0 ? Math.max(heightPercent, 2) : 1;

        const liveClass = map.isLive ? ' pulse-bar-live' : '';
        const negativeClass = isNegative ? ' pulse-bar-negative' : '';
        return `<div class="pulse-bar-wrapper"><div class="pulse-bar${liveClass}${negativeClass}" style="height: ${minHeight}%" data-value="${TLI.formatCompact(value)}"></div></div>`;
    }).join('');

    const chartClass = hasNegative ? 'pulse-chart has-negative' : 'pulse-chart';
    const chartStyle = hasNegative ? ` style="--zero-line: ${negativeSpace}%"` : '';
    container.innerHTML = `<div class="${chartClass}"${chartStyle}>${barsHTML}</div>`;
};

/**
 * Render Efficiency Trend Chart (line chart showing value/hour over time)
 * Shows a rolling 1-hour window with wall-clock time on x-axis
 * @param {HTMLElement} container - The container element
 * @param {Array} maps - Array of map objects with total_value and ended_at_offset
 * @param {number} sessionDuration - Total session duration in seconds
 * @param {number} currentValue - Current total value including current map
 */
TLI.charts.renderEfficiency = function(container, maps, sessionDuration, currentValue) {
    if (!container) return;

    const WINDOW_SECONDS = 3600; // 1 hour rolling window

    // Calculate time window (full session if < 1 hour)
    const windowEnd = sessionDuration;
    const windowStart = Math.max(0, windowEnd - WINDOW_SECONDS);
    const windowSize = windowEnd - windowStart;

    if (windowSize <= 0) {
        container.innerHTML = '<div class="efficiency-empty">Need more data</div>';
        return;
    }

    // Build points using wall-clock time (ended_at_offset)
    const points = [];
    let cumulativeValue = 0;
    let lastRateBeforeWindow = 0;

    for (const map of maps) {
        cumulativeValue += map.total_value || 0;
        const mapEndTime = map.ended_at_offset || 0;
        const rate = mapEndTime > 0 ? (cumulativeValue / mapEndTime) * 3600 : 0;

        if (mapEndTime < windowStart) {
            // Track the rate just before window starts (for left edge)
            lastRateBeforeWindow = rate;
        } else if (mapEndTime <= windowEnd) {
            // Point is within window
            points.push({ time: mapEndTime, rate });
        }
    }

    // If there were maps before the window, add a starting point at window edge
    if (windowStart > 0 && lastRateBeforeWindow !== 0 && (points.length === 0 || points[0].time > windowStart)) {
        points.unshift({ time: windowStart, rate: lastRateBeforeWindow });
    }

    // Add current point at session duration (right edge)
    if (sessionDuration > 0) {
        const currentRate = (currentValue / sessionDuration) * 3600;
        points.push({ time: sessionDuration, rate: currentRate, current: true });
    }

    // Need at least 2 points to draw a line
    if (points.length < 2) {
        container.innerHTML = '<div class="efficiency-empty">Need more data</div>';
        return;
    }

    // Find bounds (handle negative values)
    const rates = points.map(p => p.rate);
    const minRate = Math.min(...rates, 0);
    const maxRate = Math.max(...rates, 0);
    const rateRange = maxRate - minRate || 1;

    // Calculate SVG path
    const width = 200;
    const height = 60;
    const padding = 4;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // X-axis spans the time window (windowStart to windowEnd)
    const getX = (time) => padding + ((time - windowStart) / windowSize) * chartWidth;
    const getY = (rate) => height - padding - ((rate - minRate) / rateRange) * chartHeight;

    // Build line path
    const linePath = points.map((p, i) => {
        const x = getX(p.time);
        const y = getY(p.rate);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }).join(' ');

    // Build area path (fill under line)
    const areaPath = linePath + ` L ${getX(windowEnd)} ${height - padding} L ${getX(points[0].time)} ${height - padding} Z`;

    // Current rate display
    const currentRate = points[points.length - 1]?.rate || 0;

    // Unique gradient ID to avoid collisions when multiple charts exist
    // Use container ID for stable gradient ID (avoids orphaned gradients)
    const gradientId = `efficiency-gradient-${container.id || 'default'}`;

    container.innerHTML = `
        <div class="efficiency-chart">
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.4"/>
                        <stop offset="100%" stop-color="#14b8a6" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <path class="efficiency-area" d="${areaPath}" fill="url(#${gradientId})"/>
                <path class="efficiency-line" d="${linePath}"/>
                <circle class="efficiency-dot" cx="${getX(windowEnd)}" cy="${getY(currentRate)}" r="3"/>
            </svg>
        </div>
    `;
};

/**
 * Render Donut Chart (loot distribution by category)
 * @param {HTMLElement} container - The container element
 * @param {Array} drops - Array of drop objects with item_type and value
 */
TLI.charts.renderDonut = function(container, drops) {
    if (!container) return;

    if (!drops || drops.length === 0) {
        container.innerHTML = '<div class="donut-empty">No drops yet</div>';
        return;
    }

    // Aggregate drops by item category/type
    const categoryTotals = {};
    for (const drop of drops) {
        const category = drop.item_type || 'Other';
        const value = drop.value || 0;
        if (value > 0) {
            categoryTotals[category] = (categoryTotals[category] || 0) + value;
        }
    }

    // Sort by value - top 4 categories + "Other" for everything else (5 groups max)
    const sortedCategories = Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1]);

    const topItems = sortedCategories.slice(0, 4);
    const otherValue = sortedCategories.slice(4).reduce((sum, item) => sum + item[1], 0);

    if (otherValue > 0) {
        topItems.push(['Other', otherValue]);
    }

    // Calculate total for percentages
    const total = topItems.reduce((sum, item) => sum + item[1], 0);

    if (total === 0) {
        container.innerHTML = '<div class="donut-empty">No valued drops</div>';
        return;
    }

    // Build conic gradient stops
    const COLORS = TLI.charts.COLORS;
    let currentAngle = 0;
    const gradientStops = topItems.map(([name, value], i) => {
        const percent = (value / total) * 100;
        const startAngle = currentAngle;
        currentAngle += percent;
        return `${COLORS[i]} ${startAngle}% ${currentAngle}%`;
    }).join(', ');

    // Build legend HTML (show all 5 items, truncate names to 20 chars)
    const legendHTML = topItems.map(([name, value], i) => {
        const percent = ((value / total) * 100).toFixed(0);
        const truncatedName = name.length > 20 ? name.substring(0, 20) + '...' : name;
        return `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${COLORS[i]}"></div>
                <span class="legend-name">${truncatedName}</span>
                <span class="legend-value">${percent}%</span>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="donut-chart">
            <div class="donut-ring" style="background: conic-gradient(${gradientStops})">
                <div class="donut-center">${TLI.formatCompact(total)}</div>
            </div>
            <div class="donut-legend">${legendHTML}</div>
        </div>
    `;
};
