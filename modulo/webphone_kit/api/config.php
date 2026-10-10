<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Endpoint de configuracion del webphone. Archivo autonomo: NO pasa por index.php ni por la ACL de menus, asi que
 * cualquier usuario de Issabel con sesion puede llamarlo. La autorizacion la decide este archivo:
 *   sesion valida + extension asignada (acl_user.extension) + webphone activado (wp_user) + extension webphone
 *   (PJSIP con transport-wss). Todo lo demas responde 403 con el MISMO cuerpo, sin pistas.
 *
 * Reglas: solo GET; solo HTTPS; la identidad sale SOLO de la sesion (no se lee ningun parametro del request);
 * Sec-Fetch-Site debe ser same-origin o no venir; sin CORS; sin cache; el secreto SIP solo viaja en el cuerpo de
 * esta respuesta y nunca se escribe en logs. La base se lee con el usuario webphone_ro, que solo tiene SELECT sobre
 * la vista v_webphone_cfg (esa vista ya filtra por activado y por extension webphone).
 */

const WPK_VERSION      = '0.2.0';
const WPK_SESSION_NAME = 'issabelSession';
const WPK_WEB_ROOT     = '/var/www/html';
const WPK_RO_CONF      = '/etc/asterisk/webphone_ro.conf';

// Que ningun aviso de PHP contamine el JSON ni muestre rutas.
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');

/** Cabeceras fijas de toda respuesta (exito o error). */
function wpk_headers($code)
{
    http_response_code($code);
    header_remove('X-Powered-By');
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, private');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
}

function wpk_json($code, array $body)
{
    while (ob_get_level() > 0) {
        ob_end_clean();   // descarta cualquier salida accidental de las librerias del framework
    }
    wpk_headers($code);
    // Sin Set-Cookie en ninguna respuesta de este endpoint
    header_remove('Set-Cookie');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    exit;
}

/** 403 identico en todos los casos de "no autorizado". */
function wpk_forbidden()
{
    wpk_json(403, array('error' => 'forbidden'));
}

function wpk_server_error($tag)
{
    // Solo una etiqueta fija: nunca mensajes de excepcion, claves ni datos de la peticion
    error_log('webphone_kit config.php: ' . $tag);
    wpk_json(500, array('error' => 'server_error'));
}

/** Ruta WebSocket valida: /algo/otro, sin "..", sin "//", solo caracteres seguros. */
function wpk_valid_ws_path($p)
{
    return is_string($p) && preg_match('#^/[A-Za-z0-9._~/-]{1,100}$#', $p) === 1
        && strpos($p, '..') === false && strpos($p, '//') === false;
}

/** Lista de servidores STUN separados por coma: stun:host[:puerto] o stuns:host[:puerto]. */
function wpk_valid_stun($s)
{
    return is_string($s) && preg_match('#^stuns?:[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$#', $s) === 1;
}

/** Directorio de sesiones de PHP (ruta del manejador de archivos, quitando el prefijo "N;" o "N;MODO;"). */
function wpk_session_dir()
{
    $p = (string) ini_get('session.save_path');
    $pos = strrpos($p, ';');
    if ($pos !== false) {
        $p = substr($p, $pos + 1);
    }
    return $p;
}

try {
    // 1) Metodo: solo GET
    if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'GET') {
        header('Allow: GET');
        wpk_json(405, array('error' => 'method_not_allowed'));
    }

    // 2) Solo HTTPS (Apache termina TLS en el mismo servidor; no se confia en X-Forwarded-Proto)
    $https = isset($_SERVER['HTTPS']) ? strtolower((string) $_SERVER['HTTPS']) : '';
    if ($https === '' || $https === 'off') {
        wpk_forbidden();
    }

    // 3) Origen: same-origin o cabecera ausente (navegadores antiguos o curl)
    if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && $_SERVER['HTTP_SEC_FETCH_SITE'] !== 'same-origin') {
        wpk_forbidden();
    }

    // 4) Sesion de Issabel (misma validacion que index.php: cookie issabelSession, issabel_user, issabel_pass y
    //    paloACL::authenticateUser en cada peticion). Se abre en solo lectura y sin cookies propias.
    $sid = isset($_COOKIE[WPK_SESSION_NAME]) ? $_COOKIE[WPK_SESSION_NAME] : '';
    if (!is_string($sid) || preg_match('/^[A-Za-z0-9,-]{16,128}$/', $sid) !== 1) {
        wpk_forbidden();
    }
    // Un id desconocido haria que PHP cree un archivo de sesion vacio: se comprueba antes que exista
    $sdir = wpk_session_dir();
    if ($sdir !== '' && is_dir($sdir) && !is_file($sdir . '/sess_' . $sid)) {
        wpk_forbidden();
    }
    session_name(WPK_SESSION_NAME);
    session_id($sid);
    session_cache_limiter('');
    $started = @session_start(array(
        'read_and_close'  => true,
        'use_cookies'     => 0,
        'use_strict_mode' => 1,
    ));
    if (!$started || !isset($_SESSION['issabel_user'], $_SESSION['issabel_pass'])
        || !is_string($_SESSION['issabel_user']) || !is_string($_SESSION['issabel_pass'])
        || $_SESSION['issabel_user'] === '') {
        wpk_forbidden();
    }
    $user    = $_SESSION['issabel_user'];
    $passMd5 = $_SESSION['issabel_pass'];

    // 5) Credenciales y extension segun la ACL de Issabel (las librerias usan rutas relativas)
    chdir(WPK_WEB_ROOT);
    ob_start();   // algunas librerias del framework pueden emitir avisos: nunca deben llegar al cliente
    include_once WPK_WEB_ROOT . '/libs/misc.lib.php';
    include_once WPK_WEB_ROOT . '/configs/default.conf.php';
    include_once WPK_WEB_ROOT . '/libs/paloSantoDB.class.php';
    include_once WPK_WEB_ROOT . '/libs/paloSantoACL.class.php';
    global $arrConf;
    $pdbACL = new paloDB($arrConf['issabel_dsn']['acl']);
    $pACL   = new paloACL($pdbACL);
    $authOk = $pACL->authenticateUser($user, $passMd5);
    $ext    = $authOk ? $pACL->getUserExtension($user) : null;
    ob_end_clean();
    if (!$authOk) {
        wpk_forbidden();
    }
    if (!is_string($ext) || preg_match('/^[0-9]{1,20}$/', $ext) !== 1) {
        wpk_forbidden();   // sin extension asignada (o con un valor que no es una extension numerica)
    }

    // 6) Host validado: dominio SIP y URL WSS salen de aqui (nunca de un parametro)
    $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
    $okHost = preg_match('/^(?:[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::[0-9]{1,5})?$/', $host) === 1;
    if (!$okHost) {
        wpk_json(400, array('error' => 'bad_request'));
    }
    $domain = preg_replace('/:[0-9]{1,5}$/', '', $host);

    // 7) Lectura de la configuracion con el usuario de solo lectura (SOLO la vista v_webphone_cfg)
    $conf = @parse_ini_file(WPK_RO_CONF, false, INI_SCANNER_RAW);
    if (!is_array($conf) || empty($conf['db']) || empty($conf['ro_user']) || empty($conf['ro_pass'])) {
        wpk_server_error('config de base ilegible');
    }
    mysqli_report(MYSQLI_REPORT_OFF);
    $my = @mysqli_init();
    if (!$my || !@$my->real_connect('localhost', $conf['ro_user'], $conf['ro_pass'], $conf['db'])) {
        wpk_server_error('no conecta a la base');
    }
    $my->set_charset('utf8mb4');
    $stmt = $my->prepare(
        'SELECT extension, secret, transport, display_name, ws_path, stun_servers, register_expires, '
      . 'ringtone_enabled, ringback_enabled FROM v_webphone_cfg WHERE username = ? AND extension = ? LIMIT 2'
    );
    if (!$stmt) {
        wpk_server_error('consulta no preparada');
    }
    $stmt->bind_param('ss', $user, $ext);
    if (!$stmt->execute()) {
        wpk_server_error('consulta fallida');
    }
    $stmt->bind_result($rExt, $rSecret, $rTransport, $rName, $rWsPath, $rStun, $rExpires, $rRing, $rBack);
    $rows = array();
    while ($stmt->fetch()) {
        $rows[] = array($rExt, $rSecret, $rTransport, $rName, $rWsPath, $rStun, $rExpires, $rRing, $rBack);
    }
    $stmt->close();
    $my->close();
    if (count($rows) !== 1) {
        wpk_forbidden();   // no activado, extension de otro tipo, o usuario sin fila
    }
    list($rExt, $rSecret, $rTransport, $rName, $rWsPath, $rStun, $rExpires, $rRing, $rBack) = $rows[0];
    if ($rExt !== $ext || $rTransport !== 'transport-wss' || !is_string($rSecret) || $rSecret === '') {
        wpk_forbidden();
    }

    // 8) Ajustes (validados de nuevo: la base no es de confianza ciega)
    if (!wpk_valid_ws_path($rWsPath)) {
        wpk_server_error('ws_path invalido');
    }
    $expires = (ctype_digit((string) $rExpires) && (int) $rExpires >= 60 && (int) $rExpires <= 3600) ? (int) $rExpires : 600;
    $ice = array();
    $stun = array();
    foreach (explode(',', (string) $rStun) as $s) {
        $s = trim($s);
        if ($s !== '' && wpk_valid_stun($s)) {
            $stun[] = $s;
        }
    }
    if (count($stun) > 0) {
        $ice[] = array('urls' => $stun);
    }

    $displayName = trim((string) $rName);
    if (function_exists('mb_substr')) {
        $displayName = mb_substr($displayName, 0, 80, 'UTF-8');
    }
    if ($displayName === '') {
        $displayName = $ext;
    }

    wpk_json(200, array(
        'sip_user'         => $rExt,
        'password'         => $rSecret,
        'domain'           => $domain,
        'ws_url'           => 'wss://' . $host . $rWsPath,
        'ice_servers'      => $ice,
        'register_expires' => $expires,
        'display_name'     => $displayName,
        'tones'            => array('ringtone' => $rRing === '1', 'ringback' => $rBack === '1'),
        'version'          => WPK_VERSION,
    ));
} catch (Throwable $e) {
    // Solo la clase de la excepcion: su mensaje podria incluir datos de la base
    wpk_server_error('excepcion ' . get_class($e));
}
