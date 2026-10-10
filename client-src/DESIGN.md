<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!-- Copyright (C) 2026 Galcyon -->
# Diseño del cliente webphone (etapa 3b)

Quién lo usa: una persona sin conocimientos técnicos, por ejemplo un agente de un centro de contacto, que abre la página de
Issabel y necesita llamar y contestar sin pensar en la red. El teléfono es solo teléfono: aquí no hay ajustes del servidor ni
administración. Cuando algo falla, el cliente dice qué pasó en una frase y ofrece una acción.

Cómo se llegó aquí: se cargaron las skills de diseño `frontend-design` e `impeccable` y se siguió su método (plan de tokens,
revisión del plan contra la tarea, construcción, una ronda de inspección por lote y correcciones). El proyecto no tenía
`PRODUCT.md`: la tarea ya fijaba usuario, identidad y límites, así que no se hizo la entrevista y se declaró aquí.

## Identidad

"Teléfono de oficina moderno": calmado, confiable, con una paleta neutra fría y un solo acento. El verde y el rojo no son
acento: son semánticos (contestar y listo; colgar y error). Esquinas y sombras discretas, sin degradados, sin emojis, sin
fuentes ni imágenes remotas. Lo memorable está en dos sitios y el resto se queda quieto:

1. **La barra se transforma al entrar una llamada.** Crece de 48 a 72 px, toma un fondo verde suave, muestra las iniciales de
   quien llama en un círculo con un anillo que pulsa y pone Contestar en verde a la izquierda de Rechazar.
2. **La tarjeta previa al micrófono** con un dibujo SVG propio de una ventana de navegador, el aviso arriba a la izquierda y
   una flecha que lo señala. Es lo que más ayuda a quien nunca vio ese aviso.

Descartado a propósito: fondo crema con serif y terracota, modo oscuro negro con acento ácido, tarjetas iguales con la misma
sombra, etiquetas en mayúsculas sobre los títulos, listas numeradas que no son una secuencia, texto con acento de una sola palabra.

## Tokens de color

Viven en `src/style.css` entre las marcas `@tokens`; `harness/contrast.mjs` los lee de ahí (62 pares, claro y oscuro). La página
anfitriona puede redefinir cualquier `--wpk-*`. El modo oscuro sigue `prefers-color-scheme`.

| Token | Claro | Oscuro | Uso |
|-------|-------|--------|-----|
| `bg` | `#f5f7fa` | `#141922` | barra |
| `surface` | `#ffffff` | `#1c2330` | cajón, teclado, campos |
| `sunken` | `#e9edf3` | `#262e3d` | fondo al pasar el cursor, medidor |
| `ink` | `#151b26` | `#e8ecf3` | texto |
| `ink-2` | `#475166` | `#a8b2c3` | texto secundario y placeholder |
| `line` / `line-strong` | `#d3d9e2` / `#78839a` | `#343e50` / `#7d8aa3` | divisores / bordes de campos y botones (3:1) |
| `accent` (+ `accent-ink`, `accent-soft`) | `#2447c8` | `#8fa8ff` | Llamar, Siguiente, foco, pasos |
| `ok` (+ `ok-ink`, `ok-soft`) | `#0f6b45` | `#45c48c` | Contestar, Listo, llamada entrante |
| `warn` (+ `warn-soft`) | `#7a4b00` | `#f2b94b` | Conectando, en espera, silenciado |
| `bad` (+ `bad-ink`, `bad-soft`) | `#b3261e` | `#ff8f85` | Colgar, errores |
| `focus` | `#2447c8` | `#8fa8ff` | anillo de foco de 2 px con 2 px de separación |

`prefers-contrast: more` lleva los bordes y el texto secundario al color de la tinta y los bordes a 2 px.

## Tipografía

Familia del sistema: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (variable `--wpk-font`).
No se descarga nada. Cifras tabulares en cronómetro, números y teclado, para que no salten.

| Tamaño | Uso |
|--------|-----|
| 11 px | etiqueta "Llamada entrante" en móvil |
| 12 px | etiqueta de llamada, subtítulo y cronómetro en móvil, informe de soporte |
| 13 px | número secundario, avisos de error, botones pequeños, notas |
| 14 px | base: palabra de estado (600), botones (600), textos del cajón |
| 15 px | nombre o número de quien llama (600), campos, filas del cajón |
| 16 px | frase principal de cada vista del cajón |
| 19 px | números del teclado |
| 20 px | título del cajón (600, interlineado 1,25) |

Pesos: 400 texto, 500 teclas y avisos breves, 600 lo que se debe encontrar rápido. Medida de lectura de unos 45 caracteres en
el cajón (420 px de ancho): las frases tienen menos de 15 palabras.

## Espaciado, forma y profundidad

- Escala de 4 px: 4, 6, 8, 12, 16, 20, 24. Separación mayor entre grupos que dentro de un grupo.
- Altura de la barra: 48 px en escritorio y tablet, 56 px por debajo de 560 px de ancho de la barra, 72 px con llamada entrante.
  La medida es el ancho real de la barra (`ResizeObserver`), no el de la ventana, así sirve en un contenedor angosto y con zoom.
- Objetivos táctiles de 44 px o más en todo (campos, botones, filas, enlaces, resumen del informe). Teclado numérico de 48 px.
- Radios: 8 px controles, 12 px tarjetas, teclado y filas, 50 % para círculos. Sin tarjetas dentro de tarjetas.
- Sombra solo en lo que flota a petición (teclado, aviso breve, cajón): `0 1px 2px` más `0 12px 32px`, con desplazamiento y desenfoque.

## Estados: color más icono más palabra

El color nunca va solo. Cada estado trae un icono dentro de un círculo teñido y una palabra, y el cambio se anuncia en una
región `aria-live="polite"`.

| Palabra | Icono | Tono |
|---------|-------|------|
| Conectando | arco que gira, con anillo que pulsa | ámbar |
| Listo | marca de verificación | verde |
| Sin conexión | señal tachada | rojo |
| Sin micrófono | micrófono tachado | rojo |
| Marcando | teléfono | acento |
| Sonando | teléfono | verde (entrante) o acento (saliente) |
| En llamada | teléfono | verde |
| En espera | pausa | ámbar |
| Silenciado | micrófono tachado | ámbar |
| Reconectando | arco que gira | ámbar |
| Otra pestaña | ventana | acento |
| Sesión de agente (etapa 4) | teléfono | verde |

La barra se divide en tres zonas que no cambian de sitio: izquierda estado, centro identidad o campo (o el aviso de error, que
ocupa el centro), derecha controles. Colgar es siempre el último control a la derecha y siempre rojo.

## Movimiento

Poco y con sentido; todo se apaga con `prefers-reduced-motion` (animaciones y transiciones en `none`).

- Anillo que pulsa en el punto de "Conectando" y en las iniciales de una llamada entrante (1,4 s y 1,6 s).
- La altura de la barra cambia de golpe (48 a 72 px): no se anima `height`, `padding` ni `margin`, porque la barra está en el flujo y cada
  fotograma movería el resto de la página (en el envoltorio, el iframe completo de Issabel). Lo que se suaviza es el fondo (180 ms) y la entrada
  del contenido de la llamada con solo `opacity` y `transform` (220 ms). El medidor del micrófono también usa `transform`.
- Cajón: desliza 32 px y aparece (240 ms). Teclado numérico y aviso breve: 140 y 200 ms.
- La flecha del dibujo del micrófono se mueve 6 px hacia el aviso, sin parar, para llamar la atención una sola vez en la tarjeta.
- Curva: salida exponencial `cubic-bezier(0.22, 1, 0.36, 1)`; nada entra desde invisible con retraso.

## Iconos y dibujo

Iconos propios en SVG de 24 px con trazo de 1,75 y terminaciones redondas (`src/icons.js`, creados con `createElementNS`). Ninguna
librería de iconos. El dibujo del aviso del navegador es un SVG propio dentro del mismo archivo, con los textos traducidos.

## Textos

Segunda persona con tuteo, verbos de acción, frases de menos de 15 palabras, sin culpar ("No pudimos" en vez de "Fallaste"), sin
siglas en la interfaz y sin signos de exclamación salvo "¡Listo!". Cada error trae un mensaje y una acción concreta (tabla en
`src/errors.js`). Es, en y pt-BR tienen las mismas claves y ninguna frase se arma con piezas: los marcadores `{n}` y `{m}` son la
única sustitución. Las siglas técnicas (SIP, WSS, ICE) solo existen dentro del bloque plegado "Detalles para soporte".

## Accesibilidad como decisión de diseño

- Orden de tabulación igual al orden visual: campo, Llamar, Marcador, Ayuda; en llamada Silenciar, Espera, Teclado, Colgar.
- Atajos con aviso (tooltip, `aria-keyshortcuts`, lista en Ayuda): Alt+Mayús+A contestar, +H colgar o rechazar, +M silenciar.
  No chocan con el navegador ni con Issabel; se leen por `event.code`, no por la letra. Esc ya no cuelga (antes lo hacía).
- Región `aria-live="assertive"` para la llamada entrante y `role="alert"` en los avisos de error. El foco va a Contestar solo si
  la persona no estaba escribiendo en otro campo de la página.
- El cajón es un diálogo modal: foco atrapado, Esc cierra y devuelve el foco a quien lo abrió.
- Zoom al 200 % (640 px de ancho CSS) sin perder controles y 390 px sin desplazamiento horizontal. En ancho medio y angosto los
  controles quedan solo con icono y conservan su nombre accesible; Contestar mantiene su palabra siempre.
- En móvil, en una llamada entrante el botón Rechazar queda solo con icono (rojo con borde) para dar sitio al nombre.

## Desviaciones y límites conocidos

- El teclado numérico, el aviso breve y la tarjeta de transferencia aparecen anclados bajo la barra a petición y se cierran solos o
  con Esc: no son un panel flotante permanente, pero necesitan que el contenedor de la página no recorte lo que sobresale.
- La transferencia ciega vive dentro del teclado (la barra en llamada tiene solo cuatro controles).
- Sin foto remota: la llamada entrante usa iniciales del nombre o un icono de teléfono.
- No se probó con un lector de pantalla real (NVDA, VoiceOver); se verificó el árbol de accesibilidad de Chrome y axe-core.

## Etapa 4: sesión de agente (cliente 0.5.0)

Sin colores ni medidas nuevas: la sesión de agente reutiliza los tokens y la barra de 48 px. El login del agente es una llamada que
dura todo el turno, así que la barra la trata distinto de una llamada normal:

- No suena ni crece a 72 px: el login se contesta solo, la barra muestra "Conectando" con el texto "Conectando tu sesión de agente" y luego
  "Sesión de agente" con "Agente 8000" y el cronómetro. Sin Contestar ni Rechazar.
- El botón rojo, siempre el último de la derecha, dice "Cerrar sesión de agente": colgar esa llamada cierra la sesión (regla de la 5.1.8 del
  Call Center), y con el nombre de siempre ("Colgar") se podría confundir con colgar a un cliente. Con 390 px conserva solo el icono y el nombre accesible.
- Aviso "Mantén esta pestaña abierta mientras atiendes llamadas." (10 s, sin acciones): al volver a una pestaña que estuvo oculta más de 10 s y cuando
  los temporizadores se pausaron más de 25 s. Mientras la pestaña está oculta, el mismo texto va en el título de la pestaña.
- Al terminar la sesión: aviso breve "Sesión de agente terminada" y la barra vuelve a "Listo".
