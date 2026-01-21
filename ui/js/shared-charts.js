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

    // Find max value for scaling
    const maxValue = Math.max(...recentMaps.map(m => m.total_value || 0), 1);

    // Build bars HTML
    const barsHTML = recentMaps.map((map) => {
        const value = map.total_value || 0;
        const heightPercent = (value / maxValue) * 100;
        const minHeight = value > 0 ? Math.max(heightPercent, 5) : 2;
        const liveClass = map.isLive ? ' pulse-bar-live' : '';
        return `<div class="pulse-bar${liveClass}" style="height: ${minHeight}%" data-value="${TLI.formatCompact(value)}"></div>`;
    }).join('');

    container.innerHTML = `<div class="pulse-chart">${barsHTML}</div>`;
};

/**
 * Render Efficiency Trend Chart (line chart showing cumulative value/hour)
 * @param {HTMLElement} container - The container element
 * @param {Array} maps - Array of map objects with total_value and duration_seconds
 * @param {number} sessionDuration - Total session duration in seconds
 * @param {number} currentValue - Current total value including current map
 */
TLI.charts.renderEfficiency = function(container, maps, sessionDuration, currentValue) {
    if (!container) return;

    // Calculate cumulative efficiency at each map completion
    const points = [];
    let cumulativeValue = 0;
    let cumulativeTime = 0;

    for (const map of maps) {
        cumulativeValue += map.total_value || 0;
        cumulativeTime += map.duration_seconds || 0;

        if (cumulativeTime > 0) {
            const rate = (cumulativeValue / cumulativeTime) * 3600;
            points.push({ time: cumulativeTime, rate });
        }
    }

    // Add current point based on session duration
    if (sessionDuration > 0 && currentValue > 0) {
        const currentRate = (currentValue / sessionDuration) * 3600;
        points.push({ time: sessionDuration, rate: currentRate, current: true });
    }

    if (points.length < 2) {
        container.innerHTML = '<div class="efficiency-empty">Need more data</div>';
        return;
    }

    // Find bounds
    const maxRate = Math.max(...points.map(p => p.rate));
    const maxTime = points[points.length - 1].time;

    // Calculate SVG path
    const width = 200;
    const height = 60;
    const padding = 4;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const getX = (time) => padding + (time / maxTime) * chartWidth;
    const getY = (rate) => height - padding - (rate / maxRate) * chartHeight;

    // Build line path
    const linePath = points.map((p, i) => {
        const x = getX(p.time);
        const y = getY(p.rate);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }).join(' ');

    // Build area path (fill under line)
    const areaPath = linePath + ` L ${getX(maxTime)} ${height - padding} L ${padding} ${height - padding} Z`;

    // Current rate display
    const currentRate = points[points.length - 1]?.rate || 0;

    container.innerHTML = `
        <div class="efficiency-chart">
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="efficiency-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.4"/>
                        <stop offset="100%" stop-color="#14b8a6" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <path class="efficiency-area" d="${areaPath}"/>
                <path class="efficiency-line" d="${linePath}"/>
                <circle class="efficiency-dot" cx="${getX(maxTime)}" cy="${getY(currentRate)}" r="3"/>
            </svg>
        </div>
    `;
};

/**
 * Render Donut Chart (loot distribution by item)
 * @param {HTMLElement} container - The container element
 * @param {Array} drops - Array of drop objects with item_name and value
 */
TLI.charts.renderDonut = function(container, drops) {
    if (!container) return;

    if (!drops || drops.length === 0) {
        container.innerHTML = '<div class="donut-empty">No drops yet</div>';
        return;
    }

    // Aggregate drops by item name
    const itemTotals = {};
    for (const drop of drops) {
        const name = drop.item_name || 'Unknown';
        const value = drop.value || 0;
        if (value > 0) {
            itemTotals[name] = (itemTotals[name] || 0) + value;
        }
    }

    // Sort by value - top 4 items + "Other" for everything else (5 groups max)
    const sortedItems = Object.entries(itemTotals)
        .sort((a, b) => b[1] - a[1]);

    const topItems = sortedItems.slice(0, 4);
    const otherValue = sortedItems.slice(4).reduce((sum, [_, v]) => sum + v, 0);

    if (otherValue > 0) {
        topItems.push(['Other', otherValue]);
    }

    // Calculate total for percentages
    const total = topItems.reduce((sum, [_, v]) => sum + v, 0);

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
