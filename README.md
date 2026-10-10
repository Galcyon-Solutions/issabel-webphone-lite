<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
# issabel-webphone-lite

Un **teléfono dentro del navegador** para Issabel 5 (WebRTC sobre PJSIP). Se instala como un módulo más de Issabel y deja a un usuario con su **primer anexo funcionando en tres clics**, sin instalar nada en su computador.

```
navegador (JsSIP)  --wss:443-->  Apache (/kit-ws)  --ws:8088 en loopback-->  Asterisk (PJSIP transport-wss)
```

> Este repositorio es un **complemento**: el resto de los manuales funciona sin él, pero con él puedes probar llamadas, el voicebot (extensión 7500) y la consola de agente del Call Center usando solo el navegador.

## Cómo se usa (la parte corta)

1. `bash install.sh` en el servidor (como root).
2. En Issabel: **PBX > Webphone Lite**. Es una sola pantalla, el **Inicio rápido**:

   | Si la central... | Qué ves | Clics hasta el primer anexo |
   |---|---|---|
   | ya está lista (HTTPS válido y todo lo demás) | Solo "Crear mi primer anexo" | **1** |
   | le falta algo de Issabel o Asterisk | Un botón **Preparar** que dice en palabras simples qué va a cambiar y qué no, y pide tu OK | **3** (Preparar, Hacer estos cambios, Crear) |
   | no tiene un certificado HTTPS válido | Explica qué falta y lleva al módulo Let's Encrypt. **No avanza** hasta que esté | los del caso anterior, después del certificado |

3. Al terminar queda el teléfono registrado en la misma pantalla y un botón **Llamar al eco (\*43)** para probar.

![Inicio rápido: todo listo](docs/img/05-inicio-listo.png)

Todo lo demás (varios anexos, rango de extensiones, CSV, usuarios, ajustes, diagnóstico completo) sigue disponible en **Opciones avanzadas** (el asistente completo de siempre), fuera del camino principal.

## Qué trae

| Pieza | Para qué |
|-------|----------|
| `modulo/webphone_kit/` | Módulo web en **PBX > Webphone Lite**: Inicio rápido (`quick.js`), asistente avanzado, diagnóstico y alta de extensiones WebRTC |
| `modulo/webphone_kit/themes/default/js/webphone.js` | La barra del teléfono (cliente JsSIP ya compilado) |
| `apache/kit-webphone-wrap.conf` | El **envoltorio**: hace que la barra aparezca arriba de *toda* la web de Issabel. Se instala por defecto (`install.sh --sin-envoltorio` para omitirlo) |
| `modulo/agent_console_hook/` | **Opcional.** Archivo nuevo para la Consola de Agente del Call Center: contesta solo el login del agente |
| `priv/` | Helper root mínimo (verbos fijos) que usa el módulo por `issabel-helper` |
| `sql/` | Base `kit_webphone` con dos usuarios MySQL de mínimo privilegio |
| `client-src/` | Fuente del cliente y `build.sh` (solo si quieres modificar la barra; requiere Node en tu PC, no en el servidor) |
| `install.sh`, `uninstall.sh` | Instalación y reversa, idempotentes, con respaldo |
| `docs/manual-webphone.md` | **Manual paso a paso** |

## Requisitos

- Issabel 5 sobre Rocky Linux 8 (el transporte WebSocket de PJSIP viene de fábrica en IssabelPBX).
- **HTTPS con un certificado en el que el navegador confíe**: sin él no hay micrófono ni WebSocket seguro. Lo normal es un dominio propio y el módulo **Seguridad > HTTPS Certificate (Let's Encrypt)**.
- UDP del rango RTP abierto si los usuarios llaman desde fuera de tu red (por defecto 10000-20000).
- Acceso root por SSH al servidor.

## Instalar

```bash
dnf install -y git                                   # si no lo tienes
git clone <URL-de-este-repositorio> /usr/src/issabel-webphone-lite
cd /usr/src/issabel-webphone-lite
bash install.sh                                      # modulo + base + helper + barra en toda la web
bash install.sh --comprobar                          # resumen de lo instalado
```

Cierra sesión en Issabel y vuelve a entrar para ver el menú. `install.sh` respalda en `/root/respaldo-webphone-<fecha>/`, genera las claves en el servidor (nunca las imprime) y comprueba que el endpoint responda `403` sin sesión.

## Desinstalar

```bash
bash uninstall.sh --si                   # quita menú, módulo, base, usuarios MySQL, claves, helper y envoltorio
bash uninstall.sh --si --quitar-anexos   # además borra las extensiones que creó el asistente
```

## Seguridad en pocas líneas

- Solo el grupo *administrator* ve el módulo; cada acción exige token CSRF y se vuelve a comprobar en el servidor.
- El secreto SIP no se muestra nunca en la administración; el endpoint solo lo entrega al dueño de la sesión, por HTTPS y con `Cache-Control: no-store`. En el navegador vive solo en memoria.
- Dos usuarios MySQL: `webphone_web` (administración) y `webphone_ro` (solo `SELECT` sobre una vista).
- El helper root acepta verbos fijos (`status`, `install_ws`, `remove_ws`) y rechaza todo lo demás.
- **Preparar** solo escribe bloques marcados (`BEGIN/END webphone_kit`) en archivos `*_custom.conf` y la conf propia de Apache, y todo se deshace desde Opciones avanzadas o con `uninstall.sh`.

## Estado de la verificación (sin adornos)

Probado en un contenedor Issabel 5 desechable (Rocky 8.10, Asterisk 20.12) con Chrome por CDP, recorriendo el Inicio rápido como un usuario nuevo:

| Caso | Resultado |
|---|---|
| A. Todo listo | 1 clic (2 si hay una llamada activa, que pide confirmar), unos 9 s desde abrir la página hasta el teléfono registrado |
| B. Falta la puerta `/kit-ws` y hay choque con `chan_sip` | 3 clics, unos 11 s; Preparar los aplica y verifica, y el teléfono registra |
| C. Certificado de fábrica | Bloquea, explica los 3 pasos y no ofrece crear el anexo |
| Llamada | El teléfono llama al eco `*43` y Asterisk lo contesta (`demo-echotest`) |
| Accesibilidad (axe-core 4.14, WCAG 2 A y AA) | 0 violaciones en las cuatro pantallas del Inicio rápido |
| Contraste (62 pares, claro y oscuro) | Todos sobre el mínimo (4,5:1 texto, 3:1 componentes) |
| Desinstalación | Sin restos: mismas filas de menú y permisos que antes, sin base, usuarios ni bloques, y `httpd -t` correcto |

Colores: antes los pares también pasaban el contraste numérico, el problema era de armonía. La barra seguía el modo del sistema operativo (en un Windows oscuro salía casi negra sobre un Issabel claro) y el azul chocaba con el morado del tema. Ahora la barra es clara por defecto (`theme: 'auto'` si quieres seguir al sistema) y toda la paleta sale del tema real de Issabel 5. Capturas antes y después en `docs/img/`.

**No se probó (pruébalo antes de dárselo a usuarios reales):**
- Audio real de persona a persona (en el contenedor no hay ruta UDP desde el navegador; se verificó el registro y que Asterisk conteste, no el audio).
- Firefox, Safari y Edge; lectores de pantalla reales; NAT estricto o TURN.
- Una VM con dominio y un certificado real de Let's Encrypt (en el contenedor se usó una CA de pruebas).

## Licencia

GPL-2.0-or-later (ver `LICENSE`). Titular: Galcyon, **por confirmar antes de publicar**. El cliente incluye JsSIP (MIT) y otras dependencias: `THIRD_PARTY_LICENSES.md`.
