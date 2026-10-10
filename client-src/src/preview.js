// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// Vista previa de la interfaz SIN central: un telefono de mentira que solo cambia de estado dentro de la pagina. La usa la
// galeria de estados (testsite/gallery.html) para revisar la barra, los errores y la ayuda sin hacer llamadas. No abre
// WebSocket, no pide configuracion, no toca el microfono ni la red. WebphoneKit.preview(el, { lang, theme, layerHost }).
import { Bar } from './ui.js';
import { makeT, pickLang } from './i18n.js';

class FakePhone {
  constructor(emit) {
    this.emit = emit;
    this.status = 'registered';
    this.call = null;
    this.otherTab = null;
    this._sipUser = '7300';
    this._secret = 'CANARY-PREVIEW-SECRET-0123456789';   // nunca se dibuja: la galeria comprueba que no aparece en nada
    this.echoNumber = '*43';
    this.history = [{ t: Date.now() - 60000, kind: 'call-failed', code: '486' }];
    this.timers = [];
  }

  getState() { return { status: this.status, call: this.call }; }

  diagInfo() { return { status: this.status, sipUser: this._sipUser, wsUrl: '', iceServers: [], history: this.history.slice(), version: '0.5.0 (vista previa)' }; }

  _later(ms, fn) { this.timers.push(window.setTimeout(fn, ms)); }

  clear() { this.timers.forEach(t => window.clearTimeout(t)); this.timers = []; }

  make(o) {
    return Object.assign({ direction: 'outgoing', state: 'active', number: '7301', name: '', held: false, muted: false, startedAt: Date.now() - 83000, confirmed: true }, o);
  }

  _changed() { this.emit('callChange', this.call); }

  call_(number) {
    this.clear();
    this.call = this.make({ state: 'calling', number: String(number), confirmed: false, startedAt: null });
    this.emit('calling', { number: String(number) });
    this._changed();
    this._later(900, () => { if (this.call) { this.call.state = 'early'; this._changed(); } });
    this._later(2600, () => { if (this.call) { Object.assign(this.call, { state: 'active', confirmed: true, startedAt: Date.now() }); this._changed(); } });
    return Promise.resolve(true);
  }

  async answer() {
    if (!this.call) return false;
    Object.assign(this.call, { state: 'active', confirmed: true, startedAt: Date.now() });
    this._changed();
    return true;
  }

  hangup() {
    if (!this.call) return false;
    this.clear();
    this.call = null;
    this._changed();
    return true;
  }

  mute() {
    const c = this.call;
    if (!c || !c.confirmed) return false;
    c.muted = !c.muted;
    this.emit(c.muted ? 'mute' : 'unmute');
    this._changed();
    return true;
  }

  hold() {
    const c = this.call;
    if (!c || !c.confirmed) return false;
    c.held = !c.held;
    c.state = c.held ? 'held' : 'active';
    this.emit(c.held ? 'hold' : 'unhold');
    this._changed();
    return true;
  }

  dtmf() { return !!(this.call && this.call.confirmed); }

  transfer() { return !!(this.call && this.call.confirmed); }

  resumeAudio() { return Promise.resolve(true); }

  probeSession() { return Promise.resolve('ok'); }
}

const STATES = {
  connecting: p => { p.status = 'registering'; },
  ready: () => {},
  offline: p => { p.status = 'disconnected'; },
  dialing: p => { p.call = p.make({ state: 'calling', confirmed: false, startedAt: null }); },
  ringing: p => { p.call = p.make({ state: 'early', confirmed: false, startedAt: null }); },
  reconnecting: p => { p.status = 'registering'; },
  oncall: p => { p.call = p.make({ name: 'Carlos Ramírez' }); },
  hold: p => { p.call = p.make({ name: 'Carlos Ramírez', held: true, state: 'held' }); },
  muted: p => { p.call = p.make({ name: 'Carlos Ramírez', muted: true }); },
  agent: p => { p.call = p.make({ direction: 'incoming', number: 'asterisk', name: 'Agent/8000 Login', agent: '8000' }); },
  'agent-joining': p => { p.call = p.make({ direction: 'incoming', state: 'ringing', name: 'Agent/8000 Login', agent: '8000', confirmed: false, startedAt: null }); },
  other: p => { p.status = 'follower'; p.otherTab = { status: 'registered', call: null }; },
  incoming: p => { p.call = p.make({ direction: 'incoming', state: 'ringing', name: 'María Fernández', confirmed: false, startedAt: null }); },
  'incoming-number': p => { p.call = p.make({ direction: 'incoming', state: 'ringing', number: '7301', confirmed: false, startedAt: null }); },
  'incoming-xss': p => { p.call = p.make({ direction: 'incoming', state: 'ringing', name: '<img src=x onerror=alert(1)>', number: '<script>alert(2)</script>', confirmed: false, startedAt: null }); },
};

/** Estados que solo muestran un aviso de error de la tabla (en la barra en reposo). */
const NOTICES = ['ws', 'auth', 'session', 'nomic', 'micdenied', 'micbusy', 'silent', 'audio', 'busy', 'rejected', 'notfound', 'unavail', 'ice', 'timeout', 'invalid', 'keepopen'];
/** Vistas del cajon de ayuda. */
const HELP = { help: ['home'], nohear: ['nohear', { node: 'q1' }], 'nohear-end': ['nohear', { node: 'actMic' }], support: ['support'], denied: ['denied'], miss: ['miss', { kind: 'nomic' }], s1: ['s1'], s2: ['s2'], s3: ['s3'], done: ['done'], failed: ['failed', {}] };

export function createPreview(el, o) {
  const opts = o || {};
  const lang = pickLang(opts.lang);
  const t = makeT(lang);
  const holder = { bar: null };
  const phone = new FakePhone((name, data) => { if (holder.bar) holder.bar.onEvent(name, data); });
  const bar = new Bar(el, phone, t, { lang, preview: true, layerHost: opts.layerHost, reconnect: () => Promise.resolve(true) });
  holder.bar = bar;
  if (opts.theme) bar.setTheme(opts.theme);
  bar.wasReady = true;
  bar.onEvent('status', { status: 'registered' });

  const ctl = {
    bar,
    phone,
    states: Object.keys(STATES).concat(NOTICES.map(n => 'err-' + n), ['micissue', 'firstuse'], Object.keys(HELP)),
    setTheme(v) { bar.setTheme(v); },
    /** Lleva la barra y el cajon al estado pedido (sin llamadas reales). */
    setState(name) {
      phone.clear();
      bar.help.close();
      bar.clearNotice();
      bar.setMicIssue(null);
      bar.keypadOpen = false;
      bar.xferOpen = false;
      phone.call = null;
      phone.otherTab = null;
      phone.status = 'registered';
      bar.wasReady = name !== 'connecting' && name !== 'offline';
      if (STATES[name]) STATES[name](phone);
      if (name === 'err-ws') phone.status = 'disconnected';
      if (name === 'err-auth') phone.status = 'error';
      bar.onEvent('status', { status: phone.status });
      bar.onEvent('callChange', phone.call);
      if (name === 'micissue') bar.setMicIssue('nomic');
      else if (name === 'firstuse') bar.help.openFirstUse('7301', bar.input);
      else if (name.indexOf('err-') === 0) bar.showNotice(name.slice(4));
      else if (HELP[name]) bar.help.open(HELP[name][0], HELP[name][1] || {}, bar.helpBtn);
      bar.render();
    },
    destroy() { phone.clear(); bar.destroy(); },
  };
  return ctl;
}
