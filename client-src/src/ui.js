// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// Barra horizontal de altura fija (48 px; 56 px en movil; 72 px con una llamada entrante). Se monta en el contenedor
// que da la pagina anfitriona y nunca flota. Todo texto que viene del servidor o de la señalizacion (numero, nombre)
// entra por textContent: jamas se interpreta como HTML.
import './style.css';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { Help, onboarded } from './help.js';
import { Attention } from './attention.js';
import { describe, errorKind, endKind } from './errors.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const SHORT = { answer: ['KeyA', 'Alt+Shift+A'], hangup: ['KeyH', 'Alt+Shift+H'], mute: ['KeyM', 'Alt+Shift+M'] };
const OFFLINE_NOTICE_MS = 5000;
const END_NOTICE_MS = 20000;
const TOAST_MS = 3000;
const HIDDEN_WARN_MS = 10000;      // agente conectado y pestaña oculta mas de 10 s: al volver se le recuerda
const BEAT_MS = 5000;              // latido: si los temporizadores se pausaron (pestaña dormida, equipo suspendido) se nota
const BEAT_GAP_MS = 25000;

function initials(name) {
  const letters = String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => Array.from(w)[0]);
  const s = letters.join('').toUpperCase();
  return /^[\p{L}\p{N}]+$/u.test(s) ? s : '';
}

export class Bar {
  /**
   * @param {HTMLElement} host  contenedor que da la pagina anfitriona
   * @param {object} phone      nucleo (Phone)
   * @param {(k:string, p?:object)=>string} t  traductor
   * @param {{lang:string, reconnect:()=>Promise<any>}} env
   */
  constructor(host, phone, t, env) {
    this.host = host;
    this.phone = phone;
    this.t = t;
    this.lang = env.lang;
    this.env = env;
    this.keypadOpen = false;
    this.xferOpen = false;
    this.wasReady = false;
    this.micIssue = null;
    this.notice = null;
    this.noticeTimer = null;
    this.offTimer = null;
    this.toastTimer = null;
    this.tick = null;
    this.lastNumber = '';
    this.ringing = false;
    this.hadCall = false;
    this.attention = new Attention();
    this.help = new Help(this);
    this._hiddenAt = 0;
    this._titleSwap = null;
    this._beatAt = Date.now();
    this._build();
    // Sesion de agente: el dialer la cierra si el navegador deja de contestar. Se avisa cuando la pestaña queda oculta o dormida.
    this._onVis = () => this._visibility();
    document.addEventListener('visibilitychange', this._onVis);
    this._beat = window.setInterval(() => this._heartbeat(), BEAT_MS);
  }

  // ------------------------------------------------------------------ construccion
  _ctl(cls, key, ico, shortcut) {
    const b = h('button', { type: 'button', class: 'wpk-btn wpk-ctl ' + cls });
    b.dataset.key = key;
    b.dataset.ico = ico;
    if (shortcut) b.setAttribute('aria-keyshortcuts', SHORT[shortcut][1]);
    b.dataset.sc = shortcut || '';
    return b;
  }

  _build() {
    const t = this.t;
    const root = h('div', { class: 'wpk-bar wpk-scope', role: 'region', 'aria-label': t('bar') });
    this.root = root;

    this.stateIcon = h('span', { class: 'wpk-state-icon', 'aria-hidden': 'true' });
    this.statusEl = h('span', { class: 'wpk-status', role: 'status', 'aria-live': 'polite' });
    this.extEl = h('span', { class: 'wpk-ext' });
    const left = h('div', { class: 'wpk-left' }, this.stateIcon, this.statusEl, this.extEl);

    // Marcador (en reposo): campo con placeholder claro, Enter llama
    this.input = h('input', { class: 'wpk-input', type: 'text', inputmode: 'tel', autocomplete: 'off', spellcheck: 'false', maxlength: '32' });
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this._submit(); } });
    this.callBtn = this._ctl('wpk-call', 'dial.call', 'phone');
    this.callBtn.addEventListener('click', () => this._submit());
    this.dialBox = h('div', { class: 'wpk-dial' }, this.input, this.callBtn);

    // Llamada: quien es y cuanto lleva
    this.avatar = h('span', { class: 'wpk-avatar', 'aria-hidden': 'true' });
    this.peerLabel = h('span', { class: 'wpk-peer-label' });
    this.peerName = h('span', { class: 'wpk-peer-name' });
    this.peerNum = h('span', { class: 'wpk-peer-num' });
    this.timerEl = h('span', { class: 'wpk-timer', role: 'timer' });
    this.peerSubWord = h('span');
    this.peerSubTime = h('span');
    this.peerSub = h('span', { class: 'wpk-peer-sub', 'aria-hidden': 'true' }, this.peerSubWord, this.peerSubTime);
    this.peerBox = h('div', { class: 'wpk-peer' }, this.avatar,
      h('div', { class: 'wpk-peer-text' }, this.peerLabel, h('div', { class: 'wpk-peer-line' }, this.peerName, this.peerNum, this.timerEl), this.peerSub));

    // Aviso (errores en lenguaje humano) en lugar del centro
    this.noticeBox = h('div', { class: 'wpk-notice', role: 'alert', hidden: true });
    this.followerEl = h('span', { class: 'wpk-follower' });
    const center = h('div', { class: 'wpk-center' }, this.dialBox, this.peerBox, this.noticeBox, this.followerEl);

    // Controles (derecha). Orden de tabulacion = orden visual. Colgar siempre es el ultimo.
    this.answerBtn = this._ctl('wpk-answer', 'call.answer', 'phone', 'answer');
    this.rejectBtn = this._ctl('wpk-hangup wpk-reject', 'call.reject', 'hangup', 'hangup');
    this.muteBtn = this._ctl('wpk-toggle', 'call.mute', 'mic', 'mute');
    this.holdBtn = this._ctl('wpk-toggle', 'call.hold', 'pause');
    this.keypadBtn = this._ctl('wpk-toggle wpk-keypad-toggle', 'dial.open', 'keypad');
    this.hangBtn = this._ctl('wpk-hangup', 'call.hangup', 'hangup', 'hangup');
    this.helpBtn = this._ctl('wpk-help', 'help.open', 'help');
    this.answerBtn.addEventListener('click', () => this.phone.answer());
    this.rejectBtn.addEventListener('click', () => this.phone.hangup());
    this.hangBtn.addEventListener('click', () => this.phone.hangup());
    this.muteBtn.addEventListener('click', () => this.phone.mute());
    this.holdBtn.addEventListener('click', () => this.phone.hold());
    this.keypadBtn.addEventListener('click', () => { this.keypadOpen = !this.keypadOpen; this.render(); });
    this.helpBtn.addEventListener('click', () => this.help.open('home', {}, this.helpBtn));
    this.ctrl = h('div', { class: 'wpk-actions wpk-ctrl' }, this.answerBtn, this.muteBtn, this.holdBtn, this.keypadBtn, this.helpBtn, this.rejectBtn, this.hangBtn);

    // Teclado numerico (a peticion, anclado bajo la barra) con la transferencia ciega
    this.pad = h('div', { class: 'wpk-pad', role: 'group', id: 'wpk-pad-' + Math.random().toString(36).slice(2, 7) });
    const grid = h('div', { class: 'wpk-pad-grid' });
    for (const k of KEYS) {
      const b = h('button', { type: 'button', class: 'wpk-key', text: k });
      b.dataset.digit = k;
      b.addEventListener('click', () => this._digit(k));
      grid.append(b);
    }
    this.xferInput = h('input', { class: 'wpk-input', type: 'text', inputmode: 'tel', autocomplete: 'off', spellcheck: 'false', maxlength: '32' });
    this.xferGo = this._ctl('wpk-call', 'call.transferGo', 'phone');
    this.xferInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this._xfer(); } });
    this.xferGo.addEventListener('click', () => this._xfer());
    this.xferToggle = h('button', { type: 'button', class: 'wpk-btn wpk-btn-ghost wpk-xfer-toggle' });
    this.xferToggle.dataset.key = 'call.transfer';
    this.xferToggle.addEventListener('click', () => { this.xferOpen = !this.xferOpen; this.render(); if (this.xferOpen) this.xferInput.focus(); });
    this.xferBox = h('div', { class: 'wpk-xfer' }, this.xferInput, this.xferGo);
    this.pad.append(grid, this.xferToggle, this.xferBox);
    this.keypadBtn.setAttribute('aria-controls', this.pad.id);

    this.toastEl = h('div', { class: 'wpk-toast', role: 'status', hidden: true });
    this.srAlert = h('div', { class: 'wpk-sr', 'aria-live': 'assertive', 'aria-atomic': 'true' });

    root.append(left, center, this.ctrl, this.pad, this.toastEl, this.srAlert);
    root.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (this.xferOpen) { this.xferOpen = false; this.render(); }
      else if (this.keypadOpen) { this.keypadOpen = false; this.render(); this.keypadBtn.focus(); e.preventDefault(); }
    });

    this._onDocKey = e => this._shortcut(e);
    this._onDocDown = e => {
      if (this.keypadOpen && !this.pad.contains(e.target) && !this.keypadBtn.contains(e.target)) { this.keypadOpen = false; this.render(); }
    };
    document.addEventListener('keydown', this._onDocKey);
    document.addEventListener('pointerdown', this._onDocDown);
    this.host.appendChild(root);

    // Tamaño por el ancho real de la barra (no de la ventana): sirve igual en un contenedor angosto y con zoom.
    this._size = '';
    this._fit = () => {
      const w = root.getBoundingClientRect().width;
      const s = w && w < 560 ? 'narrow' : w < 900 ? 'mid' : 'wide';
      if (s !== this._size) {
        this._size = s;
        root.dataset.size = s;
        this.input.setAttribute('placeholder', t(s === 'narrow' ? 'dial.short' : 'dial.placeholder'));
      }
    };
    if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(this._fit); this._ro.observe(root); }
    this.input.setAttribute('aria-label', t('dial.label'));
    this.xferInput.setAttribute('aria-label', t('call.transferTo'));
    this.xferInput.setAttribute('placeholder', t('call.transferTo'));
    this.pad.setAttribute('aria-label', t('call.keypadLabel'));
    this._fit();
    this.render();
  }

  // ------------------------------------------------------------------ sesion de agente (etapa 4)
  _agentLive() {
    const c = this.phone && this.phone.call;
    return !!(c && c.agent && c.confirmed);
  }

  /** Pestaña oculta con el agente conectado: el titulo de la pestaña lo recuerda; al volver se muestra el aviso. */
  _visibility() {
    if (document.hidden) {
      if (this._agentLive()) {
        this._hiddenAt = Date.now();
        const text = this.t('agent.keepOpen');
        if (document.title !== text && !this.ringing) { this._titleSwap = { orig: document.title, text }; document.title = text; }
      }
      return;
    }
    if (this._titleSwap) {
      if (document.title === this._titleSwap.text) document.title = this._titleSwap.orig;   // si el marco ya puso otro titulo, se respeta
      this._titleSwap = null;
    }
    const away = this._hiddenAt ? Date.now() - this._hiddenAt : 0;
    this._hiddenAt = 0;
    if (away >= HIDDEN_WARN_MS && this._agentLive()) this.showNotice('keepopen');
  }

  _heartbeat() {
    const now = Date.now();
    const gap = now - this._beatAt;
    this._beatAt = now;
    if (gap > BEAT_GAP_MS && this._agentLive()) this.showNotice('keepopen');
  }

  // ------------------------------------------------------------------ acciones de la persona
  _submit() {
    const v = this.input.value;
    if (!v.trim()) { this.input.focus(); return; }
    if (!onboarded()) { const a = document.activeElement; this.help.openFirstUse(v, a && this.root.contains(a) ? a : this.input); return; }
    this._dial(v);
  }

  _dial(v) {
    this.lastNumber = v;
    this.clearNotice();
    return this.phone.call_(v).then(ok => { if (ok && this.input.value === v) this.input.value = ''; return ok; });
  }

  /** La ayuda ya cerro: si la persona queria llamar y completo la prueba, deja el numero listo en el campo. */
  afterHelp(pending) {
    if (pending && onboarded() && !this.phone.call) { this.input.value = pending; this.input.focus(); }
  }

  callNow(number) { return this._dial(number); }

  _xfer() {
    if (this.phone.transfer(this.xferInput.value)) { this.xferInput.value = ''; this.xferOpen = false; this.keypadOpen = false; this.render(); }
  }

  _digit(k) {
    if (this.phone.call && this.phone.call.confirmed) this.phone.dtmf(k);
    else if (!this.phone.call) { this.input.value += k; this.input.focus(); }
  }

  /** Atajos con aviso (tooltip, aria-keyshortcuts y la lista de la ayuda). Alt+Mayus+letra: no chocan con Issabel ni con el navegador. */
  _shortcut(e) {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.defaultPrevented || this.help.isOpen) return;
    const c = this.phone.call;
    if (!c) return;
    const ringing = c.direction === 'incoming' && c.state === 'ringing';
    if (e.code === SHORT.answer[0] && ringing) { e.preventDefault(); this.phone.answer(); }
    else if (e.code === SHORT.hangup[0]) { e.preventDefault(); this.phone.hangup(); }
    else if (e.code === SHORT.mute[0] && c.confirmed) { e.preventDefault(); this.phone.mute(); }
  }

  // ------------------------------------------------------------------ eventos del telefono
  onEvent(name, data) {
    if (name === 'status') this._onStatus(data);
    if (name === 'status' || name === 'callChange') this.render();
    if (name === 'error' && data) this.onError(data);
    if (name === 'failed' && data) this.onFailed(data);
    if (name === 'calling' && data) { this.lastNumber = data.number || this.lastNumber; if (this.notice && !this.notice.sticky) this.clearNotice(); }
    if (name === 'mute') this.toast(this.t('toast.muted'));
    if (name === 'unmute') this.toast(this.t('toast.unmuted'));
    if (name === 'hold') this.toast(this.t('toast.held'));
    if (name === 'unhold') this.toast(this.t('toast.resumed'));
    if (name === 'ended') this.toast(this.t(data && data.agent ? 'toast.agentEnded' : 'toast.ended'));
    if (name === 'agentSession' && data && data.open) this.toast(this.t('toast.agentOn'));
    this.help.onPhoneEvent(name, data);
  }

  _onStatus(d) {
    const st = d && d.status;
    if (st === 'registered') {
      if (this.offTimer) { window.clearTimeout(this.offTimer); this.offTimer = null; }
      if (this.notice && ['ws', 'auth', 'config'].includes(this.notice.kind)) this.clearNotice();
      if (this.wasReady && this.reconnecting) this.toast(this.t('toast.ready'));
      this.wasReady = true;
      this.reconnecting = false;
    } else if (st === 'disconnected' || st === 'error' || st === 'registering') {
      if (this.wasReady) this.reconnecting = true;
    }
    if ((st === 'disconnected' || st === 'error') && !this.offTimer && !this.notice) {
      this.offTimer = window.setTimeout(() => {
        this.offTimer = null;
        const s = this.phone.status;
        if ((s === 'disconnected' || s === 'error') && !this.notice) this.showNotice('ws');
      }, OFFLINE_NOTICE_MS);
    }
  }

  onError(data) {
    if (this.help.isOpen && ['mic', 'audio', 'silentMic'].includes(data.code) && this.help.view !== 'home') return;
    const kind = errorKind(data);
    if (data.code === 'mic' && kind === 'nomic') this.setMicIssue('nomic');
    this.showNotice(kind);
  }

  onFailed(data) {
    if (this.help.isOpen && this.help.view === 's3') return;     // la prueba de eco lo explica ella misma
    if (data.local) return;                                       // la persona misma colgo o rechazo: no hay nada que explicar
    const kind = endKind(data.cause, data.code);
    if (kind) this.showNotice(kind);
  }

  setMicIssue(v) {
    if (this.micIssue === v) return;
    this.micIssue = v;
    if (!v && this.notice && ['nomic', 'micbusy', 'micfail', 'micdenied'].includes(this.notice.kind)) this.clearNotice();
    this.render();
  }

  // ------------------------------------------------------------------ avisos y toast
  showNotice(kind) {
    const d = describe(kind);
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer);
    this.notice = { kind, sticky: !!d.sticky };
    this.noticeTimer = d.sticky ? null : window.setTimeout(() => this.clearNotice(), d.ttl || END_NOTICE_MS);
    this.render();
  }

  clearNotice() {
    if (!this.notice) return;
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.notice = null;
    this.render();
  }

  toast(msg) {
    if (this.help.isOpen) return;      // con el cajon abierto el aviso quedaria bajo el fondo oscuro: el cajon da su propia respuesta
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    this.toastEl.classList.remove('wpk-toast-in');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('wpk-toast-in');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toastEl.hidden = true; this.toastEl.textContent = ''; }, TOAST_MS);
  }

  _renderNotice(visible) {
    const n = visible ? this.notice : null;
    if (n === this._noticeDrawn) return;     // sin cambios: no se reconstruye (conserva el foco del boton)
    this._noticeDrawn = n;
    clear(this.noticeBox);
    this.noticeBox.hidden = !n;
    if (!n) return;
    const t = this.t;
    const d = describe(n.kind);
    this.noticeBox.dataset.kind = n.kind;
    this.noticeBox.append(icon('alert', 18), h('span', { class: 'wpk-error', text: t(d.msg) }));
    const acts = h('span', { class: 'wpk-notice-acts' });
    for (const a of d.act) {
      if (a === 'home') acts.append(h('a', { class: 'wpk-btn wpk-btn-secondary wpk-sm', href: '/', 'data-act': 'home', text: t('act.home') }));
      else acts.append(h('button', { type: 'button', class: 'wpk-btn wpk-btn-secondary wpk-sm', 'data-act': a, onclick: () => this._act(a), text: t('act.' + ({ retry: 'retry', reconnect: 'retry', copy: 'copy', again: 'again', howto: 'howto', fix: 'fix', testaudio: 'testaudio', sound: 'sound' })[a]) }));
    }
    acts.append(h('button', { type: 'button', class: 'wpk-iconbtn wpk-notice-x', 'aria-label': t('dismiss'), title: t('dismiss'), onclick: () => this.clearNotice() }, icon('close', 18)));
    this.noticeBox.append(acts);
  }

  async _act(a) {
    if (a === 'retry') { const n = this.lastNumber; this.clearNotice(); if (n) this._dial(n); else this.input.focus(); }
    else if (a === 'reconnect') { this.clearNotice(); await this.env.reconnect(); }
    else if (a === 'copy') await this.help.copyReport();
    else if (a === 'again') await this._probeMic();
    else if (a === 'howto') this.help.open('denied');
    else if (a === 'fix') { this.clearNotice(); this.input.value = this.lastNumber || this.input.value; this.input.focus(); this.input.select(); }
    else if (a === 'testaudio') this.help.startTest();
    else if (a === 'sound') { if (await this.phone.resumeAudio()) { this.clearNotice(); this.toast(this.t('toast.sound')); } }
  }

  /** "Probar de nuevo" tras un problema de microfono: lo pide un instante y lo suelta. */
  async _probeMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(tr => tr.stop());
      this.setMicIssue(null);
      this.clearNotice();
    } catch (e) { this.onError({ code: 'mic', reason: e && e.name ? String(e.name) : 'Error' }); }
  }

  // ------------------------------------------------------------------ dibujo
  _derive() {
    const p = this.phone;
    const c = p.call;
    const st = p.status;
    if (st === 'follower') return { key: 'other', ico: 'tab', tone: 'info' };
    if (c) {
      if (c.agent && !c.confirmed) return { key: 'connecting', ico: 'spinner', tone: 'warn' };
      if (c.direction === 'incoming' && c.state === 'ringing') return { key: 'ringing', ico: 'phone', tone: 'ok' };
      if (c.state === 'calling') return { key: 'dialing', ico: 'phone', tone: 'info' };
      if (c.state === 'early') return { key: 'ringing', ico: 'phone', tone: 'info' };
      if (c.held) return { key: 'hold', ico: 'pause', tone: 'warn' };
      if (c.muted) return { key: 'muted', ico: 'micoff', tone: 'warn' };
      return c.agent ? { key: 'agent', ico: 'phone', tone: 'ok' } : { key: 'oncall', ico: 'phone', tone: 'ok' };
    }
    if (st === 'registered') return this.micIssue ? { key: 'nomic', ico: 'micoff', tone: 'bad' } : { key: 'ready', ico: 'check', tone: 'ok' };
    if (st === 'disconnected' || st === 'registering') return this.wasReady ? { key: 'reconnecting', ico: 'spinner', tone: 'warn' } : (st === 'disconnected' ? { key: 'offline', ico: 'offline', tone: 'bad' } : { key: 'connecting', ico: 'spinner', tone: 'warn' });
    if (st === 'error') return { key: 'offline', ico: 'offline', tone: 'bad' };
    return { key: 'connecting', ico: 'spinner', tone: 'warn' };
  }

  _setCtl(b, key, ico, pressed) {
    const t = this.t;
    let lbl = b.querySelector('.wpk-lbl');
    if (!lbl) { lbl = h('span', { class: 'wpk-lbl' }); b.append(lbl); }
    const text = t(key);
    if (b.dataset.shown !== key + '|' + ico) {
      b.dataset.shown = key + '|' + ico;
      const old = b.querySelector('svg');
      const fresh = icon(ico, 20);
      if (old) old.replaceWith(fresh); else b.prepend(fresh);
    }
    b.dataset.key = key;
    lbl.textContent = text;
    b.setAttribute('aria-label', text);
    const sc = b.dataset.sc;
    b.title = sc ? `${text} (${SHORT[sc][1]})` : text;
    if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }

  render() {
    const t = this.t;
    const p = this.phone;
    const c = p.call;
    const st = p.status;
    const follower = st === 'follower';
    const show = (n, v) => { n.hidden = !v; };
    const d = this._derive();
    const agent = !!c && !!c.agent;
    const ringing = !!c && c.direction === 'incoming' && c.state === 'ringing' && !follower && !agent;
    const inCall = !!c && !follower;
    const confirmed = !!c && c.confirmed;
    const registered = st === 'registered';
    const hasNotice = !!this.notice && !ringing;      // una llamada entrante siempre se ve: manda sobre cualquier aviso

    this.root.dataset.status = st;
    this.root.dataset.call = c ? c.state : 'idle';
    this.root.dataset.state = d.key;
    this.root.dataset.tone = d.tone;
    this.root.dataset.view = ringing ? 'incoming' : inCall ? 'call' : follower ? 'follower' : 'idle';
    this.root.toggleAttribute('data-notice', hasNotice);
    this.root.classList.toggle('wpk-ringing', ringing);

    clear(this.stateIcon);
    this.stateIcon.append(icon(d.ico, 16));
    this.statusEl.textContent = t('st.' + d.key);
    this.extEl.textContent = p._sipUser && !follower ? p._sipUser : '';
    show(this.extEl, !!this.extEl.textContent);
    this.followerEl.textContent = follower ? t(p.otherTab && p.otherTab.call ? 'follower.call' : 'follower.detail') : '';
    show(this.followerEl, follower && !hasNotice);

    this._renderNotice(hasNotice);
    show(this.dialBox, !follower && !c && !hasNotice);
    this.callBtn.disabled = !registered;
    this.input.disabled = !registered;
    this._setCtl(this.callBtn, 'dial.call', 'phone');

    show(this.peerBox, inCall && !hasNotice);
    if (c) {
      const label = ringing ? t('call.incoming') : '';
      this.peerLabel.textContent = label;
      show(this.peerLabel, !!label);
      this.peerName.textContent = agent ? t('agent.name', { n: c.agent }) : (c.name || '');
      show(this.peerName, agent || !!c.name);
      this.peerNum.textContent = agent ? (c.confirmed ? '' : t('agent.joining')) : (c.number || t('call.unknown'));
      const ini = initials(c.name);
      clear(this.avatar);
      if (ini) this.avatar.textContent = ini; else this.avatar.append(icon('phone', 22));
      show(this.avatar, ringing);
      this.peerSubWord.textContent = t('st.' + d.key);
    }

    // controles de la derecha
    const idle = !c && !follower;
    show(this.answerBtn, ringing);
    show(this.rejectBtn, ringing);
    show(this.muteBtn, inCall && !ringing && confirmed);
    show(this.holdBtn, inCall && !ringing && confirmed);
    const padOk = !follower && ((registered && !c) || (inCall && !ringing && confirmed));
    show(this.keypadBtn, padOk);
    show(this.hangBtn, inCall && !ringing);
    show(this.helpBtn, !c);
    this._setCtl(this.answerBtn, 'call.answer', 'phone');
    this._setCtl(this.rejectBtn, 'call.reject', 'hangup');
    this._setCtl(this.hangBtn, agent ? 'agent.leave' : 'call.hangup', 'hangup');
    this._setCtl(this.helpBtn, 'help.open', 'help');
    this._setCtl(this.muteBtn, c && c.muted ? 'call.unmute' : 'call.mute', c && c.muted ? 'micoff' : 'mic', !!(c && c.muted));
    this._setCtl(this.holdBtn, c && c.held ? 'call.unhold' : 'call.hold', c && c.held ? 'play' : 'pause', !!(c && c.held));
    if (!padOk) this.keypadOpen = false;
    this._setCtl(this.keypadBtn, inCall ? 'call.keypad' : 'dial.open', 'keypad', this.keypadOpen);
    this.keypadBtn.setAttribute('aria-expanded', this.keypadOpen ? 'true' : 'false');
    if (!inCall || !confirmed) this.xferOpen = false;
    show(this.pad, this.keypadOpen && padOk);
    show(this.xferToggle, inCall && confirmed);
    this.xferToggle.textContent = t('call.transfer');
    this.xferToggle.setAttribute('aria-expanded', this.xferOpen ? 'true' : 'false');
    show(this.xferBox, inCall && confirmed && this.xferOpen);
    this._setCtl(this.xferGo, 'call.transferGo', 'phone');

    if (c) this._tickStart(); else this._tickStop();
    this._attention(ringing, c);
    if (this.hadCall && !c && !hasNotice && registered && (document.activeElement === document.body || document.activeElement === null)) this.input.focus();
    this.hadCall = !!c;
  }

  /** Entrante: titulo de la pestaña que parpadea, aviso del sistema (si ya hay permiso) y lectura inmediata. */
  _attention(ringing, c) {
    if (ringing && !this.ringing) {
      if (this.notice && !this.notice.sticky) this.clearNotice();
      const who = c.name || c.number || this.t('call.unknown');
      const label = this.t('call.incoming');
      this.attention.start(label + ': ' + who, who);
      this.srAlert.textContent = label + '. ' + who;
      const a = document.activeElement;
      if (!a || a === document.body || this.root.contains(a)) this.answerBtn.focus();
    } else if (!ringing && this.ringing) {
      this.attention.stop();
      this.srAlert.textContent = '';
    }
    this.ringing = ringing;
  }

  _tickStart() {
    this._tickUpdate();
    if (!this.tick) this.tick = window.setInterval(() => this._tickUpdate(), 1000);
  }

  _tickStop() {
    if (this.tick) window.clearInterval(this.tick);
    this.tick = null;
    this.timerEl.textContent = '';
    this.peerSubTime.textContent = '';
  }

  _tickUpdate() {
    const c = this.phone.call;
    if (!c || !c.startedAt) { this.timerEl.textContent = ''; this.peerSubTime.textContent = ''; return; }
    const s = Math.max(0, Math.floor((Date.now() - c.startedAt) / 1000));
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.timerEl.textContent = s >= 3600 ? Math.floor(s / 3600) + ':' + mm + ':' + ss : mm + ':' + ss;
    this.peerSubTime.textContent = this.timerEl.textContent;
  }

  setPhone(phone) { this.phone = phone; this.render(); }

  /** Fuerza claro u oscuro (la galeria de estados); sin valor vuelve a seguir al sistema. */
  setTheme(t) {
    for (const n of [this.root, this.help.layer]) if (n) { if (t) n.setAttribute('data-theme', t); else n.removeAttribute('data-theme'); }
    this.theme = t || '';
  }

  destroy() {
    this._tickStop();
    this.attention.stop();
    for (const k of ['noticeTimer', 'offTimer', 'toastTimer']) if (this[k]) window.clearTimeout(this[k]);
    if (this._beat) window.clearInterval(this._beat);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._titleSwap && document.title === this._titleSwap.text) document.title = this._titleSwap.orig;
    document.removeEventListener('keydown', this._onDocKey);
    document.removeEventListener('pointerdown', this._onDocDown);
    if (this._ro) this._ro.disconnect();
    this.help.destroy();
    this.root.remove();
  }
}
