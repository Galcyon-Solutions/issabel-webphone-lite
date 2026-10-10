<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Provisionador de anexos WebRTC del webphone. Solo linea de comandos, como el usuario asterisk, SIN shell:
 * la web lo lanza con proc_open con los argumentos en arreglo y le pasa un JSON por la entrada estandar; responde un
 * JSON por la salida estandar. Usa la API core de IssabelPBX (las mismas funciones que el formulario de extensiones:
 * core_users_add, core_devices_add, core_users_edit, core_devices_del) y NO depende de paloSantoExtensionsBatch.
 *
 * Reglas duras de este archivo:
 *   - Un lote = UN retrieve_conf y UN reload de res_pjsip (mas un dialplan reload al crear), nunca uno por fila.
 *   - Nada borra en lote: la accion "delete" solo existe por linea de comandos, exige una lista corta (maximo 50) y solo
 *     acepta anexos que este mismo archivo creo (consta en batches.log).
 *   - El secreto SIP lo genera este archivo (24 caracteres hexadecimales aleatorios) y NUNCA sale por la salida estandar,
 *     ni a la bitacora. Los respaldos que lo contienen quedan 0600 asterisk.
 *   - Toda salida de las funciones del core (alert de JavaScript, avisos) se descarta: la salida es solo el JSON.
 *
 * Acciones: calls | plan | audit | create | repair | delete.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
ob_start();
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');

const WPK_STATE_DIR = '/var/lib/asterisk/webphone_kit';
const WPK_BATCH_LOG = '/var/lib/asterisk/webphone_kit/batches.log';
const WPK_APPLY_LOG = '/var/log/asterisk/webphone_kit.log';
const WPK_ASTERISK  = '/usr/sbin/asterisk';

function wpk_out(array $r)
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    echo json_encode($r, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit(isset($r['ok']) && $r['ok'] ? 0 : 1);
}

function wpk_fail($code, array $more = array())
{
    wpk_out(array_merge(array('ok' => false, 'error' => $code), $more));
}

// ---------------------------------------------------------------- entrada
$raw = stream_get_contents(STDIN);
$in = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($in) || !isset($in['action']) || !is_string($in['action'])) {
    wpk_fail('bad_input');
}
$action = $in['action'];
if (!in_array($action, array('calls', 'plan', 'audit', 'create', 'repair', 'delete'), true)) {
    wpk_fail('bad_action');
}

$bootstrap_settings['freepbx_auth'] = false;
require_once '/etc/issabelpbx.conf';
global $db, $astman, $amp_conf;
if (!function_exists('core_users_add') || !is_object($astman)) {
    wpk_fail('core_unavailable');
}

// ---------------------------------------------------------------- utilidades
/** Ejecuta un programa SIN shell. Devuelve array(codigo, salida). */
function wpk_run_cmd(array $argv, $timeout = 60)
{
    $p = @proc_open($argv, array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes, '/tmp', array('PATH' => '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG' => 'C'));
    if (!is_resource($p)) {
        return array(-1, '');
    }
    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);
    $buf = '';
    $t0 = time();
    while (true) {
        $st = proc_get_status($p);
        $buf .= (string) stream_get_contents($pipes[1]);
        stream_get_contents($pipes[2]);
        if (!$st['running']) {
            break;
        }
        if (time() - $t0 > $timeout) {
            proc_terminate($p, 9);
            break;
        }
        usleep(50000);
    }
    $buf .= (string) stream_get_contents($pipes[1]);
    $code = isset($st['exitcode']) ? $st['exitcode'] : -1;
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($p);
    return array($code, $buf);
}

function wpk_ast($cmd)
{
    list(, $o) = wpk_run_cmd(array(WPK_ASTERISK, '-rx', $cmd), 30);
    return $o;
}

function wpk_active_calls()
{
    $o = wpk_ast('core show channels count');
    return preg_match('/(\d+) active call/', $o, $m) ? (int) $m[1] : -1;
}

function wpk_state_dir()
{
    if (!is_dir(WPK_STATE_DIR)) {
        @mkdir(WPK_STATE_DIR, 0700, true);
    }
    @chmod(WPK_STATE_DIR, 0700);
    @mkdir(WPK_STATE_DIR . '/backup', 0700, true);
    return is_dir(WPK_STATE_DIR) && is_writable(WPK_STATE_DIR);
}

function wpk_log_line($file, $line)
{
    $f = @fopen($file, 'ab');
    if ($f) {
        fwrite($f, date('c') . ' ' . $line . "\n");
        fclose($f);
        @chmod($file, 0640);
    }
}

function wpk_valid_ext($e)
{
    return is_string($e) && preg_match('/^[0-9]{3,6}$/', $e) === 1;
}

/** Nombre visible: sin comillas, barras, menor/mayor, punto y coma, barra vertical, signo de dolar ni control. */
function wpk_valid_name($n)
{
    return is_string($n) && $n !== '' && mb_strlen($n, 'UTF-8') <= 40
        && preg_match('/^[^\x00-\x1F\x7F"\\\\<>;|`$]+$/u', $n) === 1 && trim($n) === $n;
}

function wpk_norm_profile($p)
{
    $d = array('v' => 1, 'codecs' => 'auto', 'recording' => 'dontcare', 'callwaiting' => true, 'outbound_cid' => '');
    if (!is_array($p)) {
        return $d;
    }
    if (isset($p['codecs']) && in_array($p['codecs'], array('auto', 'g711'), true)) {
        $d['codecs'] = $p['codecs'];
    }
    if (isset($p['recording']) && in_array($p['recording'], array('dontcare', 'always', 'never', 'ondemand'), true)) {
        $d['recording'] = $p['recording'];
    }
    if (isset($p['callwaiting'])) {
        $d['callwaiting'] = (bool) $p['callwaiting'];
    }
    if (isset($p['outbound_cid']) && is_string($p['outbound_cid']) && preg_match('/^[0-9+*#() \-]{0,32}$/', $p['outbound_cid']) === 1) {
        $d['outbound_cid'] = trim($p['outbound_cid']);
    }
    return $d;
}

function wpk_opus_available()
{
    return preg_match('/^\s*\d+\s+audio\s+opus\s/m', wpk_ast('core show codecs')) === 1;
}

/** Campos WebRTC que el perfil fija en el dispositivo (la misma combinacion de la etapa 2). */
function wpk_expected_device(array $profile)
{
    $allow = $profile['codecs'] === 'g711' ? 'ulaw,alaw' : (wpk_opus_available() ? 'opus,ulaw,alaw,g722' : 'ulaw,alaw,g722');
    return array(
        'transport' => 'transport-wss', 'media_encryption' => 'dtls', 'dtls_verify' => 'fingerprint', 'dtls_setup' => 'actpass',
        'dtls_cert_file' => '/etc/asterisk/keys/asterisk.pem', 'dtls_private_key' => '/etc/asterisk/keys/asterisk.pem',
        'ice_support' => 'yes', 'use_avpf' => 'yes', 'rtcp_mux' => 'yes', 'media_use_received_transport' => 'yes',
        'max_contacts' => '1', 'remove_existing' => 'yes', 'dtmfmode' => 'rfc4733', 'disallow' => 'all', 'allow' => $allow,
        'direct_media' => 'no', 'nat' => 'yes', 'context' => 'from-internal', 'qualifyfreq' => '60', 'qualify_timeout' => '3',
    );
}

/** Cuatro direcciones de grabacion + bajo demanda segun el modo del perfil. */
function wpk_recording_values($mode)
{
    $v = ($mode === 'always' || $mode === 'never') ? $mode : 'dontcare';
    return array('in_external' => $v, 'out_external' => $v, 'in_internal' => $v, 'out_internal' => $v,
                 'ondemand' => $mode === 'ondemand' ? 'enabled' : 'disabled');
}

function wpk_recording_mode_from(array $u)
{
    $dirs = array();
    foreach (array('in_external', 'out_external', 'in_internal', 'out_internal') as $k) {
        $dirs[] = isset($u['recording_' . $k]) ? (string) $u['recording_' . $k] : 'dontcare';
    }
    $od = isset($u['recording_ondemand']) ? (string) $u['recording_ondemand'] : 'disabled';
    $uniq = array_unique($dirs);
    if (count($uniq) === 1 && $uniq[0] === 'always') {
        return 'always';
    }
    if (count($uniq) === 1 && $uniq[0] === 'never') {
        return 'never';
    }
    if (count($uniq) === 1 && $uniq[0] === 'dontcare') {
        return $od === 'enabled' ? 'ondemand' : 'dontcare';
    }
    return 'custom';
}

function wpk_webphone_exts()
{
    $rows = sql("SELECT DISTINCT id FROM sip WHERE keyword='transport' AND data='transport-wss' ORDER BY id", 'getAll', DB_FETCHMODE_ASSOC);
    $out = array();
    if (is_array($rows)) {
        foreach ($rows as $r) {
            if (wpk_valid_ext((string) $r['id'])) {
                $out[] = (string) $r['id'];
            }
        }
    }
    return $out;
}

/** Diferencias entre un anexo y el perfil (solo nombres de campo y valores NO secretos). */
function wpk_diff_ext($ext, array $profile)
{
    $dev = core_devices_get($ext);
    $usr = core_users_get($ext);
    $ch = array();
    if (!is_array($dev) || count($dev) === 0 || !is_array($usr) || count($usr) === 0) {
        return array('error' => 'not_found');
    }
    foreach (wpk_expected_device($profile) as $k => $want) {
        $got = isset($dev[$k]) ? (string) $dev[$k] : '';
        if ($k === 'allow') {
            // El orden de los codecs no importa para decidir si falta algo
            $a = array_filter(explode(',', $got));
            $b = explode(',', $want);
            sort($a);
            sort($b);
            if ($a !== $b) {
                $ch[] = array('f' => 'allow', 'from' => $got, 'to' => $want);
            }
            continue;
        }
        if (strtolower($got) !== strtolower($want)) {
            $ch[] = array('f' => $k, 'from' => $got, 'to' => $want);
        }
    }
    $rm = wpk_recording_mode_from($usr);
    if ($rm !== $profile['recording']) {
        $ch[] = array('f' => 'recording', 'from' => $rm, 'to' => $profile['recording']);
    }
    $cw = (isset($usr['callwaiting']) && $usr['callwaiting'] === 'enabled');
    if ($cw !== $profile['callwaiting']) {
        $ch[] = array('f' => 'callwaiting', 'from' => $cw ? 'enabled' : 'disabled', 'to' => $profile['callwaiting'] ? 'enabled' : 'disabled');
    }
    if ($profile['outbound_cid'] !== '' && (string) $usr['outboundcid'] !== $profile['outbound_cid']) {
        $ch[] = array('f' => 'outbound_cid', 'from' => (string) $usr['outboundcid'], 'to' => $profile['outbound_cid']);
    }
    return array('name' => (string) $usr['name'], 'changes' => $ch);
}

/** Un solo retrieve_conf y un solo reload por lote. */
function wpk_apply_config($dialplan, $batch)
{
    list($rc) = wpk_run_cmd(array('/var/lib/asterisk/bin/retrieve_conf'), 120);
    $o1 = wpk_ast('module reload res_pjsip.so');
    $o2 = '';
    if ($dialplan) {
        $o2 = wpk_ast('dialplan reload');
    }
    usleep(1500000);
    wpk_log_line(WPK_APPLY_LOG, 'batch=' . $batch . ' retrieve_conf=1 reload_pjsip=1 dialplan_reload=' . ($dialplan ? 1 : 0) . ' rc=' . $rc);
    return $rc === 0;
}

function wpk_endpoints_loaded(array $exts)
{
    $o = wpk_ast('pjsip show endpoints');
    $ok = array();
    foreach ($exts as $e) {
        if (preg_match('/^\s*Endpoint:\s+' . preg_quote($e, '/') . '(\/|\s)/m', $o)) {
            $ok[$e] = true;
        }
    }
    return $ok;
}

function wpk_created_by_us()
{
    $set = array();
    if (is_readable(WPK_BATCH_LOG)) {
        foreach (file(WPK_BATCH_LOG, FILE_IGNORE_NEW_LINES) as $l) {
            if (preg_match('/ created=([0-9,]+)/', $l, $m)) {
                foreach (explode(',', $m[1]) as $e) {
                    $set[$e] = true;
                }
            }
        }
    }
    return $set;
}

function wpk_lock_batch()
{
    wpk_state_dir();
    $fh = @fopen(WPK_STATE_DIR . '/batch.lock', 'c');
    if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
        wpk_fail('busy');
    }
    return $fh;
}

/** Campos del formulario de una extension (el mismo arreglo que arma el formulario de IssabelPBX). */
function wpk_build_request($ext, $name, $secret, array $profile, array $extra = array())
{
    $req = array(
        'display' => 'extensions', 'extension' => $ext, 'name' => $name, 'tech_hardware' => 'pjsip_generic',
        'devinfo_secret' => $secret,
        'noanswer_dest' => '', 'busy_dest' => '', 'chanunavail_dest' => '', 'outboundcid' => $profile['outbound_cid'], 'ringtimer' => '0',
        'callwaiting' => $profile['callwaiting'] ? 'enabled' : 'disabled', 'pinless' => 'disabled',
    );
    foreach (wpk_expected_device($profile) as $k => $v) {
        $req['devinfo_' . $k] = $v;
    }
    $rec = wpk_recording_values($profile['recording']);
    foreach (array('in_external', 'out_external', 'in_internal', 'out_internal', 'ondemand') as $k) {
        // El formulario manda "campo=valor" (un radio): core_users_add lo parte con explode('=')
        $req['recording_' . $k] = 'recording_' . $k . '=' . $rec[$k];
    }
    $req['recording_priority'] = '10';
    return array_merge($req, $extra);
}

// ---------------------------------------------------------------- acciones de solo lectura
if ($action === 'calls') {
    wpk_out(array('ok' => true, 'calls' => wpk_active_calls()));
}

$profile = wpk_norm_profile(isset($in['profile']) ? $in['profile'] : null);

if ($action === 'plan') {
    $exists = array();
    $rows = (isset($in['rows']) && is_array($in['rows'])) ? array_slice($in['rows'], 0, 600) : array();
    foreach ($rows as $r) {
        $e = (is_array($r) && isset($r['ext'])) ? (string) $r['ext'] : '';
        if (!wpk_valid_ext($e)) {
            continue;
        }
        $u = framework_check_extension_usage($e);
        if (is_array($u) && count($u) > 0) {
            $exists[$e] = true;
        }
    }
    wpk_out(array('ok' => true, 'exists' => $exists, 'calls' => wpk_active_calls(), 'opus' => wpk_opus_available()));
}

if ($action === 'audit') {
    $list = (isset($in['exts']) && is_array($in['exts'])) ? $in['exts'] : wpk_webphone_exts();
    $res = array();
    foreach (array_slice($list, 0, 600) as $e) {
        $e = (string) $e;
        if (!wpk_valid_ext($e)) {
            continue;
        }
        $d = wpk_diff_ext($e, $profile);
        $res[] = array_merge(array('ext' => $e), $d);
    }
    // anexos con chan_sip y transporte WebSocket (S13)
    $legacy = sql("SELECT DISTINCT s.id FROM sip s JOIN devices d ON d.id=s.id WHERE d.tech='sip' AND s.keyword='transport' AND s.data LIKE '%ws%'", 'getAll', DB_FETCHMODE_ASSOC);
    $leg = array();
    if (is_array($legacy)) {
        foreach ($legacy as $r) {
            $leg[] = (string) $r['id'];
        }
    }
    wpk_out(array('ok' => true, 'anexos' => $res, 'legacy_sip' => $leg, 'opus' => wpk_opus_available(), 'calls' => wpk_active_calls()));
}

// ---------------------------------------------------------------- acciones que cambian datos
$lockfh = wpk_lock_batch();
$batch = date('YmdHis') . '-' . bin2hex(random_bytes(3));
$webExts = wpk_webphone_exts();

if ($action === 'create') {
    $rows = (isset($in['rows']) && is_array($in['rows'])) ? $in['rows'] : array();
    if (count($rows) < 1 || count($rows) > 500) {
        wpk_fail('bad_rows');
    }
    $results = array();
    $created = array();
    foreach ($rows as $r) {
        $line = (is_array($r) && isset($r['line'])) ? (int) $r['line'] : 0;
        $ext = (is_array($r) && isset($r['ext'])) ? (string) $r['ext'] : '';
        $name = (is_array($r) && isset($r['name'])) ? (string) $r['name'] : '';
        $res = array('line' => $line, 'ext' => $ext);
        if (!wpk_valid_ext($ext) || !wpk_valid_name($name)) {
            $res['status'] = 'error';
            $res['code'] = 'invalid';
            $results[] = $res;
            continue;
        }
        $use = framework_check_extension_usage($ext);
        if (is_array($use) && count($use) > 0) {
            $res['status'] = 'skipped';
            $res['code'] = 'ext_exists';
            $results[] = $res;
            continue;
        }
        $secret = bin2hex(random_bytes(12));
        $req = wpk_build_request($ext, $name, $secret, $profile);
        $secret = null;
        $_REQUEST = $req;
        ob_start();
        $ok1 = core_users_add($req);
        $ok2 = ($ok1 !== false) ? core_devices_add($ext, 'pjsip', "PJSIP/$ext", 'fixed', $ext, $name) : false;
        ob_end_clean();
        $req = null;
        $_REQUEST = array();
        if ($ok1 === false || $ok2 === false) {
            if ($ok1 !== false) {
                // revierte lo que si se creo para no dejar un usuario sin dispositivo
                ob_start();
                core_users_del($ext);
                core_users_cleanastdb($ext);
                ob_end_clean();
            }
            $res['status'] = 'error';
            $res['code'] = 'core_failed';
        } else {
            $res['status'] = 'created';
            $created[] = $ext;
        }
        $results[] = $res;
    }
    $applied = false;
    $loaded = array();
    if (count($created) > 0) {
        $applied = wpk_apply_config(true, $batch);
        $loaded = wpk_endpoints_loaded($created);
        wpk_log_line(WPK_BATCH_LOG, 'batch=' . $batch . ' action=create created=' . implode(',', $created));
        foreach ($results as &$x) {
            if ($x['status'] === 'created' && !isset($loaded[$x['ext']])) {
                $x['status'] = 'error';
                $x['code'] = 'not_loaded';
            }
        }
        unset($x);
    }
    wpk_out(array('ok' => true, 'batch' => $batch, 'results' => $results, 'applied' => $applied,
              'retrieve_conf' => count($created) > 0 ? 1 : 0, 'reload_pjsip' => count($created) > 0 ? 1 : 0));
}

if ($action === 'repair') {
    $list = (isset($in['exts']) && is_array($in['exts'])) ? $in['exts'] : array();
    if (count($list) < 1 || count($list) > 500) {
        wpk_fail('bad_rows');
    }
    wpk_state_dir();
    $backup = array('batch' => $batch, 'time' => date('c'), 'items' => array());
    $results = array();
    $done = array();
    foreach ($list as $e) {
        $e = (string) $e;
        $res = array('ext' => $e);
        if (!wpk_valid_ext($e) || !in_array($e, $webExts, true)) {
            $res['status'] = 'skipped';
            $res['code'] = 'not_webphone';
            $results[] = $res;
            continue;
        }
        $dev = core_devices_get($e);
        $usr = core_users_get($e);
        if (!is_array($dev) || !is_array($usr) || count($dev) === 0 || count($usr) === 0 || empty($dev['secret'])) {
            $res['status'] = 'error';
            $res['code'] = 'not_found';
            $results[] = $res;
            continue;
        }
        $d = wpk_diff_ext($e, $profile);
        if (isset($d['changes']) && count($d['changes']) === 0) {
            $res['status'] = 'unchanged';
            $results[] = $res;
            continue;
        }
        $backup['items'][$e] = array('device' => $dev, 'user' => $usr);   // incluye el secreto: archivo 0600
        $name = (string) $usr['name'];
        // users: mismos pasos que el formulario (core_users_edit borra y vuelve a crear con lo que se le pasa)
        $vars = $usr;
        $vars['display'] = 'extensions';
        $vars['extension'] = $e;
        $vars['name'] = $name;
        $vars['callwaiting'] = $profile['callwaiting'] ? 'enabled' : 'disabled';
        if ($profile['outbound_cid'] !== '') {
            $vars['outboundcid'] = $profile['outbound_cid'];
        }
        $rec = wpk_recording_values($profile['recording']);
        foreach ($rec as $k => $v) {
            $vars['recording_' . $k] = 'recording_' . $k . '=' . $v;
        }
        $vars['recording_priority'] = (string) ((int) $usr['recording_priority'] > 0 ? (int) $usr['recording_priority'] : 10);
        $vars['vmcontext'] = (string) $usr['voicemail'];
        foreach (array('noanswer', 'busy', 'chanunavail') as $k) {
            $dest = (string) $usr[$k . '_dest'];
            if ($dest !== '') {
                // core_users_add resuelve el destino con $vars[$vars[nombre]]: se arma la misma indireccion
                $vars[$k . '_dest'] = 'wpk_g_' . $k;
                $vars['wpk_g_' . $k] = 'wpk_g_' . $k . '_v';
                $vars['wpk_g_' . $k . '_v'] = $dest;
            } else {
                $vars[$k . '_dest'] = '';
            }
        }
        // device: se reescribe con los campos del perfil y el MISMO secreto
        $req = wpk_build_request($e, $name, (string) $dev['secret'], $profile, array('outboundcid' => $vars['outboundcid']));
        $req['devinfo_context'] = 'from-internal';
        $_REQUEST = $req;
        ob_start();
        $okU = core_users_edit($e, $vars);
        $okD = false;
        if ($okU) {
            core_devices_del($e, true);
            $okD = core_devices_add($e, 'pjsip', "PJSIP/$e", 'fixed', $e, (string) $dev['description'], isset($dev['emergency_cid']) ? $dev['emergency_cid'] : null, true);
        }
        ob_end_clean();
        $_REQUEST = array();
        $req = null;
        $vars = null;
        if (!$okU || $okD === false) {
            $res['status'] = 'error';
            $res['code'] = 'core_failed';
        } else {
            $res['status'] = 'repaired';
            $res['changes'] = array_map(function ($c) { return $c['f']; }, $d['changes']);
            $done[] = $e;
        }
        $results[] = $res;
    }
    if (count($backup['items']) > 0) {
        $bf = WPK_STATE_DIR . '/backup/repair-' . $batch . '.json';
        $old = umask(0177);
        file_put_contents($bf, json_encode($backup));
        umask($old);
        @chmod($bf, 0600);
    }
    $applied = false;
    if (count($done) > 0) {
        $applied = wpk_apply_config(false, $batch);
        wpk_log_line(WPK_BATCH_LOG, 'batch=' . $batch . ' action=repair repaired=' . implode(',', $done));
    }
    wpk_out(array('ok' => true, 'batch' => $batch, 'results' => $results, 'applied' => $applied,
              'retrieve_conf' => count($done) > 0 ? 1 : 0, 'reload_pjsip' => count($done) > 0 ? 1 : 0));
}

if ($action === 'delete') {
    // Solo linea de comandos y solo anexos que creo este archivo. Nunca por la web.
    $list = (isset($in['exts']) && is_array($in['exts'])) ? $in['exts'] : array();
    if (count($list) < 1 || count($list) > 50) {
        wpk_fail('bad_rows');
    }
    $mine = wpk_created_by_us();
    $removed = array();
    $results = array();
    foreach ($list as $e) {
        $e = (string) $e;
        if (!wpk_valid_ext($e) || !isset($mine[$e])) {
            $results[] = array('ext' => $e, 'status' => 'skipped', 'code' => 'not_created_by_kit');
            continue;
        }
        ob_start();
        core_devices_del($e);
        core_users_del($e);
        core_users_cleanastdb($e);
        ob_end_clean();
        $removed[] = $e;
        $results[] = array('ext' => $e, 'status' => 'deleted');
    }
    $applied = false;
    if (count($removed) > 0) {
        $applied = wpk_apply_config(true, $batch);
        wpk_log_line(WPK_BATCH_LOG, 'batch=' . $batch . ' action=delete deleted=' . implode(',', $removed));
    }
    wpk_out(array('ok' => true, 'batch' => $batch, 'results' => $results, 'applied' => $applied));
}
wpk_fail('bad_action');
