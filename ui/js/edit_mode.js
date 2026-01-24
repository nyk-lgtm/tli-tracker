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
        };
        widget.classList.add('resizing');
    },

    /**
     * Update widget size during resize
     */
    updateResize(e) {
        if (!this.resizing) return;

        const { widget, handle, startX, startY, startRect } = this.resizing;
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

        // Adjust based on handle
        if (handle.includes('e')) {
            newWidth = Math.max(minW, Math.min(maxW, startRect.width + deltaX));
        }
        if (handle.includes('w')) {
            const widthDelta = Math.max(minW, Math.min(maxW, startRect.width - deltaX)) - startRect.width;
            newWidth = startRect.width + widthDelta;
            newLeft = startRect.left - widthDelta;
        }
        if (handle.includes('s')) {
            newHeight = Math.max(minH, Math.min(maxH, startRect.height + deltaY));
        }
        if (handle.includes('n')) {
            const heightDelta = Math.max(minH, Math.min(maxH, startRect.height - deltaY)) - startRect.height;
            newHeight = startRect.height + heightDelta;
            newTop = startRect.top - heightDelta;
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
    },

    /**
     * End resizing
     */
    endResize() {
        if (!this.resizing) return;

        this.resizing.widget.classList.remove('resizing');
        this.resizing = null;
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
