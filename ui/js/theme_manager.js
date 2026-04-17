/**
 * Theme Manager
 *
 * Fetches the active theme from Python and writes its CSS-var map onto
 * :root. Listens for `themes_update` push events and re-applies on change.
 *
 * Plain script (no ES modules) so the same file works in both index.html
 * (where app.js is the module entry point) and overlay.html (all sync
 * scripts). Wires up lazily after waitForApi() resolves so it can wrap
 * whatever onPythonEvent handler the page's primary controller installs.
 *
 * FOUC guard: an inline <style>body { visibility: hidden }</style> in
 * each page's <head> hides the document until applyVars() runs (or until
 * the safety timeout elapses, whichever comes first).
 */

const ThemeManager = {
    _revealed: false,
    _revealTimeoutId: null,
    REVEAL_TIMEOUT_MS: 1500,

    /**
     * Apply a flat { '--tli-palette-bg': '#xxx', ... } map onto :root.
     */
    applyVars(cssVars) {
        if (!cssVars || typeof cssVars !== 'object') return;
        const root = document.documentElement;
        for (const [key, value] of Object.entries(cssVars)) {
            root.style.setProperty(key, value);
        }
    },

    /**
     * Fetch the active theme from Python and apply it.
     */
    async loadAndApply() {
        if (typeof api === 'undefined') {
            console.warn('[ThemeManager] api() not available, skipping apply');
            this.reveal();
            return;
        }
        try {
            const result = await api('get_active_theme');
            if (result && result.css_vars) {
                this.applyVars(result.css_vars);
            }
        } catch (e) {
            console.error('[ThemeManager] failed to load active theme:', e);
        } finally {
            this.reveal();
        }
    },

    /**
     * Remove the FOUC guard. Idempotent.
     */
    reveal() {
        if (this._revealed) return;
        this._revealed = true;
        if (this._revealTimeoutId !== null) {
            clearTimeout(this._revealTimeoutId);
            this._revealTimeoutId = null;
        }
        // Defer one frame so the just-set CSS vars are flushed before paint.
        // The .theme-ready class on <html> defeats the FOUC :not() selector.
        requestAnimationFrame(() => {
            document.documentElement.classList.add('theme-ready');
        });
    },

    /**
     * Wrap the existing onPythonEvent handler so we re-apply on push.
     */
    _hookEvents() {
        const previous = window.onPythonEvent;
        window.onPythonEvent = (eventType, data) => {
            if (eventType === 'themes_update') {
                void this.loadAndApply();
            }
            if (previous) {
                try {
                    previous(eventType, data);
                } catch (e) {
                    console.error('[ThemeManager] downstream handler threw:', e);
                }
            }
        };
    },

    /**
     * Bootstrap. Called after the bridge is ready.
     */
    async init() {
        this._hookEvents();
        await this.loadAndApply();
    },
};

window.themeManager = ThemeManager;

// Safety net: if the bridge never connects, reveal the page anyway so the
// user isn't staring at a blank window.
ThemeManager._revealTimeoutId = setTimeout(
    () => ThemeManager.reveal(),
    ThemeManager.REVEAL_TIMEOUT_MS,
);

if (typeof waitForApi !== 'undefined') {
    waitForApi().then(() => ThemeManager.init()).catch((e) => {
        console.error('[ThemeManager] init failed:', e);
        ThemeManager.reveal();
    });
} else {
    console.warn('[ThemeManager] waitForApi() unavailable - browser mode?');
    ThemeManager.reveal();
}
