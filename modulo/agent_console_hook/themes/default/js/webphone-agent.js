/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * kit-unit: webphone
 *
 * Gancho de la consola de agente del Call Center (etapa 4 del webphone). ARCHIVO NUEVO: el framework de Issabel carga solo
 * todo modules/agent_console/themes/default/js/*.js en orden alfabetico, asi que este se ejecuta despues de javascript.js
 * sin modificar ningun archivo del Call Center. install.sh lo instala y uninstall.sh lo quita.
 *
 * Que hace, solo cuando la consola esta dentro del envoltorio del webphone (mismo origen y parent.WebphoneKit existe):
 *   1. Al enviar el login del agente (peticion AJAX action=doLogin con "Agent/<n>" y la extension del webphone) abre en la
 *      barra una ventana de 35 s con parent.WebphoneKit.expectAgentLogin({agent:<n>}). La barra contesta SOLA la llamada
 *      del dialer ("Agent/<n> Login") y solo dentro de esa ventana; ver client-src/src/agentlogin.js.
 *   2. Preselecciona en el formulario la extension del propio webphone y esconde el "Callback Login", que no aplica.
 *   3. Dice con una frase clara si el telefono web aun no esta listo y, en ese caso, no deja enviar el login con esa extension.
 * Fuera del envoltorio (consola abierta sola, o sin barra) no hace nada y no lanza errores.
 * Todo texto va con textContent. No guarda nada. No toca claves ni cookies.
 */
(function () {
  'use strict';

  var WINDOW_MS = 35000;

  // ---------------------------------------------------------------- textos (mismas claves en es, en y pt-BR)
  var MSG = {
    es: {
      ready: 'Tu teléfono web está listo. Al entrar, contestará solo.',
      notReady: 'Tu teléfono web aún no está listo. Espera a que la barra diga Listo.',
      otherTab: 'Tu teléfono web está activo en otra pestaña. Entra desde esa pestaña.',
      busy: 'Hay una llamada en curso en tu teléfono web. Termínala y vuelve a intentar.',
      waiting: 'Esperando que tu teléfono web conteste...',
      answering: 'Tu teléfono web está contestando...',
      answered: 'Tu teléfono web contestó. Entrando...',
      micFail: 'Tu navegador no dejó usar el micrófono. Revisa el permiso e inténtalo de nuevo.',
      noAnswer: 'Tu teléfono web no contestó a tiempo. Revisa que la barra diga Listo e inténtalo de nuevo.',
      otherExt: 'Esta extensión no es tu teléfono web. El teléfono web no contestará.',
      notInList: 'Tu extensión web no está en la lista. Pide ayuda a tu administrador.',
      micHint: 'Antes de entrar, prueba tu micrófono: pulsa Ayuda en la barra.'
    },
    en: {
      ready: 'Your web phone is ready. It will answer by itself when you sign in.',
      notReady: 'Your web phone is not ready yet. Wait until the bar says Ready.',
      otherTab: 'Your web phone is active in another tab. Sign in from that tab.',
      busy: 'Your web phone is on a call. End it and try again.',
      waiting: 'Waiting for your web phone to answer...',
      answering: 'Your web phone is answering...',
      answered: 'Your web phone answered. Signing in...',
      micFail: 'Your browser did not allow the microphone. Check the permission and try again.',
      noAnswer: 'Your web phone did not answer in time. Check that the bar says Ready and try again.',
      otherExt: 'This extension is not your web phone. The web phone will not answer.',
      notInList: 'Your web extension is not in the list. Ask your administrator for help.',
      micHint: 'Before you sign in, test your microphone: press Help in the bar.'
    },
    'pt-BR': {
      ready: 'Seu telefone web está pronto. Ele vai atender sozinho quando você entrar.',
      notReady: 'Seu telefone web ainda não está pronto. Espere até a barra dizer Pronto.',
      otherTab: 'Seu telefone web está ativo em outra aba. Entre por essa aba.',
      busy: 'Seu telefone web está em uma chamada. Encerre e tente de novo.',
      waiting: 'Esperando seu telefone web atender...',
      answering: 'Seu telefone web está atendendo...',
      answered: 'Seu telefone web atendeu. Entrando...',
      micFail: 'Seu navegador não permitiu o microfone. Verifique a permissão e tente de novo.',
      noAnswer: 'Seu telefone web não atendeu a tempo. Veja se a barra diz Pronto e tente de novo.',
      otherExt: 'Este ramal não é seu telefone web. O telefone web não vai atender.',
      notInList: 'Seu ramal web não está na lista. Peça ajuda ao administrador.',
      micHint: 'Antes de entrar, teste seu microfone: toque em Ajuda na barra.'
    }
  };

  function pickLang() {
    var c = '';
    try { c = String(document.documentElement.getAttribute('lang') || (navigator.languages && navigator.languages[0]) || navigator.language || ''); } catch (e) { c = ''; }
    c = c.replace('_', '-').toLowerCase();
    if (c.indexOf('pt') === 0) return 'pt-BR';
    if (c.indexOf('en') === 0) return 'en';
    return 'es';
  }

  // ---------------------------------------------------------------- el envoltorio (si no esta, no se hace nada)
  function findKit() {
    try {
      if (window.parent === window) return null;
      var k = window.parent.WebphoneKit;
      return k && typeof k.expectAgentLogin === 'function' && typeof k.cancelAgentLogin === 'function' && typeof k.info === 'function' && typeof k.on === 'function' ? k : null;
    } catch (e) {
      return null;   // el padre es de otro origen: no hay acceso
    }
  }

  var kit = findKit();
  if (!kit) return;

  function init() {
    var agentSel = document.getElementById('input_agent_user');
    var extSel = document.getElementById('input_extension');
    var btn = document.getElementById('submit_agent_login');
    if (!agentSel || !extSel || !btn) return;                       // no es el formulario de login (sesion activa u otra pantalla)
    var onlyCb = document.getElementById('onlycallback');
    if (onlyCb && String(onlyCb.value) !== '0') return;             // modo solo callback: este gancho no aplica

    var msgs = MSG[pickLang()];
    var subs = [];
    var blocked = false;
    var touched = false;
    var pending = null;                                              // la peticion doLogin que abrio la ventana
    var phase = '';                                                  // '', 'waiting', 'answering', 'answered', 'noAnswer'

    // "Callback Login" no aplica con el webphone: se esconde y se deja sin marcar.
    var cbRow = document.getElementById('callbackcheck');
    if (cbRow) cbRow.style.display = 'none';
    var cb = document.getElementById('input_callback');
    if (cb) cb.checked = false;

    // Fila de aviso, justo encima del boton de entrar.
    var note = document.createElement('div');
    note.id = 'wpk-agent-note';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    note.style.cssText = 'margin:4px 0;font-weight:bold;text-align:center;';
    var btnRow = btn.parentNode && btn.parentNode.parentNode;
    if (btnRow && btnRow.parentNode && btnRow.nodeName === 'TR') {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 2;
      td.appendChild(note);
      tr.appendChild(td);
      btnRow.parentNode.insertBefore(tr, btnRow);
    } else {
      btn.parentNode.insertBefore(note, btn);
    }

    function say(key, bad) {
      note.textContent = key ? msgs[key] : '';
      note.style.color = bad ? '#b3261e' : '';
    }

    function hasOption(sel, v) {
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) return true;
      return false;
    }

    // Preselecciona la extension del webphone mientras la persona no haya elegido otra.
    function preselect(info) {
      if (touched || !info.extension) return;
      if (hasOption(extSel, info.extension)) extSel.value = info.extension;
    }

    function setBlocked(v) {
      blocked = v;
      btn.disabled = v;
    }

    function refresh() {
      var info;
      try { info = kit.info(); } catch (e) { return; }
      if (info.status === 'inactive' || info.status === 'unmounted') {    // esta cuenta no tiene telefono web: el formulario queda intacto
        say('');
        setBlocked(false);
        return;
      }
      preselect(info);
      if (phase === 'waiting' || phase === 'answering' || phase === 'answered' || phase === 'noAnswer') return;   // lo que pasa con un login en curso manda sobre el estado
      if (!info.extension) { say('notReady'); setBlocked(true); return; }              // aun cargando la configuracion
      if (!hasOption(extSel, info.extension)) { say('notInList', true); setBlocked(false); return; }
      if (extSel.value !== info.extension) { say('otherExt'); setBlocked(false); return; }
      if (info.follower) { say('otherTab', true); setBlocked(true); return; }
      if (info.inCall && !info.agentSession) { say('busy', true); setBlocked(true); return; }
      if (info.registered) {
        say(info.micReady ? 'ready' : 'micHint');
        setBlocked(false);
        return;
      }
      say('notReady');
      setBlocked(true);
    }

    function sub(name) {
      var off = kit.on(name, function () { refresh(); });
      if (typeof off === 'function') subs.push(off);
    }
    ['status', 'registered', 'unregistered', 'inactive', 'callChange'].forEach(sub);
    subs.push(kit.on('agentLoginWindow', function (d) {
      if (!pending || !d || d.open) return;
      if (d.reason === 'matched') { phase = 'answering'; say('answering'); }          // la barra tomo la llamada del dialer
      else if (d.reason === 'timeout') { phase = 'noAnswer'; say('noAnswer', true); pending = null; }
    }));
    subs.push(kit.on('agentSession', function (d) {
      if (!pending || !d || !d.open) return;
      phase = 'answered';
      say('answered');                                                               // la llamada quedo establecida
    }));
    subs.push(kit.on('error', function (d) {
      if (!pending || !d || d.code !== 'mic' || (phase !== 'waiting' && phase !== 'answering')) return;
      phase = 'noAnswer';
      say('micFail', true);                                                          // no se pudo contestar por el microfono
    }));

    extSel.addEventListener('change', function () { touched = true; phase = ''; refresh(); });
    agentSel.addEventListener('change', function () { phase = ''; refresh(); });

    // Nada se envia mientras el telefono no este listo: el boton queda desactivado, y la tecla Enter de la clave del agente y
    // el envio del formulario (que llaman a do_login() sin pasar por el boton) se cortan en la fase de captura.
    function guard(e) {
      if (!blocked) return;
      if (e.type === 'keypress' && e.which !== 13) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    document.addEventListener('click', function (e) { if (e.target === btn) guard(e); }, true);
    document.addEventListener('keypress', function (e) { if (e.target && (e.target.id === 'input_agent_password' || e.target.id === 'input_password_callback')) guard(e); }, true);
    document.addEventListener('submit', guard, true);

    // La peticion de login de la consola (jQuery $.post a index.php?menu=agent_console&rawmode=yes con action=doLogin).
    var $ = window.jQuery;
    if ($ && typeof $.fn === 'object' && typeof $.fn.ajaxSend === 'function') {
      $(document).ajaxSend(function (ev, xhr, settings) {
        try {
          if (!settings || typeof settings.data !== 'string') return;
          var q = {};
          settings.data.split('&').forEach(function (kv) {
            var i = kv.indexOf('=');
            try { q[decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' '))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (x) { /* par mal codificado */ }
          });
          if (q.action !== 'doLogin') return;
          pending = null;
          phase = '';
          if (q.callback === 'true' || q.callback === 'checked') return;      // login por callback: no hay llamada al telefono
          var m = /^Agent\/(\d+)$/.exec(q.agent || '');
          if (!m) return;
          var info = kit.info();
          if (!info.extension || String(q.ext) !== info.extension || info.agentSession) return;   // otra extension, o ya hay sesion en la barra
          pending = settings;
          phase = 'waiting';
          say('waiting');
          kit.expectAgentLogin({ agent: m[1], windowMs: WINDOW_MS });
        } catch (e) { /* un fallo aqui nunca debe impedir el login normal */ }
      });
      $(document).ajaxSuccess(function (ev, xhr, settings, data) {
        if (settings !== pending) return;
        if (data && data.status === false) { pending = null; phase = ''; try { kit.cancelAgentLogin(); } catch (e) { /* sin barra */ } refresh(); }
      });
      $(document).ajaxError(function (ev, xhr, settings) {
        if (settings !== pending) return;
        pending = null;
        phase = '';
        try { kit.cancelAgentLogin(); } catch (e) { /* sin barra */ }
        refresh();
      });
    }

    window.addEventListener('pagehide', function () {
      subs.forEach(function (off) { try { if (typeof off === 'function') off(); } catch (e) { /* ya cancelado */ } });
      subs = [];
    });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
