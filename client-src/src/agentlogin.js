// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// Regla pura (sin DOM ni red) que decide si una llamada entrante es el login de un agente del Call Center y se contesta
// sola. El dialer origina el login con el nombre visible "Agent/<n> Login" y no agrega ninguna cabecera SIP, asi que la
// regla exige TRES cosas a la vez: una ventana abierta por la consola (expectAgentLogin) que aun no vencio, el nombre
// exacto con el mismo numero de agente de la ventana, y que la llamada sea entrante. Cualquier otra llamada suena normal.

export const AGENT_NAME_RE = /^Agent\/(\d+) Login$/;

/** "8000" o "Agent/8000" -> "8000"; cualquier otra cosa -> "" (una ventana sin agente valido nunca contesta). */
export function normalizeAgent(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const m = /^(?:Agent\/)?(\d{1,10})$/.exec(s);
  return m ? m[1] : '';
}

/**
 * @param {{agent:string, until:number}|null} win  ventana abierta (o null)
 * @param {{direction:string, name:string}|null} call  llamada entrante recien creada
 * @param {number} now  Date.now()
 * @returns {{ok:boolean, agent:string, reason:string}}  reason: '' si ok; si no, por que NO se contesta
 */
export function agentLoginMatch(win, call, now) {
  const no = reason => ({ ok: false, agent: '', reason });
  if (!call || call.direction !== 'incoming') return no('not-incoming');
  if (!win) return no('no-window');
  if (!(win.until > now)) return no('expired');
  if (!win.agent) return no('no-agent');
  const m = AGENT_NAME_RE.exec(typeof call.name === 'string' ? call.name : '');
  if (!m) return no('name');
  if (m[1] !== win.agent) return no('other-agent');
  return { ok: true, agent: m[1], reason: '' };
}
