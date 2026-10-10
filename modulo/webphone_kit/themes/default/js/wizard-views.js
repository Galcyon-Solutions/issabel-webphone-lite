/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Copyright (C) 2026 Galcyon */
/*
 * Asistente del webphone: vistas (solo construyen DOM a partir del estado de la app A.S; las acciones viven en wizard.js).
 * Una pregunta por pantalla, "Atras" siempre, semaforo por comprobacion con "Explicame". Todo texto dinamico va con textContent.
 */
(function (w) {
  'use strict';
  var WPA = w.WPA;
  var h = WPA.h, icon = WPA.icon, t = function (k, p) { return WPA.t(k, p); };
  var V = WPA.views = {};

  // ================================================================ piezas pequenas
  function btn(label, o) {
    o = o || {};
    var cls = 'wpa-btn wpa-btn--' + (o.kind || 'secondary') + (o.cls ? ' ' + o.cls : '');
    var b = h('button', { type: 'button', class: cls, disabled: o.disabled, onclick: o.onclick, 'aria-label': o.aria, title: o.title,
      'data-act': o.act, 'aria-busy': o.busy ? 'true' : null, 'aria-expanded': o.expanded === undefined ? null : String(o.expanded),
      'aria-controls': o.expanded ? o.controls : null });
    if (o.icon) b.appendChild(icon(o.icon));
    b.appendChild(h('span', { class: 'wpa-btn__t', text: label }));
    if (o.iconAfter) b.appendChild(icon(o.iconAfter));
    return b;
  }
  V.btn = btn;
  function chip(level, text) {
    return h('span', { class: 'wpa-chip wpa-chip--' + level }, icon(level === 'ok' ? 'check' : level === 'bad' ? 'x' : level === 'warn' ? 'warn' : 'minus'), h('span', { text: text }));
  }
  V.chip = chip;
  var LAMP_ICON = { ok: 'check', warn: 'warn', bad: 'x', skip: 'minus', run: 'refresh' };
  function lamp(level) {
    return h('span', { class: 'wpa-lamp wpa-lamp--' + level, role: 'img', 'aria-label': t('lamp.' + level) }, icon(LAMP_ICON[level] || 'minus'));
  }
  V.lamp = lamp;
  function field(id, label, input, hint, err) {
    return h('div', { class: 'wpa-field' + (err ? ' has-error' : '') },
      h('label', { class: 'wpa-label', for: id, text: label }),
      input,
      hint ? h('p', { class: 'wpa-hint', id: id + '-h', text: hint }) : null,
      err ? h('p', { class: 'wpa-err', id: id + '-e', role: 'alert', text: err }) : null);
  }
  V.field = field;
  function textInput(A, id, val, onInput, o) {
    o = o || {};
    var i = h('input', { type: o.type || 'text', id: id, class: 'wpa-input', value: val || '', autocomplete: 'off', spellcheck: 'false',
      maxlength: o.max, inputmode: o.inputmode, placeholder: o.ph, 'aria-describedby': o.hint ? id + '-h' : null, disabled: o.disabled,
      'aria-invalid': o.invalid ? 'true' : null });
    i.addEventListener('input', function () { onInput(i.value); });
    return i;
  }
  V.textInput = textInput;
  function codeBox(A, text, label) {
    var copied = false;
    var b = btn(t('nav.copy'), { kind: 'ghost', icon: 'copy', aria: t('nav.copy') + ': ' + label });
    b.addEventListener('click', function () {
      WPA.copy(text).then(function () {
        b.querySelector('.wpa-btn__t').textContent = t('nav.copied');
        A.announce(t('nav.copied'));
        setTimeout(function () { b.querySelector('.wpa-btn__t').textContent = t('nav.copy'); }, 1800);
      });
    });
    return h('div', { class: 'wpa-code' },
      h('div', { class: 'wpa-code__head' }, h('span', { class: 'wpa-code__label', text: label }), b),
      h('pre', { class: 'wpa-code__pre', tabindex: '0', 'aria-label': label }, h('code', { text: text })));
  }
  V.codeBox = codeBox;
  function note(kind, title, body) {
    return h('div', { class: 'wpa-note wpa-note--' + kind, role: kind === 'bad' ? 'alert' : null },
      icon(kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : kind === 'warn' ? 'warn' : 'help'),
      h('div', null, title ? h('strong', { text: title }) : null, body ? h('p', { text: body }) : null));
  }
  V.note = note;
  function choice(name, items, value, onPick) {
    // Filas de opcion (radio): titulo, una linea de apoyo y, a la derecha, un ejemplo corto
    var wrap = h('div', { class: 'wpa-choices', role: 'radiogroup' });
    items.forEach(function (it) {
      var id = 'wpa-' + name + '-' + it.value;
      var inp = h('input', { type: 'radio', name: 'wpa-' + name, id: id, value: it.value, checked: value === it.value, class: 'wpa-choice__in' });
      inp.addEventListener('change', function () { onPick(it.value); });
      wrap.appendChild(h('label', { class: 'wpa-choice' + (value === it.value ? ' is-on' : ''), for: id },
        inp,
        h('span', { class: 'wpa-choice__dot', 'aria-hidden': 'true' }),
        h('span', { class: 'wpa-choice__body' }, h('span', { class: 'wpa-choice__t', text: it.title }), it.desc ? h('span', { class: 'wpa-choice__d', text: it.desc }) : null),
        it.eg ? h('span', { class: 'wpa-choice__eg', text: it.eg }) : null));
    });
    return wrap;
  }
  V.choice = choice;
  function stepHead(A, title, lead) {
    return h('header', { class: 'wpa-head' },
      h('h2', { class: 'wpa-title', id: 'wpa-title', tabindex: '-1', text: title }),
      lead ? h('p', { class: 'wpa-lead', text: lead }) : null);
  }
  V.stepHead = stepHead;
  function footer(A, backFn, nextBtn, extra) {
    return h('footer', { class: 'wpa-foot' },
      backFn ? btn(t('nav.back'), { kind: 'ghost', icon: 'back', onclick: backFn, act: 'back' }) : h('span'),
      h('div', { class: 'wpa-foot__r' }, extra || null, nextBtn || null));
  }
  V.footer = footer;

  // ================================================================ cabecera y barra de progreso
  var STEP_ICONS = ['sparkle', 'list', 'lock', 'net', 'phone', 'speaker'];
  V.progress = function (A) {
    var S = A.S, n = 6;
    var ol = h('ol', { class: 'wpa-steps', 'aria-label': t('step.list') });
    for (var i = 1; i <= n; i++) {
      (function (i) {
        var state = i < S.step ? 'done' : i === S.step ? 'now' : 'todo';
        var reach = i <= S.maxStep;
        var inner = [h('span', { class: 'wpa-step__n', 'aria-hidden': 'true' }, state === 'done' ? icon('check') : String(i)), h('span', { class: 'wpa-step__t', text: t('step.' + i) })];
        var el = reach && i !== S.step
          ? h('button', { type: 'button', class: 'wpa-step__b', onclick: function () { A.go(i); }, 'aria-label': t('step.goto', { n: i, name: t('step.' + i) }) }, inner)
          : h('span', { class: 'wpa-step__b', 'aria-current': state === 'now' ? 'step' : null }, inner);
        ol.appendChild(h('li', { class: 'wpa-step wpa-step--' + state }, el));
      })(i);
    }
    var bar = h('div', { class: 'wpa-bar', role: 'presentation' }, h('span', { class: 'wpa-bar__fill', style: 'transform:scaleX(' + (S.step / n).toFixed(4) + ')' }));
    return h('nav', { class: 'wpa-progress', 'aria-label': t('step.nav') },
      h('p', { class: 'wpa-progress__m', text: t('step.of', { n: S.step, m: n, name: t('step.' + S.step) }) }), bar, ol);
  };

  // ================================================================ comprobaciones (semaforo, Explicame y Resolver)
  function checkText(c) {
    var key = 'c.' + c.id + '.' + c.code;
    if (!WPA.has(key) && /^http\d+$/.test(c.code)) key = 'c.' + c.id + '.http';
    if (!WPA.has(key)) key = 'c.default';
    return t(key, c.p || {});
  }
  V.checkText = checkText;

  function fixButtonLabel(c) {
    var f = c.fix;
    if (!f) return '';
    switch (f.kind) {
      case 'auto': return t('fix.auto');
      case 'le': return t('fix.le');
      case 'ext': return t('fix.ext', { ext: f.ext || '' });
      case 'cmd': return t('fix.cmd');
      case 'ca': return t('fix.ca');
      case 'link': return t('fix.link');
      case 'browser': return t('fix.browser.' + f.id);
    }
    return t('fix.auto');
  }

  /** Fila de una comprobacion. $open y $fixes viven en A.S (abierto y estado del Resolver por id). */
  V.checkRow = function (A, c, o) {
    o = o || {};
    var S = A.S;
    var level = c.level;
    var isOpen = !!S.open[c.id];
    var fs = S.fix[c.id] || { status: 'idle' };
    var row = h('li', { class: 'wpa-check wpa-check--' + level + (c.critical && level === 'bad' ? ' is-critical' : ''), 'data-id': c.id });
    var main = h('div', { class: 'wpa-check__main' },
      lamp(level),
      h('div', { class: 'wpa-check__txt' },
        h('p', { class: 'wpa-check__t' }, t('t.' + c.id), c.critical && level !== 'ok' ? h('span', { class: 'wpa-check__crit', text: t('check.critical') }) : null),
        h('p', { class: 'wpa-check__r', text: level === 'run' ? t('check.running') : checkText(c) }),
        (c.id === 'S7' && c.p && c.p.docker === 'yes' && (level === 'warn' || level === 'bad')) ? h('p', { class: 'wpa-check__r wpa-check__r--extra', text: t('rtp.docker') }) : null,
        (c.id === 'S7' && c.p && c.p.source === 'issabelpbx' && c.p.priv === 'no' && (level === 'warn' || level === 'bad')) ? h('p', { class: 'wpa-check__r wpa-check__r--extra', text: t('rtp.pbx.note') }) : null));
    var acts = h('div', { class: 'wpa-check__acts' });
    if (level !== 'run') {
      var ex = btn(t('nav.explain'), { kind: 'ghost', icon: 'help', expanded: isOpen, controls: 'wpa-why-' + c.id, act: 'explain',
        aria: t('nav.explain') + ': ' + t('t.' + c.id), onclick: function () { S.open[c.id] = !S.open[c.id]; A.render('keep'); } });
      acts.appendChild(ex);
      if (c.fix && level === 'ok' && c.fix.undo && c.fix.id === 'rtp_range_undo') {
        acts.appendChild(btn(t('nav.undo'), { kind: 'ghost', icon: 'undo', act: 'undo', aria: t('nav.undo') + ': ' + t('t.' + c.id), onclick: function () { A.undoFix(c, 'rtp_range_undo'); } }));
      }
      if (c.fix && level !== 'ok') {
        var open = fs.status !== 'idle' || S.fixOpen[c.id];
        acts.appendChild(btn(fixButtonLabel(c), { kind: level === 'bad' ? 'primary' : 'secondary', act: 'resolve', cls: 'wpa-resolve', expanded: open,
          controls: 'wpa-fix-' + c.id, onclick: function () { A.openFix(c); } }));
      }
    }
    row.appendChild(main);
    row.appendChild(acts);
    if (isOpen) row.appendChild(h('div', { class: 'wpa-why', id: 'wpa-why-' + c.id }, h('p', { text: t('w.' + c.id) })));
    var fx = V.fixPanel(A, c, fs);
    if (fx) row.appendChild(fx);
    return row;
  };

  /** Panel del Resolver. Varia segun el tipo: auto, le, ext, cmd, ca, link o navegador. */
  V.fixPanel = function (A, c, fs) {
    var S = A.S, f = c.fix;
    if (!f) return null;
    var show = fs.status !== 'idle' || S.fixOpen[c.id];
    if (!show) return null;
    var box = h('div', { class: 'wpa-fix wpa-fix--' + f.kind, id: 'wpa-fix-' + c.id });
    var inputs = S.fixIn[c.id] || (S.fixIn[c.id] = {});

    if (fs.status === 'running') {
      box.appendChild(h('p', { class: 'wpa-fix__s' }, icon('refresh', 'wpa-spin'), h('span', { text: t('fix.running') })));
      return box;
    }
    if (fs.status === 'done') {
      box.appendChild(note('ok', t('fix.done'), fs.msg ? t(fs.msg) : null));
      var rr = h('div', { class: 'wpa-row' });
      if (fs.undo) rr.appendChild(btn(t('nav.undo'), { kind: 'ghost', icon: 'undo', act: 'undo', onclick: function () { A.undoFix(c, fs.undo); } }));
      rr.appendChild(btn(t('nav.recheck'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } }));
      box.appendChild(rr);
      return box;
    }
    if (fs.status === 'error') {
      box.appendChild(note('bad', t('fix.failed'), t('err.' + (fs.error || 'generic'), Object.assign({ calls: fs.calls }, fs.p || {}))));
      if (fs.error === 'no_sip_privilege') {
        box.appendChild(h('div', { class: 'wpa-row' }, btn(t('rtp.pbx.open'), { kind: 'secondary', icon: 'ext', act: 'open-pbx', onclick: function () { A.openPbx(A.PBX_SIP); } })));
      }
    }
    if (f.kind === 'auto') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fixn.' + f.id + (f.id === 'rtp_range' && f.via === 'pbx' ? '.pbx' : '')) }));
      if (f.id === 'rtp_range') {
        // En el paso 4 la pregunta ya esta arriba: aqui solo el resumen. En el Diagnostico va la pregunta completa.
        if (S.view === 'wizard' && S.step === 4) box.appendChild(V.rtpSummary(A));
        else box.appendChild(V.rtpCard(A, { inFix: true }));
      }
      if (f.needs_input === 'ip') {
        box.appendChild(field('wpa-fixip-' + c.id, t('fix.ip.label'), textInput(A, 'wpa-fixip-' + c.id, inputs.ip || A.S.pubGuess || '', function (v) { inputs.ip = v; }, { ph: '203.0.113.10', max: 45, inputmode: 'decimal', hint: true }), t('fix.ip.hint')));
      }
      if (f.consent) {
        var cb = h('input', { type: 'checkbox', id: 'wpa-fixc-' + c.id, checked: !!inputs.consent });
        cb.addEventListener('change', function () { inputs.consent = cb.checked; A.render('keep'); });
        box.appendChild(h('label', { class: 'wpa-check-l', for: 'wpa-fixc-' + c.id }, cb, h('span', { text: t('fix.consent.' + f.consent) })));
      }
      if (f.needs_calls && S.doctor.calls > 0) {
        var cc = h('input', { type: 'checkbox', id: 'wpa-fixk-' + c.id, checked: !!inputs.calls });
        cc.addEventListener('change', function () { inputs.calls = cc.checked; A.render('keep'); });
        box.appendChild(h('label', { class: 'wpa-check-l', for: 'wpa-fixk-' + c.id }, cc, h('span', { text: t(f.id === 'rtp_range' ? 'calls.confirm.rtp' : 'calls.confirm', { n: S.doctor.calls }) })));
      }
      var ready = (!f.consent || inputs.consent) && (!(f.needs_calls && S.doctor.calls > 0) || inputs.calls) && (f.needs_input !== 'ip' || true)
        && (f.id !== 'rtp_range' || S.rtp.calls !== null);
      box.appendChild(h('div', { class: 'wpa-row' },
        btn(t('nav.apply'), { kind: 'primary', disabled: !ready, act: 'apply', onclick: function () { A.runFix(c); } }),
        btn(t('nav.cancel'), { kind: 'ghost', onclick: function () { S.fixOpen[c.id] = false; S.fix[c.id] = { status: 'idle' }; A.render('keep'); } })));
      return box;
    }
    if (f.kind === 'le') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.le.d', { host: f.host || '' }) }));
      box.appendChild(h('div', { class: 'wpa-row' },
        h('a', { class: 'wpa-btn wpa-btn--primary', href: f.url, target: '_blank', rel: 'noopener' }, icon('ext'), h('span', { class: 'wpa-btn__t', text: t('fix.le.open') })),
        btn(t('fix.recheck.done'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } })));
      return box;
    }
    if (f.kind === 'ext') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.ext.d', { ext: f.ext || '' }) }));
      box.appendChild(h('div', { class: 'wpa-row' },
        btn(t('fix.ext', { ext: f.ext || '' }), { kind: 'primary', icon: 'ext', act: 'edit-ext', onclick: function () { A.openExt(f.ext); } }),
        btn(t('fix.recheck.done'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } })));
      return box;
    }
    if (f.kind === 'cmd') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.cmd.d') }));
      if (f.needs) box.appendChild(note('warn', null, t('fix.needs.' + String(f.needs).replace(/[^a-z]/g, ''))));
      box.appendChild(codeBox(A, f.cmd, t('fix.cmd.label')));
      if (f.undo) box.appendChild(codeBox(A, f.undo, t('fix.undo.label')));
      box.appendChild(h('div', { class: 'wpa-row' }, btn(t('fix.recheck.done'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } })));
      return box;
    }
    if (f.kind === 'ca') {
      box.appendChild(V.caGuide(A));
      box.appendChild(h('div', { class: 'wpa-row' }, btn(t('fix.recheck.done'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } })));
      return box;
    }
    if (f.kind === 'link' && f.label === 'rtpsip') {
      // El rango lo define IssabelPBX (rtp_additional.conf): se guia a cambiarlo alli con los valores exactos
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.link.d.rtpsip') }));
      if (S.view === 'wizard' && S.step === 4) box.appendChild(V.rtpSummary(A));
      else box.appendChild(V.rtpCard(A, { inFix: true }));
      box.appendChild(h('div', { class: 'wpa-row' },
        btn(t('rtp.pbx.open'), { kind: 'primary', icon: 'ext', act: 'open-pbx', disabled: S.rtp.calls === null, onclick: function () { A.openPbx(f.url); } }),
        btn(t('fix.recheck.done'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } })));
      return box;
    }
    if (f.kind === 'link') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.link.d.' + (f.label || 'x')) }));
      box.appendChild(h('div', { class: 'wpa-row' },
        h('a', { class: 'wpa-btn wpa-btn--primary', href: f.url, target: '_blank', rel: 'noopener' }, icon('ext'), h('span', { class: 'wpa-btn__t', text: t('fix.link') })),
        btn(t('fix.recheck.done'), { kind: 'secondary', icon: 'refresh', onclick: function () { A.recheck(); } })));
      return box;
    }
    if (f.kind === 'browser') {
      return V.browserFix(A, c, f, box);
    }
    return null;
  };

  V.browserFix = function (A, c, f, box) {
    var S = A.S;
    if (f.id === 'mic_test') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.mic.d') }));
      var m = S.mic;
      if (m.status === 'running') {
        var pct = Math.max(0, Math.min(100, Math.round(m.level * 100)));
        box.appendChild(h('div', { class: 'wpa-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': t('fix.mic.meter') },
          h('span', { class: 'wpa-meter__fill', style: 'transform:scaleX(' + (Math.min(1, m.level * 3)).toFixed(3) + ')' })));
        box.appendChild(h('p', { class: 'wpa-hint', text: m.ignored ? t('fix.mic.ignored') : t('fix.mic.speak') }));
      } else {
        if (m.status === 'done' && m.result) box.appendChild(note(m.result === 'ok' ? 'ok' : 'warn', t('fix.mic.r.' + m.result)));
        box.appendChild(h('div', { class: 'wpa-row' }, btn(t('fix.browser.mic_test'), { kind: 'primary', icon: 'mic', act: 'mic-test', onclick: function () { A.micTest(); } })));
      }
      return box;
    }
    if (f.id === 'mic_help') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.mic.help') }));
      box.appendChild(h('div', { class: 'wpa-row' }, btn(t('fix.mic.changed'), { kind: 'primary', icon: 'refresh', onclick: function () { A.recheckBrowser(); } })));
      return box;
    }
    if (f.id === 'audio_unlock') {
      box.appendChild(h('p', { class: 'wpa-fix__d', text: t('fix.audio.d') }));
      box.appendChild(h('div', { class: 'wpa-row' }, btn(t('fix.audio.btn'), { kind: 'primary', icon: 'speaker', onclick: function () { WPA.browser.tone().then(function () { A.recheckBrowser(); }); } })));
      return box;
    }
    return null;
  };

  V.caGuide = function (A) {
    var S = A.S;
    var os = S.caOs || 'win';
    var tabs = h('div', { class: 'wpa-seg', role: 'tablist', 'aria-label': t('ca.os') });
    ['win', 'mac', 'ios', 'android', 'linux'].forEach(function (k) {
      tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'wpa-seg__b' + (os === k ? ' is-on' : ''), 'aria-selected': os === k ? 'true' : 'false',
        onclick: function () { S.caOs = k; A.render('keep'); } }, t('ca.os.' + k)));
    });
    var steps = h('ol', { class: 'wpa-ol' });
    for (var i = 1; i <= 4; i++) {
      if (WPA.has('ca.' + os + '.' + i)) steps.appendChild(h('li', { text: t('ca.' + os + '.' + i) }));
    }
    return h('div', { class: 'wpa-ca' }, h('p', { class: 'wpa-fix__d', text: t('ca.intro') }), tabs, steps,
      codeBox(A, 'mkcert -install\nmkcert -cert-file server.crt -key-file server.key ' + (S.doctor.ssl && S.doctor.ssl.host ? S.doctor.ssl.host : 'HOST') + ' localhost 127.0.0.1', t('ca.cmd')),
      note('warn', null, t('ca.warn')));
  };

  /** Lista de comprobaciones agrupada (central y navegador). */
  V.checkList = function (A, ids, o) {
    o = o || {};
    var S = A.S;
    var ul = h('ul', { class: 'wpa-checks' });
    var all = A.allChecks();
    ids.forEach(function (id) {
      var c = all[id];
      if (!c) c = { id: id, level: 'run', code: 'run', p: {}, critical: false };
      ul.appendChild(V.checkRow(A, c));
    });
    return ul;
  };

  V.summaryBar = function (A) {
    var sm = A.summary();
    var kids = [];
    kids.push(h('p', { class: 'wpa-sum__t', role: 'status' }, sm.running ? t('sum.running', { n: sm.done, m: sm.total }) : t('sum.done', { ok: sm.ok, m: sm.total })));
    var chips = h('div', { class: 'wpa-sum__c' });
    if (sm.bad) chips.appendChild(chip('bad', t('sum.bad', { n: sm.bad })));
    if (sm.warn) chips.appendChild(chip('warn', t('sum.warn', { n: sm.warn })));
    if (sm.ok) chips.appendChild(chip('ok', t('sum.ok', { n: sm.ok })));
    kids.push(chips);
    return h('div', { class: 'wpa-sum' }, kids);
  };

  // ================================================================ PASO 1: bienvenida
  V.welcome = function (A) {
    var S = A.S;
    var art = h('div', { class: 'wpa-art', 'aria-hidden': 'true' },
      h('span', { class: 'wpa-art__n wpa-art__n--a' }, icon('window')),
      h('span', { class: 'wpa-art__line' }),
      h('span', { class: 'wpa-art__n wpa-art__n--b' }, icon('lock')),
      h('span', { class: 'wpa-art__line' }),
      h('span', { class: 'wpa-art__n wpa-art__n--c' }, icon('server')));
    var facts = h('dl', { class: 'wpa-facts' });
    function fact(k, v) { facts.appendChild(h('div', { class: 'wpa-fact' }, h('dt', { text: k }), h('dd', { text: v }))); }
    fact(t('s1.user'), S.user + ' (' + (S.caps.admin ? t('s1.admin') : t('s1.notadmin')) + ')');
    fact(t('s1.exists'), t('s1.exists.v', { a: S.counts.webphone, u: S.counts.enabled }));
    var kids = [h('div', { class: 'wpa-welcome' }, art, stepHead(A, t('s1.title'), t('s1.lead'))), facts];
    if (S.wizard.step > 1 && !S.wizard.done) kids.push(note('info', t('s1.resume', { n: S.wizard.step, name: t('step.' + S.wizard.step) })));
    kids.push(footer(A, null,
      btn(S.wizard.step > 1 && !S.wizard.done ? t('s1.resume.btn', { n: S.wizard.step }) : t('nav.start'), { kind: 'primary', iconAfter: 'next', act: 'start',
        onclick: function () { A.go(S.wizard.step > 1 && !S.wizard.done ? S.wizard.step : 2); } }),
      S.wizard.step > 1 && !S.wizard.done ? btn(t('s1.restart'), { kind: 'ghost', onclick: function () { A.go(2, null, true); } }) : null));
    return h('div', { class: 'wpa-pane' }, kids);
  };

  V.noPermission = function (A) {
    return h('div', { class: 'wpa-pane wpa-pane--center' },
      h('div', { class: 'wpa-art wpa-art--lock', 'aria-hidden': 'true' }, h('span', { class: 'wpa-art__n' }, icon('lock'))),
      stepHead(A, t('np.title'), t('np.lead', { user: A.S.user })),
      note('info', null, t('np.what')),
      h('p', { class: 'wpa-hint', text: t('np.hint') }));
  };

  // ================================================================ PASO 2: revision
  V.review = function (A) {
    var S = A.S;
    var c = A.criticalPending();
    var kids = [stepHead(A, t('s2.title'), t('s2.lead')), V.summaryBar(A)];
    kids.push(h('div', { class: 'wpa-row wpa-row--end' },
      btn(t('nav.recheck'), { kind: 'secondary', icon: 'refresh', disabled: S.doctor.state === 'running', act: 'recheck', onclick: function () { A.recheck(); } })));
    kids.push(h('h3', { class: 'wpa-h3', text: t('s2.group.server') }));
    kids.push(V.checkList(A, S.serverIds));
    kids.push(h('h3', { class: 'wpa-h3', text: t('s2.group.browser') }));
    kids.push(V.checkList(A, WPA.BROWSER_SHOWN));
    if (S.doctor.state === 'error') kids.push(note('bad', t('s2.error'), t('err.' + (S.doctor.error || 'generic'))));
    if (c > 0 && S.doctor.state === 'done') kids.push(note('warn', null, t('s2.blocked', { n: c })));
    kids.push(footer(A, function () { A.back(); },
      btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', disabled: c > 0 || S.doctor.state !== 'done', act: 'next', onclick: function () { A.go(3); } })));
    return h('div', { class: 'wpa-pane' }, kids);
  };

  // ================================================================ PASO 3: conexion segura
  V.sslLevel = function (A) {
    var s = A.S.doctor.ssl || {};
    var b6 = A.S.bchecks.B6, b7 = A.S.bchecks.B7;
    if (!s.tls) return 'bad';
    if (s.days !== null && s.days !== undefined && s.days < 0) return 'bad';
    if (b7 && b7.level === 'bad') return 'bad';
    if (s.class === 'self' || !s.san_ok) return 'warn';
    if (b6 && b6.level === 'bad') return 'bad';
    return 'ok';
  };
  V.secure = function (A) {
    var S = A.S;
    var sub = S.sub[3] || 'detect';
    if (sub === 'ask1' || sub === 'ask2') return V.secureAsk(A, sub);
    var s = S.doctor.ssl || {};
    var cs = S.wizard.data.ssl_case || s.case || 'b';
    var lvl = V.sslLevel(A);
    var kids = [stepHead(A, t('s3.title'), t('s3.lead'))];
    // Lo que se detecto
    var facts = h('dl', { class: 'wpa-facts' });
    function fact(k, v) { facts.appendChild(h('div', { class: 'wpa-fact' }, h('dt', { text: k }), h('dd', { text: v }))); }
    fact(t('s3.f.host'), (s.host || '-') + ' (' + t('s3.kind.' + (s.host_kind === 'ip' ? (s.ip_private ? 'ipp' : 'ipu') : (s.public_name ? 'name' : 'nameloc'))) + ')');
    fact(t('s3.f.cert'), s.tls ? t('s3.cert.v', { issuer: s.issuer || '?', days: s.days === null ? '?' : s.days }) : t('s3.cert.none'));
    fact(t('s3.f.class'), t('s3.class.' + (s.class || 'none')));
    fact(t('s3.f.san'), s.san_ok ? t('s3.san.yes') : t('s3.san.no'));
    fact(t('s3.f.p80'), s.port80 ? t('s3.p80.yes') : t('s3.p80.no'));
    kids.push(h('div', { class: 'wpa-sslstate wpa-sslstate--' + lvl }, lamp(lvl), h('p', { class: 'wpa-sslstate__t', role: 'status', text: t('s3.state.' + lvl + (lvl === 'ok' && s.class === 'local' ? '.local' : '')) })));
    kids.push(facts);
    kids.push(h('h3', { class: 'wpa-h3', text: t('s3.case.' + cs + '.title') }));
    kids.push(h('p', { class: 'wpa-p', text: t('s3.case.' + cs + '.body') }));
    // Resolver del caso
    var fix = A.sslFixFor(cs, s);
    if (fix && lvl !== 'ok') {
      var c = { id: 'SSL', level: lvl === 'bad' ? 'bad' : 'warn', code: 'ssl', critical: false, p: {}, fix: fix };
      var fs = S.fix.SSL || { status: 'idle' };
      var rowActs = h('div', { class: 'wpa-row' });
      rowActs.appendChild(btn(fixButtonLabel(c), { kind: 'primary', act: 'resolve', cls: 'wpa-resolve', expanded: !!S.fixOpen.SSL, controls: 'wpa-fix-SSL',
        onclick: function () { A.openFix(c); } }));
      if (fix.alt === 'ca' && fix.kind === 'cmd') {
        rowActs.appendChild(btn(t('fix.ca'), { kind: 'secondary', act: 'resolve-ca', onclick: function () { S.sslAlt = !S.sslAlt; A.render('keep'); } }));
      }
      kids.push(rowActs);
      var fx = V.fixPanel(A, c, fs);
      if (fx) kids.push(fx);
      if (S.sslAlt) kids.push(h('div', { class: 'wpa-fix' }, V.caGuide(A)));
    }
    if (lvl !== 'ok' && lvl !== 'bad') {
      var man = S.wizard.data.ssl_choice === 'manual';
      kids.push(h('div', { class: 'wpa-manual' },
        h('label', { class: 'wpa-check-l', for: 'wpa-manual' }, (function () {
          var cb = h('input', { type: 'checkbox', id: 'wpa-manual', checked: man });
          cb.addEventListener('change', function () { A.setData({ ssl_choice: cb.checked ? 'manual' : 'cmd' }); A.render('keep'); });
          return cb;
        })(), h('span', { text: t('s3.manual.cb') })),
        man ? note('warn', t('s3.manual.t'), t('s3.manual.b')) : null));
    }
    kids.push(h('div', { class: 'wpa-row' }, btn(t('s3.other'), { kind: 'ghost', icon: 'help', onclick: function () { A.sub(3, 'ask1'); } }),
      btn(t('nav.recheck'), { kind: 'ghost', icon: 'refresh', onclick: function () { A.recheck(); } })));
    kids.push(footer(A, function () { A.back(); },
      btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', disabled: lvl === 'bad', act: 'next', onclick: function () { A.go(4); } })));
    return h('div', { class: 'wpa-pane' }, kids);
  };

  V.secureAsk = function (A, sub) {
    var S = A.S;
    var d = S.askSsl || (S.askSsl = {});
    var kids = [];
    if (sub === 'ask1') {
      kids.push(stepHead(A, t('s3.q1.title'), t('s3.q1.lead')));
      kids.push(choice('how', [
        { value: 'name', title: t('s3.q1.name'), desc: t('s3.q1.name.d'), eg: 'central.miempresa.com' },
        { value: 'ip', title: t('s3.q1.ip'), desc: t('s3.q1.ip.d'), eg: '203.0.113.10' }], d.how, function (v) { d.how = v; A.render('keep'); }));
      kids.push(footer(A, function () { A.sub(3, 'detect'); }, btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', disabled: !d.how, onclick: function () { A.sub(3, 'ask2'); } })));
    } else {
      kids.push(stepHead(A, t('s3.q2.title'), t('s3.q2.lead')));
      kids.push(choice('out', [
        { value: 'yes', title: t('s3.q2.yes'), desc: t('s3.q2.yes.d') },
        { value: 'no', title: t('s3.q2.no'), desc: t('s3.q2.no.d') }], d.out, function (v) { d.out = v; A.render('keep'); }));
      kids.push(footer(A, function () { A.sub(3, 'ask1'); }, btn(t('nav.apply'), { kind: 'primary', disabled: !d.out, onclick: function () {
        var cs = d.how === 'name' ? (d.out === 'yes' ? 'd' : 'c') : (d.out === 'yes' ? 'a' : 'b');
        A.setData({ ssl_case: cs }); A.sub(3, 'detect'); } })));
    }
    return h('div', { class: 'wpa-pane' }, kids);
  };

  // ================================================================ rango de audio: pregunta de llamadas simultaneas
  function rtpInfo(A) {
    var c7 = A.S.doctor.checks.S7, p = c7 && c7.p ? c7.p : {};
    return { start: p.start > 0 ? p.start : 0, end: p.end > 0 ? p.end : 0, docker: p.docker === 'yes', pbx: p.source === 'issabelpbx', guide: p.source === 'issabelpbx' && p.priv === 'no' };
  }
  /** Resumen de una linea del rango que se escribira (usa la respuesta valida de la pregunta). */
  V.rtpSummary = function (A) {
    var R = A.S.rtp, info = rtpInfo(A);
    if (R.calls === null) return note('warn', null, t('rtp.err.' + (R.err || 'invalid')));
    var pl = WPA.rtp.plan(R.calls, info.start);
    if (info.guide && info.start) return h('p', { class: 'wpa-fix__d wpa-rtp__sum', text: t('rtp.pbx.summary', { calls: R.calls, start: pl.start, end: pl.end }) });
    return h('p', { class: 'wpa-fix__d wpa-rtp__sum', text: info.start ? t('rtp.fix.summary', { calls: R.calls, start: pl.start, end: pl.end }) : t('rtp.fix.summary.nostart', { calls: R.calls, ports: pl.ports }) });
  };
  /** Tarjeta: pregunta, rango calculado, bloque exacto y puertos UDP del firewall. o.inFix: dentro del Resolver (sin encabezado). */
  V.rtpCard = function (A, o) {
    o = o || {};
    var S = A.S, R = S.rtp, info = rtpInfo(A);
    var kids = [];
    if (!o.inFix) {
      kids.push(h('h3', { class: 'wpa-h3', id: 'wpa-rtp-t', text: t('rtp.q.title') }));
      kids.push(h('p', { class: 'wpa-p', text: t('rtp.q.lead') }));
    }
    var inp = textInput(A, 'wpa-rtp-calls', R.draft, function (v) { A.setCalls(v); }, { max: 4, inputmode: 'numeric', ph: String(WPA.rtp.DEF), hint: true, invalid: !!R.err });
    inp.setAttribute('aria-describedby', 'wpa-rtp-calls-h' + (R.err ? ' wpa-rtp-calls-e' : ''));
    inp.classList.add('wpa-input--num');
    kids.push(field('wpa-rtp-calls', t('rtp.q.label'), inp, t('rtp.q.hint'), R.err ? t('rtp.err.' + R.err) : null));
    if (!R.err && R.calls !== null) {
      var pl = WPA.rtp.plan(R.calls, info.start);
      var facts = h('dl', { class: 'wpa-facts' });
      var fact = function (k, v) { facts.appendChild(h('div', { class: 'wpa-fact' }, h('dt', { text: k }), h('dd', { text: v }))); };
      if (info.start) {
        fact(t('rtp.f.now'), t('rtp.range', { start: info.start, end: info.end }));
        fact(t('rtp.f.new'), t('rtp.range.ports', { start: pl.start, end: pl.end, ports: pl.ports }));
        fact(t('rtp.f.fw'), t('rtp.fw', { start: pl.start, end: pl.end }));
      } else {
        fact(t('rtp.f.ports'), String(pl.ports));
      }
      kids.push(h('div', { class: 'wpa-rtp__res', 'aria-live': 'polite' }, facts));
      if (info.start && info.pbx) kids.push(codeBox(A, t('rtp.pbx.vals', { start: pl.start, end: pl.end }), t('rtp.preview.pbx')));
      else if (info.start) kids.push(codeBox(A, WPA.rtp.block(pl.start, pl.end), t('rtp.preview.label')));
      else kids.push(h('p', { class: 'wpa-hint', text: t('rtp.nostart') }));
    }
    kids.push(h('p', { class: 'wpa-hint wpa-rtp__formula', text: t('rtp.formula') }));
    if (info.docker) kids.push(note('info', null, t('rtp.docker')));
    return h('section', { class: o.inFix ? 'wpa-rtpq wpa-rtpq--fix' : 'wpa-card wpa-rtpq', 'aria-labelledby': o.inFix ? null : 'wpa-rtp-t' }, kids);
  };

  // ================================================================ PASO 4: audio y red
  V.audio = function (A) {
    var S = A.S;
    var usage = S.wizard.data.usage;
    var sub = S.sub[4] || (usage ? 'detail' : 'ask');
    if (sub === 'ask' || !usage) {
      return h('div', { class: 'wpa-pane' }, stepHead(A, t('s4.title'), t('s4.lead')),
        choice('usage', [
          { value: 'inside', title: t('s4.inside'), desc: t('s4.inside.d') },
          { value: 'outside', title: t('s4.outside'), desc: t('s4.outside.d') },
          { value: 'both', title: t('s4.both'), desc: t('s4.both.d') }], usage, function (v) { A.pickUsage(v); }),
        footer(A, function () { A.back(); }, btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', disabled: !usage, onclick: function () { A.sub(4, 'detail'); } })));
    }
    var kids = [stepHead(A, t('s4.detail.title'), t('s4.detail.lead.' + usage))];
    kids.push(h('div', { class: 'wpa-row' }, btn(t('s4.change'), { kind: 'ghost', icon: 'sliders', onclick: function () { A.sub(4, 'ask'); } }),
      btn(t('nav.recheck'), { kind: 'ghost', icon: 'refresh', onclick: function () { A.recheck(); } })));
    kids.push(V.rtpCard(A, {}));
    kids.push(V.checkList(A, ['S7', 'S8', 'S9', 'S14', 'B8']));
    var ap = V.applied ? V.applied(A) : null;
    if (ap) kids.push(ap);
    if (usage !== 'inside') {
      kids.push(note('info', t('s4.turn.t'), t('s4.turn.b')));
    }
    kids.push(footer(A, function () { A.back(); }, btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', act: 'next', onclick: function () { A.go(5); } })));
    return h('div', { class: 'wpa-pane' }, kids);
  };

  // ================================================================ PASO 5: telefonos (perfil, modo, datos, vista previa, resultado)
  V.profileForm = function (A, o) {
    o = o || {};
    var S = A.S;
    var p = S.profileDraft;
    var kids = [];
    kids.push(h('p', { class: 'wpa-lead', text: t('pf.lead') }));
    kids.push(h('fieldset', { class: 'wpa-fs' }, h('legend', { text: t('pf.codecs') }),
      choice('codecs', [
        { value: 'auto', title: t('pf.codecs.auto'), desc: t('pf.codecs.auto.d') },
        { value: 'g711', title: t('pf.codecs.g711'), desc: t('pf.codecs.g711.d') }], p.codecs, function (v) { p.codecs = v; A.render('keep'); })));
    kids.push(h('h3', { class: 'wpa-h3', text: t('pf.quick') }));
    kids.push(h('fieldset', { class: 'wpa-fs' }, h('legend', { text: t('pf.rec') }),
      choice('rec', [
        { value: 'dontcare', title: t('pf.rec.dontcare'), desc: t('pf.rec.dontcare.d') },
        { value: 'always', title: t('pf.rec.always'), desc: t('pf.rec.always.d') },
        { value: 'never', title: t('pf.rec.never'), desc: t('pf.rec.never.d') },
        { value: 'ondemand', title: t('pf.rec.ondemand'), desc: t('pf.rec.ondemand.d') }], p.recording, function (v) { p.recording = v; A.render('keep'); })));
    var cw = h('input', { type: 'checkbox', id: 'wpa-pf-cw', checked: !!p.callwaiting, role: 'switch' });
    cw.addEventListener('change', function () { p.callwaiting = cw.checked; A.render('keep'); });
    kids.push(h('div', { class: 'wpa-switchrow' }, h('label', { class: 'wpa-switch', for: 'wpa-pf-cw' }, cw, h('span', { class: 'wpa-switch__ui', 'aria-hidden': 'true' }),
      h('span', { class: 'wpa-switch__t' }, h('strong', { text: t('pf.cw') }), h('span', { text: t('pf.cw.d') })))));
    var errCid = S.profileErr && S.profileErr.outbound_cid ? t('pf.cid.err') : null;
    kids.push(field('wpa-pf-cid', t('pf.cid'), textInput(A, 'wpa-pf-cid', p.outbound_cid, function (v) { p.outbound_cid = v; }, { ph: '5551234', max: 32, hint: true, invalid: !!errCid }), t('pf.cid.hint'), errCid));
    kids.push(note('info', t('pf.more.t'), t('pf.more.b')));
    kids.push(h('p', {}, h('a', { class: 'wpa-link', href: S.urls.pbx_init, target: '_blank', rel: 'noopener', onclick: function (e) { e.preventDefault(); A.openExt(''); } }, icon('ext'), h('span', { text: t('pf.more.link') }))));
    var acts = h('div', { class: 'wpa-row' });
    acts.appendChild(btn(S.profileBusy ? t('nav.saving') : t('pf.save'), { kind: 'primary', icon: 'check', act: 'save-profile', disabled: S.profileBusy || !S.caps.admin, onclick: function () { A.saveProfile(); } }));
    if (S.profile_prev) acts.appendChild(btn(t('pf.revert'), { kind: 'ghost', icon: 'undo', onclick: function () { A.revertProfile(); } }));
    if (!S.caps.admin) kids.push(note('warn', null, t('pf.adminonly')));
    kids.push(acts);
    if (S.profileMsg) kids.push(note(S.profileMsg.kind, S.profileMsg.text));
    return h('div', { class: 'wpa-profile' }, kids);
  };

  V.applyAll = function (A) {
    var S = A.S;
    var r = S.repair;
    var kids = [h('h3', { class: 'wpa-h3', text: t('aa.title') }), h('p', { class: 'wpa-p', text: t('aa.lead') })];
    kids.push(h('div', { class: 'wpa-row' }, btn(r.busy === 'plan' ? t('aa.loading') : t('aa.preview'), { kind: 'secondary', icon: 'list', act: 'aa-preview', disabled: !!r.busy, onclick: function () { A.repairPlan(); } })));
    if (r.plan) {
      var withCh = r.plan.anexos.filter(function (a) { return a.changes && a.changes.length; });
      if (r.plan.anexos.length === 0) kids.push(note('info', null, t('aa.none')));
      else {
        kids.push(note(withCh.length ? 'warn' : 'ok', t('aa.sum', { n: r.plan.anexos.length, m: withCh.length })));
        if (withCh.length) {
          var ul = h('ul', { class: 'wpa-diff' });
          withCh.slice(0, 50).forEach(function (a) {
            var li = h('li', { class: 'wpa-diff__i' }, h('p', { class: 'wpa-diff__h' }, h('strong', { text: a.ext }), h('span', { text: ' ' + (a.name || '') })));
            var cl = h('ul', { class: 'wpa-diff__c' });
            a.changes.forEach(function (c) { cl.appendChild(h('li', {}, h('span', { class: 'wpa-diff__f', text: t('f.' + c.f) }), h('span', { class: 'wpa-diff__v' }, h('del', { text: c.from === '' ? t('f.empty') : c.from }), icon('next'), h('ins', { text: c.to === '' ? t('f.empty') : c.to })))); });
            li.appendChild(cl);
            ul.appendChild(li);
          });
          kids.push(ul);
          if (withCh.length > 50) kids.push(h('p', { class: 'wpa-hint', text: t('aa.more', { n: withCh.length - 50 }) }));
          if (r.plan.calls > 0) {
            var cb = h('input', { type: 'checkbox', id: 'wpa-aa-calls', checked: !!r.calls });
            cb.addEventListener('change', function () { r.calls = cb.checked; A.render('keep'); });
            kids.push(h('label', { class: 'wpa-check-l', for: 'wpa-aa-calls' }, cb, h('span', { text: t('calls.confirm', { n: r.plan.calls }) })));
          }
          kids.push(h('div', { class: 'wpa-row' }, btn(r.busy === 'apply' ? t('aa.applying') : t('aa.apply', { n: withCh.length }), { kind: 'primary', act: 'aa-apply',
            disabled: !!r.busy || (r.plan.calls > 0 && !r.calls), onclick: function () { A.repairApply(); } })));
        }
      }
    }
    if (r.result) {
      var cnt = { repaired: 0, unchanged: 0, skipped: 0, error: 0 };
      r.result.results.forEach(function (x) { cnt[x.status] = (cnt[x.status] || 0) + 1; });
      kids.push(note(cnt.error ? 'warn' : 'ok', t('aa.done', { n: cnt.repaired || 0 }), t('aa.done.b', { rc: r.result.retrieve_conf, rl: r.result.reload_pjsip })));
    }
    return h('div', { class: 'wpa-applyall' }, kids);
  };

  V.phonesProfile = function (A) {
    return h('div', { class: 'wpa-pane' }, stepHead(A, t('s5.profile.title')), V.profileForm(A), V.applyAll(A),
      footer(A, function () { A.back(); }, btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', act: 'next', onclick: function () { A.sub(5, 'mode'); } })));
  };

  V.phonesMode = function (A, inTab) {
    var S = A.S;
    var d = S.alta;
    var kids = [inTab ? h('h3', { class: 'wpa-h3', text: t('s5.mode.title') }) : stepHead(A, t('s5.mode.title'), t('s5.mode.lead'))];
    kids.push(choice('mode', [
      { value: 'one', title: t('s5.mode.one'), desc: t('s5.mode.one.d'), eg: '7410' },
      { value: 'range', title: t('s5.mode.range'), desc: t('s5.mode.range.d'), eg: '7410-7430' },
      { value: 'csv', title: t('s5.mode.csv'), desc: t('s5.mode.csv.d'), eg: '.csv' }], d.mode, function (v) { d.mode = v; d.plan = null; d.result = null; A.render('keep'); }));
    var next = btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', disabled: !d.mode, act: 'next', onclick: function () { A.altaStep('data'); } });
    if (inTab) kids.push(h('div', { class: 'wpa-foot' }, h('span'), h('div', { class: 'wpa-foot__r' }, next)));
    else kids.push(footer(A, function () { A.back(); }, next, S.counts.webphone > 0 ? btn(t('s5.skip'), { kind: 'ghost', onclick: function () { A.go(6); } }) : null));
    return h('div', { class: inTab ? 'wpa-alta' : 'wpa-pane' }, kids);
  };

  V.altaData = function (A, inTab) {
    var S = A.S;
    var d = S.alta;
    var kids = [inTab ? h('h3', { class: 'wpa-h3', text: t('s5.data.title.' + d.mode) }) : stepHead(A, t('s5.data.title.' + d.mode), t('s5.data.lead.' + d.mode))];
    if (d.mode === 'one') {
      kids.push(field('wpa-one-name', t('s5.f.name'), textInput(A, 'wpa-one-name', d.one.name, function (v) { d.one.name = v; }, { max: 40, hint: true }), t('s5.f.name.h')));
      kids.push(field('wpa-one-ext', t('s5.f.ext'), textInput(A, 'wpa-one-ext', d.one.ext, function (v) { d.one.ext = v; }, { max: 6, inputmode: 'numeric', hint: true, ph: '7410' }), t('s5.f.ext.h', { min: S.ext_range[0], max: S.ext_range[1] })));
      var selfCb = h('input', { type: 'checkbox', id: 'wpa-one-self', checked: !!d.one.self });
      selfCb.addEventListener('change', function () { d.one.self = selfCb.checked; A.render('keep'); });
      kids.push(h('label', { class: 'wpa-check-l', for: 'wpa-one-self' }, selfCb, h('span', { text: t('s5.f.self', { user: S.user }) })));
      if (!d.one.self) kids.push(field('wpa-one-user', t('s5.f.user'), textInput(A, 'wpa-one-user', d.one.user, function (v) { d.one.user = v; }, { max: 50, hint: true, disabled: !S.caps.assign_others && !S.caps.admin }), S.caps.assign_others ? t('s5.f.user.h') : t('s5.f.user.noperm')));
    } else if (d.mode === 'range') {
      kids.push(h('div', { class: 'wpa-grid2' },
        field('wpa-r-from', t('s5.f.from'), textInput(A, 'wpa-r-from', d.range.from, function (v) { d.range.from = v; }, { max: 6, inputmode: 'numeric', ph: '7410' })),
        field('wpa-r-to', t('s5.f.to'), textInput(A, 'wpa-r-to', d.range.to, function (v) { d.range.to = v; }, { max: 6, inputmode: 'numeric', ph: '7430' }))));
      kids.push(field('wpa-r-prefix', t('s5.f.prefix'), textInput(A, 'wpa-r-prefix', d.range.prefix, function (v) { d.range.prefix = v; }, { max: 25, hint: true, ph: 'Agente' }), t('s5.f.prefix.h')));
    } else {
      var fileIn = h('input', { type: 'file', id: 'wpa-csv-file', accept: '.csv,text/csv,text/plain', class: 'wpa-file__in' });
      fileIn.addEventListener('change', function () { if (fileIn.files && fileIn.files[0]) A.loadCsv(fileIn.files[0]); });
      var drop = h('label', { class: 'wpa-drop' + (d.csv.error ? ' has-error' : ''), for: 'wpa-csv-file' }, icon('upload'),
        h('span', { class: 'wpa-drop__t', text: d.csv.name ? d.csv.name : t('s5.csv.drop') }),
        h('span', { class: 'wpa-drop__h', text: d.csv.name ? t('s5.csv.bytes', { n: Math.round((d.csv.text || '').length / 102.4) / 10 }) : t('s5.csv.limits') }), fileIn);
      ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
      drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) A.loadCsv(f); });
      kids.push(drop);
      if (d.csv.error) kids.push(note('bad', t('err.' + d.csv.error)));
      kids.push(h('div', { class: 'wpa-row' }, btn(t('s5.csv.template'), { kind: 'secondary', icon: 'download', act: 'csv-template', onclick: function () { A.csvTemplate(); } })));
      kids.push(h('div', { class: 'wpa-cols' }, h('p', { class: 'wpa-hint', text: t('s5.csv.cols') })));
    }
    var go = btn(d.busy ? t('s5.previewing') : t('s5.preview'), { kind: 'primary', iconAfter: 'next', act: 'preview', disabled: !!d.busy || (d.mode === 'csv' && !d.csv.text), onclick: function () { A.altaPreview(); } });
    if (d.error) kids.push(note('bad', t('err.' + d.error)));
    kids.push(footer(A, function () { A.altaStep('mode'); }, go));
    return h('div', { class: inTab ? 'wpa-alta' : 'wpa-pane' }, kids);
  };

  function codeMsg(c) {
    var p = { n: c.n };
    return t('code.' + c.c, p);
  }
  V.codeMsg = codeMsg;

  V.altaPreview = function (A, inTab) {
    var S = A.S;
    var d = S.alta;
    var pl = d.plan;
    var kids = [inTab ? h('h3', { class: 'wpa-h3', text: t('s5.prev.title') }) : stepHead(A, t('s5.prev.title'), t('s5.prev.lead'))];
    if (!pl) return h('div', { class: 'wpa-pane' }, kids);
    var sm = pl.summary;
    kids.push(h('div', { class: 'wpa-sum' }, h('p', { class: 'wpa-sum__t', role: 'status', text: t('s5.prev.sum', { n: sm.total, ok: sm.ok, bad: sm.errors }) }),
      h('div', { class: 'wpa-sum__c' }, sm.ok ? chip('ok', t('sum.valid', { n: sm.ok })) : null, sm.errors ? chip('bad', t('sum.invalid', { n: sm.errors })) : null)));
    if (sm.errors) {
      var by = h('ul', { class: 'wpa-bycode' });
      Object.keys(sm.by_code).forEach(function (k) { by.appendChild(h('li', { text: t('code.' + k + '.sum', { n: sm.by_code[k] }) })); });
      kids.push(by);
    }
    var tbl = h('table', { class: 'wpa-table' }, h('caption', { class: 'wpa-sr', text: t('s5.prev.caption') }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: d.mode === 'csv' ? t('col.line') : '#' }), h('th', { scope: 'col', text: t('col.ext') }), h('th', { scope: 'col', text: t('col.name') }),
        h('th', { scope: 'col', text: t('col.user') }), h('th', { scope: 'col', text: t('col.status') }))));
    var tb = h('tbody');
    var shown = pl.rows.slice(0, 200);
    shown.forEach(function (r) {
      var st = r.status === 'ok' ? chip('ok', t('st.valid')) : chip('bad', t('st.invalid'));
      var det = r.codes && r.codes.length ? h('ul', { class: 'wpa-codes' }, r.codes.map(function (c) { return h('li', { text: codeMsg(c) }); })) : null;
      tb.appendChild(h('tr', { class: r.status === 'ok' ? '' : 'is-bad' },
        h('td', { 'data-l': t('col.line'), text: String(r.line) }), h('td', { 'data-l': t('col.ext'), text: r.ext }), h('td', { 'data-l': t('col.name'), text: r.name }),
        h('td', { 'data-l': t('col.user'), text: r.user || '-' }), h('td', { class: 'wpa-td-st', 'data-l': t('col.status') }, st, det)));
    });
    tbl.appendChild(tb);
    kids.push(h('div', { class: 'wpa-tablewrap', tabindex: '0', role: 'region', 'aria-label': t('s5.prev.caption') }, tbl));
    if (pl.rows.length > shown.length) kids.push(h('p', { class: 'wpa-hint', text: t('s5.prev.more', { n: pl.rows.length - shown.length }) }));
    // confirmacion
    var conf = h('div', { class: 'wpa-confirm' });
    conf.appendChild(h('h3', { class: 'wpa-h3', text: t('s5.conf.title') }));
    conf.appendChild(h('p', { class: 'wpa-p', text: t('s5.conf.body', { n: sm.ok }) }));
    conf.appendChild(h('ul', { class: 'wpa-ul' }, h('li', { text: t('s5.conf.l1') }), h('li', { text: t('s5.conf.l2') }), h('li', { text: t('s5.conf.l3') })));
    if (pl.calls > 0) {
      var cb = h('input', { type: 'checkbox', id: 'wpa-calls', checked: !!d.calls });
      cb.addEventListener('change', function () { d.calls = cb.checked; A.render('keep'); });
      conf.appendChild(note('warn', t('calls.title'), t('calls.body', { n: pl.calls })));
      conf.appendChild(h('label', { class: 'wpa-check-l', for: 'wpa-calls' }, cb, h('span', { text: t('calls.confirm', { n: pl.calls }) })));
    }
    var cOk = h('input', { type: 'checkbox', id: 'wpa-confirm', checked: !!d.confirm });
    cOk.addEventListener('change', function () { d.confirm = cOk.checked; A.render('keep'); });
    conf.appendChild(h('label', { class: 'wpa-check-l', for: 'wpa-confirm' }, cOk, h('span', { text: t('s5.conf.cb', { n: sm.ok }) })));
    if (sm.ok > 0) kids.push(conf);
    var disabled = !!d.busy || sm.ok === 0 || !d.confirm || (pl.calls > 0 && !d.calls);
    if (d.error) kids.push(note('bad', t('err.' + d.error, { calls: d.errCalls })));
    var create = btn(d.busy ? t('s5.creating') : t('s5.create', { n: sm.ok }), { kind: 'primary', icon: 'check', act: 'create', disabled: disabled, onclick: function () { A.altaApply(); } });
    kids.push(footer(A, function () { A.altaStep('data'); }, create));
    return h('div', { class: inTab ? 'wpa-alta' : 'wpa-pane' }, kids);
  };

  V.altaResult = function (A, inTab) {
    var S = A.S;
    var d = S.alta;
    var rs = d.result;
    var kids = [inTab ? h('h3', { class: 'wpa-h3', text: t('s5.res.title') }) : stepHead(A, t('s5.res.title'), t('s5.res.lead'))];
    var c = rs.counts;
    kids.push(h('div', { class: 'wpa-sum' }, h('p', { class: 'wpa-sum__t', role: 'status', text: t('s5.res.sum', { n: c.created, s: c.skipped, f: c.failed }) }),
      h('div', { class: 'wpa-sum__c' }, c.created ? chip('ok', t('sum.created', { n: c.created })) : null, c.skipped ? chip('warn', t('sum.skipped', { n: c.skipped })) : null, c.failed ? chip('bad', t('sum.failed', { n: c.failed })) : null)));
    kids.push(note('info', t('s5.res.applied.t'), t('s5.res.applied', { rc: rs.retrieve_conf, rl: rs.reload_pjsip })));
    kids.push(note('info', null, t('s5.res.nosecret')));
    var tbl = h('table', { class: 'wpa-table' }, h('caption', { class: 'wpa-sr', text: t('s5.res.caption') }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: d.mode === 'csv' ? t('col.line') : '#' }), h('th', { scope: 'col', text: t('col.ext') }), h('th', { scope: 'col', text: t('col.name') }),
        h('th', { scope: 'col', text: t('col.user') }), h('th', { scope: 'col', text: t('col.status') }))));
    var tb = h('tbody');
    rs.results.slice(0, 200).forEach(function (r) {
      var lvl = r.status === 'created' ? 'ok' : r.status === 'skipped' ? 'warn' : 'bad';
      var detail = r.code ? h('span', { class: 'wpa-res__d', text: t('code.' + r.code) }) : null;
      tb.appendChild(h('tr', { class: lvl === 'ok' ? '' : 'is-bad' },
        h('td', { 'data-l': t('col.line'), text: String(r.line) }), h('td', { 'data-l': t('col.ext'), text: r.ext }), h('td', { 'data-l': t('col.name'), text: r.name }),
        h('td', { 'data-l': t('col.user'), text: r.user || '-' }), h('td', { class: 'wpa-td-st', 'data-l': t('col.status') }, chip(lvl, t('st.' + r.status)), detail)));
    });
    tbl.appendChild(tb);
    kids.push(h('div', { class: 'wpa-tablewrap', tabindex: '0', role: 'region', 'aria-label': t('s5.res.caption') }, tbl));
    kids.push(h('div', { class: 'wpa-row' }, btn(t('s5.res.export'), { kind: 'secondary', icon: 'download', act: 'export', onclick: function () { A.exportResult(); } }),
      btn(t('s5.res.more'), { kind: 'ghost', icon: 'plus', onclick: function () { A.altaReset(); } })));
    if (inTab) return h('div', { class: 'wpa-alta' }, kids);
    kids.push(footer(A, null, btn(t('nav.next'), { kind: 'primary', iconAfter: 'next', act: 'next', onclick: function () { A.go(6); } })));
    return h('div', { class: 'wpa-pane' }, kids);
  };

  /** Contenido del alta (compartido por el paso 5 y la pestana Anexos). */
  V.altaBody = function (A, inTab) {
    var S = A.S, d = S.alta;
    if (!S.caps.ext) return note('warn', t('perm.ext.t'), t('perm.ext.b'));
    var sub = d.step;
    if (sub === 'result' && d.result) return V.altaResult(A, inTab);
    if (sub === 'preview' && d.plan) return V.altaPreview(A, inTab);
    if (sub === 'data' && d.mode) return V.altaData(A, inTab);
    return V.phonesMode(A, inTab);
  };
  V.phones = function (A) {
    var S = A.S;
    var sub = S.sub[5] || 'profile';
    if (sub === 'profile') return V.phonesProfile(A);
    // Dentro del paso 5, "Atras" desde el modo vuelve al perfil
    return V.altaBody(A, false);
  };

  // ================================================================ PASO 6: probar y compartir
  V.test = function (A) {
    var S = A.S;
    var kids = [stepHead(A, t('s6.title'), t('s6.lead'))];
    // microfono
    var m = S.mic;
    var micBox = h('section', { class: 'wpa-card' }, h('h3', { class: 'wpa-h3', text: t('s6.mic') }), h('p', { class: 'wpa-p', text: t('s6.mic.d') }));
    if (m.status === 'running') {
      micBox.appendChild(h('div', { class: 'wpa-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(m.level * 100)), 'aria-label': t('fix.mic.meter') },
        h('span', { class: 'wpa-meter__fill', style: 'transform:scaleX(' + Math.min(1, m.level * 3).toFixed(3) + ')' })));
      micBox.appendChild(h('p', { class: 'wpa-hint', text: m.ignored ? t('fix.mic.ignored') : t('fix.mic.speak') }));
    } else {
      if (m.status === 'done' && m.result) micBox.appendChild(note(m.result === 'ok' ? 'ok' : 'warn', t('fix.mic.r.' + m.result)));
      micBox.appendChild(h('div', { class: 'wpa-row' }, btn(t('fix.browser.mic_test'), { kind: 'secondary', icon: 'mic', act: 'mic-test', onclick: function () { A.micTest(); } })));
    }
    kids.push(micBox);
    // altavoz
    var sp = S.speaker;
    var spBox = h('section', { class: 'wpa-card' }, h('h3', { class: 'wpa-h3', text: t('s6.spk') }), h('p', { class: 'wpa-p', text: t('s6.spk.d') }));
    var spRow = h('div', { class: 'wpa-row' }, btn(sp.playing ? t('s6.spk.playing') : t('s6.spk.play'), { kind: 'secondary', icon: 'play', act: 'tone', disabled: sp.playing, onclick: function () { A.playTone(); } }));
    if (sp.played) {
      spRow.appendChild(btn(t('s6.spk.yes'), { kind: sp.heard === true ? 'primary' : 'ghost', icon: 'check', onclick: function () { sp.heard = true; A.render('keep'); } }));
      spRow.appendChild(btn(t('s6.spk.no'), { kind: sp.heard === false ? 'primary' : 'ghost', icon: 'x', onclick: function () { sp.heard = false; A.render('keep'); } }));
    }
    spBox.appendChild(spRow);
    if (sp.heard === false) spBox.appendChild(note('warn', null, t('s6.spk.fix')));
    kids.push(spBox);
    // eco
    var hasBar = !!(w.WebphoneKit && w.WebphoneKit.call);
    kids.push(h('section', { class: 'wpa-card' }, h('h3', { class: 'wpa-h3', text: t('s6.echo') }), h('p', { class: 'wpa-p', text: t('s6.echo.d') }),
      h('div', { class: 'wpa-row' }, btn(t('s6.echo.btn'), { kind: 'secondary', icon: 'phone', disabled: !hasBar, act: 'echo', onclick: function () { A.echoTest(); } })),
      hasBar ? null : note('info', null, t('s6.echo.nobar')), S.echo ? note(S.echo.level === 'ok' ? 'ok' : 'warn', t('c.B9.' + S.echo.code)) : null));
    // compartir
    var link = location.origin + '/';
    if (S.shareUrl) link = S.shareUrl;
    var msg = t('s6.share.msg', { url: link });
    kids.push(h('section', { class: 'wpa-card wpa-card--share' }, h('h3', { class: 'wpa-h3', text: t('s6.share') }), h('p', { class: 'wpa-p', text: t('s6.share.d') }),
      codeBox(A, link, t('s6.share.link')), codeBox(A, msg, t('s6.share.text')),
      h('div', { class: 'wpa-row' }, h('a', { class: 'wpa-btn wpa-btn--secondary', href: link, target: '_blank', rel: 'noopener' }, icon('ext'), h('span', { class: 'wpa-btn__t', text: t('s6.share.try') })))));
    // grupo Agente web
    var g = S.group;
    var gBox = h('section', { class: 'wpa-card' }, h('h3', { class: 'wpa-h3', text: t('s6.group') }), h('p', { class: 'wpa-p', text: t('s6.group.d') }));
    if (!S.caps.admin) gBox.appendChild(note('warn', null, t('pf.adminonly')));
    else if (g.exists) {
      gBox.appendChild(note('ok', t('s6.group.exists'), t('s6.group.next')));
      gBox.appendChild(h('p', {}, h('a', { class: 'wpa-link', href: S.urls.users, target: '_blank', rel: 'noopener' }, icon('ext'), h('span', { text: t('s6.group.users') }))));
    } else {
      if (g.confirming) {
        gBox.appendChild(note('warn', t('s6.group.conf.t'), t('s6.group.conf.b')));
        gBox.appendChild(h('div', { class: 'wpa-row' }, btn(g.busy ? t('nav.saving') : t('s6.group.create'), { kind: 'primary', act: 'group-create', disabled: !!g.busy, onclick: function () { A.createGroup(); } }),
          btn(t('nav.cancel'), { kind: 'ghost', onclick: function () { g.confirming = false; A.render('keep'); } })));
      } else {
        gBox.appendChild(h('div', { class: 'wpa-row' }, btn(t('s6.group.offer'), { kind: 'secondary', icon: 'shield', act: 'group-offer', onclick: function () { g.confirming = true; A.render('keep'); } })));
      }
      if (g.error) gBox.appendChild(note('bad', t('err.' + g.error)));
    }
    kids.push(gBox);
    kids.push(footer(A, function () { A.back(); }, btn(t('nav.finish'), { kind: 'primary', icon: 'check', act: 'finish', onclick: function () { A.finish(); } })));
    return h('div', { class: 'wpa-pane' }, kids);
  };

  V.finished = function (A) {
    return h('div', { class: 'wpa-pane wpa-pane--center' },
      h('div', { class: 'wpa-art wpa-art--ok', 'aria-hidden': 'true' }, h('span', { class: 'wpa-art__n' }, icon('check'))),
      stepHead(A, t('done.title'), t('done.lead')),
      h('div', { class: 'wpa-row wpa-row--center' }, btn(t('done.open'), { kind: 'primary', iconAfter: 'next', act: 'open-tabs', onclick: function () { A.openTabs('diagnostic'); } })));
  };

  // ================================================================ pestanas
  V.tabsBar = function (A) {
    var S = A.S;
    var list = h('div', { class: 'wpa-tabs', role: 'tablist', 'aria-label': t('tabs.label') });
    var items = [['diagnostic', 'shield'], ['anexos', 'phone'], ['users', 'users'], ['settings', 'sliders']];
    items.forEach(function (it) {
      var on = S.tab === it[0];
      list.appendChild(h('button', { type: 'button', role: 'tab', id: 'wpa-tab-' + it[0], 'aria-selected': on ? 'true' : 'false', 'aria-controls': 'wpa-panel', tabindex: on ? '0' : '-1',
        class: 'wpa-tab' + (on ? ' is-on' : ''), onclick: function () { A.openTabs(it[0]); },
        onkeydown: function (e) {
          var idx = items.map(function (x) { return x[0]; }).indexOf(it[0]);
          var to = e.key === 'ArrowRight' ? (idx + 1) % items.length : e.key === 'ArrowLeft' ? (idx + items.length - 1) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
          if (to >= 0) { e.preventDefault(); A.openTabs(items[to][0], true); }
        } }, icon(it[1]), h('span', { text: t('tab.' + it[0]) })));
    });
    return list;
  };

  V.diagnostic = function (A) {
    var S = A.S;
    var kids = [h('div', { class: 'wpa-tabhead' }, h('h2', { class: 'wpa-title', id: 'wpa-title', tabindex: '-1', text: t('tab.diagnostic.title') }),
      h('div', { class: 'wpa-row' }, btn(t('nav.recheck'), { kind: 'secondary', icon: 'refresh', disabled: S.doctor.state === 'running', act: 'recheck', onclick: function () { A.recheck(); } }),
        btn(t('tab.reopen'), { kind: 'ghost', icon: 'sparkle', act: 'reopen', onclick: function () { A.reopenWizard(); } }))), V.summaryBar(A)];
    if (A.criticalPending() > 0 && S.doctor.state === 'done') kids.push(note('bad', t('diag.critical.t'), t('diag.critical.b', { n: A.criticalPending() })));
    kids.push(h('h3', { class: 'wpa-h3', text: t('s2.group.server') }));
    kids.push(V.checkList(A, S.serverIds));
    kids.push(h('h3', { class: 'wpa-h3', text: t('s2.group.browser') }));
    kids.push(V.checkList(A, WPA.BROWSER_SHOWN));
    return h('div', { class: 'wpa-panel' }, kids);
  };

  /** Lista de anexos de webphone con su estado frente al perfil y un boton Reparar por fila. */
  V.anexList = function (A) {
    var S = A.S, an = S.anex;
    var kids = [h('h3', { class: 'wpa-h3', text: t('anex.title') }), h('p', { class: 'wpa-p', text: t('anex.lead') })];
    kids.push(h('div', { class: 'wpa-row' }, btn(an.loading ? t('aa.loading') : t('anex.reload'), { kind: 'secondary', icon: 'refresh', act: 'anex-reload', disabled: an.loading, onclick: function () { A.loadAnexos(); } })));
    if (an.msg) kids.push(note(an.msg.kind, an.msg.text));
    if (an.loaded && !an.rows.length) kids.push(note('info', null, t('anex.none')));
    if (an.rows.length) {
      var tbl = h('table', { class: 'wpa-table' }, h('caption', { class: 'wpa-sr', text: t('anex.title') }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: t('col.ext') }), h('th', { scope: 'col', text: t('col.name') }), h('th', { scope: 'col', text: t('col.status') }), h('th', { scope: 'col' }, h('span', { class: 'wpa-sr', text: t('anex.col.act') })))));
      var tb = h('tbody');
      an.rows.forEach(function (r) {
        var need = r.changes && r.changes.length > 0;
        var open = an.confirm === r.ext;
        var acts = h('div', { class: 'wpa-row' });
        if (need) {
          acts.appendChild(btn(open ? t('nav.cancel') : t('anex.repair'), { kind: open ? 'ghost' : 'secondary', icon: open ? 'x' : 'sliders', act: 'repair-one', aria: t('anex.repair') + ' ' + r.ext,
            expanded: open, onclick: function () { an.confirm = open ? null : r.ext; an.calls = false; A.render('keep'); } }));
        }
        tb.appendChild(h('tr', { class: need ? 'is-bad' : '' },
          h('td', { 'data-l': t('col.ext'), text: r.ext }), h('td', { 'data-l': t('col.name'), text: r.name || '' }),
          h('td', { 'data-l': t('col.status') }, need ? chip('warn', t('anex.needs')) : chip('ok', t('anex.ok'))), h('td', null, acts)));
        if (open && need) {
          var cl = h('ul', { class: 'wpa-diff__c' });
          r.changes.forEach(function (c) { cl.appendChild(h('li', {}, h('span', { class: 'wpa-diff__f', text: t('f.' + c.f) }), h('span', { class: 'wpa-diff__v' }, h('del', { text: c.from === '' ? t('f.empty') : c.from }), icon('next'), h('ins', { text: c.to === '' ? t('f.empty') : c.to })))); });
          var calls = S.doctor.calls || 0;
          var cbWrap = null;
          if (calls > 0) {
            var cb = h('input', { type: 'checkbox', id: 'wpa-an-calls', checked: !!an.calls });
            cb.addEventListener('change', function () { an.calls = cb.checked; A.render('keep'); });
            cbWrap = h('label', { class: 'wpa-check-l', for: 'wpa-an-calls' }, cb, h('span', { text: t('calls.confirm', { n: calls }) }));
          }
          tb.appendChild(h('tr', { class: 'wpa-tr-detail' }, h('td', { colspan: '4' }, h('div', { class: 'wpa-confirm' }, h('p', { class: 'wpa-h3', text: t('anex.confirm', { ext: r.ext }) }), cl, cbWrap,
            h('div', { class: 'wpa-row' }, btn(an.busy ? t('aa.applying') : t('anex.confirm.btn', { ext: r.ext }), { kind: 'primary', icon: 'check', act: 'repair-confirm', disabled: !!an.busy || (calls > 0 && !an.calls), onclick: function () { A.repairOne(r.ext); } }))))));
        }
      });
      tbl.appendChild(tb);
      kids.push(h('div', { class: 'wpa-tablewrap', tabindex: '0', role: 'region', 'aria-label': t('anex.title') }, tbl));
    }
    return h('div', { class: 'wpa-anex' }, kids);
  };

  V.anexosTab = function (A) {
    var S = A.S;
    var kids = [h('h2', { class: 'wpa-title', id: 'wpa-title', tabindex: '-1', text: t('tab.anexos.title') })];
    kids.push(V.altaBody(A, true));
    kids.push(h('hr', { class: 'wpa-hr' }));
    kids.push(V.anexList(A));
    kids.push(h('hr', { class: 'wpa-hr' }));
    kids.push(h('h3', { class: 'wpa-h3', text: t('pf.title') }));
    kids.push(V.profileForm(A));
    kids.push(V.applyAll(A));
    return h('div', { class: 'wpa-panel' }, kids);
  };

  V.usersTab = function (A) {
    var S = A.S;
    var u = S.users;
    var kids = [h('h2', { class: 'wpa-title', id: 'wpa-title', tabindex: '-1', text: t('tab.users.title') }), h('p', { class: 'wpa-lead', text: t('users.lead') })];
    var q = textInput(A, 'wpa-uq', u.q, function (v) { u.q = v; }, { ph: t('users.search'), max: 50 });
    q.setAttribute('aria-label', t('users.search'));
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); A.loadUsers(1); } });
    kids.push(h('div', { class: 'wpa-toolbar' }, q, btn(t('users.find'), { kind: 'secondary', icon: 'list', onclick: function () { A.loadUsers(1); } }),
      h('span', { class: 'wpa-toolbar__sp' }),
      btn(t('users.enable'), { kind: 'primary', act: 'enable', disabled: !Object.keys(u.sel).length, onclick: function () { A.toggleUsers(true); } }),
      btn(t('users.disable'), { kind: 'secondary', act: 'disable', disabled: !Object.keys(u.sel).length, onclick: function () { A.toggleUsers(false); } })));
    if (u.msg) kids.push(note(u.msg.kind, u.msg.text));
    var tbl = h('table', { class: 'wpa-table wpa-table--users' }, h('caption', { class: 'wpa-sr', text: t('users.caption') }),
      h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'wpa-th-cb' }, h('span', { class: 'wpa-sr', text: t('users.sel') })), h('th', { scope: 'col', text: t('col.user') }), h('th', { scope: 'col', text: t('col.desc') }),
        h('th', { scope: 'col', text: t('col.ext') }), h('th', { scope: 'col', text: t('users.col.enabled') }), h('th', { scope: 'col', text: t('users.col.webrtc') }))));
    var tb = h('tbody');
    (u.rows || []).forEach(function (r) {
      var cb = h('input', { type: 'checkbox', checked: !!u.sel[r.id], 'aria-label': t('users.sel.one', { name: r.name }) });
      cb.addEventListener('change', function () { if (cb.checked) u.sel[r.id] = true; else delete u.sel[r.id]; A.render('keep'); });
      var st = r.state === 'yes' ? chip('ok', t('yes')) : r.state === 'outdated' ? chip('warn', t('users.outdated')) : chip('skip', t('no'));
      var wr = r.webrtc === 'yes' ? chip('ok', t('yes')) : r.webrtc === 'no' ? chip('warn', t('no')) : h('span', { text: '-' });
      tb.appendChild(h('tr', null, h('td', { class: 'wpa-td-cb' }, h('label', { class: 'wpa-cbbox' }, cb)), h('td', { 'data-l': t('col.user'), text: r.name }), h('td', { 'data-l': t('col.desc'), text: r.desc }),
        h('td', { 'data-l': t('col.ext'), text: r.ext === '' ? t('none') : r.ext }), h('td', { 'data-l': t('users.col.enabled') }, st), h('td', { 'data-l': t('users.col.webrtc') }, wr)));
    });
    if (!(u.rows || []).length) tb.appendChild(h('tr', null, h('td', { colspan: '6', text: u.loading ? t('users.loading') : t('users.empty') })));
    tbl.appendChild(tb);
    kids.push(h('div', { class: 'wpa-tablewrap', tabindex: '0', role: 'region', 'aria-label': t('users.caption') }, tbl));
    kids.push(h('div', { class: 'wpa-pager' }, btn(t('users.prev'), { kind: 'ghost', icon: 'back', disabled: u.page <= 1, onclick: function () { A.loadUsers(u.page - 1); } }),
      h('span', { class: 'wpa-pager__t', text: t('users.page', { n: u.page, m: u.pages, total: u.total }) }),
      btn(t('users.next'), { kind: 'ghost', iconAfter: 'next', disabled: u.page >= u.pages, onclick: function () { A.loadUsers(u.page + 1); } })));
    return h('div', { class: 'wpa-panel' }, kids);
  };

  V.settingsTab = function (A) {
    var S = A.S;
    var f = S.settingsDraft;
    var er = S.settingsErr || {};
    var kids = [h('h2', { class: 'wpa-title', id: 'wpa-title', tabindex: '-1', text: t('tab.settings.title') }), h('p', { class: 'wpa-lead', text: t('set.lead') })];
    kids.push(field('wpa-s-ws', t('set.ws'), textInput(A, 'wpa-s-ws', f.ws_path, function (v) { f.ws_path = v; }, { max: 101, hint: true, invalid: !!er.ws }), t('set.ws.h'), er.ws ? t('set.err.ws') : null));
    var ta = h('textarea', { id: 'wpa-s-stun', class: 'wpa-input wpa-input--area', rows: '3', spellcheck: 'false', 'aria-describedby': 'wpa-s-stun-h', 'aria-invalid': er.stun ? 'true' : null });
    ta.value = f.stun_servers;
    ta.addEventListener('input', function () { f.stun_servers = ta.value; });
    kids.push(field('wpa-s-stun', t('set.stun'), ta, t('set.stun.h'), er.stun ? t('set.err.stun') : null));
    kids.push(h('div', { class: 'wpa-grid2' },
      field('wpa-s-exp', t('set.exp'), textInput(A, 'wpa-s-exp', f.register_expires, function (v) { f.register_expires = v; }, { max: 4, inputmode: 'numeric', hint: true, invalid: !!er.exp }), t('set.exp.h'), er.exp ? t('set.err.exp') : null)));
    kids.push(h('div', { class: 'wpa-grid2' },
      field('wpa-s-min', t('set.min'), textInput(A, 'wpa-s-min', f.ext_min, function (v) { f.ext_min = v; }, { max: 6, inputmode: 'numeric', invalid: !!er.range })),
      field('wpa-s-max', t('set.max'), textInput(A, 'wpa-s-max', f.ext_max, function (v) { f.ext_max = v; }, { max: 6, inputmode: 'numeric', invalid: !!er.range }), t('set.range.h'), er.range ? t('set.err.range') : null)));
    if (S.settingsMsg) kids.push(note(S.settingsMsg.kind, S.settingsMsg.text));
    kids.push(h('div', { class: 'wpa-row' }, btn(S.settingsBusy ? t('nav.saving') : t('nav.save'), { kind: 'primary', icon: 'check', act: 'save-settings', disabled: S.settingsBusy, onclick: function () { A.saveSettings(); } })));
    return h('div', { class: 'wpa-panel' }, kids);
  };
})(window);
