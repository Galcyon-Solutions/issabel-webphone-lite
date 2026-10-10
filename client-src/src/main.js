// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// API global window.WebphoneKit. La barra solo se dibuja si el endpoint de configuracion responde 200; en cualquier
// otro caso queda inactiva y silenciosa (sin WebSocket, sin DOM visible) y emite el evento "inactive".
import { Phone } from './phone.js';
import { Bar } from './ui.js';
import { onboarded } from './help.js';
import { makeT, pickLang } from './i18n.js';

const VERSION = '0.5.0';
const DEFAULT_CONFIG_URL = '/modules/webphone_kit/api/config.php';

const listeners = new Map();   // evento -> Set de funciones ('*' recibe todos: fn(nombre, datos))
let inst = null;               // { phone, bar, opts, host, t, recheckTimer }

function emit(name, data) {
  for (const key of [name, '*']) {
    const set = listeners.get(key);
    if (!set) continue;
    for (const fn of [...set]) {
      try { if (key === '*') fn(name, data); else fn(data); } catch (e) { /* un oyente roto no frena al resto */ }
    }
  }
}

function connect() {
  const { opts, host } = inst;
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  const phone = new Phone(opts, (name, data) => {
    if (!inst || inst.phone !== phone) return;
    if (name === 'status' && !inst.bar && data.status !== 'loading' && data.status !== 'inactive') {
      inst.bar = new Bar(host, phone, inst.t, { lang: opts.lang, reconnect });
      if (opts.theme) inst.bar.setTheme(opts.theme);
    }
    if (inst.bar) {
      if (inst.bar.phone !== phone) inst.bar.setPhone(phone);
      inst.bar.onEvent(name, data);
    }
    emit(name, data);
  }, audio);
  inst.phone = phone;
  phone.start();
}

/** "Reintentar" de la barra: primero comprueba la sesion de Issabel; si sigue valida, vuelve a conectar desde cero. */
async function reconnect() {
  if (!inst || !inst.phone) return false;
  const me = inst;
  const res = await me.phone.probeSession();
  if (inst !== me) return false;
  if (res === 'session') {
    const data = { code: 'session' };
    if (me.bar) me.bar.onEvent('error', data);
    emit('error', data);
    return false;
  }
  me.phone.destroy();
  connect();
  return true;
}

function scheduleRecheck() {
  if (!inst || !inst.opts.inactiveRecheckMs) return;
  const me = inst;
  me.recheckTimer = window.setTimeout(() => {
    if (inst !== me || !me.phone || me.phone.status !== 'inactive') return;
    me.phone.destroy();
    connect();
    scheduleRecheck();
  }, me.opts.inactiveRecheckMs);
}

const WebphoneKit = {
  version: VERSION,

  /** Monta la barra dentro de `el`. opciones: lang, configUrl, debug, autoAnswer(info)=>boolean, inactiveRecheckMs, echoNumber. */
  mount(el, options) {
    if (!(el instanceof HTMLElement)) throw new TypeError('WebphoneKit.mount: se esperaba un elemento HTML');
    WebphoneKit.destroy();
    const o = options || {};
    const opts = {
      version: VERSION,
      lang: pickLang(o.lang),
      configUrl: typeof o.configUrl === 'string' && o.configUrl.startsWith('/') ? o.configUrl : DEFAULT_CONFIG_URL,
      debug: !!o.debug,
      // Los temas de Issabel son claros: la barra es clara salvo que se pida 'dark' o 'auto' (seguir al sistema operativo)
      theme: o.theme === 'dark' ? 'dark' : (o.theme === 'auto' ? '' : 'light'),
      autoAnswer: typeof o.autoAnswer === 'function' ? o.autoAnswer : null,
      inactiveRecheckMs: Number(o.inactiveRecheckMs) > 0 ? Math.max(Number(o.inactiveRecheckMs), 30000) : 0,
      echoNumber: typeof o.echoNumber === 'string' && /^[0-9+*#]{1,32}$/.test(o.echoNumber) ? o.echoNumber : '',
    };
    inst = { phone: null, bar: null, opts, host: el, t: makeT(opts.lang), recheckTimer: null };
    connect();
    scheduleRecheck();
    return WebphoneKit;
  },

  /** Suscribe a un evento (o a '*'). Devuelve la funcion para cancelar. */
  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('WebphoneKit.on: se esperaba una funcion');
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => WebphoneKit.off(name, fn);
  },
  off(name, fn) { const s = listeners.get(name); if (s) s.delete(fn); },

  call(number) { return inst && inst.phone ? inst.phone.call_(number) : Promise.resolve(false); },
  answer() { return inst && inst.phone ? inst.phone.answer() : Promise.resolve(false); },
  hangup() { return !!(inst && inst.phone && inst.phone.hangup()); },
  mute() { return !!(inst && inst.phone && inst.phone.mute()); },
  hold() { return !!(inst && inst.phone && inst.phone.hold()); },
  dtmf(d) { return !!(inst && inst.phone && inst.phone.dtmf(d)); },
  /** Bytes y paquetes de audio de la llamada actual (diagnostico). */
  mediaStats() { return inst && inst.phone ? inst.phone.mediaStats() : Promise.resolve(null); },
  transfer(number) { return !!(inst && inst.phone && inst.phone.transfer(number)); },

  /** Abre el cajon de ayuda: 'home' (inicio), 'test' (prueba de audio), 'nohear' o 'support'. */
  openHelp(section) {
    if (!inst || !inst.bar) return false;
    if (section === 'test') inst.bar.help.startTest();
    else inst.bar.help.open(section === 'nohear' ? 'nohear' : section === 'support' ? 'support' : 'home', section === 'nohear' ? { node: 'q1' } : {});
    return true;
  },

  /**
   * Etapa 4 (login de agente): abre una ventana en la que un INVITE entrante con el nombre "Agent/<n> Login" y el mismo
   * agente se contesta solo. Solo la abre quien conoce al agente (la consola del Call Center, mismo origen). Devuelve cancelar().
   */
  expectAgentLogin(o) { return inst && inst.phone ? inst.phone.expectAgentLogin(o) : function () {}; },

  cancelAgentLogin() { if (inst && inst.phone) inst.phone.cancelAgentLogin(); },

  /**
   * Vuelve a evaluar la sesion de Issabel (el envoltorio lo llama en cada carga del marco). Inactivo: consulta de nuevo
   * la configuracion y se activa si ya hay sesion. Activo: si la sesion terminó (403), desregistra y quita la barra.
   * Nunca toca una llamada en curso. Devuelve 'unmounted', 'busy', 'activating', 'deactivated' o 'unchanged'.
   */
  async recheck() {
    if (!inst) return 'unmounted';
    const me = inst;
    const p = me.phone;
    if (!p || p.status === 'loading') return 'unchanged';
    if (p.status === 'inactive') { p.destroy(); connect(); return 'activating'; }
    if (p.call) return 'busy';
    if (me.rechecking) return 'unchanged';
    me.rechecking = true;
    try {
      const res = await p.probeSession();
      if (inst !== me || me.phone !== p || p.call) return 'unchanged';
      if (res !== 'session') return 'unchanged';
      if (me.bar) { me.bar.destroy(); me.bar = null; }
      p.destroy();
      connect();
      return 'deactivated';
    } finally { me.rechecking = false; }
  },

  /** Datos publicos para la pagina anfitriona (sin secretos): extension del webphone, estado y sesion de agente. */
  info() {
    const p = inst && inst.phone;
    if (!p) return { version: VERSION, status: 'unmounted', extension: '', registered: false, follower: false, inCall: false, agentSession: null, agentLoginWindow: null, micReady: false };
    return {
      version: VERSION,
      status: p.status,
      extension: p._sipUser || '',
      registered: !!(p._ua && p._ua.isRegistered()),
      follower: p.status === 'follower',
      inCall: !!p.call,
      agentSession: p.call && p.call.agent ? { agent: p.call.agent } : null,
      agentLoginWindow: p._agentWindowInfo(),
      micReady: onboarded(),
    };
  },

  /** Estado actual sin secretos. */
  getState() { return inst && inst.phone ? inst.phone.getState() : { status: 'unmounted' }; },

  destroy() {
    if (!inst) return;
    const me = inst;
    inst = null;
    if (me.recheckTimer) window.clearTimeout(me.recheckTimer);
    if (me.phone) me.phone.destroy();
    if (me.bar) me.bar.destroy();
  },
};

window.WebphoneKit = WebphoneKit;
