# managed-by: webphone_kit
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Galcyon
#
# Ruta WSS propia del webphone del kit. La instala y la quita SOLO el helper root
# /usr/share/issabel/privileged/webphone_kit, que la copia desde esta plantilla (dueño root).
#   Navegador --wss(443, certificado de Apache)--> Apache --ws(127.0.0.1:8088)--> Asterisk /ws
# connectiontimeout=5 falla rapido si Asterisk no escucha; timeout=3600 evita cortes por inactividad del proxy;
# retry=0 no marca el backend "en error" tras un fallo, el siguiente intento reconecta.
<IfModule proxy_wstunnel_module>
    ProxyPass        "/kit-ws" "ws://127.0.0.1:8088/ws" retry=0 connectiontimeout=5 timeout=3600
    ProxyPassReverse "/kit-ws" "ws://127.0.0.1:8088/ws"
</IfModule>
