// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// Entrada del bundle de la GALERIA de estados (testsite/gallery/webphone-gallery.js): el mismo cliente mas la vista previa
// sin central. El bundle de produccion (webphone.js) NO incluye la vista previa.
import './main.js';
import { createPreview } from './preview.js';

window.WebphoneKit.preview = function preview(el, options) {
  if (!(el instanceof HTMLElement)) throw new TypeError('WebphoneKit.preview: se esperaba un elemento HTML');
  return createPreview(el, options);
};
