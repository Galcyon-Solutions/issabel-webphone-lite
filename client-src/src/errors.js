// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Tabla de errores en lenguaje humano: cada situacion tiene UN mensaje y UNA o DOS acciones concretas. Aqui no sale
// nunca un nombre de protocolo: los codigos tecnicos solo viven en el informe plegado de soporte (diag.js).
// Acciones: retry (reintentar lo ultimo), reconnect, copy, home, again, howto, fix, testaudio, sound.
const T = {
  ws: { msg: 'err.ws', act: ['reconnect', 'copy'], sticky: true },
  auth: { msg: 'err.auth', act: ['copy'], sticky: true },
  session: { msg: 'err.session', act: ['home'], sticky: true },
  nomic: { msg: 'err.nomic', act: ['again'] },
  micdenied: { msg: 'err.micdenied', act: ['howto'] },
  micbusy: { msg: 'err.micbusy', act: ['again'] },
  micfail: { msg: 'err.micfail', act: ['again'] },
  silent: { msg: 'err.silent', act: ['testaudio'] },
  audio: { msg: 'err.audio', act: ['sound'] },
  busy: { msg: 'err.busy', act: ['retry'] },
  rejected: { msg: 'err.rejected', act: ['retry'] },
  notfound: { msg: 'err.notfound', act: ['fix'] },
  unavail: { msg: 'err.unavail', act: ['retry'] },
  ice: { msg: 'err.ice', act: ['retry'] },
  timeout: { msg: 'err.timeout', act: ['retry'] },
  invalid: { msg: 'err.invalid', act: ['fix'] },
  notready: { msg: 'err.notready', act: [] },
  incall: { msg: 'err.incall', act: [] },
  keepopen: { msg: 'agent.keepOpen', act: [], ttl: 10000 },
  config: { msg: 'err.config', act: ['reconnect', 'copy'], sticky: true },
  fallback: { msg: 'err.default', act: ['retry'] },
};

const END_BY_CODE = { 486: 'busy', 600: 'busy', 603: 'rejected', 480: 'unavail', 503: 'unavail', 404: 'notfound', 604: 'notfound', 408: 'timeout', 487: null };
const END_BY_CAUSE = { Busy: 'busy', Rejected: 'rejected', Unavailable: 'unavail', 'Not Found': 'notfound', 'Request Timeout': 'timeout', 'RTP Timeout': 'ice', Canceled: null, 'No Answer': 'timeout' };

/** Evento "failed" de una llamada (causa y codigo del servidor) -> clave de la tabla, o null si no hay nada que avisar. */
export function endKind(cause, code) {
  if (code && Object.prototype.hasOwnProperty.call(END_BY_CODE, code)) return END_BY_CODE[code];
  if (cause && Object.prototype.hasOwnProperty.call(END_BY_CAUSE, cause)) return END_BY_CAUSE[cause];
  return 'fallback';
}

/** Evento "error" del nucleo -> clave de la tabla. */
export function errorKind(data) {
  switch (data && data.code) {
    case 'register': return [401, 403].includes(data.status) ? 'auth' : 'ws';
    case 'mic': {
      const r = data.reason || '';
      if (r === 'NotFoundError' || r === 'DevicesNotFoundError' || r === 'OverconstrainedError') return 'nomic';
      if (r === 'NotAllowedError' || r === 'SecurityError' || r === 'PermissionDeniedError') return 'micdenied';
      if (r === 'NotReadableError' || r === 'TrackStartError' || r === 'AbortError') return 'micbusy';
      return 'micfail';
    }
    case 'invalidNumber': return 'invalid';
    case 'notRegistered': return 'notready';
    case 'busy': return 'incall';
    case 'audio': return 'audio';
    case 'ice': return 'ice';
    case 'silentMic': return 'silent';
    case 'session': return 'session';
    case 'config': return 'config';
    case 'ws': return 'ws';
    default: return 'fallback';
  }
}

export function describe(kind) { return T[kind] || T.fallback; }
