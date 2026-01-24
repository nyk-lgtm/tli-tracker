/**
 * Edit Mode Manager
 *
 * Handles widget drag/resize in edit mode.
 */

const EditMode = {
    enabled: false,
    dragging: null,  // { widget, startX, startY, startLeft, startTop }
    resizing: null,  // { widget, handle, startX, startY, startRect }

    /**
     * Initialize edit mode manager
     */
    init() {
        // Listen for edit mode events from Python
        const originalHandler = window.onPythonEvent;
        window.onPythonEvent = (eventType, data) => {
            if (eventType === 'edit_mode') {
                this.setEnabled(data.enabled);
            }
            // Call original handler
            if (originalHandler) {
                originalHandler(eventType, data);
            }
        };

        // Set up mouse event listeners
        document.addEventListener('mousedown', (e) => this.onMouseDown(e));
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));

        console.log('[EditMode] Initialized');
    },

    /**
     * Enable or disable edit mode
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        const overlay = document.getElementById('edit-mode-overlay');
        const canvas = document.getElementById('widget-canvas');

        if (enabled) {
            overlay?.classList.remove('hidden');
            canvas?.classList.add('edit-mode');

            // Add editing class to all widgets
            document.querySelectorAll('.widget').forEach(w => {
                w.classList.add('editing');
            });
        } else {
            overlay?.classList.add('hidden');
            canvas?.classList.remove('edit-mode');

            // Remove editing class from all widgets
            document.querySelectorAll('.widget').forEach(w => {
                w.classList.remove('editing');
            });

            // Save layout when exiting edit mode
            this.saveLayout();
        }

        console.log('[EditMode]', enabled ? 'Enabled' : 'Disabled');
    },

    /**
     * Handle mouse down - start drag or resize
     */
    onMouseDown(e) {
        if (!this.enabled) return;

        const target = e.target;

        // Check if clicking a resize handle
        if (target.classList.contains('widget-resize-handle')) {
            const widget = target.closest('.widget');
            if (widget) {
                this.startResize(widget, target, e);
                e.preventDefault();
                return;
            }
        }

        // Check if clicking a widget (for dragging)
        const widget = target.closest('.widget');
        if (widget && widget.classList.contains('editing')) {
            this.startDrag(widget, e);
            e.preventDefault();
        }
    },

    /**
     * Handle mouse move - update drag or resize
     */
    onMouseMove(e) {
        if (this.dragging) {
            this.updateDrag(e);
        } else if (this.resizing) {
            this.updateResize(e);
        }
    },

    /**
     * Handle mouse up - end drag or resize
     */
    onMouseUp(e) {
        if (this.dragging) {
            this.endDrag();
        } else if (this.resizing) {
            this.endResize();
        }
    },

    /**
     * Start dragging a widget
     */
    startDrag(widget, e) {
        const rect = widget.getBoundingClientRect();
        this.dragging = {
            widget,
            startX: e.clientX,
            startY: e.clientY,
            startLeft: rect.left,
            startTop: rect.top,
        };
        widget.classList.add('dragging');
    },

    /**
     * Update widget position during drag
     */
    updateDrag(e) {
        if (!this.dragging) return;

        const { widget, startX, startY, startLeft, startTop } = this.dragging;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = startLeft + deltaX;
        let newTop = startTop + deltaY;

        // Calculate proposed position
        const proposedRect = {
            x: newLeft,
            y: newTop,
            width: widget.offsetWidth,
            height: widget.offsetHeight,
        };

        // Apply snapping
        const snapped = SnapEngine.calculateSnap(widget, proposedRect);
        SnapEngine.renderGuides(snapped.guides);

        // Clamp to canvas bounds
        const bounds = CanvasManager.clampToBounds({
            x: snapped.x,
            y: snapped.y,
            width: widget.offsetWidth,
            height: widget.offsetHeight,
        });

        widget.style.left = `${bounds.x}px`;
        widget.style.top = `${bounds.y}px`;
    },

    /**
     * End dragging
     */
    endDrag() {
        if (!this.dragging) return;

        this.dragging.widget.classList.remove('dragging');
        this.dragging = null;

        // Clear snap guides
        SnapEngine.clearGuides();
    },

    /**
     * Start resizing a widget
     */
    startResize(widget, handle, e) {
        const rect = widget.getBoundingClientRect();
        const handleType = Array.from(handle.classList)
            .find(c => ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].includes(c));

        // Find widgets that share edges with this one
        const linkedWidgets = SnapEngine.findLinkedWidgets(widget, handleType);

        // Store start rects for all linked widgets
        const linkedData = linkedWidgets.map(({ widget: linkedWidget, sharedEdge, linkedEdge }) => {
            const linkedRect = linkedWidget.getBoundingClientRect();
            return {
                widget: linkedWidget,
                sharedEdge,
                linkedEdge,
                startRect: {
                    left: linkedRect.left,
                    top: linkedRect.top,
                    width: linkedRect.width,
                    height: linkedRect.height,
                },
            };
        });

        this.resizing = {
            widget,
            handle: handleType,
            startX: e.clientX,
            startY: e.clientY,
            startRect: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            },
            linkedWidgets: linkedData,
        };
        widget.classList.add('resizing');
    },

    /**
     * Update widget size during resize
     */
    updateResize(e) {
        if (!this.resizing) return;

        const { widget, handle, startX, startY, startRect, linkedWidgets } = this.resizing;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = startRect.left;
        let newTop = startRect.top;
        let newWidth = startRect.width;
        let newHeight = startRect.height;

        // Get widget type for min/max constraints
        const widgetType = widget.dataset.type;
        const typeDef = WidgetManager.WIDGET_TYPES[widgetType] || {};
        const minW = typeDef.minSize?.width || 100;
        const minH = typeDef.minSize?.height || 50;
        const maxW = typeDef.maxSize?.width || 800;
        const maxH = typeDef.maxSize?.height || 600;

        // Calculate constrained delta considering linked widgets
        let constrainedDeltaX = deltaX;
        let constrainedDeltaY = deltaY;

        // Check linked widget constraints
        for (const linked of linkedWidgets || []) {
            const linkedType = linked.widget.dataset.type;
            const linkedTypeDef = WidgetManager.WIDGET_TYPES[linkedType] || {};
            const linkedMinW = linkedTypeDef.minSize?.width || 100;
            const linkedMinH = linkedTypeDef.minSize?.height || 50;
            const linkedMaxW = linkedTypeDef.maxSize?.width || 800;
            const linkedMaxH = linkedTypeDef.maxSize?.height || 600;

            // Constrain based on which edge is linked
            if (linked.linkedEdge === 'left') {
                // We're pushing into their left edge - they shrink
                const maxShrink = linked.startRect.width - linkedMinW;
                const maxGrow = linkedMaxW - linked.startRect.width;
                if (deltaX > 0) constrainedDeltaX = Math.min(constrainedDeltaX, maxShrink);
                if (deltaX < 0) constrainedDeltaX = Math.max(constrainedDeltaX, -maxGrow);
            }
            if (linked.linkedEdge === 'right') {
                // We're pulling their right edge - they shrink
                const maxShrink = linked.startRect.width - linkedMinW;
                const maxGrow = linkedMaxW - linked.startRect.width;
                if (deltaX < 0) constrainedDeltaX = Math.max(constrainedDeltaX, -maxShrink);
                if (deltaX > 0) constrainedDeltaX = Math.min(constrainedDeltaX, maxGrow);
            }
            if (linked.linkedEdge === 'top') {
                // We're pushing into their top edge - they shrink
                const maxShrink = linked.startRect.height - linkedMinH;
                const maxGrow = linkedMaxH - linked.startRect.height;
                if (deltaY > 0) constrainedDeltaY = Math.min(constrainedDeltaY, maxShrink);
                if (deltaY < 0) constrainedDeltaY = Math.max(constrainedDeltaY, -maxGrow);
            }
            if (linked.linkedEdge === 'bottom') {
                // We're pulling their bottom edge - they shrink
                const maxShrink = linked.startRect.height - linkedMinH;
                const maxGrow = linkedMaxH - linked.startRect.height;
                if (deltaY < 0) constrainedDeltaY = Math.max(constrainedDeltaY, -maxShrink);
                if (deltaY > 0) constrainedDeltaY = Math.min(constrainedDeltaY, maxGrow);
            }
        }

        // Adjust main widget based on handle (using constrained deltas)
        if (handle.includes('e')) {
            newWidth = Math.max(minW, Math.min(maxW, startRect.width + constrainedDeltaX));
        }
        if (handle.includes('w')) {
            const widthDelta = Math.max(minW, Math.min(maxW, startRect.width - constrainedDeltaX)) - startRect.width;
            newWidth = startRect.width + widthDelta;
            newLeft = startRect.left - widthDelta;
        }
        if (handle.includes('s')) {
            newHeight = Math.max(minH, Math.min(maxH, startRect.height + constrainedDeltaY));
        }
        if (handle.includes('n')) {
            const heightDelta = Math.max(minH, Math.min(maxH, startRect.height - constrainedDeltaY)) - startRect.height;
            newHeight = startRect.height + heightDelta;
            newTop = startRect.top - heightDelta;
        }

        // Calculate proposed rect for snapping (only if no linked widgets)
        if (!linkedWidgets || linkedWidgets.length === 0) {
            const proposedRect = {
                x: newLeft,
                y: newTop,
                width: newWidth,
                height: newHeight,
            };

            // Apply snapping based on which edges are being resized
            const snapped = SnapEngine.calculateSnapForResize(widget, proposedRect, handle);
            SnapEngine.renderGuides(snapped.guides);

            // Apply snapped dimensions (respecting min/max constraints)
            newLeft = snapped.x;
            newTop = snapped.y;
            newWidth = Math.max(minW, Math.min(maxW, snapped.width));
            newHeight = Math.max(minH, Math.min(maxH, snapped.height));
        }

        // Clamp to canvas bounds
        const bounds = CanvasManager.clampToBounds({
            x: newLeft,
            y: newTop,
            width: newWidth,
            height: newHeight,
        });

        widget.style.left = `${bounds.x}px`;
        widget.style.top = `${bounds.y}px`;
        widget.style.width = `${bounds.width}px`;
        widget.style.height = `${bounds.height}px`;

        // Update linked widgets
        for (const linked of linkedWidgets || []) {
            const linkedWidget = linked.widget;
            let linkedLeft = linked.startRect.left;
            let linkedTop = linked.startRect.top;
            let linkedWidth = linked.startRect.width;
            let linkedHeight = linked.startRect.height;

            // Calculate actual delta that was applied to main widget
            const actualDeltaX = (parseFloat(widget.style.left) - startRect.left) || 0;
            const actualDeltaY = (parseFloat(widget.style.top) - startRect.top) || 0;
            const actualWidthDelta = parseFloat(widget.style.width) - startRect.width;
            const actualHeightDelta = parseFloat(widget.style.height) - startRect.height;

            // Adjust linked widget based on which edge is shared
            if (linked.linkedEdge === 'left' && handle.includes('e')) {
                // Main widget's right edge pushed into linked widget's left edge
                linkedLeft = linked.startRect.left + actualWidthDelta;
                linkedWidth = linked.startRect.width - actualWidthDelta;
            }
            if (linked.linkedEdge === 'right' && handle.includes('w')) {
                // Main widget's left edge pulled linked widget's right edge
                linkedWidth = linked.startRect.width + actualDeltaX;
            }
            if (linked.linkedEdge === 'top' && handle.includes('s')) {
                // Main widget's bottom edge pushed into linked widget's top edge
                linkedTop = linked.startRect.top + actualHeightDelta;
                linkedHeight = linked.startRect.height - actualHeightDelta;
            }
            if (linked.linkedEdge === 'bottom' && handle.includes('n')) {
                // Main widget's top edge pulled linked widget's bottom edge
                linkedHeight = linked.startRect.height + actualDeltaY;
            }

            // Apply to linked widget
            linkedWidget.style.left = `${linkedLeft}px`;
            linkedWidget.style.top = `${linkedTop}px`;
            linkedWidget.style.width = `${linkedWidth}px`;
            linkedWidget.style.height = `${linkedHeight}px`;
        }
    },

    /**
     * End resizing
     */
    endResize() {
        if (!this.resizing) return;

        this.resizing.widget.classList.remove('resizing');
        this.resizing = null;

        // Clear snap guides
        SnapEngine.clearGuides();
    },

    /**
     * Save current widget layout to config
     */
    async saveLayout() {
        const widgets = [];

        document.querySelectorAll('.widget').forEach(el => {
            const id = el.id;
            const widgetData = WidgetManager.getWidget(id);
            if (!widgetData) return;

            widgets.push({
                ...widgetData,
                position: {
                    x: parseInt(el.style.left) || 0,
                    y: parseInt(el.style.top) || 0,
                },
                size: {
                    width: el.offsetWidth,
                    height: el.offsetHeight,
                },
            });
        });

        // Update WidgetManager's widgets array
        WidgetManager.widgets = widgets;

        // Save to backend
        if (typeof api !== 'undefined') {
            try {
                await api('save_widget_layout', JSON.stringify(widgets));
                console.log('[EditMode] Layout saved');
            } catch (e) {
                console.error('[EditMode] Failed to save layout:', e);
            }
        }
    },
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => EditMode.init());
} else {
    EditMode.init();
}
