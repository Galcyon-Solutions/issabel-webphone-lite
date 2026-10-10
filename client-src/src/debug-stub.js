// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// Sustituto del paquete "debug" que JsSIP usa para su traza interna. El cliente SIEMPRE apaga esa traza (puede incluir
// cabeceras de autenticacion) y ofrece la suya, ya enmascarada, con la opcion debug. Un registrador que no hace nada
// da el mismo resultado y ahorra unos 10 KB del bundle (debug y ms ya no viajan). vite.config.js lo aplica con un alias.
// JsSIP lo usa de dos formas: como funcion (require('debug')('JsSIP'), debug.default(nombre)) y como objeto con
// enable/disable. Por eso hay exportaciones con nombre ademas de la exportacion por defecto.
export function enable() { /* la traza de JsSIP no se puede encender */ }
export function disable() { return ''; }
export function enabled() { return false; }

function createDebug() {
  const log = function () { /* sin traza */ };
  log.log = function () { /* JsSIP asigna aqui su salida; no se usa */ };
  log.enabled = false;
  return log;
}
createDebug.enable = enable;
createDebug.disable = disable;
createDebug.enabled = enabled;
createDebug.default = createDebug;
export default createDebug;
