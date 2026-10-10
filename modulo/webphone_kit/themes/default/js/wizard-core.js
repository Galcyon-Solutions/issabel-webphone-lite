/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Copyright (C) 2026 Galcyon */
/*
 * Asistente del webphone: nucleo comun (utilidades de DOM, iconos, textos, capa de red y comprobaciones del NAVEGADOR).
 * Sin dependencias. Todo texto del servidor o del usuario se pinta con textContent: nunca innerHTML con datos.
 * La galeria de estados (testsite/wizard-gallery.html) carga estos mismos archivos con datos simulados.
 */
(function (w) {
  'use strict';
  var WPA = w.WPA = w.WPA || {};

  // ---------------------------------------------------------------- DOM
  WPA.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected' || k === 'open') { if (v) el.setAttribute(k, ''); }
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) WPA._append(el, arguments[i]);
    return el;
  };
  WPA._append = function (el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) WPA._append(el, c[i]); return; }
    el.appendChild(c && c.nodeType ? c : document.createTextNode(String(c)));
  };
  var h = WPA.h;

  // ---------------------------------------------------------------- iconos propios (trazo 1,75, esquinas redondas)
  var ICONS = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    warn: 'M12 4l9 16H3L12 4zM12 10v4.5M12 17.5v.01',
    dot: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    minus: 'M6 12h12',
    back: 'M14.5 6L8.5 12l6 6',
    next: 'M9.5 6l6 6-6 6',
    chev: 'M6 9.5l6 6 6-6',
    copy: 'M9 9h10v11H9zM6 15H5V4h10v2',
    ext: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5zM12 15v2',
    phone: 'M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 13l4 1.5v3a2 2 0 0 1-2 2A14.5 14.5 0 0 1 4.5 6a2 2 0 0 1 2-2z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 19a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13a6.5 6.5 0 0 1 3.5 6',
    net: 'M3 9a14 14 0 0 1 18 0M6 12.5a9.5 9.5 0 0 1 12 0M9 16a5 5 0 0 1 6 0M12 19.5v.01',
    mic: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v3M9 20h6',
    speaker: 'M4 10v4h3.5l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
    download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14',
    upload: 'M12 16V5M7.5 9L12 4.5 16.5 9M5 20h14',
    file: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    refresh: 'M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4.5v4h-4',
    shield: 'M12 3l7.5 3v5.5c0 4.5-3 7.5-7.5 9.5-4.5-2-7.5-5-7.5-9.5V6L12 3zM9 12l2.2 2.2L15.5 10',
    help: 'M9.2 9a3 3 0 1 1 4.4 2.6c-.9.5-1.6 1.1-1.6 2.2M12 17.5v.01',
    undo: 'M9 7L4.5 11.5 9 16M5 11.5h9a5.5 5.5 0 0 1 0 11',
    plus: 'M12 5v14M5 12h14',
    play: 'M8 5.5v13l10-6.5z',
    terminal: 'M4 5h16v14H4zM7.5 10l3 2.5-3 2.5M13 15h4',
    server: 'M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5v.01M7.5 16.5v.01',
    window: 'M3.5 5h17v14h-17zM3.5 9h17',
    list: 'M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01',
    sliders: 'M5 7h9M18 7h1M5 17h1M10 17h9M14 4.5v5M8 14.5v5',
    sparkle: 'M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z'
  };
  WPA.icon = function (name, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '20');
    s.setAttribute('height', '20');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'wpa-ico' + (cls ? ' ' + cls : ''));
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONS[name] || ICONS.dot);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.75');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  };
  WPA.hasIcon = function (n) { return !!ICONS[n]; };

  // ---------------------------------------------------------------- textos (es, en, pt-BR con las mismas claves)
  WPA.lang = 'es';
  WPA.t = function (key, params) {
    var tab = (w.WPA_I18N && (w.WPA_I18N[WPA.lang] || w.WPA_I18N.es)) || {};
    var s = tab[key];
    if (s === undefined && w.WPA_I18N && w.WPA_I18N.es) s = w.WPA_I18N.es[key];
    if (s === undefined) return key;
    if (params) {
      s = s.replace(/\{([a-z_0-9]+)\}/g, function (m, k) { return params[k] !== undefined && params[k] !== null ? String(params[k]) : m; });
    }
    return s;
  };
  WPA.has = function (key) {
    var tab = (w.WPA_I18N && (w.WPA_I18N[WPA.lang] || w.WPA_I18N.es)) || {};
    return tab[key] !== undefined;
  };

  // ---------------------------------------------------------------- utilidades
  WPA.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText && w.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  };
  function legacyCopy(text) {
    var ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;top:0;left:-9999px;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  WPA.isIp = function (s) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^\[?[0-9a-f:]+\]?$/i.test(s) && s.indexOf(':') !== -1; };
  WPA.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /** Luminancia aproximada de un color "rgb(r, g, b)". */
  function lum(rgb) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(rgb || '');
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    var c = [m[1], m[2], m[3]].map(function (v) { v = parseInt(v, 10) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  /** Tema claro u oscuro: el del marco de Issabel si se puede medir (el marco es claro de fabrica), si no el del sistema. */
  WPA.detectTheme = function () {
    var els = [document.getElementById('neo-contentbox-leftcolumn'), document.querySelector('.neo-contentbox'), document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      var l = lum(getComputedStyle(els[i]).backgroundColor);
      if (l !== null) return l < 0.35 ? 'dark' : 'light';
    }
    return (w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  };

  // ---------------------------------------------------------------- red
  WPA.makeApi = function (boot) {
    function call(action, payload) {
      return fetch(boot.endpoint + '&wpa=' + encodeURIComponent(action), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-WPK-CSRF': boot.csrf },
        body: JSON.stringify(payload || {})
      }).then(function (r) {
        return r.text().then(function (txt) {
          // El marco de Issabel responde vacio cuando el usuario no tiene acceso al menu
          if (!txt) return { ok: false, error: 'forbidden', need: 'menu' };
          try { return JSON.parse(txt); } catch (e) { return { ok: false, error: 'bad_response' }; }
        });
      }, function () { return { ok: false, error: 'network' }; });
    }
    call.download = function (action, payload, filename) {
      return fetch(boot.endpoint + '&wpa=' + encodeURIComponent(action), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-WPK-CSRF': boot.csrf }, body: JSON.stringify(payload || {})
      }).then(function (r) { return r.blob(); }).then(function (b) { WPA.saveBlob(b, filename); return true; }, function () { return false; });
    };
    call.template = function (filename) {
      return fetch(boot.endpoint + '&wpa=csv_template', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.blob(); }).then(function (b) { WPA.saveBlob(b, filename); return true; }, function () { return false; });
    };
    return call;
  };
  WPA.saveBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  };

  // ---------------------------------------------------------------- comprobaciones del NAVEGADOR (B1 a B12)
  // Cada una devuelve {id, scope:'browser', level, code, p, critical, fix}. B9 y B10 existen pero solo se ejecutan con
  // una barra de webphone presente (window.WebphoneKit) y a pedido: el asistente nunca llama por su cuenta.
  var B = WPA.browser = {};
  function res(id, level, code, critical, p, fix) { return { id: id, scope: 'browser', level: level, code: code, critical: !!critical, p: p || {}, fix: fix || null }; }
  var MIC_FIX = { kind: 'browser', id: 'mic_test' };

  B.b1 = function () { return Promise.resolve(w.isSecureContext ? res('B1', 'ok', 'ok', true) : res('B1', 'bad', 'insecure', true, { proto: location.protocol })); };
  B.b2 = function () {
    var miss = [];
    if (!w.RTCPeerConnection) miss.push('RTCPeerConnection');
    if (!w.WebSocket) miss.push('WebSocket');
    if (!(w.AudioContext || w.webkitAudioContext)) miss.push('AudioContext');
    return Promise.resolve(miss.length ? res('B2', 'bad', 'old', true, { miss: miss.join(', ') }) : res('B2', 'ok', 'ok', true));
  };
  B.b3 = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(res('B3', 'bad', 'nomedia', false));
    if (!(navigator.permissions && navigator.permissions.query)) return Promise.resolve(res('B3', 'warn', 'unknown', false, {}, MIC_FIX));
    return navigator.permissions.query({ name: 'microphone' }).then(function (p) {
      if (p.state === 'granted') return res('B3', 'ok', 'granted', false);
      if (p.state === 'denied') return res('B3', 'bad', 'denied', false, {}, { kind: 'browser', id: 'mic_help' });
      return res('B3', 'warn', 'prompt', false, {}, MIC_FIX);
    }, function () { return res('B3', 'warn', 'unknown', false, {}, MIC_FIX); });
  };
  B.b4 = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve(res('B4', 'bad', 'nomedia', false));
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var ins = list.filter(function (d) { return d.kind === 'audioinput'; });
      var outs = list.filter(function (d) { return d.kind === 'audiooutput'; });
      if (ins.length === 0) return res('B4', 'bad', 'none', false, { ins: 0, outs: outs.length });
      return res('B4', 'ok', 'ok', false, { ins: ins.length, outs: outs.length });
    }, function () { return res('B4', 'warn', 'unknown', false); });
  };
  B.b5 = function () { return Promise.resolve(res('B5', 'skip', 'notrun', false, {}, MIC_FIX)); };
  B.b6 = function (wsPath) {
    return new Promise(function (resolve) {
      var done = false;
      var url = 'wss://' + location.host + wsPath;
      var sock;
      var t = setTimeout(function () { fin(res('B6', 'bad', 'timeout', true, { path: wsPath })); }, 5000);
      function fin(r) { if (done) return; done = true; clearTimeout(t); try { sock.close(); } catch (e) { } resolve(r); }
      try {
        sock = new WebSocket(url, 'sip');
        sock.onopen = function () { fin(res('B6', 'ok', 'ok', true, { path: wsPath })); };
        sock.onerror = function () { fin(res('B6', 'bad', 'fail', true, { path: wsPath })); };
        sock.onclose = function () { fin(res('B6', 'bad', 'fail', true, { path: wsPath })); };
      } catch (e) { fin(res('B6', 'bad', 'fail', true, { path: wsPath })); }
    });
  };
  B.b7 = function (b6) {
    if (b6 && b6.level === 'ok') return Promise.resolve(res('B7', 'ok', 'ok', true));
    return fetch(location.origin + '/', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' }).then(function () {
      return res('B7', 'bad', 'untrusted', true);
    }, function () { return res('B7', 'skip', 'unknown', false); });
  };
  B.b8 = function (stunList, usage) {
    return new Promise(function (resolve) {
      if (!w.RTCPeerConnection) return resolve(res('B8', 'skip', 'nowebrtc', false));
      var servers = [];
      (stunList || []).forEach(function (s) { servers.push({ urls: s }); });
      var counts = { host: 0, srflx: 0, relay: 0 };
      var pc, done = false;
      var t = setTimeout(finish, 4000);
      function finish() {
        if (done) return; done = true; clearTimeout(t);
        try { pc.close(); } catch (e) { }
        var p = { host: counts.host, srflx: counts.srflx, relay: counts.relay, stun: servers.length };
        if (counts.srflx + counts.relay > 0) return resolve(res('B8', 'ok', 'ok', false, p));
        if (counts.host === 0) return resolve(res('B8', 'warn', 'none', false, p));
        if (usage === 'inside' || (usage !== 'outside' && usage !== 'both' && servers.length === 0)) return resolve(res('B8', 'ok', 'inside', false, p));
        resolve(res('B8', 'warn', 'hostonly', false, p));
      }
      try {
        pc = new RTCPeerConnection({ iceServers: servers });
        pc.createDataChannel('wpa');
        pc.onicecandidate = function (e) {
          if (!e.candidate) return finish();
          var m = /typ (host|srflx|relay)/.exec(e.candidate.candidate || '');
          if (m) counts[m[1]]++;
        };
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () { finish(); });
      } catch (e) { finish(); }
    });
  };
  B.b9 = function () {
    // Llamada de eco: necesita la barra del webphone y se pide a mano. Aqui solo se invoca si existe.
    if (!w.WebphoneKit || typeof w.WebphoneKit.call !== 'function') return Promise.resolve(res('B9', 'skip', 'nobar', false));
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(res('B9', 'warn', 'timeout', false)); }, 15000);
      var off = w.WebphoneKit.on('accepted', function () { clearTimeout(t); if (off) off(); resolve(res('B9', 'ok', 'ok', false)); });
      w.WebphoneKit.call('*43');
    });
  };
  B.b10 = function () {
    if (!w.WebphoneKit || typeof w.WebphoneKit.mediaStats !== 'function') return Promise.resolve(res('B10', 'skip', 'nobar', false));
    return Promise.resolve(w.WebphoneKit.mediaStats()).then(function (s) {
      if (!s || typeof s.lossPct !== 'number') return res('B10', 'skip', 'nostats', false);
      var lvl = s.lossPct > 5 ? 'bad' : (s.lossPct > 2 ? 'warn' : 'ok');
      return res('B10', lvl, lvl === 'ok' ? 'ok' : 'loss', false, { loss: s.lossPct });
    }, function () { return res('B10', 'skip', 'nostats', false); });
  };
  B.b11 = function () {
    var AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return Promise.resolve(res('B11', 'skip', 'noaudio', false));
    var ctx;
    try { ctx = new AC(); } catch (e) { return Promise.resolve(res('B11', 'skip', 'noaudio', false)); }
    var p = ctx.state === 'running' ? Promise.resolve() : ctx.resume().catch(function () { });
    return p.then(function () { return WPA.sleep(60); }).then(function () {
      var running = ctx.state === 'running';
      try { ctx.close(); } catch (e) { }
      return running ? res('B11', 'ok', 'ok', false) : res('B11', 'warn', 'blocked', false, {}, { kind: 'browser', id: 'audio_unlock' });
    });
  };
  B.b12 = function (user) {
    if (!(navigator.locks && navigator.locks.request)) return Promise.resolve(res('B12', 'skip', 'nolocks', false));
    return new Promise(function (resolve) {
      navigator.locks.request('wpa-admin-' + (user || ''), { ifAvailable: true }, function (lock) {
        if (!lock) { resolve(res('B12', 'warn', 'other', false)); return undefined; }
        resolve(res('B12', 'ok', 'ok', false));
        return new Promise(function () { });   // se conserva el candado mientras la pagina siga abierta
      }).catch(function () { resolve(res('B12', 'skip', 'nolocks', false)); });
    });
  };

  /** Prueba de micrófono: pide permiso (con aviso si se ignora) y mide el nivel 3 segundos. */
  B.micTest = function (onLevel) {
    return new Promise(function (resolve) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return resolve({ ok: false, reason: 'nomedia' });
      var ignored = setTimeout(function () { if (onLevel) onLevel(-1); }, 8000);
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        clearTimeout(ignored);
        var AC = w.AudioContext || w.webkitAudioContext;
        var ctx = new AC();
        var src = ctx.createMediaStreamSource(stream);
        var an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        var buf = new Uint8Array(an.fftSize);
        var peak = 0;
        var t0 = Date.now();
        (function tick() {
          an.getByteTimeDomainData(buf);
          var mx = 0;
          for (var i = 0; i < buf.length; i++) mx = Math.max(mx, Math.abs(buf[i] - 128) / 128);
          peak = Math.max(peak, mx);
          if (onLevel) onLevel(mx);
          if (Date.now() - t0 < 3000) return requestAnimationFrame(tick);
          stream.getTracks().forEach(function (tr) { tr.stop(); });
          try { ctx.close(); } catch (e) { }
          resolve({ ok: true, peak: peak });
        })();
      }, function (err) {
        clearTimeout(ignored);
        resolve({ ok: false, reason: (err && err.name) || 'error' });
      });
    });
  };

  /** Tono de prueba por el altavoz (440 Hz, un segundo). Necesita un gesto previo: se llama desde un clic. */
  B.tone = function () {
    var AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return Promise.resolve(false);
    var ctx = new AC();
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    g.gain.value = 0.12;
    o.frequency.value = 440;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    return WPA.sleep(1000).then(function () { o.stop(); try { ctx.close(); } catch (e) { } return true; });
  };

  /** Ejecuta las comprobaciones del navegador. onEach(result) se llama a medida que terminan. */
  B.runAll = function (ctx, onEach) {
    var out = {};
    function put(r) { out[r.id] = r; if (onEach) onEach(r); return r; }
    var wsPath = ctx.wsPath || '/kit-ws';
    return B.b1().then(put)
      .then(function () { return B.b2().then(put); })
      .then(function () { return B.b3().then(put); })
      .then(function () { return B.b4().then(put); })
      .then(function () { return B.b5().then(put); })
      .then(function () { return B.b6(wsPath).then(put); })
      .then(function () { return B.b7(out.B6).then(put); })
      .then(function () { return B.b8(ctx.stun, ctx.usage).then(put); })
      .then(function () { put(res('B9', 'skip', 'notrun', false)); put(res('B10', 'skip', 'notrun', false)); })
      .then(function () { return B.b11().then(put); })
      .then(function () { return B.b12(ctx.user).then(put); })
      .then(function () { return out; });
  };
  // ---------------------------------------------------------------- rango de audio (RTP): validacion y formula
  /*
   * FORMULA (la misma en el servidor: libs/WpkRtp.class.php):
   *   puertos necesarios = llamadas simultaneas x 4 (una llamada entre dos telefonos usa 2 tramos de audio y cada tramo
   *   ocupa un par RTP + RTCP), con margen x2, redondeado hacia arriba a multiplos de 100 y con un minimo de 100.
   *   rtpstart se conserva con el valor efectivo actual y rtpend = rtpstart + puertos.
   */
  WPA.rtp = {
    MIN: 1, MAX: 2000, DEF: 10,
    /** Solo enteros de 1 a 2000 en digitos (sin signo, decimales, notacion cientifica, espacios ni ceros a la izquierda). */
    parse: function (v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (s === '') return { ok: false, err: 'empty' };
      if (!/^[1-9][0-9]{0,3}$/.test(s)) return { ok: false, err: 'invalid' };
      var n = parseInt(s, 10);
      if (n < WPA.rtp.MIN || n > WPA.rtp.MAX) return { ok: false, err: 'invalid' };
      return { ok: true, n: n };
    },
    ports: function (calls) { return Math.max(100, Math.ceil(calls * 4 * 2 / 100) * 100); },
    /** start: puerto inicial efectivo (0 o desconocido: solo se devuelven los puertos). */
    plan: function (calls, start) {
      var ports = WPA.rtp.ports(calls);
      return { calls: calls, ports: ports, start: start > 0 ? start : 0, end: start > 0 ? start + ports : 0 };
    },
    block: function (start, end) { return ['; BEGIN webphone_kit:rtp-range', 'rtpstart=' + start, 'rtpend=' + end, '; END webphone_kit:rtp-range'].join('\n'); }
  };
  WPA.BROWSER_IDS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12'];
  /** B9 y B10 no se muestran en la revision: solo existen como funciones a pedido (ver B.b9 y B.b10). */
  WPA.BROWSER_SHOWN = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B11', 'B12'];
})(window);
