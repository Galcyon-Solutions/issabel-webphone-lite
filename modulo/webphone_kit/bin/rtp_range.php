<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Cambia el rango de puertos de audio (RTP) POR LA VIA DE ISSABELPBX. Solo linea de comandos, como el usuario asterisk, SIN shell:
 * la web lo lanza con proc_open con los argumentos en arreglo y le pasa un JSON por la entrada estandar; responde un JSON por la
 * salida estandar (como bin/provision.php).
 *
 * Por que existe: IssabelPBX escribe rtpstart y rtpend en rtp_additional.conf desde Configuracion de SIP de Asterisk (modulo
 * sipsettings) y Asterisk usa la PRIMERA definicion, asi que un bloque en rtp_custom.conf no tiene efecto. Aqui se usan las funciones
 * propias del modulo (sipsettings_get y sipsettings_edit, las mismas que usa su pantalla) y luego UN retrieve_conf.
 * OJO: sipsettings_edit borra y vuelve a escribir TODAS las filas de la tabla sipsettings (rellena con valores por defecto las que
 * no existian). Por eso la reversa no puede ser "poner los dos valores de antes": se guarda la tabla completa, la fila
 * ALLOW_SIP_ANON de la tabla admin y el hash de cada *_additional.conf y extensions_*.conf, y "undo" los restaura TAL CUAL
 * (incluida la ausencia de filas), regenera y comprueba por hash que todo es identico.
 *
 * Entrada: {"action":"apply","start":10000,"end":10100} | {"action":"undo"} | {"action":"state"}
 * Salida:  {"ok":true,...} o {"ok":false,"error":codigo,...}. Nunca imprime claves (solo nombres y hashes cortos de archivos).
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
ob_start();
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');

const WPK_STATE_DIR = '/var/lib/asterisk/webphone_kit';
const WPK_SNAP = '/var/lib/asterisk/webphone_kit/rtp_range.snap.json';
const WPK_RC = '/var/lib/asterisk/bin/retrieve_conf';

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

$raw = stream_get_contents(STDIN);
$in = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($in) || !isset($in['action']) || !in_array($in['action'], array('apply', 'undo', 'state'), true)) {
    wpk_fail('bad_input');
}
$action = $in['action'];
if ($action === 'apply') {
    // Mismas reglas que el servidor web (WpkRtp): enteros, inicio >= 1, fin mayor que el inicio y hasta 65535
    $st = isset($in['start']) ? $in['start'] : null;
    $en = isset($in['end']) ? $in['end'] : null;
    if (!is_int($st) || !is_int($en) || $st < 1 || $en <= $st || $en > 65535) {
        wpk_fail('bad_range');
    }
}

$bootstrap_settings['freepbx_auth'] = false;
require_once '/etc/issabelpbx.conf';
global $db, $amp_conf;
if (!function_exists('sipsettings_get') || !function_exists('sipsettings_edit') || !is_object($db)) {
    wpk_fail('sipsettings_unavailable');
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
    $st = array('running' => true);
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

/** Hash de cada archivo generado (los *_additional.conf y los extensions_*.conf), por nombre. */
function wpk_hashes()
{
    $files = array_merge((array) glob('/etc/asterisk/*_additional.conf'), (array) glob('/etc/asterisk/extensions_*.conf'));
    $files = array_values(array_unique($files));
    sort($files);
    $h = array();
    foreach ($files as $f) {
        $h[basename($f)] = (string) @hash_file('sha256', $f);
    }
    return $h;
}

function wpk_diff(array $a, array $b)
{
    $out = array();
    foreach (array_unique(array_merge(array_keys($a), array_keys($b))) as $k) {
        if (!isset($a[$k]) || !isset($b[$k]) || $a[$k] !== $b[$k]) {
            $out[] = $k;
        }
    }
    sort($out);
    return $out;
}

function wpk_rows()
{
    $r = sql('SELECT `keyword`, `data`, `seq`, `type` FROM `sipsettings` ORDER BY `type`, `seq`, `keyword`', 'getAll', DB_FETCHMODE_ASSOC);
    return is_array($r) ? $r : array();
}

/** Fila ALLOW_SIP_ANON de la tabla admin (la guarda sipsettings_edit): array(valor) o null si no existe. */
function wpk_anon()
{
    $r = sql("SELECT `value` FROM `admin` WHERE `variable` = 'ALLOW_SIP_ANON'", 'getAll', DB_FETCHMODE_ASSOC);
    return (is_array($r) && count($r) > 0) ? array((string) $r[0]['value']) : null;
}

function wpk_regenerate()
{
    list($rc) = wpk_run_cmd(array(WPK_RC), 180);
    return $rc;
}

function wpk_lock()
{
    if (!is_dir(WPK_STATE_DIR)) {
        @mkdir(WPK_STATE_DIR, 0700, true);
    }
    @chmod(WPK_STATE_DIR, 0700);
    $fh = @fopen(WPK_STATE_DIR . '/rtp_range.lock', 'c');
    if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
        wpk_fail('busy');
    }
    return $fh;
}

function wpk_snapshot_read()
{
    if (!is_file(WPK_SNAP)) {
        return null;
    }
    $j = json_decode((string) file_get_contents(WPK_SNAP), true);
    return is_array($j) && isset($j['rows'], $j['hashes']) ? $j : null;
}

// ---------------------------------------------------------------- acciones
$lock = wpk_lock();

if ($action === 'state') {
    $s = wpk_snapshot_read();
    wpk_out(array('ok' => true, 'applied' => $s !== null));
}

if ($action === 'apply') {
    $snap = wpk_snapshot_read();
    $created = false;
    if ($snap === null) {
        $created = true;
        // Estado previo COMPLETO, antes de tocar nada. Si ya hay uno (ya se aplico antes) se conserva el original.
        $snap = array('v' => 1, 'time' => date('c'), 'rows' => wpk_rows(), 'anon' => wpk_anon(), 'hashes' => wpk_hashes());
        $tmp = WPK_SNAP . '.tmp';
        $old = umask(0177);
        $okw = @file_put_contents($tmp, json_encode($snap, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) !== false && @rename($tmp, WPK_SNAP);
        umask($old);
        if (!$okw) {
            wpk_fail('snapshot_failed');
        }
    }
    $before = wpk_hashes();
    // Se parte de las filas que YA existen (no de sipsettings_get, que rellena con valores por defecto las ausentes y haria que
    // IssabelPBX empezara a escribir lineas nuevas en los otros archivos generados): sipsettings_edit vuelve a escribir solo lo que habia.
    $settings = array('codecs' => array(), 'video_codecs' => array());
    foreach (wpk_rows() as $r) {
        $t = (string) $r['type'];
        if ($t === SIP_CODEC) {
            $settings['codecs'][$r['keyword']] = $r['data'];
        } elseif ($t === SIP_VIDEO_CODEC) {
            $settings['video_codecs'][$r['keyword']] = $r['data'];
        } elseif ($t === SIP_CUSTOM) {
            $settings['sip_custom_key_' . $r['seq']] = $r['keyword'];
            $settings['sip_custom_val_' . $r['seq']] = $r['data'];
        } elseif ($r['keyword'] !== 'rtpstart' && $r['keyword'] !== 'rtpend') {
            $settings[$r['keyword']] = $r['data'];
        }
    }
    $settings['rtpstart'] = (string) $in['start'];
    $settings['rtpend'] = (string) $in['end'];
    $errors = sipsettings_edit($settings);
    if ($errors !== true) {
        // sipsettings_edit no escribio nada: no queda estado previo que restaurar. Se informan los campos que rechazo (solo sus nombres)
        if ($created) {
            @unlink(WPK_SNAP);
        }
        $ids = array();
        if (is_array($errors)) {
            foreach ($errors as $e) {
                if (is_array($e) && isset($e['id'])) {
                    $ids[] = preg_replace('/[^A-Za-z0-9_]/', '', (string) $e['id']);
                }
            }
        }
        wpk_fail('validation', array('fields' => array_slice($ids, 0, 8)));
    }
    $rc = wpk_regenerate();
    $changed = wpk_diff($before, wpk_hashes());
    wpk_out(array('ok' => $rc === 0, 'error' => $rc === 0 ? null : 'retrieve_conf_failed', 'rc' => $rc, 'changed' => $changed,
                  'start' => $in['start'], 'end' => $in['end']));
}

if ($action === 'undo') {
    $snap = wpk_snapshot_read();
    if ($snap === null) {
        wpk_out(array('ok' => true, 'nothing' => true, 'identical' => true, 'changed' => array()));
    }
    $save = array();
    foreach ($snap['rows'] as $r) {
        $save[] = array((string) $r['keyword'], (string) $r['data'], (string) $r['seq'], (string) $r['type']);
    }
    // Se restaura con las mismas piezas del framework que usa sipsettings_edit (sql() y sentencia preparada)
    sql('DELETE FROM `sipsettings` WHERE 1');
    if (count($save) > 0) {
        $compiled = $db->prepare('INSERT INTO `sipsettings` (`keyword`, `data`, `seq`, `type`) VALUES (?,?,?,?)');
        $res = $db->executeMultiple($compiled, $save);
        if (DB::IsError($res)) {
            wpk_fail('restore_failed');
        }
    }
    if ($snap['anon'] === null) {
        sql("DELETE FROM `admin` WHERE `variable` = 'ALLOW_SIP_ANON'");
    } else {
        $compiled = $db->prepare('REPLACE INTO `admin` (`variable`, `value`) VALUES (?,?)');
        $res = $db->executeMultiple($compiled, array(array('ALLOW_SIP_ANON', $snap['anon'][0])));
        if (DB::IsError($res)) {
            wpk_fail('restore_failed');
        }
    }
    $rc = wpk_regenerate();
    $diff = wpk_diff($snap['hashes'], wpk_hashes());
    $same = (count($diff) === 0);
    if ($same && $rc === 0) {
        @unlink(WPK_SNAP);
    }
    wpk_out(array('ok' => $rc === 0 && $same, 'error' => $rc !== 0 ? 'retrieve_conf_failed' : ($same ? null : 'not_identical'),
                  'rc' => $rc, 'identical' => $same, 'changed' => $diff));
}
