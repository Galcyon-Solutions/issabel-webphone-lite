#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Galcyon
#
# Desinstala webphone_kit del Issabel: menu y permisos, modulo web, base kit_webphone con sus usuarios MySQL
# (webphone_web y webphone_ro), archivos de claves, helper root, conf de Apache del envoltorio y gancho de la consola
# de agente (cada uno solo si lleva nuestra marca). Es la REVERSA de install.sh.
#   bash uninstall.sh --si                    quita todo menos las extensiones que creo el asistente
#   bash uninstall.sh --si --quitar-anexos    quita tambien esas extensiones (solo las que consten en la bitacora del asistente)
# Ejecutar EN el servidor, como root. Sin --si no hace nada. Antes de borrar guarda copias en
# /root/respaldo-webphone-desinstalar-<fecha>/ (acl.db, menu.db, volcado de kit_webphone, archivos de claves y el
# modulo). Esa carpeta contiene secretos (700, solo root): borrala cuando ya no la necesites.
# NO toca: el plugin de terceros issabel-webphone (modulo "webphone"), tus extensiones propias ni el Call Center.
set -euo pipefail

YES=0; QUITAR_ANEXOS=0
for a in "$@"; do
  case "$a" in
    --si) YES=1 ;;
    --quitar-anexos) QUITAR_ANEXOS=1 ;;
    *) echo "Argumento desconocido: $a (uso: uninstall.sh --si [--quitar-anexos])"; exit 2 ;;
  esac
done
[ "$YES" = 1 ] || { echo "Falta --si. No se hizo ningun cambio."; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Ejecuta como root."; exit 1; }

UNIT=webphone
MODULE=webphone_kit
MODS=/var/www/html/modules
ACLDB=/var/www/db/acl.db
TS=$(date +%Y%m%d-%H%M%S)
BK=/root/respaldo-webphone-desinstalar-$TS
WORK=$(mktemp -d /var/tmp/kit_remove.XXXXXX); chmod 755 "$WORK"   # legible por el usuario asterisk (corre el PHP de IssabelPBX)
trap 'rm -rf "$WORK"' EXIT
fail() { echo "ABORTA (no se quito nada): $*" >&2; exit 1; }
export MYSQL_PWD="$(awk -F= '/^mysqlrootpwd/{print $2}' /etc/issabel.conf)"
[ -n "$MYSQL_PWD" ] || fail "no pude leer la clave de root de MariaDB"
mq() { mysql -uroot -N -B "$@"; }

echo "== 0) Comprobaciones previas =="
OWNED=0
if [ "$(mq -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='kit_webphone'")" != 0 ]; then
  owner=$(mq -e "SELECT meta_value FROM kit_webphone.kit_meta WHERE meta_key='owner'" 2>/dev/null || true)
  if [ "$owner" = "$UNIT" ]; then OWNED=1; else echo "AVISO: la base kit_webphone no tiene la marca owner=$UNIT: NO se borrara"; fi
fi
# Usuarios de prueba de la unidad: descripcion con la marca. Sus extensiones: las que tienen nombre "Webphone ...".
TEST_USERS=""; TEST_EXTS=""
if [ "$QUITAR_ANEXOS" = 1 ]; then
TEST_USERS=$(sqlite3 "$ACLDB" "SELECT name FROM acl_user WHERE description LIKE 'Webphone kit:%'")
TEST_EXTS=$(mq -e "SELECT extension FROM asterisk.users WHERE name LIKE 'Webphone %'")
fi
for e in $TEST_EXTS; do [[ "$e" =~ ^[0-9]{3,6}$ ]] || fail "extension rara: $e"; done
for u in $TEST_USERS; do [[ "$u" =~ ^[a-z][a-z0-9_]{2,29}$ ]] || fail "usuario raro: $u"; done
echo "  usuarios de prueba: ${TEST_USERS:-(ninguno)}" | tr '\n' ' '; echo
echo "  extensiones de prueba: ${TEST_EXTS:-(ninguna)}" | tr '\n' ' '; echo

install -d -m 700 "$BK"
echo "== 1) Respaldos en $BK =="
cp -a "$ACLDB" "$BK/acl.db"
cp -a /var/www/db/menu.db "$BK/menu.db"
mysqldump -uroot --single-transaction asterisk devices users sip > "$BK/asterisk-devices-users-sip.sql"
[ "$OWNED" = 1 ] && mysqldump -uroot --single-transaction kit_webphone > "$BK/kit_webphone.sql"
for f in /etc/asterisk/$UNIT.conf /etc/asterisk/${UNIT}_ro.conf; do [ -f "$f" ] && cp -a "$f" "$BK/"; done
MY_MODS=()
for d in "$MODS"/*/; do
  if [ -f "${d}.kit-unit" ] && [ "$(tr -d '\r\n' < "${d}.kit-unit")" = "$UNIT" ]; then MY_MODS+=("$(basename "$d")"); cp -a "${d%/}" "$BK/"; fi
done
chmod -R go-rwx "$BK"
ls "$BK" | sed 's/^/  /'

echo "== 2) Extensiones y usuarios de prueba =="
for u in $TEST_USERS; do
  mq -e "DELETE FROM kit_webphone.wp_user WHERE username='$u'" 2>/dev/null || true
  if [ "$(sqlite3 "$ACLDB" "SELECT COUNT(*) FROM acl_user WHERE name='$u'")" != 0 ]; then
    uid=$(sqlite3 "$ACLDB" "SELECT id FROM acl_user WHERE name='$u'")
    sqlite3 "$ACLDB" "DELETE FROM acl_membership WHERE id_user=$uid; DELETE FROM acl_user WHERE id=$uid;"
    echo "  quitado el usuario $u de acl.db"
  fi
done
chown asterisk:asterisk "$ACLDB"
if [ -n "$TEST_EXTS" ]; then
  cat > "$WORK/rm_ext.php" <<'PHP'
<?php
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
$bootstrap_settings['freepbx_auth'] = false;
require_once '/etc/issabelpbx.conf';
foreach (array_slice($argv, 1) as $ext) {
    core_devices_del($ext); core_users_del($ext); core_users_cleanastdb($ext);
    echo "  extension $ext quitada\n";
}
PHP
  chmod 644 "$WORK/rm_ext.php"
  for e in $TEST_EXTS; do
    # solo si sigue existiendo con la marca
    n=$(mq -e "SELECT name FROM asterisk.users WHERE extension='$e'")
    case "$n" in "Webphone "*) su -s /bin/bash asterisk -c "php '$WORK/rm_ext.php' '$e'" 2>&1 | grep "quitada" || true ;; esac
  done
  su -s /bin/bash asterisk -c "/var/lib/asterisk/bin/retrieve_conf" >/dev/null 2>&1 || echo "  AVISO: retrieve_conf devolvio error"
  asterisk -rx "module reload res_pjsip.so" | tail -1 | sed 's/^/  /'
fi

echo "== 2b) Etapa 2b: anexos creados por el asistente, grupo Agente web, helper root y su conf de Apache =="
# Anexos que creo bin/provision.php (constan en batches.log): se quitan uno a uno y solo los que sigan existiendo.
KITSTATE=/var/lib/asterisk/webphone_kit
PROV=$MODS/$MODULE/bin/provision.php
# Rango de audio que el Resolver cambio por IssabelPBX (version 0.5.2): se restauran sipsettings y los archivos generados al estado
# previo EXACTO (bin/rtp_range.php undo) ANTES de quitar el modulo y la carpeta de estado, que guarda ese estado previo.
RTPTOOL=$MODS/$MODULE/bin/rtp_range.php
if [ -f "$KITSTATE/rtp_range.snap.json" ] && [ -f "$RTPTOOL" ]; then
  mkdir -p "$BK"; cp -a "$KITSTATE/rtp_range.snap.json" "$BK/"
  RTPRES=$(echo '{"action":"undo"}' | su -s /bin/bash asterisk -c "php -d display_errors=0 $RTPTOOL" 2>&1)
  if echo "$RTPRES" | grep -q '"identical":true'; then
    echo "  rango de audio restaurado: sipsettings y archivos generados identicos al estado previo"
    if [ "$(asterisk -rx 'core show channels count' 2>/dev/null | awk '/active calls/{print $1}')" = "0" ]; then asterisk -rx 'module reload res_rtp_asterisk.so' >/dev/null 2>&1 && echo "  recargado res_rtp_asterisk"; else echo "  AVISO: hay llamadas activas; recarga luego con: asterisk -rx 'module reload res_rtp_asterisk.so'"; fi
  else
    echo "  AVISO: no se pudo restaurar el rango de audio; el estado previo queda en $BK/rtp_range.snap.json. Respuesta: $RTPRES"
  fi
fi
if [ "$QUITAR_ANEXOS" = 1 ] && [ -f "$KITSTATE/batches.log" ] && [ -f "$PROV" ]; then
  CREATED=$(grep -o ' created=[0-9,]*' "$KITSTATE/batches.log" | sed 's/ created=//' | tr ',' '\n' | sort -u)
  LIST=""
  for e in $CREATED; do
    [[ "$e" =~ ^[0-9]{3,6}$ ]] || continue
    [ "$(mq -e "SELECT COUNT(*) FROM asterisk.users WHERE extension='$e'")" != 0 ] && LIST="$LIST\"$e\","
  done
  if [ -n "$LIST" ]; then
    # delete acepta como maximo 50 por llamada: se parte en tandas
    echo "$LIST" | tr ',' '\n' | tr -d '"' | grep -E '^[0-9]+$' | split -l 50 - "$WORK/del."
    for f in "$WORK"/del.*; do
      JSON="{\"action\":\"delete\",\"exts\":[$(sed 's/.*/"&"/' "$f" | paste -sd, -)]}"
      printf '%s' "$JSON" | su -s /bin/bash asterisk -c "php -d display_errors=0 '$PROV'" | grep -o '"deleted"' | sort | uniq -c | sed 's/^/  anexos quitados: /'
    done
    # el usuario de Issabel no debe quedar apuntando a un anexo que ya no existe
    for e in $CREATED; do
      [[ "$e" =~ ^[0-9]{3,6}$ ]] && sqlite3 "$ACLDB" "UPDATE acl_user SET extension='' WHERE extension='$e'"
    done
  else echo "  (no quedan anexos creados por el asistente)"; fi
elif [ -f "$KITSTATE/batches.log" ]; then
  echo "  Se CONSERVAN las extensiones que creo el asistente (usa --quitar-anexos si tambien quieres borrarlas)"
fi
# Grupo "Agente web": solo si lo creo este modulo (descripcion con la marca) y no tiene usuarios
AG=$(sqlite3 "$ACLDB" "SELECT id FROM acl_group WHERE name='Agente web' AND description LIKE 'Webphone kit:%'")
if [[ "$AG" =~ ^[0-9]+$ ]]; then
  if [ "$(sqlite3 "$ACLDB" "SELECT COUNT(*) FROM acl_membership WHERE id_group=$AG")" = 0 ]; then
    sqlite3 "$ACLDB" "DELETE FROM acl_group_permission WHERE id_group=$AG; DELETE FROM acl_group WHERE id=$AG;"; chown asterisk:asterisk "$ACLDB"; echo "  quitado el grupo Agente web"
  else echo "  AVISO: el grupo Agente web tiene usuarios: no se quita"; fi
fi
# Helper root, plantilla, conf de Apache propia (solo si lleva la marca), carpeta de estado y bitacora
HELPER=/usr/share/issabel/privileged/webphone_kit
if [ -f /etc/httpd/conf.d/webphone_kit-ws.conf ] && grep -qxF '# managed-by: webphone_kit' /etc/httpd/conf.d/webphone_kit-ws.conf && [ -x "$HELPER" ]; then "$HELPER" remove_ws || echo "  AVISO: no se pudo quitar la conf de Apache"; fi
for f in "$HELPER" /usr/share/webphone_kit/ws.conf.tpl; do [ -f "$f" ] && { cp -a "$f" "$BK/helper-$(basename "$f")"; rm -f "$f"; echo "  quitado $f"; }; done
rm -rf /usr/share/webphone_kit
[ -d "$KITSTATE" ] && { cp -a "$KITSTATE" "$BK/kit_state"; rm -rf "$KITSTATE"; echo "  quitada la carpeta de estado (copia con secretos en $BK/kit_state)"; }
[ -f /var/log/asterisk/webphone_kit.log ] && { cp -a /var/log/asterisk/webphone_kit.log "$BK/"; rm -f /var/log/asterisk/webphone_kit.log; }
# Bloques que el asistente haya escrito en los *_custom.conf (BEGIN/END webphone_kit): http-loopback, rtp-ice, rtp-range (rango de
# audio, version 0.5.1), external-addr... El patron los quita todos por la marca, tambien 'rtp-range'.
RTPBLK=0; grep -q '^; BEGIN webphone_kit:' /etc/asterisk/rtp_custom.conf 2>/dev/null && RTPBLK=1
for cf in http_custom.conf rtp_custom.conf pjsip_custom.conf sip_general_custom.conf; do
  if grep -q '^; BEGIN webphone_kit:' "/etc/asterisk/$cf" 2>/dev/null; then cp -a "/etc/asterisk/$cf" "$BK/"; sed -i '/^; BEGIN webphone_kit:/,/^; END webphone_kit:/d' "/etc/asterisk/$cf"; echo "  quitados los bloques webphone_kit de $cf (recarga el modulo correspondiente)"; fi
done
# El rango de audio acotado por 'rtp-range' sigue vigente en memoria hasta recargar el modulo de audio: se recarga solo si no hay llamadas
if [ "$RTPBLK" = 1 ] && command -v asterisk >/dev/null 2>&1; then
  if [ "$(asterisk -rx 'core show channels count' 2>/dev/null | awk '/active calls/{print $1}')" = "0" ]; then asterisk -rx 'module reload res_rtp_asterisk.so' >/dev/null 2>&1 && echo "  recargado res_rtp_asterisk (el rango de audio vuelve al de IssabelPBX)"; else echo "  AVISO: hay llamadas activas; recarga luego con: asterisk -rx 'module reload res_rtp_asterisk.so'"; fi
fi

echo "== 3) Menu y permisos =="
for r in $MODULE; do
  [[ "$r" =~ ^[A-Za-z0-9_]+$ ]] || fail "id de menu invalido: $r"
  sqlite3 "$ACLDB" "
    DELETE FROM acl_group_permission WHERE id_resource IN (SELECT id FROM acl_resource WHERE name='$r');
    DELETE FROM acl_user_permission  WHERE id_resource IN (SELECT id FROM acl_resource WHERE name='$r');
    DELETE FROM acl_resource WHERE name='$r';"
  sqlite3 /var/www/db/menu.db "DELETE FROM menu WHERE id='$r';"
  echo "  quitado el menu $r y sus permisos"
done
chown asterisk:asterisk "$ACLDB" /var/www/db/menu.db

echo "== 3b) Etapa 4: envoltorio de Apache y gancho de la consola de agente (solo si llevan la marca kit-unit: webphone) =="
# Primero la conf (antes de quitar el modulo): sin ella nada se envuelve. Respaldo en $BK antes de borrar.
WRAPCONF=/etc/httpd/conf.d/kit-webphone-wrap.conf
AGENT_HOOK=/var/www/html/modules/agent_console/themes/default/js/webphone-agent.js
if [ -f "$WRAPCONF" ]; then
  if grep -q 'kit-unit: webphone' "$WRAPCONF"; then
    cp -a "$WRAPCONF" "$BK/"; rm -f "$WRAPCONF"
    if apachectl configtest >/dev/null 2>&1 && apachectl graceful; then echo "  quitada la conf $WRAPCONF y recargado Apache (graceful, sin reiniciar)"
    else echo "  AVISO: apachectl configtest o graceful fallaron tras quitar la conf; revisa Apache"; fi
  else echo "  AVISO: $WRAPCONF no lleva la marca de la unidad: NO se toca"; fi
else echo "  (no habia envoltorio)"; fi
if [ -f "$AGENT_HOOK" ]; then
  if grep -q 'kit-unit: webphone' "$AGENT_HOOK"; then cp -a "$AGENT_HOOK" "$BK/"; rm -f "$AGENT_HOOK"; echo "  quitado el gancho de la consola ($AGENT_HOOK); el Call Center no se modifico"
  else echo "  AVISO: $AGENT_HOOK no lleva la marca de la unidad: NO se toca"; fi
fi

echo "== 4) Archivos =="
for m in "${MY_MODS[@]}"; do rm -rf "${MODS:?}/$m"; echo "  quitado modulo $m"; done
rm -f /etc/asterisk/$UNIT.conf /etc/asterisk/${UNIT}_ro.conf
echo "  quitados los archivos de claves"

echo "== 5) Base de datos y usuarios MySQL =="
if [ "$OWNED" = 1 ]; then mq -e "DROP DATABASE IF EXISTS kit_webphone;"; echo "  base kit_webphone borrada"; fi
mq -e "DROP USER IF EXISTS 'webphone_web'@'localhost'; DROP USER IF EXISTS 'webphone_ro'@'localhost'; FLUSH PRIVILEGES;"
echo "  usuarios webphone_web y webphone_ro borrados"

echo
echo "Listo. Cierra sesion en la web para refrescar el menu. Respaldos (con secretos, solo root) en $BK"
echo "Para deshacer esta desinstalacion: restaura desde $BK acl.db y menu.db en /var/www/db, los archivos de claves en"
echo "/etc/asterisk, el modulo en $MODS, importa kit_webphone.sql y las tablas devices, users y sip de asterisk-devices-users-sip.sql,"
echo "y ejecuta retrieve_conf y 'module reload res_pjsip.so'."
