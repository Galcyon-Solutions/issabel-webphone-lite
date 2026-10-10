// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
//
// Nucleo SIP del webphone: configuracion, registro, una sola instancia por usuario entre pestañas y llamadas.
// No toca el DOM (la barra vive en ui.js). El secreto SIP existe solo en memoria: se pasa a JsSIP y se descarta.
import JsSIP from 'jssip';
import { Tones } from './tones.js';
import { agentLoginMatch, normalizeAgent } from './agentlogin.js';

const NUMBER_RE = /^[0-9+*#]{1,32}$/;
const ICE_WAIT_MS = 1500;          // tope de espera de candidatos ICE antes del INVITE o de la respuesta 200
const BACKOFF_MS = [5000, 10000, 20000, 40000, 60000, 120000];

/** Enmascara el secreto y las cabeceras de autenticacion en cualquier texto que vaya a la consola. */
export function maskSecrets(text, secrets) {
  let s = String(text);
  for (const sec of secrets) if (sec && sec.length > 2) s = s.split(sec).join('***');
  return s
    .replace(/((?:Proxy-)?Authorization\s*:)[^\r\n]*/gi, '$1 ***')
    .replace(/((?:response|nonce|cnonce)\s*=\s*)"[^"]*"/gi, '$1"***"');
}

export function normalizeNumber(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\s().-]/g, '');
  return NUMBER_RE.test(s) ? s : null;
}

function uuidHex(uuid) { return uuid.replace(/-/g, ''); }

function stableInstanceId(sipUser) {
  const key = 'wpk-instance-' + sipUser;
  const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && isUuid(saved)) return saved;
    const fresh = window.crypto.randomUUID();
    window.localStorage.setItem(key, fresh);   // un identificador al azar, no un secreto
    return fresh;
  } catch (e) {
    return window.crypto.randomUUID();
  }
}

export class Phone {
  /**
   * @param {object} opts  opciones normalizadas (configUrl, debug, autoAnswer, ...)
   * @param {(name:string, data?:object)=>void} emit  emisor de eventos publico
   * @param {HTMLAudioElement} audioEl  elemento de audio remoto
   */
  constructor(opts, emit, audioEl) {
    this.opts = opts;
    this._emit = emit;
    this.audio = audioEl;
    this.tones = new Tones();
    this.status = 'loading';       // loading | inactive | disconnected | registering | registered | error | follower
    this.error = null;
    this.call = null;              // llamada actual (ver _bindSession)
    this.otherTab = null;          // estado difundido por la pestaña dueña (solo en modo follower)
    this.ice = null;               // ultimo estado de la peerconnection
    this._ua = null;
    this._cfg = null;
    this._tonesCfg = { ringtone: true, ringback: true };
    this._secrets = [];
    this._destroyed = false;
    this._releaseLock = null;
    this._lockAbort = null;
    this._bc = null;
    this._sipUser = null;
    this._stream = null;
    this._retry = { n: 0, timer: null };
    this._agentWin = null;
    this._wsUrl = '';
    this._pcConfig = { iceServers: [] };
    this.echoNumber = opts.echoNumber || '*43';
    this.history = [];             // ultimos eventos tecnicos (solo para el informe plegado de soporte, sin secretos)
    this._onPageHide = () => this._leave();
    this._onPageShow = e => { if (e.persisted && this._ua && !this._destroyed) { this._leaving = false; try { this._ua.register(); } catch (x) { /* sin socket */ } } };
  }

  // ------------------------------------------------------------------ depuracion segura
  _installLogging() {
    // La traza interna de JsSIP (modulo "debug") sale por console.info sin pasar por aqui y puede incluir cabeceras de
    // autenticacion, asi que se APAGA siempre. La opcion debug activa una traza propia ya enmascarada (ver _trace).
    // Se conserva el valor que la pagina anfitriona tenga en localStorage.debug: disable() lo borraria.
    let prev = null;
    try { prev = window.localStorage.getItem('debug'); } catch (e) { prev = null; }
    JsSIP.debug.disable();
    try { if (prev !== null) window.localStorage.setItem('debug', prev); } catch (e) { /* sin almacenamiento */ }
  }

  _trace(dir, text) {
    if (!this.opts.debug) return;
    // eslint-disable-next-line no-console
    console.debug('[webphone]', dir, maskSecrets(text, this._secrets));
  }

  _log(...args) {
    if (!this.opts.debug) return;
    // eslint-disable-next-line no-console
    console.debug('[webphone]', ...args.map(a => maskSecrets(typeof a === 'string' ? a : JSON.stringify(a), this._secrets)));
  }

  // ------------------------------------------------------------------ estado
  _set(status, error) {
    this.status = status;
    this.error = error || null;
    this._emit('status', { status, error: this.error });
    this._broadcast();
  }

  /** Apunta un evento tecnico para el informe de soporte (maximo 8, sin secretos). */
  _note(kind, code) {
    this.history.push({ t: Date.now(), kind, code: code == null ? '' : String(code) });
    if (this.history.length > 8) this.history.shift();
  }

  /** Datos para las comprobaciones del informe (la clave SIP nunca esta aqui). */
  diagInfo() {
    return {
      status: this.status, sipUser: this._sipUser, wsUrl: this._wsUrl, iceServers: this._pcConfig.iceServers,
      history: this.history.slice(), version: this.opts.version,
    };
  }

  /** Consulta el endpoint de configuracion sin conservar nada: 'ok', 'session' (sin sesion) o 'network'. */
  async probeSession() {
    let r = null;
    try { r = await this._fetchConfig(); } catch (e) { return 'network'; }
    const ok = r.ok;
    const status = r.status;
    r = null;
    if (ok) return 'ok';
    return status === 401 || status === 403 ? 'session' : 'network';
  }

  /** Reintenta reproducir el audio remoto tras un clic (politica de reproduccion automatica). */
  resumeAudio() {
    if (!this.audio) return Promise.resolve(false);
    return this.audio.play().then(() => true, () => false);
  }

  getState() {
    const c = this.call;
    return {
      status: this.status,
      error: this.error,
      registered: !!(this._ua && this._ua.isRegistered()),
      connected: !!(this._ua && this._ua.isConnected()),
      follower: this.status === 'follower',
      otherTab: this.otherTab,
      call: c ? {
        direction: c.direction, state: c.state, number: c.number, name: c.name, held: c.held, muted: c.muted,
        startedAt: c.startedAt,
      } : null,
      pc: this.ice,
      agentLoginWindow: this._agentWindowInfo(),
    };
  }

  // ------------------------------------------------------------------ arranque
  async start() {
    this._set('loading');
    let cfg;
    try {
      cfg = await this._fetchConfig();
    } catch (e) {
      return this._goInactive('network');
    }
    if (this._destroyed) return;
    if (!cfg.ok) return this._goInactive('http_' + cfg.status);
    this._sipUser = cfg.data.sip_user;
    await this._acquire(cfg.data);
  }

  async _fetchConfig() {
    this._cfgAbort = new AbortController();
    const r = await fetch(this.opts.configUrl, {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: this._cfgAbort.signal,
    });
    if (r.status !== 200) return { ok: false, status: r.status };
    let j;
    try { j = await r.json(); } catch (e) { return { ok: false, status: 'bad_json' }; }
    const valid = j && typeof j === 'object'
      && typeof j.sip_user === 'string' && /^[0-9]{1,20}$/.test(j.sip_user)
      && typeof j.password === 'string' && j.password !== ''
      && typeof j.domain === 'string' && /^[A-Za-z0-9.:[\]-]{1,253}$/.test(j.domain)
      && typeof j.ws_url === 'string' && /^wss:\/\/[A-Za-z0-9.:[\]-]{1,260}\/[A-Za-z0-9._~/-]{1,100}$/.test(j.ws_url);
    if (!valid) return { ok: false, status: 'bad_config' };
    return { ok: true, data: j };
  }

  _goInactive(reason) {
    this._cleanup();
    this.status = 'inactive';
    this._emit('inactive', { reason });
  }

  // ------------------------------------------------------------------ una instancia por usuario (navigator.locks)
  async _acquire(cfg) {
    const name = 'wpk-reg-' + cfg.sip_user;
    this._openChannel(cfg.sip_user);
    if (!navigator.locks || !navigator.locks.request) {   // sin la API: se registra (solo navegadores muy viejos)
      this._begin(cfg);
      return;
    }
    this._lockAbort = new AbortController();
    const got = await new Promise(resolve => {
      navigator.locks.request(name, { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return undefined; }
        resolve(true);
        return new Promise(res => { this._releaseLock = res; });
      }).catch(() => resolve(false));
    });
    if (this._destroyed) { this._unlock(); return; }
    if (got) { this._begin(cfg); return; }
    // Otra pestaña es la dueña: se descarta la configuracion (con el secreto) y se espera el relevo en cola.
    cfg = null;
    this.otherTab = null;
    this._set('follower');
    this._postBc({ t: 'hello' });
    navigator.locks.request(name, { signal: this._lockAbort.signal }, async () => {
      if (this._destroyed) return undefined;
      let again;
      try { again = await this._fetchConfig(); } catch (e) { again = { ok: false, status: 'network' }; }
      if (this._destroyed || !again.ok) {
        if (!this._destroyed) this._goInactive('http_' + again.status);
        return undefined;
      }
      this.otherTab = null;
      this._begin(again.data);
      return new Promise(res => { this._releaseLock = res; });
    }).catch(() => { /* espera abortada al destruir */ });
  }

  _unlock() {
    if (this._lockAbort) this._lockAbort.abort();
    if (this._releaseLock) { this._releaseLock(); this._releaseLock = null; }
  }

  _openChannel(user) {
    if (typeof BroadcastChannel === 'undefined' || this._bc) return;
    this._bc = new BroadcastChannel('wpk-' + user);
    this._bc.onmessage = ev => {
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello' && this._ua) this._broadcast();
      if (m.t === 'state' && this.status === 'follower') {
        this.otherTab = { status: String(m.status || ''), call: m.call || null };
        this._emit('status', { status: this.status, error: null, otherTab: this.otherTab });
      }
    };
  }

  _postBc(msg) { try { if (this._bc) this._bc.postMessage(msg); } catch (e) { /* canal cerrado */ } }

  _broadcast() {
    if (!this._ua) return;
    const c = this.call;
    this._postBc({
      t: 'state', status: this.status,
      call: c ? { state: c.state, direction: c.direction, number: c.number, name: c.name } : null,
    });
  }

  // ------------------------------------------------------------------ UA y registro
  _begin(cfg) {
    this._secrets = [cfg.password];
    this._installLogging();
    this._tonesCfg = {
      ringtone: !cfg.tones || cfg.tones.ringtone !== false,
      ringback: !cfg.tones || cfg.tones.ringback !== false,
    };
    const instance = stableInstanceId(cfg.sip_user);
    const hex = uuidHex(instance);
    this._domain = cfg.domain;
    this._wsUrl = cfg.ws_url;
    if (typeof cfg.echo_number === 'string' && NUMBER_RE.test(cfg.echo_number) && !this.opts.echoNumber) this.echoNumber = cfg.echo_number;
    this._pcConfig = { iceServers: Array.isArray(cfg.ice_servers) ? cfg.ice_servers : [] };
    let ua;
    try {
      ua = new JsSIP.UA({
        sockets: [this._makeSocket(cfg.ws_url)],
        uri: `sip:${cfg.sip_user}@${cfg.domain}`,
        password: cfg.password,
        authorization_user: cfg.sip_user,
        display_name: String(cfg.display_name || cfg.sip_user).slice(0, 80),
        instance_id: instance,                       // sin "urn:" (JsSIP lo rechaza)
        // Contacto estable: un registro nuevo REEMPLAZA al anterior en lugar de dejar contactos fantasma.
        contact_uri: `sip:${hex.slice(0, 8)}@${hex.slice(8, 20)}.invalid;transport=ws`,
        register: true,                              // REGISTER inmediato: sin sesion SIP Asterisk cierra el WebSocket a los 32 s
        register_expires: Number(cfg.register_expires) || 600,
        session_timers: false,
        user_agent: 'webphone_kit/' + this.opts.version,
        connection_recovery_min_interval: 2,
        connection_recovery_max_interval: 30,
      });
    } catch (e) {
      this._log('configuracion rechazada por JsSIP');
      this._set('error', 'err.config');
      this._emit('error', { code: 'config' });
      return;
    }
    cfg = null;   // a partir de aqui el secreto solo vive dentro del UA de JsSIP
    this._ua = ua;
    this._set('registering');

    ua.on('connected', () => { this._log('websocket conectado'); this._emit('connected'); });
    ua.on('disconnected', () => {
      this._note('ws-closed', '');
      this._emit('disconnected');
      if (!this._destroyed && !this._leaving) this._set('disconnected');
    });
    ua.on('registered', () => {
      this._retry.n = 0;
      this._set('registered');
      this._emit('registered');
    });
    ua.on('unregistered', () => {
      this._emit('unregistered');
      if (!this._destroyed && !this._leaving && this.status === 'registered') this._set('registering');
    });
    ua.on('registrationFailed', e => {
      if (this._destroyed || this._leaving) return;
      const status = e && e.response ? Number(e.response.status_code) || 0 : 0;
      this._note('register-failed', status || (e && e.cause) || '');
      this._set('error', 'err.register');
      this._emit('error', { code: 'register', cause: e && e.cause ? String(e.cause) : '', status });
      this._scheduleRetry();
    });
    ua.on('newRTCSession', e => {
      if (e.originator !== 'remote') return;
      if (this.call) { e.session.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); return; }
      this._bindSession(e.session);
      this._onIncoming();
    });

    window.addEventListener('pagehide', this._onPageHide);
    window.addEventListener('pageshow', this._onPageShow);
    ua.start();
  }

  /** WebSocket de JsSIP; con debug trazado y enmascarado (clave y cabeceras Authorization). */
  _makeSocket(url) {
    const self = this;
    class TracedSocket extends JsSIP.WebSocketInterface {
      send(message) { self._trace('>>', message); return super.send(message); }
      _onMessage(e) { self._trace('<<', e.data); return super._onMessage(e); }
    }
    return this.opts.debug ? new TracedSocket(url) : new JsSIP.WebSocketInterface(url);
  }

  _scheduleRetry() {
    if (this._retry.timer) return;
    const wait = BACKOFF_MS[Math.min(this._retry.n, BACKOFF_MS.length - 1)];
    this._retry.n += 1;
    this._retry.timer = window.setTimeout(() => {
      this._retry.timer = null;
      if (this._destroyed || !this._ua) return;
      this._set('registering');
      try { this._ua.register(); } catch (e) { this._scheduleRetry(); }
    }, wait);
  }

  /** Antes de cerrar la pestaña: desregistra todos los contactos para no dejar fantasmas en Asterisk. */
  _leave() {
    this._leaving = true;
    try { if (this._ua) this._ua.unregister({ all: true }); } catch (e) { /* el socket ya no esta */ }
  }

  // ------------------------------------------------------------------ audio y microfono
  async _ensureStream() {
    if (this._stream && this._stream.getTracks().some(t => t.readyState === 'live')) return this._stream;
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    });
    return this._stream;
  }

  _releaseStream() {
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    this._stream = null;
  }

  _playRemote(stream) {
    if (!this.audio) return;
    this.audio.srcObject = stream;
    this.audio.muted = false;
    this.audio.volume = 1;
    const p = this.audio.play();
    if (p && p.catch) p.catch(() => this._emit('error', { code: 'audio' }));
  }

  _wirePc(pc) {
    const snap = () => {
      this.ice = { ice: pc.iceConnectionState, connection: pc.connectionState, gathering: pc.iceGatheringState, signaling: pc.signalingState };
      this._emit('ice', this.ice);
      const c = this.call;
      if ((pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') && c && c.session.connection === pc && !c.iceFailed) {
        c.iceFailed = true;                    // la ruta de red fallo: se avisa y se corta para que la persona reintente
        this._note('ice-failed', '');
        this._emit('error', { code: 'ice' });
        try { c.session.terminate(); } catch (x) { /* ya terminada */ }
      }
    };
    pc.addEventListener('iceconnectionstatechange', snap);
    pc.addEventListener('connectionstatechange', snap);
    pc.addEventListener('icegatheringstatechange', snap);
    // ev.streams[0] a veces llega vacio: el audio remoto se reconstruye siempre desde los receivers.
    pc.addEventListener('track', () => {
      const rebuilt = new MediaStream();
      pc.getReceivers().forEach(r => { if (r.track && r.track.kind === 'audio') rebuilt.addTrack(r.track); });
      if (rebuilt.getTracks().length) this._playRemote(rebuilt);
    });
    snap();
  }

  // ------------------------------------------------------------------ sesiones
  _agentWindowInfo() {
    const w = this._agentWin;
    return w && w.until > Date.now() ? { agent: w.agent, expiresAt: w.until } : null;
  }

  /**
   * Etapa 4 (login de agente): abre una ventana en la que un INVITE entrante puede ser el login del agente. Dentro de la
   * ventana, una llamada con el nombre "Agent/<n> Login" y el mismo numero de agente se contesta sola (ver agentlogin.js).
   * La ventana se cierra con la primera llamada valida o al vencer; el evento agentLoginWindow trae el motivo.
   */
  expectAgentLogin(o) {
    const agent = normalizeAgent(o && o.agent);
    const ms = Math.min(Math.max(Number(o && o.windowMs) || 35000, 1000), 120000);
    if (this._agentTimer) window.clearTimeout(this._agentTimer);
    this._agentTimer = null;
    if (this._agentWin) this._emit('agentLoginWindow', { open: false, agent: this._agentWin.agent, reason: 'replaced' });
    this._agentWin = { agent, until: Date.now() + ms };
    this._emit('agentLoginWindow', { open: true, agent, windowMs: ms });
    this._agentTimer = window.setTimeout(() => this._closeAgentWindow('timeout'), ms);
    return () => this.cancelAgentLogin();
  }

  /** Cierra la ventana de login de agente (si hay una abierta). */
  cancelAgentLogin() { this._closeAgentWindow('cancelled'); }

  _closeAgentWindow(reason) {
    if (this._agentTimer) window.clearTimeout(this._agentTimer);
    this._agentTimer = null;
    const w = this._agentWin;
    this._agentWin = null;
    if (w) this._emit('agentLoginWindow', { open: false, agent: w.agent, reason });
  }

  _publicCall() {
    const c = this.call;
    return c ? {
      direction: c.direction, number: c.number, name: c.name,
      agentLogin: c.direction === 'incoming' ? this._agentWindowInfo() : null,
      agentSession: c.agent || '',
    } : null;
  }

  _bindSession(session) {
    const remote = session.remote_identity;
    const c = {
      session,
      direction: session.direction === 'incoming' ? 'incoming' : 'outgoing',
      state: session.direction === 'incoming' ? 'ringing' : 'calling',
      number: remote && remote.uri ? String(remote.uri.user || '') : '',
      name: remote && remote.display_name ? String(remote.display_name) : '',
      held: false, muted: false, startedAt: null, confirmed: false, iceTimer: null, agent: '',
    };
    this.call = c;
    this.ice = null;
    if (session.connection) this._wirePc(session.connection);
    session.on('peerconnection', e => this._wirePc(e.peerconnection));

    // Tope de espera de ICE: JsSIP espera todos los candidatos antes de mandar el SDP. Se corta a ICE_WAIT_MS desde el
    // primer candidato (equivalente documentado de JsSIP: evento "icecandidate" con su funcion ready()).
    session.on('icecandidate', e => {
      if (!c.iceTimer) c.iceTimer = window.setTimeout(() => { try { e.ready(); } catch (x) { /* ya listo */ } }, ICE_WAIT_MS);
    });
    session.on('progress', () => {
      if (c.direction === 'outgoing' && c.state === 'calling') {
        c.state = 'early';
        if (this._tonesCfg.ringback) this.tones.start('back');
        this._emit('progress', this._publicCall());
        this._changed();
      }
    });
    session.on('accepted', () => {
      this.tones.stop();
      c.startedAt = Date.now();
      c.state = 'active';
      this._emit('accepted', this._publicCall());
      this._changed();
    });
    session.on('confirmed', () => {
      c.confirmed = true;
      if (!c.startedAt) c.startedAt = Date.now();
      c.state = c.held ? 'held' : 'active';
      this._watchSilence(c);
      this._emit('confirmed', this._publicCall());
      if (c.agent) this._emit('agentSession', { open: true, agent: c.agent });
      this._changed();
    });
    session.on('hold', () => { c.held = true; c.state = 'held'; this._emit('hold'); this._changed(); });
    session.on('unhold', () => { c.held = false; c.state = 'active'; this._emit('unhold'); this._changed(); });
    session.on('muted', () => { c.muted = true; this._emit('mute'); this._changed(); });
    session.on('unmuted', () => { c.muted = false; this._emit('unmute'); this._changed(); });
    session.on('newDTMF', e => this._emit('dtmf', { tone: String(e.dtmf && e.dtmf.tone || ''), direction: e.originator === 'remote' ? 'in' : 'out' }));
    session.on('ended', e => this._finish(c, 'ended', e && e.cause, e && e.message && e.message.status_code, e && e.originator));
    session.on('failed', e => this._finish(c, 'failed', e && e.cause, e && e.message && e.message.status_code, e && e.originator));
  }

  /** Si el microfono no produce nada durante la llamada (sin silenciar ni en espera), se avisa una sola vez. */
  _watchSilence(c) {
    if (c.silentTimer) return;
    const energy = async () => {
      const pc = c.session && c.session.connection;
      if (!pc || !pc.getStats) return null;
      let e = null;
      (await pc.getStats()).forEach(r => { if (r.type === 'media-source' && r.kind === 'audio' && typeof r.totalAudioEnergy === 'number') e = r.totalAudioEnergy; });
      return e;
    };
    let first = null;
    c.silentTimer = window.setTimeout(async () => {
      try { first = await energy(); } catch (x) { first = null; }
      c.silentTimer = window.setTimeout(async () => {
        if (this.call !== c || c.muted || c.held || first === null) return;
        let second = null;
        try { second = await energy(); } catch (x) { second = null; }
        if (second !== null && second === first) { this._note('mic-silent', ''); this._emit('error', { code: 'silentMic' }); }
      }, 5000);
    }, 3000);
  }

  _finish(c, how, cause, code, originator) {
    if (this.call !== c) return;
    if (c.iceTimer) window.clearTimeout(c.iceTimer);
    if (c.silentTimer) window.clearTimeout(c.silentTimer);
    if (how === 'failed') this._note('call-failed', Number(code) || cause || '');
    // JsSIP corta solo la llamada cuando la ruta de red falla (causa "RTP Timeout"): se avisa como error de red.
    if (cause === 'RTP Timeout' && !c.iceFailed) { c.iceFailed = true; this._note('ice-failed', ''); this._emit('error', { code: 'ice' }); }
    this.tones.stop();
    this.call = null;
    this._releaseStream();
    if (this.audio) this.audio.srcObject = null;
    const info = { direction: c.direction, number: c.number, name: c.name, cause: cause ? String(cause) : '', code: Number(code) || 0, local: originator === 'local', seconds: c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0, agent: c.agent || '' };
    this._emit(how, info);
    this._emit('callEnd', info);
    if (c.agent) this._emit('agentSession', { open: false, agent: c.agent });
    this._changed();
  }

  _changed() {
    this._emit('callChange', this.getState().call);
    this._broadcast();
  }

  _onIncoming() {
    const c = this.call;
    // Login de agente: ventana abierta + nombre "Agent/<n> Login" + mismo agente. La ventana se consume con la primera valida.
    const m = agentLoginMatch(this._agentWin, c, Date.now());
    if (m.ok) {
      c.agent = m.agent;
      this._closeAgentWindow('matched');
    }
    const info = this._publicCall();
    this._emit('incoming', info);
    if (!c.agent && this._tonesCfg.ringtone) this.tones.start('ring');
    this._changed();
    if (c.agent) { this.answer(); return; }
    if (typeof this.opts.autoAnswer === 'function') {
      let yes = false;
      try { yes = !!this.opts.autoAnswer(info); } catch (e) { yes = false; }
      if (yes) this.answer();
    }
  }

  // ------------------------------------------------------------------ acciones
  _fail(code, reason) { this._emit('error', reason ? { code, reason } : { code }); return false; }

  async call_(raw) {
    const number = normalizeNumber(raw);
    if (!number) return this._fail('invalidNumber');
    if (!this._ua || !this._ua.isRegistered()) return this._fail('notRegistered');
    if (this.call) return this._fail('busy');
    let stream;
    try { stream = await this._ensureStream(); } catch (e) { return this._fail('mic', e && e.name ? String(e.name) : 'Error'); }
    if (this.call || !this._ua || this._destroyed) { this._releaseStream(); return this._fail('busy'); }
    const session = this._ua.call(number, {
      mediaStream: stream,
      mediaConstraints: { audio: true, video: false },
      pcConfig: this._pcConfig,
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    });
    this._bindSession(session);
    this._emit('calling', this._publicCall());
    this._changed();
    return true;
  }

  async answer() {
    const c = this.call;
    if (!c || c.direction !== 'incoming' || c.state !== 'ringing') return false;
    this.tones.stop();
    let stream;
    try { stream = await this._ensureStream(); } catch (e) { this._fail('mic', e && e.name ? String(e.name) : 'Error'); c.session.terminate({ status_code: 480, reason_phrase: 'Temporarily Unavailable' }); return false; }
    if (this.call !== c) { this._releaseStream(); return false; }
    c.session.answer({ mediaStream: stream, mediaConstraints: { audio: true, video: false }, pcConfig: this._pcConfig });
    return true;
  }

  hangup() {
    const c = this.call;
    if (!c) return false;
    this.tones.stop();
    try {
      if (c.direction === 'incoming' && c.state === 'ringing') c.session.terminate({ status_code: 603, reason_phrase: 'Decline' });
      else c.session.terminate();
    } catch (e) { return false; }
    return true;
  }

  mute() {
    const c = this.call;
    if (!c || c.state === 'ringing' || c.state === 'calling') return false;
    if (c.session.isMuted().audio) c.session.unmute({ audio: true }); else c.session.mute({ audio: true });
    return true;
  }

  hold() {
    const c = this.call;
    if (!c || !c.confirmed) return false;
    if (c.session.isOnHold().local) return c.session.unhold(); else return c.session.hold();
  }

  dtmf(d) {
    const c = this.call;
    const tone = String(d == null ? '' : d);
    if (!c || !c.confirmed || !/^[0-9A-D*#]$/i.test(tone)) return false;
    c.session.sendDTMF(tone, { transportType: 'INFO', duration: 100, interToneGap: 70 });   // por INFO (SIP)
    return true;
  }

  /** Diagnostico de media: bytes y paquetes de la llamada actual (sin secretos). */
  async mediaStats() {
    const c = this.call;
    const pc = c && c.session && c.session.connection;
    if (!pc) return null;
    const out = { outBytes: 0, outPackets: 0, inBytes: 0, inPackets: 0, pair: null };
    (await pc.getStats()).forEach(r => {
      if (r.type === 'outbound-rtp' && r.kind === 'audio') { out.outBytes += r.bytesSent || 0; out.outPackets += r.packetsSent || 0; }
      if (r.type === 'inbound-rtp' && r.kind === 'audio') { out.inBytes += r.bytesReceived || 0; out.inPackets += r.packetsReceived || 0; }
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) out.pair = { state: r.state, bytesSent: r.bytesSent, bytesReceived: r.bytesReceived, local: r.localCandidateId, remote: r.remoteCandidateId };
    });
    const stats = await pc.getStats();
    if (out.pair) {
      const l = stats.get(out.pair.local), rm = stats.get(out.pair.remote);
      out.pair.local = l ? { type: l.candidateType, protocol: l.protocol } : null;
      out.pair.remote = rm ? { type: rm.candidateType, protocol: rm.protocol, address: rm.address || rm.ip, port: rm.port } : null;
    }
    return out;
  }

  /** Transferencia ciega (REFER). */
  transfer(raw) {
    const c = this.call;
    const number = normalizeNumber(raw);
    if (!number) return this._fail('invalidNumber');
    if (!c || !c.confirmed) return false;
    c.session.refer(number);
    return true;
  }

  // ------------------------------------------------------------------ cierre
  _cleanup() {
    if (this._retry.timer) window.clearTimeout(this._retry.timer);
    this._retry.timer = null;
    if (this._agentTimer) window.clearTimeout(this._agentTimer);
    window.removeEventListener('pagehide', this._onPageHide);
    window.removeEventListener('pageshow', this._onPageShow);
    if (this._cfgAbort) this._cfgAbort.abort();
    this.tones.close();
    if (this._bc) { try { this._bc.close(); } catch (e) { /* ya cerrado */ } this._bc = null; }
    this._unlock();
  }

  destroy() {
    this._destroyed = true;
    const ua = this._ua;
    this._ua = null;
    if (this.call) { try { this.call.session.terminate(); } catch (e) { /* sin sesion */ } this.call = null; }
    if (ua) {
      this._leaving = true;
      try { ua.unregister({ all: true }); } catch (e) { /* sin socket */ }
      window.setTimeout(() => { try { ua.stop(); } catch (e) { /* ya detenido */ } }, 300);
    }
    this._releaseStream();
    this._cleanup();
    this._secrets = [];
  }
}
