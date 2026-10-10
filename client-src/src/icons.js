// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Iconos propios (SVG dibujado a mano, trazo de 1.75 en una rejilla de 24). Se crean con createElementNS: nada de HTML.
// El espacio de nombres de SVG se arma por partes para no tener una URL literal en el codigo (lo vigila lint.mjs).
const NS = 'http:' + '//www.w3.org/2000/svg';
const PHONE = 'M6.6 3.5h2.9l1.5 4-1.9 1.4a11.2 11.2 0 0 0 5.9 5.9l1.4-1.9 4 1.5v2.9a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z';
const MIC = 'M12 3.5a3 3 0 0 0-3 3V11a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v3.5 M9 20.5h6';
const ICONS = {
  phone: [PHONE],
  hangup: [{ d: PHONE, t: 'rotate(135 12 12)' }],
  mic: [MIC],
  micoff: [MIC, 'M4 4l16 16'],
  pause: ['M8.5 5.5v13 M15.5 5.5v13'],
  play: ['M8 5v14l11-7z'],
  keypad: [{ d: 'M6 5h.01 M12 5h.01 M18 5h.01 M6 11h.01 M12 11h.01 M18 11h.01 M6 17h.01 M12 17h.01 M18 17h.01', w: 3 }],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8', { d: 'M12 17h.01', w: 2.6 }],
  close: ['M6.5 6.5l11 11 M17.5 6.5l-11 11'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M12 4l9 15.5H3z', 'M12 10v4', { d: 'M12 16.8h.01', w: 2.6 }],
  speaker: ['M4 10v4h3.2L12 18V6L7.2 10z', 'M15.5 9.2a4 4 0 0 1 0 5.6', 'M18.3 6.5a8 8 0 0 1 0 11'],
  offline: ['M2.5 9.2a14.5 14.5 0 0 1 19 0', 'M5.8 12.6a9.7 9.7 0 0 1 12.4 0', 'M9.2 16a5 5 0 0 1 5.6 0', 'M3.5 3.5l17 17'],
  spinner: ['M12 3.5a8.5 8.5 0 1 0 8.5 8.5'],
  copy: ['M8.5 8.5h10.5v11H8.5z', 'M5 15.5V4.5h10'],
  back: ['M15 5l-7 7 7 7'],
  refresh: ['M19.5 11a7.5 7.5 0 1 0-2.2 5.3', 'M19.5 4.5V11H13'],
  bell: ['M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 21h4'],
  tab: ['M3.5 5.5h17v13h-17z', 'M3.5 9.5h17'],
  chevron: ['M9 5l7 7-7 7'],
};

export function icon(name, size) {
  const parts = ICONS[name] || [];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size || 20));
  svg.setAttribute('height', String(size || 20));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'wpk-ico wpk-ico-' + name);
  for (const p of parts) {
    const path = document.createElementNS(NS, 'path');
    const spec = typeof p === 'string' ? { d: p } : p;
    path.setAttribute('d', spec.d);
    if (spec.t) path.setAttribute('transform', spec.t);
    if (spec.w) path.setAttribute('stroke-width', String(spec.w));
    svg.appendChild(path);
  }
  return svg;
}

/** Dibujo del aviso del navegador: ventana con el mensaje arriba a la izquierda y una flecha que lo señala. */
export function permissionArt(t) {
  const s = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, String(attrs[k]));
    if (text) n.textContent = text;
    return n;
  };
  const svg = s('svg', { viewBox: '0 0 320 176', width: '100%', role: 'img', 'aria-label': t('fu.art'), class: 'wpk-art' });
  svg.appendChild(s('rect', { x: 4, y: 4, width: 312, height: 168, rx: 10, class: 'wpk-art-win' }));
  svg.appendChild(s('path', { d: 'M4 34h312', class: 'wpk-art-line' }));
  svg.appendChild(s('circle', { cx: 20, cy: 19, r: 4, class: 'wpk-art-dot' }));
  svg.appendChild(s('circle', { cx: 34, cy: 19, r: 4, class: 'wpk-art-dot' }));
  svg.appendChild(s('rect', { x: 92, y: 10, width: 200, height: 18, rx: 9, class: 'wpk-art-bar' }));
  svg.appendChild(s('rect', { x: 14, y: 44, width: 176, height: 70, rx: 8, class: 'wpk-art-pop' }));
  svg.appendChild(s('path', { d: 'M28 62a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z M24 67a8 8 0 0 0 16 0 M32 75v4', class: 'wpk-art-mic' }));
  svg.appendChild(s('text', { x: 48, y: 69, class: 'wpk-art-txt' }, t('art.ask')));
  svg.appendChild(s('rect', { x: 26, y: 88, width: 70, height: 18, rx: 5, class: 'wpk-art-yes' }));
  svg.appendChild(s('text', { x: 61, y: 100.5, 'text-anchor': 'middle', class: 'wpk-art-yes-t' }, t('art.allow')));
  svg.appendChild(s('rect', { x: 104, y: 88, width: 70, height: 18, rx: 5, class: 'wpk-art-no' }));
  svg.appendChild(s('text', { x: 139, y: 100.5, 'text-anchor': 'middle', class: 'wpk-art-no-t' }, t('art.block')));
  svg.appendChild(s('path', { d: 'M252 142C240 120 224 98 198 80 M198 80l5.3 10.7 M198 80l11.9 .7', class: 'wpk-art-arrow' }));
  return svg;
}
