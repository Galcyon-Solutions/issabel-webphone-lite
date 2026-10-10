// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Atencion en una llamada entrante fuera de la barra: titulo de la pestaña que parpadea y, solo si la pestaña esta
// oculta y la persona ya dio permiso, una notificacion del sistema. El permiso NUNCA se pide aqui.
export class Attention {
  constructor() { this.timer = null; this.original = ''; this.note = null; }

  start(label, body) {
    this.stop();
    this.original = document.title;
    let on = false;
    const flip = () => { on = !on; document.title = on ? label : this.original; };
    flip();
    this.timer = window.setInterval(flip, 1000);
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        this.note = new Notification(label, { body, tag: 'wpk-incoming', silent: true });
        this.note.onclick = () => { try { window.focus(); } catch (e) { /* sin foco */ } if (this.note) this.note.close(); };
      } catch (e) { this.note = null; }
    }
  }

  stop() {
    if (this.timer) { window.clearInterval(this.timer); document.title = this.original; }
    this.timer = null;
    if (this.note) { try { this.note.close(); } catch (e) { /* ya cerrada */ } this.note = null; }
  }
}

/** Pide el permiso de notificaciones. Solo desde un clic de la persona y despues de explicarlo. */
export async function askNotifications() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}

export function notificationState() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
