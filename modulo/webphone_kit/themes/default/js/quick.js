/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Copyright (C) 2026 Galcyon */
/*
 * Inicio rapido del webphone: UNA pantalla. Lee lo que ya tiene la central (doctor), muestra solo lo esencial en verde o
 * rojo, deja preparar lo que falte con un OK explicito y crea el primer anexo WebRTC del usuario. Reusa el nucleo del
 * asistente (wizard-core.js: DOM, iconos, red con token CSRF) y las acciones del servidor (doctor, fix, plan, apply).
 * Todo texto del servidor o del usuario se pinta con textContent. Sin dependencias.
 */
(function (w) {
  'use strict';
  // Issabel carga solo todos los *.js de themes/default/js en orden alfabetico (quick.js antes que wizard-core.js): esa primera
  // pasada no tiene el nucleo todavia y se salta; la segunda (las etiquetas de index.php, en orden) es la buena.
  if (!w.WPA || !w.WPA.h || (w.WPA.quick && w.WPA.quick.mount)) return;
  var WPA = w.WPA;
  var h = WPA.h;

  // ---------------------------------------------------------------- textos [es, en, pt-BR]
  var K = {
    'title': ['Webphone Lite: inicio rápido', 'Webphone Lite: quick start', 'Webphone Lite: início rápido'],
    'lead': ['Revisamos tu central y dejamos listo tu primer teléfono en el navegador.', 'We check your PBX and get your first browser phone ready.', 'Verificamos sua central e deixamos pronto seu primeiro telefone no navegador.'],
    'checking': ['Revisando tu central…', 'Checking your PBX…', 'Verificando sua central…'],
    'recheck': ['Volver a comprobar', 'Check again', 'Verificar de novo'],
    'advanced': ['Opciones avanzadas', 'Advanced options', 'Opções avançadas'],
    'row.ssl': ['Conexión segura (HTTPS válido)', 'Secure connection (valid HTTPS)', 'Conexão segura (HTTPS válido)'],
    'row.ssl.ok': ['Certificado válido para {host}', 'Valid certificate for {host}', 'Certificado válido para {host}'],
    'row.ssl.soon': ['Certificado válido para {host}; vence en {days} días, renuévalo pronto', 'Valid certificate for {host}; it expires in {days} days, renew it soon', 'Certificado válido para {host}; vence em {days} dias, renove em breve'],
    'row.ssl.bad.none': ['No hay HTTPS en esta central', 'This PBX has no HTTPS', 'Esta central não tem HTTPS'],
    'row.ssl.bad.self': ['El certificado es de fábrica: el navegador no lo acepta para el teléfono', 'The certificate is the factory one: the browser will not trust it for the phone', 'O certificado é o de fábrica: o navegador não o aceita para o telefone'],
    'row.ssl.bad.name': ['El certificado no corresponde a {host}', 'The certificate does not match {host}', 'O certificado não corresponde a {host}'],
    'row.ssl.bad.expired': ['El certificado venció', 'The certificate has expired', 'O certificado venceu'],
    'row.wss': ['Teléfonos WebRTC en Asterisk', 'WebRTC phones in Asterisk', 'Telefones WebRTC no Asterisk'],
    'row.wss.ok': ['Asterisk acepta teléfonos del navegador', 'Asterisk accepts browser phones', 'O Asterisk aceita telefones do navegador'],
    'row.wss.bad': ['Falta el transporte WebSocket seguro en Asterisk', 'The secure WebSocket transport is missing in Asterisk', 'Falta o transporte WebSocket seguro no Asterisk'],
    'row.mods': ['Módulos de Asterisk para WebRTC', 'Asterisk modules for WebRTC', 'Módulos do Asterisk para WebRTC'],
    'row.mods.ok': ['Cargados', 'Loaded', 'Carregados'],
    'row.mods.bad': ['Faltan módulos: {mods}', 'Missing modules: {mods}', 'Faltam módulos: {mods}'],
    'row.ws': ['Puerta del navegador a Asterisk', 'Browser gateway to Asterisk', 'Porta do navegador ao Asterisk'],
    'row.ws.ok': ['Responde en {path}', 'Answers at {path}', 'Responde em {path}'],
    'row.ws.bad': ['Aún no existe {path} en Apache', '{path} does not exist in Apache yet', 'Ainda não existe {path} no Apache'],
    'row.sip': ['Asterisk sin choque con el SIP antiguo', 'Asterisk without clash with the old SIP', 'Asterisk sem conflito com o SIP antigo'],
    'row.sip.ok': ['El WebSocket es de PJSIP', 'The WebSocket belongs to PJSIP', 'O WebSocket é do PJSIP'],
    'row.sip.bad': ['chan_sip puede quedarse con el WebSocket y rechazar tu teléfono', 'chan_sip may take over the WebSocket and reject your phone', 'O chan_sip pode ficar com o WebSocket e rejeitar seu telefone'],
    'prep.sip': ['Apagar el WebSocket del SIP antiguo (websocket_enabled=no en sip_general_custom.conf) y reiniciar Asterisk una vez (unos 15 segundos; solo se hace si no hay llamadas activas). Los anexos chan_sip siguen funcionando por UDP.', 'Turn off the old SIP WebSocket (websocket_enabled=no in sip_general_custom.conf) and restart Asterisk once (about 15 seconds; only done when there are no active calls). chan_sip extensions keep working over UDP.', 'Desligar o WebSocket do SIP antigo (websocket_enabled=no em sip_general_custom.conf) e reiniciar o Asterisk uma vez (uns 15 segundos; só se não houver chamadas ativas). Os ramais chan_sip continuam por UDP.'],
    'row.me': ['Tu usuario', 'Your user', 'Seu usuário'],
    'row.me.none': ['{user}: todavía sin teléfono', '{user}: no phone yet', '{user}: ainda sem telefone'],
    'row.me.ok': ['{user}: anexo {ext} listo', '{user}: extension {ext} ready', '{user}: ramal {ext} pronto'],
    'row.me.other': ['{user}: tiene el anexo {ext}, que no es WebRTC', '{user}: has extension {ext}, which is not WebRTC', '{user}: tem o ramal {ext}, que não é WebRTC'],
    'ssl.title': ['Primero hace falta un certificado HTTPS válido', 'A valid HTTPS certificate comes first', 'Primeiro é preciso um certificado HTTPS válido'],
    'ssl.why': ['Los navegadores solo abren el teléfono (micrófono y WebSocket seguro) en una página con certificado de confianza. Sin eso no avanzamos: no se puede saltar este paso.', 'Browsers only open the phone (microphone and secure WebSocket) on a page with a trusted certificate. Without it we do not go on: this step cannot be skipped.', 'Os navegadores só abrem o telefone (microfone e WebSocket seguro) em uma página com certificado confiável. Sem isso não avançamos: esta etapa não pode ser pulada.'],
    'ssl.s1': ['Apunta un dominio a la IP de esta central (registro A) y entra a Issabel por ese nombre, no por la IP.', 'Point a domain at this PBX IP (A record) and open Issabel by that name, not by the IP.', 'Aponte um domínio para o IP desta central (registro A) e acesse o Issabel por esse nome, não pelo IP.'],
    'ssl.s2': ['Abre Seguridad > Certificado HTTPS (Let\'s Encrypt), escribe el dominio y pulsa Instalar.', 'Open Security > HTTPS Certificate (Let\'s Encrypt), type the domain and press Install.', 'Abra Segurança > Certificado HTTPS (Let\'s Encrypt), digite o domínio e clique em Instalar.'],
    'ssl.s3': ['Vuelve aquí y pulsa Volver a comprobar.', 'Come back here and press Check again.', 'Volte aqui e clique em Verificar de novo.'],
    'ssl.open': ['Abrir Let\'s Encrypt', 'Open Let\'s Encrypt', 'Abrir Let\'s Encrypt'],
    'ssl.byip': ['Estás entrando por la IP ({host}). Entra por el nombre de tu dominio.', 'You are using the IP ({host}). Open it by your domain name.', 'Você está acessando pelo IP ({host}). Acesse pelo nome do domínio.'],
    'prep.btn': ['Preparar', 'Prepare', 'Preparar'],
    'prep.title': ['Esto es lo que voy a cambiar', 'This is what I am going to change', 'Isto é o que vou alterar'],
    'prep.ws': ['Crear la puerta {path} en Apache: un archivo propio (webphone_kit-ws.conf) que pasa el WebSocket del navegador a Asterisk, y recargar Apache sin cortar llamadas.', 'Create the {path} gateway in Apache: its own file (webphone_kit-ws.conf) that forwards the browser WebSocket to Asterisk, then reload Apache without dropping calls.', 'Criar a porta {path} no Apache: um arquivo próprio (webphone_kit-ws.conf) que encaminha o WebSocket do navegador ao Asterisk, e recarregar o Apache sem derrubar chamadas.'],
    'prep.mods': ['Cargar en Asterisk los módulos que faltan ({mods}), sin reiniciarlo.', 'Load the missing modules in Asterisk ({mods}), without restarting it.', 'Carregar no Asterisk os módulos que faltam ({mods}), sem reiniciá-lo.'],
    'prep.not': ['No toco: tus extensiones, el firewall, las rutas ni el dialplan.', 'I do not touch: your extensions, the firewall, routes or dialplan.', 'Não mexo em: seus ramais, o firewall, as rotas nem o dialplan.'],
    'prep.undo': ['Se puede deshacer desde Opciones avanzadas.', 'It can be undone from Advanced options.', 'Pode ser desfeito em Opções avançadas.'],
    'prep.ok': ['Hacer estos cambios', 'Make these changes', 'Fazer estas alterações'],
    'prep.cancel': ['Cancelar', 'Cancel', 'Cancelar'],
    'prep.running': ['Aplicando y comprobando…', 'Applying and checking…', 'Aplicando e verificando…'],
    'prep.done': ['Listo, la central quedó preparada.', 'Done, the PBX is ready.', 'Pronto, a central está preparada.'],
    'prep.fail': ['No se pudo aplicar algo ({err}). Revisa y vuelve a comprobar.', 'Something could not be applied ({err}). Review and check again.', 'Algo não pôde ser aplicado ({err}). Revise e verifique de novo.'],
    'prep.calls': ['Hay {n} llamada(s) activas. Aplicar recarga partes de Asterisk: espera a que terminen o confirma.', 'There are {n} active call(s). Applying reloads parts of Asterisk: wait for them to end or confirm.', 'Há {n} chamada(s) ativa(s). Aplicar recarrega partes do Asterisk: espere terminar ou confirme.'],
    'prep.calls.go': ['Confirmar y aplicar', 'Confirm and apply', 'Confirmar e aplicar'],
    'cmd.title': ['Este paso lo hace root en el servidor:', 'Root must do this step on the server:', 'Este passo é feito pelo root no servidor:'],
    'cmd.copy': ['Copiar', 'Copy', 'Copiar'],
    'cmd.copied': ['Copiado', 'Copied', 'Copiado'],
    'first.finding': ['Buscando un número de anexo libre…', 'Looking for a free extension number…', 'Procurando um número de ramal livre…'],
    'first.title': ['Tu primer anexo', 'Your first extension', 'Seu primeiro ramal'],
    'first.lead': ['Creamos un anexo WebRTC para ti y lo activamos. Puedes cambiar el número.', 'We create a WebRTC extension for you and turn it on. You can change the number.', 'Criamos um ramal WebRTC para você e o ativamos. Você pode mudar o número.'],
    'first.num': ['Número del anexo', 'Extension number', 'Número do ramal'],
    'first.create': ['Crear mi primer anexo', 'Create my first extension', 'Criar meu primeiro ramal'],
    'first.creating': ['Creando…', 'Creating…', 'Criando…'],
    'first.err.exists': ['Ese número ya está en uso. Prueba con otro.', 'That number is already in use. Try another one.', 'Esse número já está em uso. Tente outro.'],
    'first.err.range': ['Ese número está fuera del rango permitido.', 'That number is outside the allowed range.', 'Esse número está fora da faixa permitida.'],
    'first.err.bad': ['Escribe un número de 3 a 6 dígitos.', 'Type a number with 3 to 6 digits.', 'Digite um número de 3 a 6 dígitos.'],
    'first.err.other': ['No se pudo crear el anexo ({err}).', 'The extension could not be created ({err}).', 'Não foi possível criar o ramal ({err}).'],
    'ready.title': ['Listo: tu teléfono está activo', 'Done: your phone is on', 'Pronto: seu telefone está ativo'],
    'ready.ext': ['Anexo {ext} creado y activado para {user}.', 'Extension {ext} created and enabled for {user}.', 'Ramal {ext} criado e ativado para {user}.'],
    'ready.test': ['Prueba: llama al eco (*43). Debes oírte con un pequeño retraso.', 'Test: call the echo (*43). You should hear yourself with a short delay.', 'Teste: ligue para o eco (*43). Você deve se ouvir com um pequeno atraso.'],
    'ready.call': ['Llamar al eco (*43)', 'Call the echo (*43)', 'Ligar para o eco (*43)'],
    'ready.hang': ['Colgar', 'Hang up', 'Desligar'],
    'ready.status': ['Estado del teléfono: {s}', 'Phone status: {s}', 'Estado do telefone: {s}'],
    'ready.have': ['Ya tienes teléfono: anexo {ext} activo para {user}.', 'You already have a phone: extension {ext} is on for {user}.', 'Você já tem telefone: ramal {ext} ativo para {user}.'],
    'ready.nobar': ['La barra del teléfono aparece arriba de todas las páginas de Issabel después de recargar. Si no la ves, el envoltorio no está instalado: ejecuta install.sh en el servidor (o install.sh --envoltorio si instalaste con --sin-envoltorio).', 'The phone bar appears at the top of every Issabel page after reloading. If you do not see it, the wrapper is not installed: run install.sh on the server (or install.sh --envoltorio if you installed with --sin-envoltorio).', 'A barra do telefone aparece no topo de todas as páginas do Issabel após recarregar. Se não a vir, o envoltório não está instalado: execute install.sh no servidor (ou install.sh --envoltorio se instalou com --sin-envoltorio).'],
    'err.forbidden': ['No tienes permiso para esto. Entra como administrador.', 'You are not allowed to do this. Sign in as an administrator.', 'Você não tem permissão. Entre como administrador.'],
    'err.generic': ['No se pudo leer el estado de la central ({err}).', 'The PBX status could not be read ({err}).', 'Não foi possível ler o estado da central ({err}).']
  };

  function make(boot) {
    var li = ({ es: 0, en: 1, 'pt-BR': 2 })[boot.lang];
    if (li === undefined) li = 1;
    return function (key, p) {
      var e = K[key];
      var s = e ? (e[li] || e[1]) : key;
      if (p) for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) s = s.split('{' + k + '}').join(String(p[k]));
      return s;
    };
  }

  function mount(root, boot) {
    var api = WPA.makeApi(boot);
    var T = make(boot);
    var st = boot.state;
    var me = st.user || '';
    var S = { doc: null, rows: null, busy: false, plan: null, phase: 'loading', created: null, msg: null };

    function icon(n) { return WPA.icon(n); }
    function lamp(level) {
      var ic = level === 'ok' ? 'check' : level === 'run' ? 'refresh' : level === 'bad' ? 'x' : 'minus';
      return h('span', { class: 'wpa-lamp wpa-lamp--' + level }, icon(ic));
    }
    function find(d, id) { for (var i = 0; i < d.checks.length; i++) if (d.checks[i].id === id) return d.checks[i]; return null; }

    // ---------------------------------------------------------------- de las comprobaciones del doctor a 4 filas esenciales
    function rowsFrom(d) {
      var ss = d.ssl || {};
      var s1 = find(d, 'S1'), s2 = find(d, 'S2'), s3 = find(d, 'S3'), s4 = find(d, 'S4'), s5 = find(d, 'S5');
      var host = ss.host || (st.host && st.host.name) || '';
      var rows = [];
      var sslOk = !!s1 && s1.level === 'ok' && !!s2 && (s2.level === 'ok' || s2.code === 'soon');
      var sslMsg;
      if (sslOk) sslMsg = (s2.code === 'soon') ? T('row.ssl.soon', { host: host, days: (s2.p && s2.p.days) || '' }) : T('row.ssl.ok', { host: host });
      else if (!s1 || s1.level !== 'ok') sslMsg = T('row.ssl.bad.none');
      else if (s2 && s2.code === 'expired') sslMsg = T('row.ssl.bad.expired');
      else if (s2 && s2.code === 'san') sslMsg = T('row.ssl.bad.name', { host: host });
      else sslMsg = T('row.ssl.bad.self');
      rows.push({ id: 'ssl', t: T('row.ssl'), ok: sslOk, msg: sslMsg, block: true });
      var wssOk = !!s4 && s4.level === 'ok';
      rows.push({ id: 'wss', t: T('row.wss'), ok: wssOk, msg: wssOk ? T('row.wss.ok') : T('row.wss.bad'), block: true });
      var modsOk = !!s3 && (s3.level === 'ok' || s3.code === 'noopus');
      rows.push({ id: 'mods', t: T('row.mods'), ok: modsOk, msg: modsOk ? T('row.mods.ok') : T('row.mods.bad', { mods: (s3 && s3.p && s3.p.mods) || '' }), fix: modsOk ? null : s3 && s3.fix });
      var wsOk = !!s5 && s5.level === 'ok';
      var path = (s5 && s5.p && s5.p.path) || '/kit-ws';
      rows.push({ id: 'ws', t: T('row.ws'), ok: wsOk, msg: wsOk ? T('row.ws.ok', { path: path }) : T('row.ws.bad', { path: path }), fix: wsOk ? null : s5 && s5.fix, path: path });
      var s15 = find(d, 'S15');
      var sipOk = !s15 || s15.level === 'ok';
      rows.push({ id: 'sip', t: T('row.sip'), ok: sipOk, msg: sipOk ? T('row.sip.ok') : T('row.sip.bad'), fix: sipOk ? null : s15.fix });
      var m = S.me;
      if (m && m.ok) rows.push({ id: 'me', t: T('row.me'), ok: true, msg: T('row.me.ok', { user: me, ext: m.ext }), info: true });
      else if (m && m.ext) rows.push({ id: 'me', t: T('row.me'), ok: true, msg: T('row.me.other', { user: me, ext: m.ext }), info: true });
      else rows.push({ id: 'me', t: T('row.me'), ok: true, msg: T('row.me.none', { user: me }), info: true });
      return rows;
    }

    // ---------------------------------------------------------------- carga
    function load() {
      S.phase = 'loading'; S.msg = null; render();
      return Promise.all([api('doctor', {}), api('users_list', { q: me })]).then(function (both) {
        var d = both[0], ul = both[1];
        S.me = null;
        if (ul && ul.ok && ul.rows) ul.rows.forEach(function (r) { if (r.name === me) S.me = { ext: r.ext, ok: r.state === 'yes' && r.webrtc === 'yes' }; });
        if (!d || !d.ok) { S.phase = 'error'; S.msg = d && d.error === 'forbidden' ? T('err.forbidden') : T('err.generic', { err: (d && d.error) || 'network' }); render(); return; }
        S.doc = d; S.rows = rowsFrom(d);
        var blocked = S.rows.some(function (r) { return r.block && !r.ok; });
        var fixable = S.rows.filter(function (r) { return !r.ok && !r.block; });
        S.phase = blocked ? 'blocked' : (fixable.length ? 'prepare' : 'first');
        if (S.created) S.phase = 'ready';
        else if (!blocked && !fixable.length && S.me && S.me.ok) { S.created = { ext: S.me.ext, have: true }; S.phase = 'ready'; startBar(); }
        // el wss de Asterisk (transporte) no lo arregla este modulo: si falta, se explica en su fila y no se avanza
        render();
        if (S.phase === 'first') return suggest();
      });
    }

    function suggest() {
      if (S.suggested) return;
      return api('plan', { mode: 'range', from: '1001', to: '1060', prefix: '' }).then(function (r) {
        var pick = '';
        if (r && r.ok && r.rows) for (var i = 0; i < r.rows.length; i++) if (r.rows[i].status === 'ok') { pick = r.rows[i].ext; break; }
        S.suggested = pick || '1001';
        render();
      });
    }

    // ---------------------------------------------------------------- preparar
    function planText(r) {
      var out = [];
      if (r.id === 'ws' && r.fix && r.fix.kind === 'auto') out.push(T('prep.ws', { path: r.path }));
      if (r.id === 'sip' && r.fix && r.fix.kind === 'auto') out.push(T('prep.sip'));
      if (r.id === 'mods' && r.fix && r.fix.kind === 'auto') out.push(T('prep.mods', { mods: ((find(S.doc, 'S3') || {}).p || {}).mods || '' }));
      return out;
    }
    function applyAll(confirmCalls) {
      S.busy = true; S.msg = T('prep.running'); render();
      var todo = S.rows.filter(function (r) { return !r.ok && r.fix && r.fix.kind === 'auto'; });
      var chain = Promise.resolve({ ok: true });
      var failed = null;
      todo.forEach(function (r) {
        chain = chain.then(function () {
          if (failed) return null;
          var mods = r.id === 'mods' ? String(((find(S.doc, 'S3') || {}).p || {}).mods || '').split(',').filter(Boolean) : [null];
          var seq = Promise.resolve();
          mods.forEach(function (m) {
            seq = seq.then(function () {
              if (failed) return null;
              var params = m ? { mod: m } : {};
              return api('fix', { id: r.fix.id, params: params, confirm_calls: !!confirmCalls }).then(function (x) {
                if (!x || !x.ok) failed = x || { error: 'network' };
              });
            });
          });
          return seq;
        });
      });
      return chain.then(function () {
        S.busy = false;
        if (failed && failed.error === 'calls_active') { S.phase = 'prepare'; S.msg = null; S.calls = failed.calls; S.confirming = true; render(); return; }
        if (failed) { S.msg = T('prep.fail', { err: failed.error || '?' }); return load().then(function () { S.msg = T('prep.fail', { err: failed.error || '?' }); render(); }); }
        return load().then(function () { if (S.phase === 'first') { S.msg = T('prep.done'); render(); } });
      });
    }

    // ---------------------------------------------------------------- crear el primer anexo
    function create(ext, confirmCalls) {
      if (!/^[0-9]{3,6}$/.test(ext)) { S.err = T('first.err.bad'); render(); return; }
      S.busy = true; S.err = null; render();
      var body = { mode: 'one', name: me, ext: ext, self: true, confirm: true, confirm_calls: !!confirmCalls };
      api('apply', body).then(function (r) {
        S.busy = false;
        if (r && r.error === 'calls_active') { S.askCalls = true; S.err = T('prep.calls', { n: r.calls }); render(); return; }
        var res = r && r.ok && r.results && r.results[0];
        if (res && res.status === 'created' && !res.code) { S.created = { ext: ext }; S.me = { ext: ext, ok: true }; S.msg = null; S.askCalls = false; S.rows = rowsFrom(S.doc); S.phase = 'ready'; render(); startBar(); return; }
        var code = res ? (res.code || res.status) : (r && r.error) || 'network';
        S.err = /exists|taken|in_use|used/.test(code) ? T('first.err.exists') : /range/.test(code) ? T('first.err.range') : T('first.err.other', { err: code });
        render();
      });
    }

    // ---------------------------------------------------------------- la barra del teléfono (la del envoltorio si existe; si no, una propia en esta pagina)
    function startBar() {
      var par = null;
      try { if (w.parent && w.parent !== w && w.parent.WebphoneKit) par = w.parent.WebphoneKit; } catch (e) { par = null; }
      if (par) { S.kit = par; try { par.recheck(); } catch (e) { } watch(); return; }
      // Sin envoltorio y con la cookie wp_nowrap: el envoltorio se quito solo mientras esta cuenta aun no tenia
      // telefono (el backend respondia 403) y la cookie dura 10 minutos. Ya hay telefono: se borra y se recarga
      // una vez para que vuelva la barra arriba. Sin la cookie no se recarga, asi que no hay bucle.
      try {
        if (w.top === w && /(?:^|;\s*)wp_nowrap=1(?:;|$)/.test(document.cookie)) {
          document.cookie = 'wp_nowrap=; Path=/; Max-Age=0; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
          if (!/(?:^|;\s*)wp_nowrap=1(?:;|$)/.test(document.cookie)) { location.reload(); return; }
        }
      } catch (e) { }
      if (w.WebphoneKit) { mountOwn(); return; }
      var base = (document.querySelector('link[href*="wizard.css"]') || {}).href || '';
      base = base.replace(/css\/wizard\.css.*$/, '');
      var css = h('link', { rel: 'stylesheet', href: base + 'css/webphone.css' });
      document.head.appendChild(css);
      var sc = h('script', { src: base + 'js/webphone.js' });
      sc.onload = mountOwn;
      document.head.appendChild(sc);
    }
    function mountOwn() {
      var host = barHost();
      if (!w.WebphoneKit || S.own) return;
      S.own = true;
      try { w.WebphoneKit.mount(host, { lang: boot.lang, configUrl: 'modules/webphone_kit/api/config.php' }); S.kit = w.WebphoneKit; watch(); } catch (e) { }
    }
    function watch() {
      if (!S.kit || S.watching) return;
      S.watching = true;
      try { S.kit.on('*', function () { var s = ''; try { s = S.kit.getState().status; } catch (e) { } if (s !== S.kstatus) { S.kstatus = s; paintStatus(); } }); } catch (e) { }
    }
    function paintStatus() {
      var el = document.getElementById('wpa-kstatus');
      if (el) el.textContent = T('ready.status', { s: S.kstatus || '…' });
    }

    // ---------------------------------------------------------------- vistas
    function head() {
      return h('div', { class: 'wpa-top wpa-top--quick' },
        h('div', { class: 'wpa-brand' },
          h('span', { class: 'wpa-brand__ico' }, icon('phone')),
          h('div', null, h('div', { class: 'wpa-brand__t' }, T('title')), h('div', { class: 'wpa-brand__s' }, T('lead')))),
        h('span', { class: 'wpa-ver' }, 'v' + (st.version || '')));
    }
    function checksList() {
      var rows = S.rows || [];
      return h('ul', { class: 'wpa-checks', 'aria-label': 'Checks' }, rows.map(function (r) {
        return h('li', { class: 'wpa-check' + (!r.ok && r.block ? ' is-critical' : '') },
          h('div', { class: 'wpa-check__main' }, lamp(r.ok ? 'ok' : 'bad'),
            h('div', { class: 'wpa-check__txt' }, h('div', { class: 'wpa-check__t' }, r.t, r.ok ? null : h('span', { class: 'wpa-check__crit' }, '✕')), h('div', { class: 'wpa-check__r' }, r.msg))));
      }));
    }
    function sslBox() {
      var ss = (S.doc && S.doc.ssl) || {};
      var urls = (S.doc && S.doc.urls) || st.urls || {};
      var kids = [h('h2', { class: 'wpa-h3' }, T('ssl.title')), h('p', { class: 'wpa-p' }, T('ssl.why'))];
      if (ss.host_kind === 'ip') kids.push(h('p', { class: 'wpa-err' }, icon('warn'), T('ssl.byip', { host: ss.host })));
      kids.push(h('ol', { class: 'wpa-quick-steps' }, [T('ssl.s1'), T('ssl.s2'), T('ssl.s3')].map(function (x) { return h('li', null, x); })));
      var acts = [];
      if (urls.le) acts.push(h('a', { class: 'wpa-btn wpa-btn--primary', href: urls.le, target: '_top' }, icon('lock'), T('ssl.open')));
      acts.push(h('button', { type: 'button', class: 'wpa-btn wpa-btn--secondary', onclick: load }, icon('refresh'), T('recheck')));
      kids.push(h('div', { class: 'wpa-row' }, acts));
      return h('section', { class: 'wpa-card wpa-quick-box' }, kids);
    }
    function wssBox() {
      return h('section', { class: 'wpa-card wpa-quick-box' }, h('p', { class: 'wpa-p' }, T('row.wss.bad')),
        h('div', { class: 'wpa-row' }, h('button', { type: 'button', class: 'wpa-btn wpa-btn--secondary', onclick: load }, icon('refresh'), T('recheck'))));
    }
    function cmdBlock(c) {
      var code = h('code', { class: 'wpa-cmd' }, c);
      return h('div', { class: 'wpa-quick-cmd' }, h('p', { class: 'wpa-hint' }, T('cmd.title')),
        h('div', { class: 'wpa-row' }, code, h('button', { type: 'button', class: 'wpa-btn wpa-btn--ghost', onclick: function (e) { WPA.copy(c); e.currentTarget.textContent = T('cmd.copied'); } }, T('cmd.copy'))));
    }
    function prepareBox() {
      var auto = [], cmds = [];
      S.rows.forEach(function (r) {
        if (r.ok || !r.fix) return;
        if (r.fix.kind === 'auto') auto = auto.concat(planText(r));
        else if (r.fix.kind === 'cmd') cmds.push(r.fix.cmd);
      });
      var kids = [];
      if (S.confirming && auto.length) {
        kids.push(h('h2', { class: 'wpa-h3' }, T('prep.title')));
        kids.push(h('ul', { class: 'wpa-quick-list' }, auto.map(function (x) { return h('li', null, x); })));
        kids.push(h('p', { class: 'wpa-hint' }, T('prep.not') + ' ' + T('prep.undo')));
        if (S.calls) kids.push(h('p', { class: 'wpa-err' }, icon('warn'), T('prep.calls', { n: S.calls })));
        kids.push(h('div', { class: 'wpa-row' },
          h('button', { type: 'button', class: 'wpa-btn wpa-btn--primary', disabled: S.busy, onclick: function () { S.confirming = false; applyAll(!!S.calls); } }, icon('check'), S.calls ? T('prep.calls.go') : T('prep.ok')),
          h('button', { type: 'button', class: 'wpa-btn wpa-btn--secondary', disabled: S.busy, onclick: function () { S.confirming = false; S.calls = 0; render(); } }, T('prep.cancel'))));
      } else {
        if (auto.length) kids.push(h('div', { class: 'wpa-row' }, h('button', { type: 'button', class: 'wpa-btn wpa-btn--primary', disabled: S.busy, onclick: function () { S.confirming = true; render(); } }, icon('shield'), T('prep.btn'))));
        cmds.forEach(function (c) { kids.push(cmdBlock(c)); });
        kids.push(h('div', { class: 'wpa-row' }, h('button', { type: 'button', class: 'wpa-btn wpa-btn--secondary', onclick: load }, icon('refresh'), T('recheck'))));
      }
      return h('section', { class: 'wpa-card wpa-quick-box' }, kids);
    }
    function firstBox() {
      // sin numero sugerido todavia no se muestra el formulario (evita un campo vacio con el boton apagado)
      if (!S.suggested) return h('section', { class: 'wpa-card wpa-quick-box', role: 'status' }, h('p', { class: 'wpa-p' }, lamp('run'), ' ', T('first.finding')));
      var inp = h('input', { type: 'text', inputmode: 'numeric', id: 'wpa-ext', class: 'wpa-input', value: S.suggested || '', maxlength: '6', autocomplete: 'off', 'aria-describedby': 'wpa-ext-err' });
      var btn = h('button', { type: 'button', class: 'wpa-btn wpa-btn--primary', disabled: S.busy || !S.suggested, onclick: function () { create(inp.value.trim(), !!S.askCalls); } }, icon('plus'), S.busy ? T('first.creating') : (S.askCalls ? T('prep.calls.go') : T('first.create')));
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
      return h('section', { class: 'wpa-card wpa-quick-box' },
        h('h2', { class: 'wpa-h3' }, T('first.title')), h('p', { class: 'wpa-p' }, T('first.lead')),
        h('div', { class: 'wpa-quick-form' }, h('label', { for: 'wpa-ext', class: 'wpa-label' }, T('first.num')), inp, btn),
        h('p', { id: 'wpa-ext-err', class: 'wpa-err', role: 'alert' }, S.err ? [icon('warn'), S.err] : null));
    }
    function barHost() {
      // el contenedor de la barra se crea una sola vez: asi un nuevo render no destruye el teléfono ya montado
      if (!S.barEl) S.barEl = h('div', { id: 'wpa-bar', class: 'wpa-quick-bar' });
      return S.barEl;
    }
    function readyBox() {
      var call = h('button', { type: 'button', class: 'wpa-btn wpa-btn--primary', id: 'wpa-callecho', onclick: function () {
        if (!S.kit) return;
        try { var s = S.kit.getState(); if (s.inCall) S.kit.hangup(); else S.kit.call('*43'); } catch (e) { }
      } }, icon('phone'), T('ready.call'));
      return h('section', { class: 'wpa-card wpa-quick-box wpa-quick-ready', 'aria-live': 'polite' },
        h('h2', { class: 'wpa-h3' }, icon('check'), T('ready.title')),
        h('p', { class: 'wpa-p' }, T(S.created.have ? 'ready.have' : 'ready.ext', { ext: S.created.ext, user: me })),
        barHost(),
        h('p', { class: 'wpa-p' }, T('ready.test')),
        h('div', { class: 'wpa-row' }, call, h('span', { id: 'wpa-kstatus', class: 'wpa-hint' }, T('ready.status', { s: S.kstatus || '…' }))),
        h('p', { class: 'wpa-hint' }, T('ready.nobar')));
    }
    function foot() {
      var base = boot.endpoint.replace(/&rawmode=yes/, '');
      return h('div', { class: 'wpa-foot' },
        h('a', { class: 'wpa-link', href: base + '&tab=advanced', target: '_self' }, icon('sliders'), T('advanced')),
        null);
    }

    function render() {
      var keep = document.activeElement && document.activeElement.id;
      var kids = [head()];
      if (S.phase === 'loading') {
        kids.push(h('p', { class: 'wpa-p', role: 'status' }, lamp('run'), ' ', T('checking')));
      } else if (S.phase === 'error') {
        kids.push(h('p', { class: 'wpa-err', role: 'alert' }, icon('warn'), S.msg));
      } else {
        kids.push(checksList());
        if (S.msg) kids.push(h('p', { class: 'wpa-p wpa-quick-msg', role: 'status' }, S.msg));
        var wssBad = S.rows.some(function (r) { return r.id === 'wss' && !r.ok; });
        var sslBad = S.rows.some(function (r) { return r.id === 'ssl' && !r.ok; });
        if (sslBad) kids.push(sslBox());
        else if (wssBad) kids.push(wssBox());
        else if (S.phase === 'prepare') kids.push(prepareBox());
        else if (S.phase === 'first') kids.push(firstBox());
        else if (S.phase === 'ready') kids.push(readyBox());
      }
      kids.push(foot());
      root.textContent = '';
      var shell = h('div', { class: 'wpa-shell wpa-shell--quick' }, kids);
      root.appendChild(shell);
      if (S.phase === 'ready') paintStatus();
      if (keep) { var again = document.getElementById(keep); if (again) again.focus(); }
    }
    // ya tiene un anexo activo? entonces se muestra directo la prueba
    function boundStart() {
      load().then(function () {
        if (S.phase === 'first' || S.phase === 'prepare') { /* nada: sigue el flujo */ }
      });
    }
    boundStart();
    return { reload: load };
  }

  w.WPA = w.WPA || {};
  w.WPA.quick = { mount: mount };
  document.addEventListener('DOMContentLoaded', function () {
    var rootEl = document.getElementById('wpa-root');
    var el = document.getElementById('wpa-boot');
    if (!rootEl || !el) return;
    var boot = JSON.parse(el.textContent);
    if (!boot.quick) return;
    var th = w.WPA.detectTheme ? w.WPA.detectTheme() : 'light';
    rootEl.setAttribute('data-resolved', th);
    mount(rootEl, boot);
  });
})(window);
