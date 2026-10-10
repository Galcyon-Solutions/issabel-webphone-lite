// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Comprobaciones del navegador (las B1 a B8 de la guia que se pueden hacer en el cliente) y el informe de soporte.
// El informe NUNCA lleva secretos: ni la clave SIP, ni las credenciales de los servidores de red, ni cookies, ni datos
// de la llamada. Si hace falta mostrar una direccion, solo se muestra sin usuario ni parametros.
import { fmtTime } from './i18n.js';

const WSS_WAIT_MS = 5000;
const ICE_WAIT_MS = 4000;

const res = (id, status, detail) => ({ id, status, detail: detail || '' });

function checkWss(wsUrl) {
  return new Promise(resolve => {
    if (!wsUrl) { resolve(res('wss', 'unknown', 'sin direccion')); return; }
    let done = false;
    let ws = null;
    const finish = (status, detail) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try { if (ws) ws.close(); } catch (e) { /* ya cerrado */ }
      resolve(res('wss', status, detail));
    };
    const timer = window.setTimeout(() => finish('fail', 'sin respuesta en 5 s'), WSS_WAIT_MS);
    try {
      ws = new WebSocket(wsUrl, 'sip');
      ws.onopen = () => finish('ok', 'abre');
      ws.onerror = () => finish('fail', 'error al abrir');
      ws.onclose = () => finish('fail', 'cerrado al abrir');
    } catch (e) { finish('fail', 'no se pudo crear'); }
  });
}

async function checkIce(iceServers) {
  if (!window.RTCPeerConnection) return res('ice', 'unknown', 'sin soporte');
  let pc = null;
  try {
    pc = new RTCPeerConnection({ iceServers: Array.isArray(iceServers) ? iceServers : [] });
    pc.createDataChannel('wpk');
    const types = { host: 0, srflx: 0, relay: 0 };
    const done = new Promise(resolve => {
      const timer = window.setTimeout(resolve, ICE_WAIT_MS);
      pc.onicecandidate = ev => {
        if (!ev.candidate) { window.clearTimeout(timer); resolve(); return; }
        const m = / typ (host|srflx|relay)/.exec(ev.candidate.candidate || '');
        if (m) types[m[1]] += 1;
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
    const detail = `host=${types.host} srflx=${types.srflx} relay=${types.relay}`;
    if (types.srflx || types.relay) return res('ice', 'ok', detail);
    return res('ice', types.host ? 'warn' : 'fail', detail);
  } catch (e) {
    return res('ice', 'unknown', 'no se pudo medir');
  } finally {
    try { if (pc) pc.close(); } catch (e) { /* ya cerrada */ }
  }
}

async function checkPermission() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const p = await navigator.permissions.query({ name: 'microphone' });
      return res('perm', p.state === 'granted' ? 'ok' : p.state === 'prompt' ? 'warn' : 'fail', p.state);
    }
  } catch (e) { /* Firefox y Safari no lo permiten */ }
  return res('perm', 'unknown', 'no disponible');
}

async function checkDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const ins = list.filter(d => d.kind === 'audioinput').length;
    const outs = list.filter(d => d.kind === 'audiooutput').length;
    return res('devices', ins ? 'ok' : 'fail', `entradas=${ins} salidas=${outs}`);
  } catch (e) { return res('devices', 'unknown', 'no se pudo listar'); }
}

async function checkAutoplay() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let policy = '';
  try { if (navigator.getAutoplayPolicy) policy = ' politica=' + navigator.getAutoplayPolicy('mediaelement'); } catch (e) { /* sin API */ }
  if (!AC) return res('autoplay', 'unknown', 'sin AudioContext');
  let ctx = null;
  try {
    ctx = new AC();
    const state = ctx.state;
    return res('autoplay', state === 'running' ? 'ok' : 'warn', state + policy);
  } catch (e) { return res('autoplay', 'unknown', 'no se pudo medir'); } finally { try { if (ctx) ctx.close(); } catch (e) { /* ya cerrado */ } }
}

async function checkTab(info) {
  if (info.status === 'follower') return res('tab', 'warn', 'otra pestaña registrada');
  try {
    if (navigator.locks && navigator.locks.query && info.sipUser) {
      const q = await navigator.locks.query();
      const n = (q.held || []).filter(l => l.name === 'wpk-reg-' + info.sipUser).length;
      return res('tab', n <= 1 ? 'ok' : 'warn', 'dueñas=' + n);
    }
  } catch (e) { /* sin API */ }
  return res('tab', 'unknown', 'no disponible');
}

/** Corre las ocho comprobaciones. `info` sale de phone.diagInfo(). Devuelve [{id, status, detail}] en orden B1..B8. */
export async function runChecks(info) {
  const secure = res('secure', window.isSecureContext ? 'ok' : 'fail', String(!!window.isSecureContext));
  const AC = window.AudioContext || window.webkitAudioContext;
  const missing = ['RTCPeerConnection', 'WebSocket'].filter(k => !window[k]).concat(AC ? [] : ['AudioContext'], navigator.mediaDevices ? [] : ['mediaDevices']);
  const webrtc = res('webrtc', missing.length ? 'fail' : 'ok', missing.length ? 'falta ' + missing.join(',') : 'completo');
  const [perm, devices, wss, ice, autoplay, tab] = await Promise.all([
    checkPermission(), checkDevices(), checkWss(info.wsUrl), checkIce(info.iceServers), checkAutoplay(), checkTab(info),
  ]);
  return [secure, webrtc, perm, devices, wss, ice, autoplay, tab];
}

const CODES = { secure: 'B1', webrtc: 'B2', perm: 'B3', devices: 'B4', wss: 'B5', ice: 'B6', autoplay: 'B7', tab: 'B8' };
const TECH = { wss: ' (WSS)', ice: ' (ICE)' };

function safeUrl(u) {
  try { const x = new URL(u); return x.protocol + '//' + x.host + x.pathname; } catch (e) { return ''; }
}

/** Texto plano del informe. `t` es el traductor, `lang` el idioma para la hora local. */
export function buildReport(t, lang, info, checks) {
  const lines = [];
  lines.push(`${t('rep.title')} (webphone_kit ${info.version})`);
  lines.push(`${t('rep.time')}: ${fmtTime(lang, new Date())}`);
  lines.push(`${t('rep.ext')}: ${info.sipUser || '-'}`);
  lines.push(`${t('rep.browser')}: ${navigator.userAgent}`);
  lines.push(`${t('rep.state')}: ${info.status}`);
  const u = safeUrl(info.wsUrl);
  if (u) lines.push(`WSS: ${u}`);
  for (const c of checks || []) lines.push(`${CODES[c.id]} ${t('chk.' + c.id)}${TECH[c.id] || ''}: ${t('res.' + c.status)}${c.detail ? ' - ' + c.detail : ''}`);
  const ev = (info.history || []).map(e => `${fmtTime(lang, new Date(e.t))} ${e.kind}${e.code ? ' ' + e.code : ''}`);
  lines.push(`${t('rep.events')}: ${ev.length ? '' : t('rep.none')}`);
  for (const l of ev) lines.push('  ' + l);
  return lines.join('\n');
}
