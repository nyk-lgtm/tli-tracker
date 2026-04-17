/**
 * TLI Shared Charts
 * Non-module script providing chart rendering functions for both main UI and overlay.
 * Must be loaded after shared-utils.js.
 */
window.TLI = window.TLI || {};
TLI.charts = {};

// Chart color palette: theme-driven CSS variables. Resolves live so theme
// switches re-color existing charts on next render. Length must match
// theme-vars.css :root --tli-color-chart-N declarations.
TLI.charts.COLORS = Array.from({ length: 9 }, (_, i) => `var(--tli-color-chart-${i})`);

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
                        <stop offset="0%" class="efficiency-area-stop-top"/>
                        <stop offset="100%" class="efficiency-area-stop-bottom"/>
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
 * @param {Array} categoryTotals - Array of category objects with item_type and value
 */
TLI.charts.renderDonut = function(container, categoryTotals) {
    if (!container) return;

    if (!categoryTotals || categoryTotals.length === 0) {
        container.innerHTML = '<div class="donut-empty">No drops yet</div>';
        return;
    }

    // Sort by value - top 4 categories + "Other" for everything else (5 groups max)
    const sortedCategories = [...categoryTotals]
        .filter(item => (item.value || 0) > 0)
        .sort((a, b) => b.value - a.value);

    const topItems = sortedCategories.slice(0, 4);
    const otherValue = sortedCategories
        .slice(4)
        .reduce((sum, item) => sum + item.value, 0);

    if (otherValue > 0) {
        topItems.push({ item_type: 'Other', value: otherValue });
    }

    // Calculate total for percentages
    const total = topItems.reduce((sum, item) => sum + item.value, 0);

    if (total === 0) {
        container.innerHTML = '<div class="donut-empty">No valued drops</div>';
        return;
    }

    // Build conic gradient stops
    const COLORS = TLI.charts.COLORS;
    let currentAngle = 0;
    const gradientStops = topItems.map((item, i) => {
        const value = item.value;
        const percent = (value / total) * 100;
        const startAngle = currentAngle;
        currentAngle += percent;
        return `${COLORS[i]} ${startAngle}% ${currentAngle}%`;
    }).join(', ');

    // Build legend HTML (show all 5 items, truncate names to 20 chars)
    const legendHTML = topItems.map((item, i) => {
        const name = item.item_type || 'Other';
        const value = item.value;
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

function formatPriceHistoryLabel(value) {
    if (!Number.isFinite(value)) {
        return '0';
    }

    const absolute = Math.abs(value);
    const trim = (str) => str.replace(/0+$/, '').replace(/\.$/, '');

    if (absolute >= 1000000) {
        return `${trim((value / 1000000).toFixed(3))}M`;
    }

    if (absolute >= 1000) {
        const kStr = (value / 1000).toFixed(3);
        // promote to M if rounding pushed the k-form to 1000+
        if (Math.abs(parseFloat(kStr)) >= 1000) {
            return `${trim((value / 1000000).toFixed(3))}M`;
        }
        return `${trim(kStr)}k`;
    }

    return trim(value.toFixed(3));
}

function formatPriceHistoryDate(timestamp, rangeKey) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    if (rangeKey === '7d') {
        return date
            .toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            })
            .replace(',', '');
    }

    return date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Render Price History Chart (line chart for one item's price history)
 * @param {HTMLElement} container - The container element
 * @param {Object} history - Normalized history payload with { points, stats }
 */
TLI.charts.renderPriceHistory = function(container, history) {
    if (!container) return;

    const points = Array.isArray(history?.points) ? history.points : [];
    const rangeKey = history?.rangeKey === '7d' ? '7d' : '30d';
    if (points.length === 0) {
        container.innerHTML = '<div class="price-history-empty">No history</div>';
        return;
    }

    const values = points.map((point) => Number(point.value) || 0);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const baseRange = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
    const verticalPadding = baseRange * 0.14;
    const minValue = rawMin - verticalPadding;
    const maxValue = rawMax + verticalPadding;
    const valueRange = maxValue - minValue || 1;

    const width = 260;
    const height = 92;
    const paddingLeft = 8;
    const paddingRight = 8;
    const paddingTop = 10;
    const paddingBottom = 14;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    const pointCount = points.length;

    const getX = (index) => {
        if (pointCount === 1) {
            return width / 2;
        }
        return paddingLeft + (index / (pointCount - 1)) * chartWidth;
    };
    const getY = (value) => {
        return height - paddingBottom - ((value - minValue) / valueRange) * chartHeight;
    };

    const linePath = points.map((point, index) => {
        const x = getX(index);
        const y = getY(point.value);
        return index === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }).join(' ');

    const midValue = rawMin + (rawMax - rawMin) / 2;
    const topY = getY(rawMax);
    const midY = getY(midValue);
    const bottomY = getY(rawMin);
    // gridlines are position-only so a label collision never drops a visual reference
    const gridYs = rawMax === rawMin ? [topY] : [topY, midY, bottomY];
    const guidelines = gridYs.map((y) => {
        return `<line class="price-history-guide" x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}"></line>`;
    }).join('');
    const topLabel = formatPriceHistoryLabel(rawMax);
    const midLabel = formatPriceHistoryLabel(midValue);
    const bottomLabel = formatPriceHistoryLabel(rawMin);
    // endpoints take priority over mid so a collision never drops rawMin's label
    const labelEntries = [{ label: topLabel, y: topY }];
    if (bottomLabel !== topLabel) {
        labelEntries.push({ label: bottomLabel, y: bottomY });
    }
    if (midLabel !== topLabel && midLabel !== bottomLabel) {
        labelEntries.push({ label: midLabel, y: midY });
    }
    const yAxisLabels = labelEntries.map(({ label, y }) => {
        const topPercent = (y / height) * 100;
        return `<span class="price-history-yaxis-label" style="top: ${topPercent.toFixed(2)}%">${label}</span>`;
    }).join('');
    // sizer reserves gutter width for the widest label; absolute labels overlay it
    const widestLabel = labelEntries.reduce(
        (widest, entry) => entry.label.length > widest.length ? entry.label : widest,
        ''
    );
    const yAxisSizer = `<span class="price-history-yaxis-sizer" aria-hidden="true">${widestLabel}</span>`;

    const lastPoint = points[pointCount - 1];
    const lastXPoint = getX(pointCount - 1);
    const lastYPoint = getY(lastPoint.value);

    container.innerHTML = `
        <div class="price-history-visual">
            <div class="price-history-yaxis">${yAxisSizer}${yAxisLabels}</div>
            <div class="price-history-plot">
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
                    ${guidelines}
                    <path class="price-history-line" d="${linePath}"></path>
                    <circle class="price-history-dot" cx="${lastXPoint}" cy="${lastYPoint}" r="3"></circle>
                </svg>
                <div class="price-history-tooltip" role="tooltip" aria-hidden="true">
                    <span class="price-history-tooltip-value"></span>
                    <span class="price-history-tooltip-date"></span>
                </div>
            </div>
            <div class="price-history-axis">
                <span>${formatPriceHistoryDate(points[0].timestamp, rangeKey)}</span>
                <span>${formatPriceHistoryDate(lastPoint.timestamp, rangeKey)}</span>
            </div>
        </div>
    `;

    const plotEl = container.querySelector('.price-history-plot');
    const dotEl = plotEl && plotEl.querySelector('.price-history-dot');
    const tooltipEl = plotEl && plotEl.querySelector('.price-history-tooltip');
    const tooltipValueEl = tooltipEl && tooltipEl.querySelector('.price-history-tooltip-value');
    const tooltipDateEl = tooltipEl && tooltipEl.querySelector('.price-history-tooltip-date');
    if (!plotEl || !dotEl || !tooltipEl) return;

    const formatTooltipDate = (timestamp) => {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return '';
        return date
            .toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            })
            .replace(',', '');
    };

    const updateHover = (clientX) => {
        const rect = plotEl.getBoundingClientRect();
        if (rect.width === 0) return;
        let index;
        if (pointCount === 1) {
            index = 0;
        } else {
            const vbX = ((clientX - rect.left) / rect.width) * width;
            const ratio = (vbX - paddingLeft) / chartWidth;
            index = Math.round(ratio * (pointCount - 1));
            index = Math.max(0, Math.min(pointCount - 1, index));
        }
        const point = points[index];
        const cx = getX(index);
        const cy = getY(point.value);
        dotEl.setAttribute('cx', cx);
        dotEl.setAttribute('cy', cy);
        plotEl.classList.add('is-hovering');

        const pxX = (cx / width) * rect.width;
        const pxY = (cy / height) * rect.height;
        tooltipValueEl.textContent = `${formatPriceHistoryLabel(point.value)} FE`;
        tooltipDateEl.textContent = formatTooltipDate(point.timestamp);
        tooltipEl.style.left = `${pxX}px`;
        tooltipEl.style.top = `${pxY}px`;
        tooltipEl.setAttribute('aria-hidden', 'false');
    };

    plotEl.addEventListener('mousemove', (ev) => updateHover(ev.clientX));
    plotEl.addEventListener('mouseleave', () => {
        plotEl.classList.remove('is-hovering');
        tooltipEl.setAttribute('aria-hidden', 'true');
    });
};
