// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Cajon de ayuda (lateral, a peticion): primer uso con permiso de microfono, prueba de audio guiada en 3 pasos,
// arbol "No oigo nada" e informe para soporte. Foco atrapado dentro del cajon, Esc lo cierra y devuelve el foco.
// Solo el teléfono: aqui no hay administracion ni ajustes del servidor.
import { h, clear, copyText, FOCUSABLE } from './dom.js';
import { icon, permissionArt } from './icons.js';
import { askMicrophone, stopStream, startMeter, recordAndPlay, playTone, listSpeakers } from './audio.js';
import { runChecks, buildReport } from './diag.js';
import { askNotifications, notificationState } from './attention.js';
import { describe, endKind } from './errors.js';

const FLAG = 'wpk-onboarded';     // '1' = prueba terminada, 's' = la persona la omitio. Nunca es un secreto.

export function onboarded() {
  try { return !!window.localStorage.getItem(FLAG); } catch (e) { return false; }
}
function setOnboarded(v) {
  try { window.localStorage.setItem(FLAG, v); } catch (e) { /* sin almacenamiento: se vuelve a preguntar */ }
}

/** Navegador por el agente de usuario (deteccion simple, solo para elegir los pasos del permiso). */
export function detectBrowser(ua) {
  const u = ua || navigator.userAgent || '';
  if (/Edg\//.test(u)) return 'edge';
  if (/Firefox\/|FxiOS/.test(u)) return 'firefox';
  if (/Chrome\/|CriOS|OPR\//.test(u)) return 'chrome';
  if (/Safari\//.test(u)) return 'safari';
  return 'other';
}

const SHORTCUTS = [['KeyA', 'A', 'sc.answer'], ['KeyH', 'H', 'sc.hangup'], ['KeyM', 'M', 'sc.mute']];

// Arbol de "No oigo nada": cada rama pregunta como maximo tres veces y termina en una accion.
const TREE = {
  q1: { q: 'nh.q1', opts: [['nh.q1.a', 'a2'], ['nh.q1.b', 'b2']] },
  a2: { q: 'nh.a2', opts: [['nh.yes', 'a3'], ['nh.no', 'actVolume']] },
  a3: { q: 'nh.a3', opts: [['nh.yes', 'actNet'], ['nh.no', 'actOther']] },
  b2: { q: 'nh.b2', opts: [['nh.yes', 'actUnmute'], ['nh.no', 'b3']] },
  b3: { q: 'nh.b3', meter: true, opts: [['nh.yes', 'actSupport'], ['nh.no', 'actMic']] },
  actVolume: { act: 'nh.act.volume', btn: ['nh.btn.speaker', 'speaker'] },
  actNet: { act: 'nh.act.net', btn: ['hp.support', 'support'] },
  actOther: { act: 'nh.act.other' },
  actUnmute: { act: 'nh.act.unmute', btn: ['nh.btn.unmute', 'unmute'] },
  actSupport: { act: 'nh.act.support', btn: ['hp.support', 'support'] },
  actMic: { act: 'nh.act.mic', btn: ['nh.btn.mic', 'mic'] },
};

export class Help {
  constructor(bar) {
    this.bar = bar;
    this.isOpen = false;
    this.view = 'home';
    this.opts = {};
    this.token = 0;
    this.stream = null;
    this.meter = null;
    this.layer = null;
    this.opener = null;
    this.echoOk = false;
    this.still = false;
    this.report = '';
    this.checks = null;
    this.ui = {};
  }

  get t() { return this.bar.t; }

  _build() {
    this.layer = h('div', { class: 'wpk-layer wpk-scope', hidden: true });
    this.scrim = h('div', { class: 'wpk-scrim', onclick: () => this.close() });
    this.panel = h('div', { class: 'wpk-drawer', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    this.layer.append(this.scrim, this.panel);
    this.layer.addEventListener('keydown', e => this._key(e));
    if (this.bar.theme) this.layer.setAttribute('data-theme', this.bar.theme);
    (this.bar.env.layerHost || document.body).appendChild(this.layer);
  }

  // ------------------------------------------------------------------ abrir y cerrar
  open(view, opts, opener) {
    if (!this.layer) this._build();
    if (!this.isOpen) {
      const a = document.activeElement;
      this.opener = opener || (a && a !== document.body ? a : null);   // Safari y Firefox no enfocan el boton al hacer clic: la barra pasa el suyo
    }
    this.isOpen = true;
    this.layer.hidden = false;
    this.go(view || 'home', opts || {});
  }

  close() {
    if (!this.isOpen) return;
    this.token++;
    this._leave(false);
    this.isOpen = false;
    this.layer.hidden = true;
    const pending = this.opts.pending;
    this.opts = {};
    const back = this.opener;
    this.opener = null;
    const target = back && document.contains(back) && back.offsetParent !== null && !back.disabled ? back : this.bar.input;
    if (target && !target.disabled) { try { target.focus(); } catch (e) { /* sin foco */ } }
    this.bar.afterHelp(pending);
  }

  destroy() {
    this.token++;
    this._leave(false);
    if (this.layer) this.layer.remove();
    this.layer = null;
    this.isOpen = false;
  }

  _key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...this.panel.querySelectorAll(FOCUSABLE)].filter(n => !n.hidden && n.offsetParent !== null);
    if (!items.length) { e.preventDefault(); this.panel.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === this.panel || !this.panel.contains(cur))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur === last || !this.panel.contains(cur))) { e.preventDefault(); first.focus(); }
  }

  _leave(keepStream) {
    if (this.meter) { this.meter.stop(); this.meter = null; }
    if (!keepStream && this.stream) { stopStream(this.stream); this.stream = null; }
  }

  // ------------------------------------------------------------------ navegacion entre vistas
  go(view, opts) {
    const o = opts || {};
    this.token++;
    this._leave(!!o.keepStream);
    this.view = view;
    this.opts = Object.assign({}, this.opts.pending ? { pending: this.opts.pending } : {}, o);
    this.ui = {};
    const v = this._viewFor(view);
    clear(this.panel);
    const titleId = 'wpk-h-' + Math.random().toString(36).slice(2, 8);
    const title = h('h2', { id: titleId, class: 'wpk-drawer-title', tabindex: '-1', text: v.title });
    this.panel.setAttribute('aria-labelledby', titleId);
    const head = h('header', { class: 'wpk-drawer-head' },
      v.back ? this._iconBtn('back', this.t('hp.back'), () => this.go(v.back)) : null,
      title,
      this._iconBtn('close', this.t('close'), () => this.close()));
    const body = h('div', { class: 'wpk-drawer-body' }, v.body);
    const foot = v.foot && v.foot.length ? h('footer', { class: 'wpk-drawer-foot' }, v.foot) : null;
    this.panel.append(head, body);
    if (foot) this.panel.append(foot);
    title.focus();
    if (v.after) v.after();
  }

  _iconBtn(name, label, fn) {
    return h('button', { type: 'button', class: 'wpk-iconbtn', 'aria-label': label, title: label, onclick: fn }, icon(name, 20));
  }

  _btn(label, kind, fn, ico) {
    return h('button', { type: 'button', class: 'wpk-btn wpk-btn-' + (kind || 'secondary'), onclick: fn }, ico ? icon(ico, 18) : null, h('span', { text: label }));
  }

  _viewFor(view) {
    const f = this['_v_' + view];
    return f ? f.call(this) : this._v_home();
  }

  // ------------------------------------------------------------------ inicio
  _v_home() {
    const t = this.t;
    const row = (ico, title, desc, fn) => h('button', { type: 'button', class: 'wpk-row', onclick: fn },
      h('span', { class: 'wpk-row-ico' }, icon(ico, 22)),
      h('span', { class: 'wpk-row-txt' }, h('strong', { text: title }), h('span', { text: desc })),
      icon('chevron', 18));
    const sc = h('div', { class: 'wpk-sec' }, h('h3', { text: t('sc.title') }),
      h('ul', { class: 'wpk-keys' }, SHORTCUTS.map(s => h('li', null, h('kbd', { text: 'Alt+Shift+' + s[1] }), h('span', { text: t(s[2]) })))),
      h('p', { class: 'wpk-note', text: t('sc.hint') }));
    return {
      title: t('hp.title'),
      body: [
        h('div', { class: 'wpk-rows' },
          row('mic', t('hp.test'), t('hp.test.d'), () => this.startTest()),
          row('speaker', t('hp.nohear'), t('hp.nohear.d'), () => this.go('nohear', { node: 'q1' })),
          row('copy', t('hp.support'), t('hp.support.d'), () => this.go('support'))),
        this._notifBlock(),
        sc,
      ],
    };
  }

  /** Oferta de avisos del sistema: se explica primero y el permiso solo se pide con este clic. */
  _notifBlock() {
    const t = this.t;
    const st = notificationState();
    if (st === 'unsupported') return null;
    const box = h('div', { class: 'wpk-sec wpk-notif' });
    const paint = () => {
      clear(box);
      const s = notificationState();
      box.append(h('h3', { text: t('hp.notif') }));
      if (s === 'granted') box.append(h('p', { class: 'wpk-ok', text: t('hp.notif.is') }));
      else if (s === 'denied') box.append(h('p', { class: 'wpk-note', text: t('hp.notif.blocked') }));
      else {
        box.append(h('p', { text: t('hp.notif.d') }));
        box.append(this._btn(t('hp.notif.on'), 'secondary', async () => {
          const r = await askNotifications();
          if (r === 'granted') this.bar.toast(t('toast.notif'));
          paint();
        }, 'bell'));
      }
    };
    paint();
    return box;
  }

  // ------------------------------------------------------------------ primer uso: tarjeta previa al aviso del navegador
  startTest() { this.openFirstUse(this.opts.pending); }

  /** Tarjeta previa al aviso del navegador. Si el permiso ya esta dado, pasa sola a la prueba del microfono. */
  openFirstUse(pending, opener) {
    this.open('fu', { pending }, opener);
    if (this.bar.env.preview) return;      // la vista previa nunca toca el microfono
    this._permissionState().then(s => { if (s === 'granted' && this.isOpen && this.view === 'fu') this.askMic(); });
  }

  async _permissionState() {
    try { if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'microphone' })).state; } catch (e) { /* no disponible */ }
    return 'unknown';
  }

  _v_fu() {
    const t = this.t;
    const wait = h('p', { class: 'wpk-wait', 'aria-live': 'polite' },
      h('span', { class: 'wpk-wait-a', hidden: true, text: t('fu.waiting') }),
      h('span', { class: 'wpk-wait-b', hidden: true, text: t('fu.hint') }));
    const go = this._btn(t('fu.btn'), 'primary', () => this.askMic(), 'mic');
    this.ui = { wait, go };
    return {
      title: t('fu.title'),
      body: [permissionArt(t), h('p', { class: 'wpk-lead', text: t('fu.text') }), wait],
      foot: [go, this._btn(t('fu.later'), 'ghost', () => this._skip())],
    };
  }

  _skip() {
    setOnboarded('s');
    const pending = this.opts.pending;
    this.opts.pending = null;
    this.close();
    if (pending) this.bar.callNow(pending);
  }

  async askMic() {
    if (this.bar.env.preview) { this.go('s1'); return; }
    const token = ++this.token;
    if (this.ui.wait) {
      this.ui.go.disabled = true;
      this.ui.wait.firstChild.hidden = false;
    }
    let stream;
    try {
      stream = await askMicrophone(() => { if (token === this.token && this.ui.wait) this.ui.wait.lastChild.hidden = false; }, 8000);
    } catch (e) {
      if (token !== this.token) return;
      this._micError(e);
      return;
    }
    if (token !== this.token || !this.isOpen) { stopStream(stream); return; }
    this.stream = stream;
    this.bar.setMicIssue(null);
    this.still = false;
    this.go('s1', { keepStream: true });
  }

  _micError(e) {
    const name = e && e.name ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      this.still = this.view === 'denied';
      this.go('denied');
      return;
    }
    const kind = name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'nomic' : name === 'NotReadableError' || name === 'AbortError' ? 'micbusy' : 'micfail';
    if (kind === 'nomic') this.bar.setMicIssue('nomic');
    this.go('miss', { kind });
  }

  _v_miss() {
    const t = this.t;
    const d = describe(this.opts.kind);
    return {
      title: t('fu.title'),
      body: [h('div', { class: 'wpk-hero wpk-hero-bad' }, icon('micoff', 40)), h('p', { class: 'wpk-lead', role: 'alert', text: t(d.msg) })],
      foot: [this._btn(t('act.again'), 'primary', () => this.askMic(), 'refresh'), this._btn(t('close'), 'ghost', () => this.close())],
    };
  }

  _v_denied() {
    const t = this.t;
    const b = detectBrowser();
    const steps = [1, 2, 3].map(i => h('li', { text: t('dn.' + (b === 'edge' && i !== 2 ? 'chrome' : b) + '.' + i) }));   // Edge comparte los pasos 1 y 3 con Chrome
    const still = h('p', { class: 'wpk-still', role: 'alert', hidden: !this.still, text: t('dn.still') });
    const ok = this._btn(t('dn.btn'), 'primary', () => this._recheck());
    this.ui = { go: ok };
    return {
      title: t('dn.title'),
      body: [h('div', { class: 'wpk-hero wpk-hero-bad' }, icon('micoff', 40)), h('p', { class: 'wpk-lead', text: t('dn.text') }), h('ol', { class: 'wpk-steps-list' }, steps), still],
      foot: [ok, this._btn(t('close'), 'ghost', () => this.close())],
    };
  }

  async _recheck() {
    const b = detectBrowser();
    if (b === 'chrome' || b === 'edge') {
      const s = await this._permissionState();
      if (s === 'denied') { this.still = true; this.go('denied'); return; }
    }
    this.askMic();   // en los demas navegadores se vuelve a pedir el microfono: si sigue bloqueado vuelve a esta vista
  }

  // ------------------------------------------------------------------ prueba de audio guiada
  _steps(n) {
    const t = this.t;
    return h('div', { class: 'wpk-stepbar' },
      h('div', { class: 'wpk-dots', 'aria-hidden': 'true' }, [1, 2, 3].map(i => h('span', { class: i <= n ? 'on' : '' }))),
      h('span', { class: 'wpk-stepof', text: t('step.of', { n, m: 3 }) }));
  }

  _foot(next, fail) {
    const t = this.t;
    const nb = this._btn(t('step.next'), 'primary', next);
    const fb = this._btn(t('step.fail'), 'ghost', fail);
    this.ui.next = nb;
    return [nb, fb];
  }

  _v_s1() {
    const t = this.t;
    const fill = h('span', { class: 'wpk-meter-fill' });
    const meter = h('div', { class: 'wpk-meter', role: 'meter', 'aria-label': t('s1.meter'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
    const say = h('p', { class: 'wpk-say', 'aria-live': 'polite' });
    this.ui.say = say;
    const rec = typeof MediaRecorder === 'undefined' ? null : this._btn(t('s1.rec'), 'secondary', async () => {
      if (!this.stream) return;
      rec.disabled = true;
      const ok = await recordAndPlay(this.stream, 3000, ph => { say.textContent = ph === 'rec' ? t('s1.recording') : t('s1.playing'); });
      if (this.view === 's1') { rec.disabled = false; say.textContent = ok ? t('s1.ok') : ''; }
    }, 'play');
    return {
      title: t('s1.title'),
      body: [this._steps(1), h('div', { class: 'wpk-hero' }, icon('mic', 40)), h('p', { class: 'wpk-lead', text: t('s1.text') }), meter, say, rec],
      foot: this._foot(() => this.go('s2'), () => this.go('nohear', { node: 'actMic', from: 's1' })),
      after: () => {
        if (!this.stream) { if (this.bar.env.preview) this._fakeMeter(fill, meter, say); return; }
        let heard = false;
        let last = 0;
        const started = Date.now();
        this.meter = startMeter(this.stream, (lvl, peak) => {
          fill.style.transform = 'scaleX(' + lvl.toFixed(3) + ')';
          const now = Date.now();
          if (now - last > 200) { meter.setAttribute('aria-valuenow', String(Math.round(lvl * 100))); last = now; }
          if (!heard && peak > 0.05) { heard = true; say.textContent = t('s1.ok'); meter.dataset.heard = '1'; }
          else if (!heard && now - started > 3500 && !say.textContent) say.textContent = t('s1.quiet');
        });
      },
    };
  }

  /** Solo en la vista previa: un medidor que se mueve solo, para ver la pantalla sin microfono. */
  _fakeMeter(fill, meter, say) {
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      const lvl = Math.max(0.05, 0.35 + 0.3 * Math.sin(n / 2.2));
      fill.style.transform = 'scaleX(' + lvl.toFixed(3) + ')';
      meter.setAttribute('aria-valuenow', String(Math.round(lvl * 100)));
      if (n === 5) { meter.dataset.heard = '1'; say.textContent = this.t('s1.ok'); }
    }, 120);
    this.meter = { stop() { window.clearInterval(id); } };
  }

  _v_s2() {
    const t = this.t;
    const sel = h('select', { class: 'wpk-select', 'aria-label': t('s2.speaker'), hidden: true });
    const wrap = h('label', { class: 'wpk-field', hidden: true }, h('span', { text: t('s2.speaker') }), sel);
    const play = this._btn(t('s2.play'), 'secondary', async () => { play.disabled = true; await playTone(sel.value || null); play.disabled = false; }, 'play');
    return {
      title: t('s2.title'),
      body: [this._steps(2), h('div', { class: 'wpk-hero' }, icon('speaker', 40)), h('p', { class: 'wpk-lead', text: t('s2.text') }), play, wrap],
      foot: this._foot(() => this.go('s3'), () => this.go('nohear', { node: 'actVolume', from: 's2' })),
      after: async () => {
        const list = await listSpeakers();
        if (!list || !list.length || this.view !== 's2') return;
        sel.append(h('option', { value: '', text: t('s2.default') }));
        for (const d of list) sel.append(h('option', { value: d.id, text: d.label }));
        sel.hidden = false;
        wrap.hidden = false;
      },
    };
  }

  _v_s3() {
    const t = this.t;
    const say = h('p', { class: 'wpk-say', 'aria-live': 'polite' });
    const callBtn = this._btn(t('s3.call'), 'secondary', () => this._echo(), 'phone');
    const hang = this._btn(t('s3.hangup'), 'danger', () => this.bar.phone.hangup(), 'hangup');
    hang.hidden = true;
    this.echoOk = false;
    this.ui = { say, callBtn, hang };
    const foot = this._foot(() => { this.bar.phone.hangup(); this.go('done'); }, () => { this.bar.phone.hangup(); this.go('failed', { msg: this.ui.lastMsg || t('s3.failed') }); });
    this.ui.next.disabled = true;
    return {
      title: t('s3.title'),
      body: [this._steps(3), h('div', { class: 'wpk-hero' }, icon('phone', 40)), h('p', { class: 'wpk-lead', text: t('s3.text') }), say, callBtn, hang],
      foot,
    };
  }

  async _echo() {
    const ph = this.bar.phone;
    this.ui.say.textContent = this.t('s3.calling');
    this.ui.callBtn.disabled = true;
    const ok = await ph.call_(ph.echoNumber);
    if (!ok && this.view === 's3') {
      this.ui.callBtn.disabled = false;
      this.ui.lastMsg = this.t('s3.failed');
      this.ui.say.textContent = this.ui.lastMsg;
    }
    this._syncS3();
  }

  _syncS3(name, data) {
    if (this.view !== 's3' || !this.ui.say) return;
    const t = this.t;
    const c = this.bar.phone.call;
    if (name === 'failed' && data) {
      const k = endKind(data.cause, data.code);
      this.ui.lastMsg = t(describe(k || 'fallback').msg);
      this.ui.say.textContent = this.ui.lastMsg;
    }
    if (c) {
      this.ui.callBtn.hidden = true;
      this.ui.hang.hidden = false;
      if (c.confirmed) { this.echoOk = true; this.ui.say.textContent = t('s3.on'); } else this.ui.say.textContent = t('s3.calling');
    } else {
      this.ui.callBtn.hidden = false;
      this.ui.callBtn.disabled = false;
      this.ui.hang.hidden = true;
      if (name === 'ended' && this.echoOk) this.ui.say.textContent = t('dd.text');
    }
    this.ui.next.disabled = !this.echoOk;
  }

  /** La barra reenvia los eventos del telefono; solo la prueba de eco los necesita. */
  onPhoneEvent(name, data) {
    if (this.isOpen && this.view === 's3') this._syncS3(name, data);
  }

  _v_failed() {
    const t = this.t;
    return {
      title: t('s3.title'),
      body: [h('div', { class: 'wpk-hero wpk-hero-bad' }, icon('alert', 40)), h('p', { class: 'wpk-lead', role: 'alert', text: this.opts.msg || t('s3.failed') })],
      foot: [this._btn(t('act.again'), 'primary', () => this.go('s3'), 'refresh'), this._btn(t('hp.support'), 'secondary', () => this.go('support'))],
    };
  }

  _v_done() {
    const t = this.t;
    setOnboarded('1');
    return {
      title: t('dd.title'),
      body: [h('div', { class: 'wpk-hero wpk-hero-ok' }, icon('check', 40)), h('p', { class: 'wpk-lead', text: t('dd.text') }), this._notifBlock()],
      foot: [this._btn(t('close'), 'primary', () => this.close())],
    };
  }

  // ------------------------------------------------------------------ "No oigo nada"
  _v_nohear() {
    const t = this.t;
    const node = TREE[this.opts.node] || TREE.q1;
    const body = [];
    const foot = [];
    let after = null;
    if (node.q) {
      body.push(h('p', { class: 'wpk-lead', text: t(node.q) }));
      if (node.meter) {
        const fill = h('span', { class: 'wpk-meter-fill' });
        body.push(h('div', { class: 'wpk-meter', role: 'meter', 'aria-label': t('s1.meter'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill));
        after = async () => {
          try {
            const s = await askMicrophone(null, 8000);
            if (this.view !== 'nohear' || !this.isOpen) { stopStream(s); return; }
            this.stream = s;
            this.meter = startMeter(s, lvl => { fill.style.transform = 'scaleX(' + lvl.toFixed(3) + ')'; });
          } catch (e) { /* sin microfono: la persona respondera que no se mueve */ }
        };
      }
      body.push(h('div', { class: 'wpk-choices' }, node.opts.map(o => this._btn(t(o[0]), 'secondary', () => this.go('nohear', { node: o[1] })))));
    } else {
      body.push(h('div', { class: 'wpk-hero wpk-hero-ok' }, icon('check', 40)), h('p', { class: 'wpk-lead', text: t(node.act) }));
      if (node.btn) {
        const [label, what] = node.btn;
        foot.push(this._btn(t(label), 'primary', () => {
          if (what === 'speaker') this.go('s2');
          else if (what === 'mic') this.askMic();
          else if (what === 'support') this.go('support');
          else if (what === 'unmute') { this.bar.phone.mute(); this.close(); }
        }));
      }
    }
    return { title: t('nh.title'), body, foot, after, back: this.opts.from ? this.opts.from : 'home' };
  }

  // ------------------------------------------------------------------ soporte
  _v_support() {
    const t = this.t;
    const pre = h('pre', { class: 'wpk-report', tabindex: '0', 'aria-label': t('sup.details') });
    const status = h('p', { class: 'wpk-say', 'aria-live': 'polite', text: t('sup.checking') });
    const copy = this._btn(t('sup.copy'), 'primary', async () => {
      const text = await this._ready;
      const ok = await copyText(text);
      status.textContent = t(ok ? 'toast.copied' : 'toast.copyfail');
    }, 'copy');
    const details = h('details', { class: 'wpk-details' }, h('summary', { text: t('sup.details') }), pre);
    this.ui = { pre, status };
    this._ready = this._collect().then(text => { if (this.view === 'support') { pre.textContent = text; status.textContent = ''; } return text; });
    return { title: t('sup.title'), body: [h('p', { class: 'wpk-lead', text: t('sup.text') }), copy, status, details], back: 'home' };
  }

  /** Corre las comprobaciones (solo cuando la persona abre esta vista o copia el informe) y arma el texto. */
  async _collect() {
    const info = this.bar.phone.diagInfo();
    this.checks = await runChecks(info);
    this.report = buildReport(this.t, this.bar.lang, this.bar.phone.diagInfo(), this.checks);
    return this.report;
  }

  /** Copia el informe sin abrir el cajon (accion "Copiar informe" de un aviso). */
  async copyReport() {
    const text = await this._collect();
    const ok = await copyText(text);
    this.bar.toast(this.t(ok ? 'toast.copied' : 'toast.copyfail'));
    return ok;
  }
}
