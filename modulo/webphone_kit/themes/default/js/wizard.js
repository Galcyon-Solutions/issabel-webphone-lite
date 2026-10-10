/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Copyright (C) 2026 Galcyon */
/*
 * Asistente del webphone: aplicacion (estado, acciones y montaje). Las vistas estan en wizard-views.js y las
 * comprobaciones del navegador en wizard-core.js. Con #wpa-boot en la pagina se monta sola; la galeria de estados
 * (testsite/wizard-gallery.html) la monta con datos simulados y sin red (opts.noAuto).
 */
(function (w) {
  'use strict';
  var WPA = w.WPA, h = WPA.h, V = WPA.views, t = function (k, p) { return WPA.t(k, p); };

  var SERVER_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15'];

  function freshAlta() {
    return { mode: null, step: 'mode', one: { name: '', ext: '', user: '', self: false }, range: { from: '', to: '', prefix: '' },
             csv: { text: '', name: '', error: null }, plan: null, result: null, busy: false, confirm: false, calls: false, error: null, errCalls: 0 };
  }

  WPA.createApp = function (root, opts) {
    opts = opts || {};
    var boot = opts.boot;
    var api = opts.api || WPA.makeApi(boot);
    var st = boot.state;
    var A = { root: root, api: api, opts: opts };
    WPA.lang = boot.lang || 'es';
    root.setAttribute('lang', WPA.lang === 'pt-BR' ? 'pt-BR' : WPA.lang);

    var S = A.S = {
      user: st.user, caps: st.caps, settings: st.settings, profile: st.profile, profile_prev: !!st.profile_prev, ext_range: st.ext_range,
      counts: st.counts, group: { exists: !!st.group.exists, confirming: false, busy: false, error: null }, host: st.host, urls: st.urls, version: st.version,
      wizard: st.wizard, view: 'wizard', step: Math.max(1, st.wizard.step || 1), maxStep: Math.max(1, st.wizard.step || 1), sub: {}, tab: 'diagnostic',
      serverIds: SERVER_IDS, doctor: { state: 'idle', checks: {}, ssl: null, ssl_fix: null, calls: 0, helper: {}, error: null }, bchecks: {}, bRunning: false,
      fix: {}, fixOpen: {}, fixIn: {}, open: {}, applied: [], mic: { status: 'idle', level: 0, result: null, ignored: false }, speaker: { played: false, playing: false, heard: null },
      rtp: { draft: String(WPA.rtp.DEF), calls: WPA.rtp.DEF, err: null },
      echo: null, profileDraft: JSON.parse(JSON.stringify(st.profile)), profileBusy: false, profileErr: null, profileMsg: null,
      repair: { plan: null, busy: null, result: null, calls: false }, alta: freshAlta(),
      anex: { rows: [], loaded: false, loading: false, confirm: null, calls: false, busy: false, msg: null },
      users: { rows: [], page: 1, pages: 1, total: 0, q: '', sel: {}, msg: null, loading: false },
      settingsDraft: { ws_path: st.settings.ws_path, stun_servers: String(st.settings.stun_servers || '').split(',').join('\n'), register_expires: st.settings.register_expires,
                       ext_min: String(st.ext_range[0]), ext_max: String(st.ext_range[1]) },
      settingsErr: null, settingsMsg: null, settingsBusy: false, caOs: 'win', sslAlt: false, askSsl: null, pubGuess: '', banner: null, shareUrl: ''
    };
    S.wizard.data = S.wizard.data || {};
    (function () {
      // llamadas simultaneas esperadas: lo recordado por el asistente, lo guardado en wp_setting o 10
      var saved = S.wizard.data.expected_calls !== undefined ? S.wizard.data.expected_calls : (st.settings && st.settings.expected_calls);
      var pr = WPA.rtp.parse(saved);
      if (pr.ok) { S.rtp.calls = pr.n; S.rtp.draft = String(pr.n); }
    })();

    // ---------------------------------------------------------------- utilidades de la app
    A.t = t;
    var liveEl = null;
    A.announce = function (txt) { if (liveEl) { liveEl.textContent = ''; setTimeout(function () { liveEl.textContent = txt; }, 30); } };
    function focusKey(el) {
      if (!el || el === document.body || !root.contains(el)) return null;
      var row = el.closest ? el.closest('[data-id]') : null;
      return { id: el.id || null, act: el.getAttribute('data-act'), row: row ? row.getAttribute('data-id') : null, txt: (el.textContent || '').slice(0, 24),
               tag: el.tagName, ss: el.selectionStart, se: el.selectionEnd, name: el.getAttribute('name'), val: el.getAttribute('value') };
    }
    function restoreFocus(k) {
      if (!k) return;
      var el = null;
      if (k.id) el = root.querySelector('#' + (w.CSS && CSS.escape ? CSS.escape(k.id) : k.id));
      if (!el && k.act) {
        var scope = k.row ? root.querySelector('[data-id="' + k.row + '"]') : root;
        if (scope) el = scope.querySelector('[data-act="' + k.act + '"]');
      }
      if (!el && k.name && k.val !== null) el = root.querySelector('[name="' + k.name + '"][value="' + k.val + '"]');
      if (!el && k.tag === 'BUTTON') {
        var bs = root.querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) if ((bs[i].textContent || '').slice(0, 24) === k.txt) { el = bs[i]; break; }
      }
      if (el) {
        try { el.focus({ preventScroll: true }); if (k.ss !== null && k.ss !== undefined && el.setSelectionRange && el.type !== 'checkbox' && el.type !== 'radio') el.setSelectionRange(k.ss, k.se); } catch (e) { }
      }
    }

    // ---------------------------------------------------------------- render
    A.render = function (mode) {
      var keep = mode === 'keep';
      if (!keep) { root.setAttribute('data-enter', ''); clearTimeout(A._enterT); A._enterT = setTimeout(function () { root.removeAttribute('data-enter'); }, 600); }
      var fk = keep ? focusKey(document.activeElement) : null;
      var sy = keep ? w.scrollY : null;
      while (root.firstChild) root.removeChild(root.firstChild);
      var theme = root.getAttribute('data-theme');
      if (theme === 'auto') root.setAttribute('data-resolved', WPA.detectTheme());
      else root.setAttribute('data-resolved', theme);
      var shell = h('div', { class: 'wpa-shell' });
      shell.appendChild(h('div', { class: 'wpa-top' },
        h('div', { class: 'wpa-brand' }, h('span', { class: 'wpa-brand__ico', 'aria-hidden': 'true' }, WPA.icon('phone')),
          h('div', null, h('p', { class: 'wpa-brand__t', text: t('app.title') }), h('p', { class: 'wpa-brand__s', text: S.view === 'tabs' ? t('app.sub.diag') : t('app.sub.install') }))),
        h('span', { class: 'wpa-ver', text: 'v' + S.version })));
      var body;
      if (S.view === 'nopermission') body = V.noPermission(A);
      else if (S.view === 'finished') body = V.finished(A);
      else if (S.view === 'tabs') {
        body = h('div', { class: 'wpa-tabsview' }, V.tabsBar(A), h('div', { id: 'wpa-panel', role: 'tabpanel', 'aria-labelledby': 'wpa-tab-' + S.tab, class: 'wpa-tabpanel' }, tabBody()));
      } else {
        var steps = [V.welcome, V.review, V.secure, V.audio, V.phones, V.test];
        body = h('div', { class: 'wpa-wiz' }, V.progress(A), S.banner ? V.note('warn', null, t(S.banner)) : null, steps[S.step - 1](A));
      }
      shell.appendChild(body);
      root.appendChild(shell);
      liveEl = h('div', { class: 'wpa-sr', 'aria-live': 'polite', 'aria-atomic': 'true', role: 'status' });
      root.appendChild(liveEl);
      if (keep) { restoreFocus(fk); if (sy !== null) w.scrollTo(w.scrollX, sy); }
      else if (mode === 'top') {
        var ti = root.querySelector('#wpa-title');
        if (ti) { try { ti.focus({ preventScroll: true }); } catch (e) { } }
        if (!opts.gallery) { var r = root.getBoundingClientRect(); if (r.top < 0 || r.top > 200) w.scrollTo({ top: Math.max(0, w.scrollY + r.top - 12), behavior: 'auto' }); }
      }
    };
    function tabBody() {
      if (S.tab === 'anexos') return V.anexosTab(A);
      if (S.tab === 'users') return V.usersTab(A);
      if (S.tab === 'settings') return V.settingsTab(A);
      return V.diagnostic(A);
    }

    // ---------------------------------------------------------------- comprobaciones
    A.allChecks = function () {
      var m = {};
      SERVER_IDS.forEach(function (id) { if (S.doctor.checks[id]) m[id] = S.doctor.checks[id]; else if (S.doctor.state === 'running' || S.doctor.state === 'idle') m[id] = { id: id, level: 'run', code: 'run', p: {}, critical: false }; });
      WPA.BROWSER_IDS.forEach(function (id) { if (S.bchecks[id]) m[id] = S.bchecks[id]; else if (S.bRunning) m[id] = { id: id, level: 'run', code: 'run', p: {}, critical: false }; });
      return m;
    };
    A.summary = function () {
      var all = A.allChecks();
      var ids = SERVER_IDS.concat(WPA.BROWSER_SHOWN);
      var sm = { total: ids.length, ok: 0, warn: 0, bad: 0, done: 0, running: false };
      ids.forEach(function (id) {
        var c = all[id];
        if (!c || c.level === 'run') { sm.running = true; return; }
        sm.done++;
        if (c.level === 'ok') sm.ok++; else if (c.level === 'warn') sm.warn++; else if (c.level === 'bad') sm.bad++;
      });
      return sm;
    };
    A.criticalPending = function () {
      var all = A.allChecks();
      var n = 0;
      Object.keys(all).forEach(function (id) { if (all[id].critical && all[id].level === 'bad' && (SERVER_IDS.indexOf(id) >= 0 || WPA.BROWSER_SHOWN.indexOf(id) >= 0)) n++; });
      return n;
    };

    A.runDoctor = function (quiet) {
      if (opts.noAuto) return Promise.resolve();
      S.doctor.state = 'running';
      S.doctor.error = null;
      if (!quiet) { S.doctor.checks = {}; }
      S.bchecks = {};
      S.bRunning = true;
      A.render('keep');
      var usage = S.wizard.data.usage;
      var p1 = api('doctor', { client_ms: Date.now(), usage: usage, expected_calls: S.rtp.calls }).then(function (r) {
        if (!r.ok) { S.doctor.state = 'error'; S.doctor.error = r.error || 'generic'; if (r.error === 'forbidden') S.view = 'nopermission'; return; }
        var m = {};
        r.checks.forEach(function (c) { m[c.id] = c; });
        S.doctor.checks = m; S.doctor.ssl = r.ssl; S.doctor.ssl_fix = r.ssl_fix || null; S.doctor.calls = r.calls; S.doctor.helper = r.helper; S.doctor.state = 'done';
        if (r.urls) S.urls = r.urls;
        var h0 = S.host && S.host.name ? S.host.name : '';
        S.pubGuess = (r.ssl && r.ssl.host_kind === 'ip' && !r.ssl.ip_private) ? r.ssl.host : '';
        S.shareUrl = r.ssl && r.ssl.host ? 'https://' + (S.host.raw || r.ssl.host) + '/' : '';
      });
      var stunList = String(S.settings.stun_servers || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var p2 = WPA.browser.runAll({ wsPath: S.settings.ws_path || '/kit-ws', stun: stunList, usage: usage, user: S.user }, function (r) { S.bchecks[r.id] = r; A.render('keep'); })
        .then(function () { S.bRunning = false; });
      return Promise.all([p1, p2]).then(function () { S.bRunning = false; A.render('keep'); A.announce(t('sum.done', { ok: A.summary().ok, m: A.summary().total })); });
    };
    A.recheck = function () { return A.runDoctor(true).then(function () { S.sslAlt = S.sslAlt; }); };
    A.recheckBrowser = function () {
      if (opts.noAuto) return;
      S.bRunning = true;
      var stunList = String(S.settings.stun_servers || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      return WPA.browser.runAll({ wsPath: S.settings.ws_path || '/kit-ws', stun: stunList, usage: S.wizard.data.usage, user: S.user }, function (r) { S.bchecks[r.id] = r; A.render('keep'); })
        .then(function () { S.bRunning = false; A.render('keep'); });
    };

    // ---------------------------------------------------------------- Resolver
    A.openFix = function (c) {
      var open = S.fixOpen[c.id];
      S.fixOpen[c.id] = !open;
      if (open) S.fix[c.id] = { status: 'idle' };
      A.render('keep');
    };
    A.runFix = function (c) {
      var f = c.fix, inp = S.fixIn[c.id] || {};
      var params = { ip: inp.ip || S.pubGuess || '', consent: !!inp.consent, mod: f.mod };
      if (f.id === 'rtp_range') {
        if (S.rtp.calls === null) { S.rtp.err = S.rtp.err || 'invalid'; A.render('keep'); return Promise.resolve(); }
        params.calls = S.rtp.calls;
      }
      if (f.id === 'repair') { S.fix[c.id] = { status: 'running' }; A.render('keep'); return A.repairWith(f.exts, c); }
      S.fix[c.id] = { status: 'running' };
      A.render('keep');
      return api('fix', { id: f.id, params: params, confirm_calls: !!inp.calls }).then(function (r) {
        if (r.ok) {
          S.fix[c.id] = { status: 'done', undo: r.undo || f.undo_id || '', msg: '' };
          if (S.fix[c.id].undo) S.applied.push({ id: c.id, fixId: f.id, undo: S.fix[c.id].undo, p: r });
          A.announce(t('fix.done'));
          return A.recheck();
        }
        S.fix[c.id] = { status: 'error', error: r.error, calls: r.calls, p: r };
        A.render('keep');
      });
    };
    // Pregunta de llamadas simultaneas (paso 4): valida en el cliente con la misma regla del servidor, recuerda la respuesta
    // valida (wizard_save la guarda tambien en wp_setting) y vuelve a comprobar el audio un momento despues de dejar de escribir.
    A.setCalls = function (raw) {
      var r = WPA.rtp.parse(raw);
      var prevErr = S.rtp.err;
      S.rtp.draft = raw;
      S.rtp.err = r.ok ? null : r.err;
      S.rtp.calls = r.ok ? r.n : null;
      clearTimeout(A._rtpT);
      if (r.ok) {
        A.setData({ expected_calls: r.n });
        A._rtpT = setTimeout(function () {
          A.announce(t('rtp.announce', { calls: r.n, ports: WPA.rtp.ports(r.n) }));
          if (!opts.noAuto) A.runDoctor(true);
        }, 700);
      }
      A.render('keep');
      if (!r.ok && prevErr !== r.err) A.announce(t('rtp.err.' + r.err));
    };
    A.repairWith = function (exts, c) {
      return api('repair_apply', { exts: exts, confirm: true, confirm_calls: true }).then(function (r) {
        S.fix[c.id] = r.ok ? { status: 'done', undo: '' } : { status: 'error', error: r.error, calls: r.calls };
        return A.recheck();
      });
    };
    A.undoFix = function (c, undoId) {
      var inp = S.fixIn[c.id] || {};
      return api('fix', { id: undoId, params: {}, confirm_calls: true }).then(function (r) {
        S.fix[c.id] = r.ok ? { status: 'idle' } : { status: 'error', error: r.error, calls: r.calls };
        S.fixOpen[c.id] = false;
        S.applied = S.applied.filter(function (x) { return x.undo !== undoId; });
        return A.recheck();
      });
    };
    A.undoApplied = function (a) {
      return api('fix', { id: a.undo, params: {}, confirm_calls: true }).then(function () {
        S.applied = S.applied.filter(function (x) { return x !== a; });
        if (S.fix[a.id]) S.fix[a.id] = { status: 'idle' };
        S.fixOpen[a.id] = false;
        return A.recheck();
      });
    };
    A.PBX_SIP = '/admin/config.php?type=setup&display=sipsettings';
    A.openPbx = function (url) {
      var go = function () { w.open(url, '_blank', 'noopener'); };
      if (opts.noAuto) return go();
      // igual que openExt: la primera visita a /admin/ crea la sesion de IssabelPBX
      fetch(S.urls.pbx_init, { credentials: 'same-origin', cache: 'no-store' }).then(go, go);
    };
    A.sslFixFor = function (cs, s) {
      var host = s.host || 'HOST';
      var safe = /^[A-Za-z0-9.:-]{1,253}$/.test(host) ? host : 'HOST';
      if (S.doctor.ssl_fix && s.case === cs) return S.doctor.ssl_fix;
      if (cs === 'd') return S.urls.le && s.port80 ? { kind: 'le', url: S.urls.le, host: safe } : { kind: 'cmd', cmd: 'certbot certonly --standalone -d ' + safe, undo: 'certbot delete --cert-name ' + safe };
      if (cs === 'a') return { kind: 'cmd', cmd: 'certbot certonly --preferred-profile shortlived --webroot --webroot-path /var/www/html --ip-address ' + safe, undo: 'certbot delete --cert-name ' + safe, needs: 'certbot>=5.4' };
      if (cs === 'c') return { kind: 'cmd', cmd: 'certbot certonly --manual --preferred-challenges dns -d ' + safe, undo: 'certbot delete --cert-name ' + safe, alt: 'ca' };
      return { kind: 'ca' };
    };
    A.openExt = function (ext) {
      var go = function () { w.open(ext ? S.urls.pbx_edit + encodeURIComponent(ext) : S.urls.pbx_init, '_blank', 'noopener'); };
      if (opts.noAuto) return go();
      // La primera visita a /admin/ crea la sesion de IssabelPBX; sin ella el enlace directo responde error
      fetch(S.urls.pbx_init, { credentials: 'same-origin', cache: 'no-store' }).then(go, go);
    };

    // ---------------------------------------------------------------- navegacion
    var saveTimer = null;
    function persist() {
      if (opts.noAuto || !S.caps.admin) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { api('wizard_save', { step: S.step, done: !!S.wizard.done, data: S.wizard.data }); }, 250);
    }
    A.setData = function (o) { for (var k in o) S.wizard.data[k] = o[k]; persist(); };
    A.go = function (n, sub, restart) {
      S.view = 'wizard';
      S.step = Math.max(1, Math.min(6, n));
      if (restart) { S.maxStep = 1; }
      S.maxStep = Math.max(S.maxStep, S.step);
      S.sub = {};
      S.banner = null;
      if (S.step === 4 && !S.wizard.data.usage) S.sub[4] = 'ask';
      if (S.step === 5) { S.sub[5] = 'profile'; S.alta.step = 'mode'; S.profileDraft = JSON.parse(JSON.stringify(S.profile)); }
      if (S.step === 3 && !S.doctor.ssl && S.doctor.state === 'idle') A.runDoctor();
      if (S.step === 2 && S.doctor.state === 'idle') A.runDoctor();
      persist();
      A.render('top');
      A.announce(t('step.of', { n: S.step, m: 6, name: t('step.' + S.step) }));
    };
    A.sub = function (step, name) {
      S.sub[step] = name;
      if (step === 5 && name === 'mode') S.alta.step = 'mode';
      A.render('top');
    };
    A.back = function () {
      if (S.step === 5 && S.sub[5] !== 'profile') { A.sub(5, 'profile'); return; }
      A.go(S.step - 1);
    };
    A.pickUsage = function (v) {
      A.setData({ usage: v });
      A.render('keep');
      if (!opts.noAuto) A.runDoctor(true);
    };
    A.openTabs = function (tab, focusTab) {
      S.view = 'tabs';
      S.tab = tab;
      A.render('top');
      if (tab === 'users' && !S.users.rows.length && !S.users.loading) A.loadUsers(1);
      if (tab === 'anexos' && !S.anex.loaded && !S.anex.loading) A.loadAnexos();
      if (tab === 'diagnostic' && S.doctor.state === 'idle') A.runDoctor();
      if (focusTab) { var el = root.querySelector('#wpa-tab-' + tab); if (el) el.focus(); }
    };
    A.reopenWizard = function () { S.wizard.step = 1; A.go(1, null, true); };
    A.finish = function () {
      S.wizard.done = true;
      S.view = 'finished';
      if (!opts.noAuto) api('wizard_save', { step: 6, done: true, data: S.wizard.data });
      A.render('top');
      A.announce(t('done.title'));
    };

    // ---------------------------------------------------------------- microfono, altavoz y eco
    A.micTest = function () {
      S.mic = { status: 'running', level: 0, result: null, ignored: false };
      A.render('keep');
      if (opts.noAuto) return;
      WPA.browser.micTest(function (lv) { if (lv < 0) S.mic.ignored = true; else S.mic.level = lv; A.render('keep'); }).then(function (r) {
        S.mic.status = 'done';
        if (!r.ok) S.mic.result = (r.reason === 'NotAllowedError' || r.reason === 'SecurityError') ? 'denied' : (r.reason === 'NotFoundError' ? 'none' : 'error');
        else S.mic.result = r.peak > 0.05 ? 'ok' : 'silent';
        if (r.ok) S.bchecks.B3 = { id: 'B3', scope: 'browser', level: 'ok', code: 'granted', p: {}, critical: false, fix: null };
        else if (S.mic.result === 'denied') S.bchecks.B3 = { id: 'B3', scope: 'browser', level: 'bad', code: 'denied', p: {}, critical: false, fix: { kind: 'browser', id: 'mic_help' } };
        S.bchecks.B5 = r.ok ? (r.peak > 0.05 ? { id: 'B5', scope: 'browser', level: 'ok', code: 'ok', p: {}, critical: false } : { id: 'B5', scope: 'browser', level: 'warn', code: 'silent', p: {}, critical: false, fix: { kind: 'browser', id: 'mic_test' } }) : S.bchecks.B5;
        A.render('keep');
        WPA.browser.b4().then(function (b4) { S.bchecks.B4 = b4; A.render('keep'); });
      });
    };
    A.playTone = function () {
      S.speaker.playing = true;
      A.render('keep');
      if (opts.noAuto) { S.speaker.playing = false; S.speaker.played = true; A.render('keep'); return; }
      WPA.browser.tone().then(function () { S.speaker.playing = false; S.speaker.played = true; A.render('keep'); });
    };
    A.echoTest = function () {
      S.echo = null;
      WPA.browser.b9().then(function (r) { S.echo = r; A.render('keep'); });
    };

    // ---------------------------------------------------------------- perfil
    A.saveProfile = function () {
      var p = S.profileDraft;
      S.profileErr = null;
      if (!/^[0-9+*#() \-]{0,32}$/.test(p.outbound_cid || '')) { S.profileErr = { outbound_cid: true }; S.profileMsg = null; A.render('keep'); return; }
      S.profileBusy = true; S.profileMsg = null; A.render('keep');
      return api('profile_save', { profile: p }).then(function (r) {
        S.profileBusy = false;
        if (r.ok) { S.profile = r.profile; S.profile_prev = !!r.profile_prev; S.profileDraft = JSON.parse(JSON.stringify(r.profile)); S.profileMsg = { kind: 'ok', text: t('pf.saved') }; S.repair.plan = null; S.repair.result = null; }
        else S.profileMsg = { kind: 'bad', text: t('err.' + (r.error || 'generic')) };
        A.render('keep');
        A.announce(S.profileMsg.text);
      });
    };
    A.revertProfile = function () {
      return api('profile_revert', {}).then(function (r) {
        if (r.ok) { S.profile = r.profile; S.profile_prev = !!r.profile_prev; S.profileDraft = JSON.parse(JSON.stringify(r.profile)); S.profileMsg = { kind: 'ok', text: t('pf.reverted') }; S.repair.plan = null; }
        else S.profileMsg = { kind: 'bad', text: t('err.' + (r.error || 'generic')) };
        A.render('keep');
      });
    };
    A.repairPlan = function () {
      S.repair.busy = 'plan'; S.repair.result = null; A.render('keep');
      return api('repair_plan', { all: true }).then(function (r) {
        S.repair.busy = null;
        if (r.ok) { S.repair.plan = { anexos: r.anexos, calls: r.calls || 0 }; S.repair.calls = false; } else S.repair.plan = { anexos: [], calls: 0 };
        A.render('keep');
      });
    };
    A.repairApply = function () {
      S.repair.busy = 'apply'; A.render('keep');
      return api('repair_apply', { all: true, confirm: true, confirm_calls: !!S.repair.calls }).then(function (r) {
        S.repair.busy = null;
        if (r.ok) { S.repair.result = r; S.repair.plan = null; } else S.repair.plan = Object.assign({}, S.repair.plan, { error: r.error });
        A.render('keep');
        if (r.ok) A.announce(t('aa.done', { n: r.results.filter(function (x) { return x.status === 'repaired'; }).length }));
      });
    };

    A.loadAnexos = function () {
      var an = S.anex;
      an.loading = true; an.msg = null; A.render('keep');
      if (opts.noAuto) { an.loading = false; an.loaded = true; A.render('keep'); return Promise.resolve(); }
      return api('repair_plan', { all: true }).then(function (r) {
        an.loading = false; an.loaded = true;
        if (r.ok) { an.rows = r.anexos; if (r.calls !== undefined) S.doctor.calls = r.calls; } else an.msg = { kind: 'bad', text: t('err.' + (r.error || 'generic')) };
        A.render('keep');
      });
    };
    A.repairOne = function (ext) {
      var an = S.anex;
      an.busy = true; A.render('keep');
      if (opts.noAuto) { an.busy = false; an.confirm = null; an.msg = { kind: 'ok', text: t('anex.done', { ext: ext }) + '. ' + t('aa.done.b', { rc: 1, rl: 1 }) }; an.rows.forEach(function (r) { if (r.ext === ext) r.changes = []; }); A.render('keep'); return Promise.resolve(); }
      return api('repair_apply', { exts: [ext], confirm: true, confirm_calls: !!an.calls }).then(function (r) {
        an.busy = false;
        if (r.ok) { an.msg = { kind: 'ok', text: t('anex.done', { ext: ext }) + '. ' + t('aa.done.b', { rc: r.retrieve_conf, rl: r.reload_pjsip }) }; an.confirm = null; }
        else an.msg = { kind: 'bad', text: t('err.' + (r.error || 'generic'), { calls: r.calls }) };
        A.announce(an.msg.text);
        return A.loadAnexos();
      });
    };

    // ---------------------------------------------------------------- alta de anexos
    A.altaStep = function (s) { S.alta.step = s; S.alta.error = null; A.render('top'); };
    A.altaReset = function () { S.alta = freshAlta(); A.render('top'); };
    A.loadCsv = function (file) {
      var d = S.alta;
      d.csv = { text: '', name: file.name, error: null };
      d.plan = null;
      if (file.size > 262144) { d.csv.error = 'csv_too_big'; A.render('keep'); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var txt = String(fr.result || '');
        if (txt.indexOf('�') !== -1) d.csv.error = 'csv_encoding';
        else d.csv.text = txt;
        A.render('keep');
        A.announce(d.csv.error ? t('err.' + d.csv.error) : t('s5.csv.loaded', { name: file.name }));
      };
      fr.onerror = function () { d.csv.error = 'csv_encoding'; A.render('keep'); };
      fr.readAsText(file, 'UTF-8');
    };
    A.csvTemplate = function () { if (!opts.noAuto) api.template('webphone-anexos.csv'); };
    function altaPayload() {
      var d = S.alta;
      if (d.mode === 'one') return { mode: 'one', name: d.one.name, ext: d.one.ext, user: d.one.user, self: !!d.one.self };
      if (d.mode === 'range') return { mode: 'range', from: d.range.from, to: d.range.to, prefix: d.range.prefix };
      return { mode: 'csv', csv: d.csv.text };
    }
    A.altaPreview = function () {
      var d = S.alta;
      d.busy = true; d.error = null; A.render('keep');
      return api('plan', altaPayload()).then(function (r) {
        d.busy = false;
        if (r.ok) { d.plan = r; d.step = 'preview'; d.confirm = false; d.calls = false; A.render('top'); A.announce(t('s5.prev.sum', { n: r.summary.total, ok: r.summary.ok, bad: r.summary.errors })); }
        else { d.error = r.error || 'generic'; A.render('keep'); }
      });
    };
    A.altaApply = function () {
      var d = S.alta;
      d.busy = true; d.error = null; A.render('keep');
      var p = altaPayload();
      p.confirm = true; p.confirm_calls = !!d.calls;
      return api('apply', p).then(function (r) {
        d.busy = false;
        if (r.ok) {
          d.result = r; d.step = 'result';
          S.counts.webphone += r.counts.created;
          S.wizard.data.created = (S.wizard.data.created || 0) + r.counts.created;
          S.repair.plan = null;
          A.render('top');
          A.announce(t('s5.res.sum', { n: r.counts.created, s: r.counts.skipped, f: r.counts.failed }));
        } else { d.error = r.error || 'generic'; d.errCalls = r.calls; if (r.error === 'calls_active') { d.plan.calls = r.calls; } A.render('keep'); }
      });
    };
    A.exportResult = function () { if (!opts.noAuto) api.download('export_csv', { rows: S.alta.result.results }, 'webphone-resultado.csv'); };

    // ---------------------------------------------------------------- usuarios, ajustes y grupo
    A.loadUsers = function (page) {
      var u = S.users;
      u.loading = true; u.page = page; u.sel = {}; A.render('keep');
      if (opts.noAuto) { u.loading = false; return Promise.resolve(); }
      return api('users_list', { page: page, q: u.q }).then(function (r) {
        u.loading = false;
        if (r.ok) { u.rows = r.rows; u.page = r.page; u.pages = r.pages; u.total = r.total; } else u.msg = { kind: 'bad', text: t('err.' + (r.error || 'generic')) };
        A.render('keep');
      });
    };
    A.toggleUsers = function (enable) {
      var u = S.users;
      var ids = Object.keys(u.sel).map(function (x) { return parseInt(x, 10); });
      return api('users_toggle', { enable: enable, ids: ids }).then(function (r) {
        if (r.ok) {
          var txt = (enable ? t('users.enabled') : t('users.disabled')) + ': ' + r.done;
          if (r.skipped) txt += '. ' + t('users.skipped') + ': ' + r.skipped;
          if (r.not_webphone) txt += '. ' + t('users.notweb') + ': ' + r.not_webphone;
          u.msg = { kind: r.skipped || r.not_webphone ? 'warn' : 'ok', text: txt };
          A.announce(txt);
        } else u.msg = { kind: 'bad', text: t('err.' + (r.error || 'generic')) };
        return A.loadUsers(u.page);
      });
    };
    A.saveSettings = function () {
      var f = S.settingsDraft, er = {};
      S.settingsBusy = true; S.settingsMsg = null; S.settingsErr = null; A.render('keep');
      return api('settings_save', { settings: f }).then(function (r) {
        S.settingsBusy = false;
        if (r.ok) {
          S.settings = r.settings; S.ext_range = r.ext_range; S.settingsMsg = { kind: 'ok', text: t('set.saved') };
        } else if (r.error === 'validation') {
          (r.fields || []).forEach(function (x) { if (x === 'WebSocket path') er.ws = true; else if (x === 'STUN servers') er.stun = true; else if (x.indexOf('Registration') === 0) er.exp = true; else if (x === 'ext_range') er.range = true; });
          S.settingsErr = er; S.settingsMsg = { kind: 'bad', text: t('set.invalid') };
        } else S.settingsMsg = { kind: 'bad', text: t('err.' + (r.error || 'generic')) };
        A.render('keep');
        A.announce(S.settingsMsg.text);
      });
    };
    A.createGroup = function () {
      var g = S.group;
      g.busy = true; g.error = null; A.render('keep');
      return api('group_create', { confirm: true }).then(function (r) {
        g.busy = false;
        if (r.ok) { g.exists = true; g.confirming = false; A.announce(t('s6.group.exists')); } else g.error = r.error || 'generic';
        A.render('keep');
      });
    };

    // ---------------------------------------------------------------- arranque
    A.start = function () {
      var d = S.wizard.data;
      if (!S.caps.menu || (!S.caps.admin && !S.caps.ext)) { S.view = 'nopermission'; return A.render('top'); }
      if (!S.caps.admin) { S.view = 'tabs'; S.tab = 'anexos'; A.render('top'); return A.loadAnexos(); }
      var want = boot.tab || '';
      if (want === 'wizard') { S.view = 'wizard'; S.step = Math.max(1, S.wizard.step || 1); A.render('top'); return A.runDoctor(); }
      if (!S.wizard.done) {
        S.view = 'wizard'; S.step = Math.max(1, Math.min(6, S.wizard.step || 1)); S.maxStep = S.step;
        if (S.step === 4 && !d.usage) S.sub[4] = 'ask';
        if (S.step === 5) { S.sub[5] = 'profile'; }
        A.render('top');
        if (S.step >= 2) A.runDoctor();
        return;
      }
      // Ya completado: pestana Diagnostico; si falta algun critico, vuelve a abrir el asistente en la revision
      S.view = 'tabs'; S.tab = ['diagnostic', 'anexos', 'users', 'settings'].indexOf(want) >= 0 ? want : 'diagnostic';
      A.render('top');
      if (S.tab === 'users') A.loadUsers(1);
      if (S.tab === 'anexos') A.loadAnexos();
      var p = A.runDoctor();
      if (p && p.then) p.then(function () {
        if (A.criticalPending() > 0 && S.tab === 'diagnostic') { S.banner = 'banner.critical'; A.go(2); S.banner = 'banner.critical'; A.render('keep'); }
      });
    };

    return A;
  };

  // ---------------------------------------------------------------- aplicados (deshacer) en la revision y el diagnostico
  var origCheckList = V.checkList;
  V.checkList = function (A, ids, o) {
    var ul = origCheckList(A, ids, o);
    return ul;
  };
  V.applied = function (A) {
    var S = A.S;
    if (!S.applied.length) return null;
    var ul = h('ul', { class: 'wpa-applied' });
    S.applied.forEach(function (a) {
      var txt = (a.fixId === 'rtp_range' && a.p && a.p.start) ? t('applied.rtp_range', { start: a.p.start, end: a.p.end }) : t('applied.item', { id: a.id });
      ul.appendChild(h('li', {}, h('span', { text: txt }), V.btn(t('nav.undo'), { kind: 'ghost', icon: 'undo', act: 'undo', onclick: function () { A.undoApplied(a); } })));
    });
    return h('div', { class: 'wpa-appliedbox' }, h('p', { class: 'wpa-h3', text: t('applied.title') }), ul);
  };
  // se inserta bajo el resumen
  var origSummary = V.summaryBar;
  V.summaryBar = function (A) {
    var bar = origSummary(A);
    var ap = V.applied(A);
    return ap ? h('div', null, bar, ap) : bar;
  };

  // ---------------------------------------------------------------- montaje automatico
  WPA.mount = function (rootEl, opts) {
    var el = document.getElementById('wpa-boot');
    var boot = opts && opts.boot ? opts.boot : (el ? JSON.parse(el.textContent) : null);
    if (!boot) return null;
    var app = WPA.createApp(rootEl, Object.assign({}, opts || {}, { boot: boot }));
    return app;
  };
  document.addEventListener('DOMContentLoaded', function () {
    if (w.WPA_NO_AUTOMOUNT) return;
    var rootEl = document.getElementById('wpa-root');
    if (!rootEl || !document.getElementById('wpa-boot')) return;
    var app = WPA.mount(rootEl, {});
    if (app) { w.WPA_APP = app; app.start(); }
  });
})(window);
