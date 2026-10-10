#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Galcyon
#
# Instala el modulo webphone_kit en un Issabel 5 (Rocky Linux 8). Ejecutalo EN el servidor, como root, desde la
# carpeta del repositorio:
#
#   bash install.sh                  instalacion normal (base de datos, modulo, menu y helper root)
#   (la instalacion normal incluye el envoltorio: barra del webphone arriba de TODA la web de Issabel, conf de Apache propia)
#   bash install.sh --sin-envoltorio instala sin la barra global (el telefono solo se ve en la pagina del modulo)
#   bash install.sh --quitar-envoltorio   quita solo el envoltorio y deja el resto
#   bash install.sh --comprobar      solo lectura: dice que hay instalado y si responde
#
# Idempotente: puedes repetirlo; conserva las claves ya generadas. Antes de cambiar algo respalda en
# /root/respaldo-webphone-<fecha>/ (con permisos 700: contiene bases del menu). No reinicia Asterisk ni Apache
# (Apache solo se recarga con "graceful" y solo si el envoltorio lo pide, despues de "apachectl configtest").
# Las claves de MariaDB se generan aqui y nunca se imprimen. Reversa: bash uninstall.sh
#
# Modos internos que usa el asistente web del modulo (no hace falta que los llames): --helper, --helper-quitar.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE=webphone_kit
MODS=/var/www/html/modules
DB=kit_webphone
WEBUSER=webphone_web
ROUSER=webphone_ro
WEBCONF=/etc/asterisk/webphone.conf
ROCONF=/etc/asterisk/webphone_ro.conf
HELPER=/usr/share/issabel/privileged/webphone_kit
SHARE=/usr/share/webphone_kit
TPL=$SHARE/ws.conf.tpl
STATE=/var/lib/asterisk/webphone_kit
LOGF=/var/log/asterisk/webphone_kit.log
WRAPCONF=/etc/httpd/conf.d/kit-webphone-wrap.conf
AGENT_HOOK=$MODS/agent_console/themes/default/js/webphone-agent.js
MARK='kit-unit: webphone'
TS=$(date +%Y%m%d-%H%M%S)
BK=/root/respaldo-webphone-$TS

fail() { echo "ABORTA: $*" >&2; exit 1; }
say() { printf '\n== %s ==\n' "$*"; }
ours() { [ -f "$1" ] && grep -q "$MARK" "$1"; }

MODE=install_wrap      # por defecto TAMBIEN instala el envoltorio: sin el, la barra del telefono solo se ve dentro de la pagina del modulo
for a in "$@"; do
  case "$a" in
    --envoltorio) MODE=install_wrap ;;
    --sin-envoltorio) MODE=install ;;
    --quitar-envoltorio) MODE=wrap_off ;;
    --comprobar) MODE=check ;;
    --helper) MODE=helper ;;
    --helper-quitar) MODE=helper_off ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) fail "argumento desconocido: $a (usa --help)" ;;
  esac
done

[ "$(id -u)" = 0 ] || fail "ejecuta como root."

# ---------------------------------------------------------------- helper root
install_helper() {
  [ -f "$SRC/priv/webphone_kit" ] && [ -f "$SRC/priv/ws.conf.tpl" ] || fail "faltan priv/webphone_kit y priv/ws.conf.tpl junto a install.sh"
  bash -n "$SRC/priv/webphone_kit" || fail "el helper tiene errores de sintaxis"
  grep -qxF '# managed-by: webphone_kit' "$SRC/priv/ws.conf.tpl" || fail "la plantilla no lleva la marca managed-by"
  [ -d /usr/share/issabel/privileged ] || fail "no existe /usr/share/issabel/privileged (esto no parece un Issabel)"
  [ "$(stat -c '%u:%g:%a' /usr/share/issabel/privileged)" = "0:0:755" ] \
    || fail "/usr/share/issabel/privileged debe ser root:root 0755 o issabel-helper se negara a ejecutar nada"
  id asterisk >/dev/null 2>&1 || fail "no existe el usuario asterisk"
  install -d -m 700 "$BK"
  [ -f "$HELPER" ] && ! cmp -s "$SRC/priv/webphone_kit" "$HELPER" && cp -a "$HELPER" "$BK/helper-webphone_kit"
  install -d -o root -g root -m 755 "$SHARE" "$SHARE/priv"
  install -o root -g root -m 644 "$SRC/priv/ws.conf.tpl" "$TPL"
  install -o root -g root -m 755 "$SRC/priv/webphone_kit" "$HELPER"
  # Copia del instalador y del helper para que el asistente web pueda reparar el helper sin saber donde esta el repo
  if [ "$SRC" != "$SHARE" ]; then
    install -o root -g root -m 644 "$SRC/priv/webphone_kit" "$SHARE/priv/webphone_kit"
    install -o root -g root -m 644 "$SRC/priv/ws.conf.tpl" "$SHARE/priv/ws.conf.tpl"
    install -o root -g root -m 755 "$SRC/install.sh" "$SHARE/install.sh"
  fi
  install -d -o asterisk -g asterisk -m 700 "$STATE" "$STATE/backup"
  touch "$LOGF"; chown asterisk:asterisk "$LOGF"; chmod 640 "$LOGF"
  stat -c '  %n %U:%G %a' "$HELPER" "$TPL" "$STATE"
  # Verificacion como el usuario asterisk, por sudo + issabel-helper (igual que lo usa la web)
  local out
  out=$(su -s /bin/bash asterisk -c "sudo -n /usr/sbin/issabel-helper webphone_kit status" 2>&1) \
    || fail "el helper no responde como asterisk (falta el sudo de issabel-helper?): $(printf '%s' "$out" | head -2)"
  printf '%s\n' "$out" | sed 's/^/  /'
  if su -s /bin/bash asterisk -c "sudo -n /usr/sbin/issabel-helper webphone_kit borrar_todo" >/dev/null 2>&1; then
    fail "el helper acepto un verbo desconocido"
  else echo "  rechazo de verbo desconocido: OK"; fi
}

remove_helper() {
  install -d -m 700 "$BK"
  if [ -f /etc/httpd/conf.d/webphone_kit-ws.conf ] && grep -qxF '# managed-by: webphone_kit' /etc/httpd/conf.d/webphone_kit-ws.conf && [ -x "$HELPER" ]; then
    "$HELPER" remove_ws || echo "  AVISO: no se pudo quitar la conf de Apache por el helper"
  fi
  [ -f "$HELPER" ] && { cp -a "$HELPER" "$BK/helper-webphone_kit"; rm -f "$HELPER"; echo "  quitado $HELPER"; }
  [ -d "$SHARE" ] && { cp -a "$SHARE" "$BK/share"; rm -rf "$SHARE"; echo "  quitado $SHARE"; }
}

# ---------------------------------------------------------------- envoltorio de Apache
wrap_check() {
  local B=https://127.0.0.1 fails=0 body hdr code
  chk() {  # chk etiqueta esperado(WRAP|PASA) args-de-curl
    local label=$1 want=$2 got; shift 2
    body=$(mktemp); hdr=$(mktemp)
    code=$(curl -sk --max-time 20 -o "$body" -D "$hdr" -w '%{http_code}' "$@" 2>/dev/null) || code=000
    if grep -q '<iframe id="wpk-shell-frame"' "$body"; then got=WRAP; else got=PASA; fi
    rm -f "$body"
    if [ "$code" = 000 ]; then echo "  SIN VERIFICAR  $label (sin respuesta)"; rm -f "$hdr"; return 0; fi
    if [ "$got" = "$want" ]; then echo "  OK    $label -> $got ($code)"; else echo "  FALLA $label -> $got ($code), se esperaba $want"; fails=$((fails + 1)); fi
    rm -f "$hdr"
  }
  chk "GET / como documento"        WRAP -H 'Sec-Fetch-Dest: document' "$B/"
  chk "GET /index.php como documento" WRAP -H 'Sec-Fetch-Dest: document' "$B/index.php?menu=agent_console"
  chk "peticion de iframe"          PASA -H 'Sec-Fetch-Dest: iframe' "$B/index.php"
  chk "peticion sin Sec-Fetch-Dest" PASA "$B/index.php"
  chk "POST"                        PASA -X POST -d a=1 -H 'Sec-Fetch-Dest: document' "$B/index.php"
  chk "rawmode=yes"                 PASA -H 'Sec-Fetch-Dest: document' "$B/index.php?menu=x&rawmode=yes"
  chk "/admin/"                     PASA -H 'Sec-Fetch-Dest: document' "$B/admin/"
  local r; r=$(curl -sk --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Sec-Fetch-Dest: document' http://127.0.0.1/index.php 2>/dev/null || true)
  case "$r" in
    30?\ https://*) echo "  OK    HTTP:80 sigue redirigiendo a HTTPS ($r)" ;;
    000*) echo "  SIN VERIFICAR  puerto 80 sin respuesta" ;;
    *) echo "  FALLA HTTP:80 ya no redirige a HTTPS ($r)"; fails=$((fails + 1)) ;;
  esac
  [ "$fails" = 0 ]
}

wrap_off() {
  if [ -f "$WRAPCONF" ]; then
    if ours "$WRAPCONF"; then
      install -d -m 700 "$BK"; cp -a "$WRAPCONF" "$BK/"; rm -f "$WRAPCONF"
      if apachectl configtest >/dev/null 2>&1 && apachectl graceful; then echo "  quitada $WRAPCONF y recargado Apache (graceful)"
      else echo "  AVISO: configtest o graceful fallaron tras quitar la conf; revisa Apache"; fi
    else echo "  AVISO: $WRAPCONF no lleva nuestra marca: NO se toca"; fi
  else echo "  (no habia envoltorio)"; fi
  if [ -f "$AGENT_HOOK" ] && ours "$AGENT_HOOK"; then
    install -d -m 700 "$BK"; cp -a "$AGENT_HOOK" "$BK/"; rm -f "$AGENT_HOOK"; echo "  quitado el gancho de la consola de agente"
  fi
}

wrap_on() {
  local SHELLDIR=$MODS/$MODULE/shell
  for f in wrap.html wrap.js wrap.css; do [ -f "$SHELLDIR/$f" ] || fail "falta $SHELLDIR/$f (instala primero el modulo)"; done
  [ -f "$SRC/apache/kit-webphone-wrap.conf" ] && ours "$SRC/apache/kit-webphone-wrap.conf" || fail "falta apache/kit-webphone-wrap.conf o no lleva la marca"
  local mods; mods=$(httpd -M 2>/dev/null || true)
  echo "$mods" | grep -q 'rewrite_module' || fail "Apache no tiene mod_rewrite"
  echo "$mods" | grep -q 'headers_module' || fail "Apache no tiene mod_headers"
  grep -hE '^[[:space:]]*DocumentRoot[[:space:]]+"?/var/www/html"?[[:space:]]*$' /etc/httpd/conf/httpd.conf >/dev/null || fail "el DocumentRoot de httpd.conf no es /var/www/html"
  if [ -f "$WRAPCONF" ] && ! ours "$WRAPCONF"; then fail "$WRAPCONF existe y no es nuestro; no se toca"; fi
  apachectl configtest >/dev/null 2>&1 || fail "apachectl configtest ya falla ANTES del cambio; arreglalo primero"
  install -d -m 700 "$BK"
  [ -f "$WRAPCONF" ] && cp -a "$WRAPCONF" "$BK/kit-webphone-wrap.conf.prev"
  install -o root -g root -m 644 "$SRC/apache/kit-webphone-wrap.conf" "$WRAPCONF"
  if ! apachectl configtest >/tmp/wpk_ct.$$ 2>&1; then
    sed 's/^/  /' /tmp/wpk_ct.$$; rm -f /tmp/wpk_ct.$$
    if [ -f "$BK/kit-webphone-wrap.conf.prev" ]; then cp -a "$BK/kit-webphone-wrap.conf.prev" "$WRAPCONF"; else rm -f "$WRAPCONF"; fi
    fail "configtest fallo con la conf nueva: queda todo como estaba y NO se recargo Apache"
  fi
  rm -f /tmp/wpk_ct.$$
  if [ -d "$MODS/agent_console" ] && [ -f "$SRC/modulo/agent_console_hook/themes/default/js/webphone-agent.js" ]; then
    [ -f "$AGENT_HOOK" ] && ! ours "$AGENT_HOOK" && fail "$AGENT_HOOK ya existe y no es nuestro"
    install -o asterisk -g asterisk -m 644 "$SRC/modulo/agent_console_hook/themes/default/js/webphone-agent.js" "$AGENT_HOOK"
    echo "  gancho de la consola de agente instalado (archivo nuevo; no se modifica el Call Center)"
  else echo "  (no hay Call Center instalado: se omite el gancho de la consola de agente)"; fi
  if ! { apachectl graceful && sleep 2 && systemctl is-active --quiet httpd; }; then
    echo "  FALLA la recarga: se revierte" >&2; wrap_off; fail "la recarga de Apache fallo; envoltorio quitado"
  fi
  echo "  Apache recargado (graceful)"
  if ! wrap_check; then echo "  La matriz de rutas no coincide: se revierte" >&2; wrap_off; fail "verificacion fallida; envoltorio quitado"; fi
  echo "  Envoltorio activo. Reversa: bash install.sh --quitar-envoltorio"
}

# ---------------------------------------------------------------- modos cortos
case "$MODE" in
  helper) say "Helper root"; install_helper; exit 0 ;;
  helper_off) say "Quitar helper root"; remove_helper; exit 0 ;;
  wrap_off) say "Quitar el envoltorio"; wrap_off; exit 0 ;;
  check)
    say "Estado"
    [ -d "$MODS/$MODULE" ] && echo "  modulo web: instalado" || echo "  modulo web: NO"
    [ -x "$HELPER" ] && echo "  helper root: instalado" || echo "  helper root: NO"
    [ -f "$WEBCONF" ] && echo "  claves: presentes" || echo "  claves: NO"
    MYSQL_PWD="$(awk -F= '/^mysqlrootpwd/{print $2}' /etc/issabel.conf)" mysql -uroot -N -e "SELECT 'base kit_webphone: ', COUNT(*) FROM information_schema.schemata WHERE schema_name='$DB'" 2>/dev/null | tr -d '\t' | sed 's/^/  /' || true
    ours "$WRAPCONF" && echo "  envoltorio: activo" || echo "  envoltorio: no"
    echo -n "  endpoint sin sesion: "; curl -sk --max-time 10 -o /dev/null -w '%{http_code}\n' https://127.0.0.1/modules/webphone_kit/api/config.php || true
    exit 0 ;;
esac

# ---------------------------------------------------------------- instalacion normal
say "0) Comprobaciones previas"
for c in asterisk php mysql sqlite3 issabel-menumerge openssl curl; do command -v "$c" >/dev/null 2>&1 || fail "falta el comando $c (esto no parece un Issabel 5)"; done
[ -f /etc/issabel.conf ] || fail "falta /etc/issabel.conf"
[ -d "$MODS" ] || fail "falta $MODS"
for p in modulo/webphone_kit modulo/menu_webphone.xml sql priv; do [ -e "$SRC/$p" ] || fail "falta $p junto a install.sh (ejecuta desde la carpeta del repositorio)"; done
[ -f "$SRC/modulo/webphone_kit/themes/default/js/webphone.js" ] || fail "falta el cliente compilado (themes/default/js/webphone.js)"
if [ -d "$MODS/$MODULE" ] && [ ! -f "$MODS/$MODULE/.kit-unit" ]; then fail "$MODS/$MODULE existe y no es de este proyecto; no se toca"; fi
MYSQL_PWD="$(awk -F= '/^mysqlrootpwd/{print $2}' /etc/issabel.conf)"; export MYSQL_PWD
[ -n "$MYSQL_PWD" ] || fail "no pude leer la clave de root de MariaDB de /etc/issabel.conf"
mysql -uroot -e 'SELECT 1' >/dev/null 2>&1 || fail "MariaDB no responde con la clave de /etc/issabel.conf"
echo "  Asterisk: $(asterisk -rx 'core show version' 2>/dev/null | cut -c1-24)   Issabel: $(rpm -q --qf '%{VERSION}-%{RELEASE}' issabel-pbx 2>/dev/null || echo ?)"
if ! httpd -M 2>/dev/null | grep -q proxy_wstunnel_module; then echo "  AVISO: Apache no tiene proxy_wstunnel; el asistente del modulo te lo dira en el diagnostico"; fi

say "1) Respaldo en $BK"
install -d -m 700 "$BK"
cp -a /var/www/db/menu.db "$BK/menu.db"; cp -a /var/www/db/acl.db "$BK/acl.db"
for f in "$WEBCONF" "$ROCONF" /etc/asterisk/http_custom.conf /etc/asterisk/rtp_custom.conf /etc/asterisk/pjsip_custom.conf; do [ -f "$f" ] && cp -a "$f" "$BK/"; done
[ -d "$MODS/$MODULE" ] && cp -a "$MODS/$MODULE" "$BK/"
ls "$BK" | sed 's/^/  /'

say "2) Helper root y carpeta de estado"
install_helper

say "3) Base de datos kit_webphone y usuarios MySQL"
exists=$(mysql -uroot -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$DB'")
if [ "$exists" != "0" ]; then
  owner=$(mysql -uroot -N -e "SELECT meta_value FROM \`$DB\`.kit_meta WHERE meta_key='owner'" 2>/dev/null || true)
  [ "$owner" = "webphone" ] || fail "la base $DB existe y NO tiene la marca owner=webphone: no la adopto"
  echo "  la base ya es de webphone: se actualiza"
else echo "  la base no existe: se crea"; fi
ensure_key() {   # ensure_key <archivo> <clave-del-archivo> <usuario-key> <usuario>   (imprime la clave por stdout, el resto por stderr)
  local file=$1 key=$2 userkey=$3 user=$4 pw="" tmp
  [ -f "$file" ] && pw=$(awk -F= -v k="$key" '$1==k{print $2}' "$file")
  if [[ "$pw" =~ ^[A-Za-z0-9]{16,}$ ]]; then echo "  se conserva la clave de $file" >&2
  else
    pw=$(openssl rand -hex 16); tmp=$(mktemp /tmp/wpk_conf.XXXXXX)
    printf 'db=%s\n%s=%s\n%s=%s\n' "$DB" "$userkey" "$user" "$key" "$pw" > "$tmp"
    install -o asterisk -g asterisk -m 640 "$tmp" "$file"; rm -f "$tmp"
    echo "  clave nueva guardada en $file (640 asterisk:asterisk)" >&2
  fi
  chown asterisk:asterisk "$file"; chmod 640 "$file"
  printf '%s' "$pw"
}
WEBPW=$(ensure_key "$WEBCONF" web_pass web_user "$WEBUSER")
ROPW=$(ensure_key "$ROCONF" ro_pass ro_user "$ROUSER")
for f in $(ls "$SRC"/sql/*.sql | LC_ALL=C sort); do
  PWW="$WEBPW" PWR="$ROPW" awk '{ gsub(/__CLAVE_WEB__/, ENVIRON["PWW"]); gsub(/__CLAVE_RO__/, ENVIRON["PWR"]); print }' "$f" | mysql -uroot
  echo "  OK    $(basename "$f")"
done
for u in "$WEBUSER" "$ROUSER"; do
  echo "  permisos de $u:"; mysql -uroot -N -e "SHOW GRANTS FOR '$u'@'localhost'" | sed -E "s/IDENTIFIED BY PASSWORD '[^']*'/IDENTIFIED BY PASSWORD '***'/; s/^/    /"
done

say "4) Modulo web"
install -d "$MODS/$MODULE"
cp -a "$SRC/modulo/$MODULE/." "$MODS/$MODULE/"
d=$MODS/$MODULE
sed -i -E "s#(mysql://[A-Za-z0-9_]+):[^@]*@#\1:${WEBPW}@#" "$d/configs/default.conf.php"
chown -R asterisk:asterisk "$d"
find "$d" -type d -exec chmod 755 {} +; find "$d" -type f -exec chmod 644 {} +; chmod 640 "$d/configs/default.conf.php"
errs=0
while IFS= read -r f; do php -l "$f" >/dev/null 2>&1 || { echo "  FALLA sintaxis: $f"; errs=1; }; done < <(find "$d" -name '*.php' | LC_ALL=C sort)
[ "$errs" = 0 ] || fail "hay errores de sintaxis PHP en el modulo"
echo "  modulo copiado a $d y sintaxis PHP OK"

say "5) Menu de Issabel (PBX > Webphone Lite, solo grupo administrator)"
issabel-menumerge "$SRC/modulo/menu_webphone.xml"
sqlite3 -header /var/www/db/menu.db "select id,IdParent,Name,Type,order_no from menu where id='$MODULE'"
echo "  grupos con permiso:"; sqlite3 /var/www/db/acl.db "select g.name from acl_group_permission p join acl_group g on g.id=p.id_group join acl_resource r on r.id=p.id_resource where r.name='$MODULE'" | sed 's/^/    /'

say "6) Prueba de conexion a la base con el usuario del modulo"
TPHP=$(mktemp --suffix=.php /tmp/wpk_t.XXXXXX)
cat > "$TPHP" <<'PHP'
<?php
include_once "/var/www/html/libs/misc.lib.php";
include_once "/var/www/html/libs/paloSantoDB.class.php";
include "/var/www/html/modules/webphone_kit/configs/default.conf.php";
$pDB = new paloDB($arrConfModule['dsn_conn_database']);
$r = $pDB->getFirstRowQuery("SELECT 1", false);
if (!is_array($r) || (int)$r[0] !== 1) { echo "FALLA la conexion: ", $pDB->errMsg, "\n"; exit(1); }
echo "conexion OK\n";
PHP
chmod 644 "$TPHP"
su -s /bin/bash asterisk -c "php $TPHP" | sed 's/^/  /' || { rm -f "$TPHP"; fail "el modulo no se conecta a su base"; }
rm -f "$TPHP"

say "7) Endpoint sin sesion (debe responder 403)"
code=$(curl -sk --max-time 15 -o /dev/null -w '%{http_code}' https://127.0.0.1/modules/webphone_kit/api/config.php || true)
echo "  GET /modules/webphone_kit/api/config.php sin sesion -> $code"
[ "$code" = 403 ] || echo "  AVISO: se esperaba 403 (si es 000, Apache no responde por HTTPS en este momento)"

if [ "$MODE" = install_wrap ]; then say "8) Envoltorio de Apache (barra arriba de toda la web)"; wrap_on; fi

echo
echo "Listo. Cierra sesion en Issabel y vuelve a entrar para ver PBX > Webphone Lite."
echo "Respaldo: $BK (contiene copias de menu.db y acl.db; borralo cuando ya no lo necesites)."
echo "Siguiente: docs/manual-webphone.md. Reversa: bash uninstall.sh"
