// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Tonos de timbre y de llamada saliente generados con WebAudio (no se descarga ningun archivo).
export class Tones {
  constructor() {
    this._ctx = null;
    this._timer = null;
    this._kind = null;
  }

  _context() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  }

  _burst(freqs, seconds, gainValue) {
    const ctx = this._context();
    if (!ctx) return;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.02);
    gain.gain.setValueAtTime(gainValue, t0 + seconds - 0.03);
    gain.gain.linearRampToValueAtTime(0, t0 + seconds);
    gain.connect(ctx.destination);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + seconds + 0.02);
    }
  }

  /** kind: 'ring' (llamada entrante, doble timbre) o 'back' (llamada saliente, 425 Hz). */
  start(kind) {
    if (this._kind === kind) return;
    this.stop();
    this._kind = kind;
    const pulse = () => {
      if (kind === 'ring') {
        this._burst([440, 480], 0.4, 0.12);
        window.setTimeout(() => { if (this._kind === 'ring') this._burst([440, 480], 0.4, 0.12); }, 600);
      } else {
        this._burst([425], 1.0, 0.1);
      }
    };
    pulse();
    this._timer = window.setInterval(pulse, kind === 'ring' ? 3000 : 4000);
  }

  stop() {
    if (this._timer) window.clearInterval(this._timer);
    this._timer = null;
    this._kind = null;
  }

  close() {
    this.stop();
    if (this._ctx) { this._ctx.close().catch(() => {}); this._ctx = null; }
  }
}
