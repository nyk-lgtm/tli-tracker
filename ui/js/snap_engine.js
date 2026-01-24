/**
 * Snap Engine
 *
 * Provides widget-to-widget snapping during drag operations.
 * No grid snap - widgets position exactly where dropped if no nearby widget.
 */

const SnapEngine = {
    THRESHOLD: 8,  // Snap distance in pixels

    /**
     * Calculate snap adjustment for a widget being dragged
     * @param {HTMLElement} widget - The widget being dragged
     * @param {DOMRect} proposedRect - The proposed position/size
     * @returns {{x: number, y: number, guides: Array}} Adjusted position and guide lines
     */
    calculateSnap(widget, proposedRect) {
        const otherWidgets = this.getOtherWidgets(widget);

        let snapX = null;
        let snapY = null;
        const guides = [];

        const proposed = {
            left: proposedRect.x,
            right: proposedRect.x + proposedRect.width,
            top: proposedRect.y,
            bottom: proposedRect.y + proposedRect.height,
            centerX: proposedRect.x + proposedRect.width / 2,
            centerY: proposedRect.y + proposedRect.height / 2,
            width: proposedRect.width,
            height: proposedRect.height,
        };

        for (const other of otherWidgets) {
            const otherRect = other.getBoundingClientRect();
            const target = {
                left: otherRect.left,
                right: otherRect.right,
                top: otherRect.top,
                bottom: otherRect.bottom,
                centerX: otherRect.left + otherRect.width / 2,
                centerY: otherRect.top + otherRect.height / 2,
            };

            // Horizontal snapping (X axis)
            if (snapX === null) {
                // Left edge to left edge
                if (Math.abs(proposed.left - target.left) < this.THRESHOLD) {
                    snapX = target.left;
                    guides.push({ type: 'vertical', x: target.left });
                }
                // Right edge to right edge
                else if (Math.abs(proposed.right - target.right) < this.THRESHOLD) {
                    snapX = target.right - proposed.width;
                    guides.push({ type: 'vertical', x: target.right });
                }
                // Left edge to right edge
                else if (Math.abs(proposed.left - target.right) < this.THRESHOLD) {
                    snapX = target.right;
                    guides.push({ type: 'vertical', x: target.right });
                }
                // Right edge to left edge
                else if (Math.abs(proposed.right - target.left) < this.THRESHOLD) {
                    snapX = target.left - proposed.width;
                    guides.push({ type: 'vertical', x: target.left });
                }
                // Center to center (horizontal)
                else if (Math.abs(proposed.centerX - target.centerX) < this.THRESHOLD) {
                    snapX = target.centerX - proposed.width / 2;
                    guides.push({ type: 'vertical', x: target.centerX });
                }
            }

            // Vertical snapping (Y axis)
            if (snapY === null) {
                // Top edge to top edge
                if (Math.abs(proposed.top - target.top) < this.THRESHOLD) {
                    snapY = target.top;
                    guides.push({ type: 'horizontal', y: target.top });
                }
                // Bottom edge to bottom edge
                else if (Math.abs(proposed.bottom - target.bottom) < this.THRESHOLD) {
                    snapY = target.bottom - proposed.height;
                    guides.push({ type: 'horizontal', y: target.bottom });
                }
                // Top edge to bottom edge
                else if (Math.abs(proposed.top - target.bottom) < this.THRESHOLD) {
                    snapY = target.bottom;
                    guides.push({ type: 'horizontal', y: target.bottom });
                }
                // Bottom edge to top edge
                else if (Math.abs(proposed.bottom - target.top) < this.THRESHOLD) {
                    snapY = target.top - proposed.height;
                    guides.push({ type: 'horizontal', y: target.top });
                }
                // Center to center (vertical)
                else if (Math.abs(proposed.centerY - target.centerY) < this.THRESHOLD) {
                    snapY = target.centerY - proposed.height / 2;
                    guides.push({ type: 'horizontal', y: target.centerY });
                }
            }

            // If both axes snapped, we're done
            if (snapX !== null && snapY !== null) {
                break;
            }
        }

        return {
            x: snapX !== null ? snapX : proposedRect.x,
            y: snapY !== null ? snapY : proposedRect.y,
            guides,
        };
    },

    /**
     * Get all other visible widgets (excluding the one being dragged)
     */
    getOtherWidgets(excludeWidget) {
        const allWidgets = document.querySelectorAll('.widget');
        return Array.from(allWidgets).filter(w =>
            w !== excludeWidget &&
            w.offsetParent !== null  // visible
        );
    },

    /**
     * Render snap guides as SVG lines
     */
    renderGuides(guides) {
        const svg = document.getElementById('snap-guides');
        if (!svg) return;

        // Clear existing guides
        svg.innerHTML = '';

        for (const guide of guides) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.classList.add('snap-guide-line');

            if (guide.type === 'vertical') {
                line.setAttribute('x1', guide.x);
                line.setAttribute('y1', 0);
                line.setAttribute('x2', guide.x);
                line.setAttribute('y2', window.innerHeight);
            } else {
                line.setAttribute('x1', 0);
                line.setAttribute('y1', guide.y);
                line.setAttribute('x2', window.innerWidth);
                line.setAttribute('y2', guide.y);
            }

            svg.appendChild(line);
        }
    },

    /**
     * Clear all snap guides
     */
    clearGuides() {
        const svg = document.getElementById('snap-guides');
        if (svg) {
            svg.innerHTML = '';
        }
    },
};
