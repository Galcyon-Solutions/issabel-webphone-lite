// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Piezas de la prueba de audio: medidor de nivel (AnalyserNode), grabacion y reproduccion, tono y lista de altavoces.
// Todo se libera con stop(): ningun microfono ni contexto de audio queda abierto al cerrar la ayuda.
const AC = () => window.AudioContext || window.webkitAudioContext;

/** Pide el microfono con un limite de espera: onSlow() se llama una vez si pasan `ms` sin respuesta (aviso ignorado). */
export function askMicrophone(onSlow, ms) {
  let timer = null;
  const p = new Promise((resolve, reject) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error('sin soporte'); e.name = 'NotSupportedError'; reject(e); return; }
    timer = window.setTimeout(() => { if (onSlow) onSlow(); }, ms || 8000);
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(resolve, reject);
  });
  const clear = () => { if (timer) window.clearTimeout(timer); timer = null; };
  return p.then(s => { clear(); return s; }, e => { clear(); throw e; });
}

export function stopStream(stream) { if (stream) stream.getTracks().forEach(t => t.stop()); }

/** Medidor en vivo. onLevel(nivel 0..1, pico 0..1) corre en cada cuadro. Devuelve { stop }. */
export function startMeter(stream, onLevel) {
  const Ctor = AC();
  if (!Ctor) return { stop() {} };
  const ctx = new Ctor();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf = 0;
  let peak = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    const level = Math.min(1, rms * 4);
    if (level > peak) peak = level;
    onLevel(level, peak);
    raf = window.requestAnimationFrame(tick);
  };
  tick();
  return {
    stop() {
      stopped = true;
      window.cancelAnimationFrame(raf);
      try { src.disconnect(); } catch (e) { /* ya desconectado */ }
      ctx.close().catch(() => {});
    },
  };
}

/** Graba `ms` milisegundos y los reproduce. Devuelve una promesa que termina al acabar la reproduccion. */
export function recordAndPlay(stream, ms, onPhase) {
  return new Promise(resolve => {
    if (typeof MediaRecorder === 'undefined') { resolve(false); return; }
    let rec;
    try { rec = new MediaRecorder(stream); } catch (e) { resolve(false); return; }
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      if (!chunks.length) { resolve(false); return; }
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      const a = new Audio(url);
      const end = ok => { URL.revokeObjectURL(url); resolve(ok); };
      a.onended = () => end(true);
      a.onerror = () => end(false);
      onPhase('play');
      a.play().catch(() => end(false));
    };
    onPhase('rec');
    rec.start();
    window.setTimeout(() => { try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { resolve(false); } }, ms);
  });
}

/** Tono de prueba de 1 segundo. Si hay deviceId y el navegador permite elegir la salida, se usa ese altavoz. */
export async function playTone(deviceId) {
  const Ctor = AC();
  if (!Ctor) return false;
  const ctx = new Ctor();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.18, t0 + 0.05);
  gain.gain.setValueAtTime(0.18, t0 + 0.85);
  gain.gain.linearRampToValueAtTime(0, t0 + 1);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 523.25;
  osc.connect(gain);
  let el = null;
  if (deviceId && HTMLMediaElement.prototype.setSinkId) {
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    el = new Audio();
    el.srcObject = dest.stream;
    try { await el.setSinkId(deviceId); } catch (e) { /* si falla suena por el predeterminado */ }
    el.play().catch(() => {});
  } else gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 1.02);
  await new Promise(r => { osc.onended = r; window.setTimeout(r, 1500); });
  if (el) { el.pause(); el.srcObject = null; }
  ctx.close().catch(() => {});
  return true;
}

/** Altavoces disponibles, solo si el navegador deja elegir la salida (setSinkId). Si no, devuelve null. */
export async function listSpeakers() {
  if (!HTMLMediaElement.prototype.setSinkId || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: d.label || ('#' + (i + 1)) }));
  } catch (e) { return null; }
}
