/**
 * Canvas Manager
 *
 * Provides coordinate utilities and bounds checking for the widget canvas.
 * The canvas covers the entire game monitor.
 */

const CanvasManager = {
    /**
     * Get canvas dimensions
     * @returns {{width: number, height: number}}
     */
    getSize() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
        };
    },

    /**
     * Check if a point is within canvas bounds
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isInBounds(x, y) {
        const size = this.getSize();
        return x >= 0 && x <= size.width && y >= 0 && y <= size.height;
    },

    /**
     * Clamp a rectangle to stay within canvas bounds
     * @param {{x: number, y: number, width: number, height: number}} rect
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    clampToBounds(rect) {
        const size = this.getSize();
        let { x, y, width, height } = rect;

        // Clamp position to keep widget fully on screen
        x = Math.max(0, Math.min(x, size.width - width));
        y = Math.max(0, Math.min(y, size.height - height));

        return { x, y, width, height };
    },

    /**
     * Get the center point of the canvas
     * @returns {{x: number, y: number}}
     */
    getCenter() {
        const size = this.getSize();
        return {
            x: size.width / 2,
            y: size.height / 2,
        };
    },

    /**
     * Convert screen coordinates to canvas coordinates
     * (Currently 1:1, but useful if we add scaling later)
     * @param {number} screenX
     * @param {number} screenY
     * @returns {{x: number, y: number}}
     */
    screenToCanvas(screenX, screenY) {
        return { x: screenX, y: screenY };
    },

    /**
     * Initialize canvas manager
     */
    init() {
        // Listen for resize events
        window.addEventListener('resize', () => {
            // Will be used by widget manager to revalidate positions
        });
    },
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CanvasManager.init());
} else {
    CanvasManager.init();
}
