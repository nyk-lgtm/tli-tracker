/**
 * TLI Icon System
 * Classic (non-module) script. Injects an SVG <symbol> sprite into the DOM
 * and exposes window.TLI.icons.iconSvg(name, opts) for template-string use.
 *
 * Consumption:
 *   <svg class="tli-icon"><use href="#icon-chevron-right"></use></svg>
 * or from JS:
 *   window.TLI.icons.iconSvg('chevron-right', { className: 'tli-icon-chevron' })
 *
 * Icons inherit stroke from currentColor, so CSS `color` controls them and
 * they auto-theme. All icons use a 24x24 viewBox.
 */
(function () {
    'use strict';
    window.TLI = window.TLI || {};

    const NS = 'http://www.w3.org/2000/svg';
    const SPRITE_ID = 'tli-icon-sprite';

    // path `d` strings only. stroke/fill/linecap/join inherited from the
    // <symbol> element so every icon stays consistent with one source.
    const PATHS = {
        'chevron-right': 'm9 18 6-6-6-6',
        'search':        'M21 21l-4.3-4.3 M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
        'filter':        'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
        'pause':         'M6 4h4v16H6z M14 4h4v16h-4z',
        'refresh':       'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16 M16 16h5v5',
        'trash':         'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1.5 14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2L5 6',
        'history':       'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2',
        'overlay':       'M3 3h13v13H3z M8 8h13v13H8z',
        'close':         'M18 6L6 18 M6 6l12 12',
        'settings':      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    };

    function buildSprite() {
        const svg = document.createElementNS(NS, 'svg');
        svg.id = SPRITE_ID;
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.overflow = 'hidden';

        for (const [name, d] of Object.entries(PATHS)) {
            const sym = document.createElementNS(NS, 'symbol');
            sym.id = 'icon-' + name;
            sym.setAttribute('viewBox', '0 0 24 24');
            sym.setAttribute('fill', 'none');
            sym.setAttribute('stroke', 'currentColor');
            sym.setAttribute('stroke-width', '2');
            sym.setAttribute('stroke-linecap', 'round');
            sym.setAttribute('stroke-linejoin', 'round');
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', d);
            sym.appendChild(p);
            svg.appendChild(sym);
        }
        return svg;
    }

    function injectSprite() {
        if (document.getElementById(SPRITE_ID)) return;
        const svg = buildSprite();
        if (document.body) {
            document.body.insertBefore(svg, document.body.firstChild);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                if (document.getElementById(SPRITE_ID)) return;
                document.body.insertBefore(svg, document.body.firstChild);
            }, { once: true });
        }
    }

    /**
     * Returns HTML for an icon, suitable for template literals.
     * @param {string} name
     * @param {{className?: string, size?: number, title?: string}} [opts]
     */
    function iconSvg(name, opts) {
        opts = opts || {};
        if (!(name in PATHS)) {
            console.warn('[tli-icons] unknown icon:', name);
        }
        const classes = ['tli-icon'];
        if (opts.className) classes.push(opts.className);
        const attrs = [`class="${classes.join(' ')}"`, 'aria-hidden="true"', 'focusable="false"'];
        if (opts.size) attrs.push(`width="${opts.size}" height="${opts.size}"`);
        if (opts.title) attrs.push(`role="img"`);
        const titleEl = opts.title ? `<title>${opts.title}</title>` : '';
        return `<svg ${attrs.join(' ')}>${titleEl}<use href="#icon-${name}"></use></svg>`;
    }

    window.TLI.icons = {
        injectSprite: injectSprite,
        iconSvg: iconSvg,
        names: Object.keys(PATHS),
    };

    injectSprite();
})();
