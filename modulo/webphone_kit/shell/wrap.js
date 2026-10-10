/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Envoltorio transparente del webphone (etapa 4). Corre en wrap.html, que Apache sirve en lugar de index.php para una
 * navegacion de documento. Monta la barra (WebphoneKit) arriba y carga la URL original en un iframe del mismo origen.
 * Ver README-envoltorio.md. No guarda nada sensible: solo la cookie corta wp_nowrap (sin datos) y no toca secretos.
 *
 *   1. Barra de direcciones y titulo siguen al iframe (history.replaceState en cada load); Atras retrocede el iframe.
 *   2. Si el backend responde 403 y el iframe muestra a Issabel con sesion (no el login), esta cuenta no tiene webphone:
 *      el envoltorio se quita solo (cookie wp_nowrap y recarga). Si el iframe muestra el login, se queda: el login ocurre
 *      dentro del iframe y la barra se activa al entrar (recheck en cada load).
 *   3. Endurecimiento: target=_top y _parent pasan a _self (y se vigilan los enlaces nuevos), window.open con _top o
 *      _parent tambien, y beforeunload avisa si hay una llamada.
 */
(function () {
  'use strict';

  var COOKIE = 'wp_nowrap';
  var COOKIE_MAX_AGE = 600;          // segundos; corta a proposito: ver README-envoltorio.md
  var SHELL_PREFIX = '/modules/webphone_kit/shell/';
  var UNWRAP_GUARD_MS = 8000;        // no se desenvuelve dos veces seguidas (protege de un bucle si la cookie no llega)
  var TOPS = /^_(top|parent)$/i;

  var frame = document.getElementById('wpk-shell-frame');
  var host = document.getElementById('wpk-shell-bar');
  var kit = window.WebphoneKit;
  if (!frame || !host) return;

  // ---------------------------------------------------------------- cookie wp_nowrap
  function hasNoWrap() { return new RegExp('(?:^|;\\s*)' + COOKIE + '=1(?:;|$)').test(document.cookie); }
  function setNoWrap() {
    document.cookie = COOKIE + '=1; Path=/; Max-Age=' + COOKIE_MAX_AGE + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function guardOk() {
    try {
      var last = Number(window.sessionStorage.getItem('wpk-unwrap-at')) || 0;
      if (Date.now() - last < UNWRAP_GUARD_MS) return false;
      window.sessionStorage.setItem('wpk-unwrap-at', String(Date.now()));
    } catch (e) { /* sin almacenamiento: la cookie ya evita el bucle */ }
    return true;
  }

  // Si esta pagina quedo dentro de otro marco (no deberia: un iframe no se envuelve), no se anida: se quita el envoltorio.
  if (window.top !== window.self) {
    setNoWrap();
    if (hasNoWrap() && guardOk()) location.reload();
    return;
  }

  // ---------------------------------------------------------------- URL original
  function originalUrl() {
    var path = location.pathname + location.search + location.hash;
    if (path.indexOf(SHELL_PREFIX) === 0) path = '/index.php';         // alguien abrio wrap.html directo
    try {
      var u = new URL(path, location.origin);
      if (u.origin !== location.origin) return '/index.php';
      return u.pathname + u.search + u.hash;
    } catch (e) { return '/index.php'; }
  }

  // ---------------------------------------------------------------- barra
  var st = { kind: 'unknown', unwrapping: false, observer: null, first: true };

  function inCall() {
    try { return !!(kit && kit.info().inCall); } catch (e) { return false; }
  }

  function unwrap() {
    if (st.unwrapping || inCall()) return;
    if (!guardOk()) return;
    setNoWrap();
    if (!hasNoWrap()) return;                   // sin cookies no se puede recordar: se queda envuelto, sin barra
    st.unwrapping = true;
    location.reload();
  }

  if (kit) {
    kit.mount(host, {});
    kit.on('inactive', function (d) {
      // 403 (sin sesion, sin extension o sin webphone) o 404 (modulo quitado). Solo se desenvuelve cuando el iframe ya
      // muestra a Issabel CON sesion: con el login a la vista el envoltorio se queda y espera a que la persona entre.
      var reason = d && d.reason ? String(d.reason) : '';
      if (/^http_(401|403|404)$/.test(reason) && st.kind === 'app') unwrap();
    });
  }

  // ---------------------------------------------------------------- iframe: clasificar, sincronizar y endurecer
  /** 'login' si el iframe muestra el formulario de entrada, 'app' si muestra a Issabel con sesion, 'unknown' si no se sabe. */
  function classify(doc) {
    if (doc.querySelector('[name=input_user], #input_user')) return 'login';
    if (doc.querySelector('#main-menu')) return 'app';
    return 'unknown';
  }

  function syncUrl(win, doc) {
    var here = location.pathname + location.search + location.hash;
    var p = win.location.pathname + win.location.search + win.location.hash;
    if (win.location.origin === location.origin && p.indexOf(SHELL_PREFIX) !== 0 && p !== here) {
      try { window.history.replaceState(window.history.state, '', p); } catch (e) { /* URL no permitida */ }
    }
    if (doc.title) document.title = doc.title;
    var lang = doc.documentElement && doc.documentElement.getAttribute('lang');
    if (lang) document.documentElement.setAttribute('lang', lang);
    var ico = doc.querySelector('link[rel~="icon"]');
    var mine = document.querySelector('link[rel~="icon"]');
    if (ico && ico.getAttribute('href')) {
      if (!mine) { mine = document.createElement('link'); mine.setAttribute('rel', 'icon'); document.head.appendChild(mine); }
      mine.setAttribute('href', ico.href);
    }
  }

  function fixNode(n) {
    if (n && n.nodeType === 1 && n.hasAttribute && n.hasAttribute('target') && TOPS.test(n.getAttribute('target') || '')) n.setAttribute('target', '_self');
  }

  function fixTree(root) {
    if (!root || !root.querySelectorAll) return;
    fixNode(root);
    var list = root.querySelectorAll('a[target],area[target],form[target],base[target]');
    for (var i = 0; i < list.length; i++) fixNode(list[i]);
  }

  function harden(win, doc) {
    if (st.observer) { try { st.observer.disconnect(); } catch (e) { /* ya desconectado */ } st.observer = null; }
    fixTree(doc.documentElement);
    if (typeof win.MutationObserver === 'function') {
      st.observer = new win.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'attributes') fixNode(r.target);
          else for (var j = 0; j < r.addedNodes.length; j++) fixTree(r.addedNodes[j]);
        }
      });
      st.observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['target'] });
    }
    // window.open(url, '_top' | '_parent') desde el iframe tambien se queda en el iframe.
    if (typeof win.open === 'function' && !win.open.__wpkShell) {
      var orig = win.open;
      var patched = function (url, target, features) {
        return orig.call(win, url, typeof target === 'string' && TOPS.test(target) ? '_self' : target, features);
      };
      patched.__wpkShell = true;
      try { win.open = patched; } catch (e) { /* no se pudo reemplazar */ }
    }
  }

  function onFrameLoad() {
    var win = null;
    var doc = null;
    try { win = frame.contentWindow; doc = frame.contentDocument; if (win && win.location.href === 'about:blank') return; } catch (e) { win = doc = null; }
    if (!win || !doc || !doc.documentElement) { st.kind = 'unknown'; return; }   // otro origen o sin documento: no se toca
    syncUrl(win, doc);
    harden(win, doc);
    st.kind = classify(doc);
    if (st.first) {
      st.first = false;
      try { if (document.activeElement === document.body) win.focus(); } catch (e) { /* sin foco */ }
    }
    // La barra se activa al iniciar sesion y se quita al cerrarla: se vuelve a evaluar en cada carga.
    if (kit) { try { var r = kit.recheck(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* sin barra */ } }
  }

  frame.addEventListener('load', onFrameLoad);

  // ---------------------------------------------------------------- una llamada activa no se pierde por una recarga de arriba
  window.addEventListener('beforeunload', function (e) {
    if (!inCall()) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // Navegar el iframe desde fuera siempre con rutas absolutas (una relativa se resolveria contra la ruta de la barra).
  window.WebphoneShell = {
    navigate: function (path) {
      var p = String(path || '');
      if (p.charAt(0) !== '/' || p.charAt(1) === '/') return false;
      frame.src = p;
      return true;
    },
    /** Estado para diagnostico y pruebas: lo que el envoltorio cree que muestra el iframe ('login', 'app' o 'unknown'). */
    state: function () { return { kind: st.kind, unwrapping: st.unwrapping }; }
  };

  frame.src = originalUrl();
}());
