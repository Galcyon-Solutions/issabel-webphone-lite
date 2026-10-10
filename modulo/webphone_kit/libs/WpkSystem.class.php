<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Acceso del modulo al sistema, siempre SIN shell (proc_open con los argumentos en arreglo):
 *   - Asterisk por "asterisk -rx" (el usuario asterisk ya tiene el socket de control).
 *   - Bloques BEGIN/END en los *_custom.conf (lista cerrada de archivos), con respaldo previo.
 *   - Helper root por "sudo -n /usr/sbin/issabel-helper webphone_kit <verbo>" (verbos FIJOS, sin argumentos libres).
 *   - Provisionador bin/provision.php (JSON por la entrada estandar, JSON por la salida, como el usuario asterisk).
 * Nada de lo que pasa por aqui imprime claves: el JSON del provisionador nunca las trae.
 */
class WpkSystem
{
    const ASTERISK  = '/usr/sbin/asterisk';
    const SUDO      = '/usr/bin/sudo';
    const HELPER_BIN = '/usr/sbin/issabel-helper';
    const PHP       = '/usr/bin/php';
    const STATE_DIR = '/var/lib/asterisk/webphone_kit';
    const ETC       = '/etc/asterisk';

    /** Verbos del helper root. Cualquier otro se rechaza antes de ejecutar nada. */
    static $HELPER_VERBS = array('status', 'install_ws', 'remove_ws');
    /** Archivos *_custom.conf donde el modulo puede escribir su bloque (lista cerrada). */
    static $CUSTOM_FILES = array('http_custom.conf', 'rtp_custom.conf', 'pjsip_custom.conf', 'sip_general_custom.conf');

    /**
     * Ejecuta un programa sin shell. Devuelve array(codigo, stdout). La salida se acota a 256 KB y el tiempo a $timeout s.
     */
    static function run(array $argv, $stdin = null, $timeout = 30)
    {
        $env = array('PATH' => '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG' => 'C', 'HOME' => '/var/lib/asterisk');
        $p = @proc_open($argv, array(0 => array('pipe', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes, '/tmp', $env);
        if (!is_resource($p)) {
            return array(-1, '');
        }
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        if ($stdin !== null) {
            @fwrite($pipes[0], $stdin);
        }
        @fclose($pipes[0]);
        $out = '';
        $t0 = microtime(true);
        $code = -1;
        while (true) {
            $st = proc_get_status($p);
            $chunk = stream_get_contents($pipes[1]);
            if ($chunk !== false && $chunk !== '') {
                $out .= $chunk;
            }
            stream_get_contents($pipes[2]);
            if (!$st['running']) {
                $code = $st['exitcode'];
                break;
            }
            if (strlen($out) > 262144 || (microtime(true) - $t0) > $timeout) {
                proc_terminate($p, 9);
                break;
            }
            usleep(30000);
        }
        $chunk = stream_get_contents($pipes[1]);
        if ($chunk !== false) {
            $out .= $chunk;
        }
        fclose($pipes[1]);
        fclose($pipes[2]);
        $rc = proc_close($p);
        if ($code === -1 && $rc !== -1) {
            $code = $rc;
        }
        return array($code, substr($out, 0, 262144));
    }

    static function asterisk($cmd)
    {
        list(, $o) = self::run(array(self::ASTERISK, '-rx', $cmd), null, 30);
        return $o;
    }

    static function activeCalls()
    {
        $o = self::asterisk('core show channels count');
        return preg_match('/(\d+) active call/', $o, $m) ? (int) $m[1] : -1;
    }

    // ------------------------------------------------------------------ helper root

    /** @return array('ok'=>bool,'code'=>int,'kv'=>array,'present'=>bool) */
    static function helper($verb)
    {
        if (!in_array($verb, self::$HELPER_VERBS, true)) {
            return array('ok' => false, 'code' => 2, 'kv' => array('error' => 'unknown_verb'), 'present' => false);
        }
        list($code, $out) = self::run(array(self::SUDO, '-n', self::HELPER_BIN, 'webphone_kit', $verb), null, 60);
        $kv = array();
        foreach (preg_split('/\r?\n/', $out) as $l) {
            if (preg_match('/^([a-z_0-9]{1,40})=([A-Za-z0-9_.\-]{0,80})$/', $l, $m)) {
                $kv[$m[1]] = $m[2];
            }
        }
        // "Helper program does not exist!" de issabel-helper sale por stderr y con codigo 1 sin pares clave=valor
        $present = isset($kv['helper']) || isset($kv['result']) || isset($kv['error']);
        return array('ok' => $code === 0, 'code' => $code, 'kv' => $kv, 'present' => $present);
    }

    // ------------------------------------------------------------------ provisionador

    /** Lanza bin/provision.php. Devuelve el JSON decodificado o array('ok'=>false,'error'=>...). */
    static function provision(array $input, $timeout = 240)
    {
        $script = dirname(__DIR__) . '/bin/provision.php';
        $json = json_encode($input, JSON_UNESCAPED_UNICODE);
        list($code, $out) = self::run(array(self::PHP, '-d', 'display_errors=0', '-d', 'html_errors=0', $script), $json, $timeout);
        $r = json_decode($out, true);
        if (!is_array($r)) {
            error_log('webphone_kit: el provisionador no devolvio JSON (codigo ' . (int) $code . ')');
            return array('ok' => false, 'error' => 'provision_failed');
        }
        return $r;
    }

    /**
     * Lanza bin/rtp_range.php (cambio del rango de audio por la via de IssabelPBX: sipsettings + un retrieve_conf).
     * JSON por la entrada estandar, JSON por la salida, como el usuario asterisk y sin shell.
     */
    static function rtpTool(array $input, $timeout = 240)
    {
        $script = dirname(__DIR__) . '/bin/rtp_range.php';
        list($code, $out) = self::run(array(self::PHP, '-d', 'display_errors=0', '-d', 'html_errors=0', $script), json_encode($input), $timeout);
        $r = json_decode($out, true);
        if (!is_array($r)) {
            error_log('webphone_kit: rtp_range.php no devolvio JSON (codigo ' . (int) $code . ')');
            return array('ok' => false, 'error' => 'rtp_tool_failed');
        }
        return $r;
    }

    // ------------------------------------------------------------------ bloques *_custom.conf

    private static function customPath($file)
    {
        if (!in_array($file, self::$CUSTOM_FILES, true)) {
            return null;
        }
        return self::ETC . '/' . $file;
    }

    private static function marks($id)
    {
        return array('; BEGIN webphone_kit:' . $id, '; END webphone_kit:' . $id);
    }

    /** Contenido (sin marcas) del bloque, o null si no existe. */
    static function blockRead($file, $id)
    {
        $path = self::customPath($file);
        if ($path === null || !is_readable($path) || preg_match('/^[a-z0-9-]{1,30}$/', $id) !== 1) {
            return null;
        }
        list($b, $e) = self::marks($id);
        $txt = (string) file_get_contents($path);
        $i = strpos($txt, $b);
        $j = strpos($txt, $e);
        if ($i === false || $j === false || $j < $i) {
            return null;
        }
        return trim(substr($txt, $i + strlen($b), $j - $i - strlen($b)));
    }

    private static function backup($path)
    {
        $dir = self::STATE_DIR . '/backup';
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        $dst = $dir . '/' . basename($path) . '.' . date('Ymd-His');
        return @copy($path, $dst) ? $dst : null;
    }

    /** Escribe o reemplaza el bloque. Respalda antes. Devuelve true o un codigo de error. */
    static function blockWrite($file, $id, $content)
    {
        $path = self::customPath($file);
        if ($path === null || preg_match('/^[a-z0-9-]{1,30}$/', $id) !== 1 || !is_file($path) || !is_writable($path)) {
            return 'not_writable';
        }
        if (preg_match('/^[\x20-\x7E\n]*$/', $content) !== 1) {
            return 'bad_content';
        }
        list($b, $e) = self::marks($id);
        $fh = fopen($path, 'c+');
        if (!$fh || !flock($fh, LOCK_EX)) {
            return 'lock';
        }
        $txt = stream_get_contents($fh);
        self::backup($path);
        $block = $b . "\n" . rtrim($content) . "\n" . $e . "\n";
        $i = strpos($txt, $b);
        $j = strpos($txt, $e);
        if ($i !== false && $j !== false && $j > $i) {
            $k = $j + strlen($e);
            if (isset($txt[$k]) && $txt[$k] === "\n") {
                $k++;
            }
            $new = substr($txt, 0, $i) . $block . substr($txt, $k);
        } else {
            $new = $txt . ($txt !== '' && substr($txt, -1) !== "\n" ? "\n" : '') . $block;
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $new);
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
        return true;
    }

    /** Contenido exacto de un *_custom.conf (lista cerrada) o null. Para poder devolverlo byte a byte si un cambio no se confirma. */
    static function fileSnapshot($file)
    {
        $path = self::customPath($file);
        if ($path === null || !is_file($path) || !is_readable($path)) {
            return null;
        }
        $c = file_get_contents($path);
        return $c === false ? null : $c;
    }

    /** Devuelve el archivo a un contenido guardado con fileSnapshot. true si quedo igual, o un codigo de error. */
    static function fileRestore($file, $content)
    {
        $path = self::customPath($file);
        if ($path === null || !is_string($content) || !is_file($path) || !is_writable($path)) {
            return 'not_writable';
        }
        $fh = fopen($path, 'c+');
        if (!$fh || !flock($fh, LOCK_EX)) {
            return 'lock';
        }
        $cur = stream_get_contents($fh);
        if ($cur !== $content) {
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, $content);
            fflush($fh);
        }
        flock($fh, LOCK_UN);
        fclose($fh);
        return true;
    }

    /** Quita el bloque (solo el nuestro). true si lo quito o no existia. */
    static function blockRemove($file, $id)
    {
        $path = self::customPath($file);
        if ($path === null || preg_match('/^[a-z0-9-]{1,30}$/', $id) !== 1 || !is_file($path) || !is_writable($path)) {
            return 'not_writable';
        }
        list($b, $e) = self::marks($id);
        $fh = fopen($path, 'c+');
        if (!$fh || !flock($fh, LOCK_EX)) {
            return 'lock';
        }
        $txt = stream_get_contents($fh);
        $i = strpos($txt, $b);
        $j = strpos($txt, $e);
        if ($i === false || $j === false || $j < $i) {
            flock($fh, LOCK_UN);
            fclose($fh);
            return true;
        }
        self::backup($path);
        $k = $j + strlen($e);
        if (isset($txt[$k]) && $txt[$k] === "\n") {
            $k++;
        }
        $new = substr($txt, 0, $i) . substr($txt, $k);
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $new);
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
        return true;
    }

    // ------------------------------------------------------------------ red

    /** IPv4 privada, de enlace local, CGNAT o loopback (FILTER_FLAG_NO_PRIV_RANGE no cubre CGNAT ni enlace local). */
    static function isPrivateIp($ip)
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            $l = strtolower($ip);
            return $l === '::1' || strpos($l, 'fe80:') === 0 || strpos($l, 'fc') === 0 || strpos($l, 'fd') === 0;
        }
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return false;
        }
        $n = ip2long($ip);
        $nets = array(array('10.0.0.0', 8), array('172.16.0.0', 12), array('192.168.0.0', 16), array('100.64.0.0', 10),
                      array('169.254.0.0', 16), array('127.0.0.0', 8), array('0.0.0.0', 8));
        foreach ($nets as $net) {
            $mask = -1 << (32 - $net[1]);
            if (($n & $mask) === (ip2long($net[0]) & $mask)) {
                return true;
            }
        }
        return false;
    }

    /** IPv4 de las interfaces del servidor (sin loopback). */
    static function serverIps()
    {
        $ips = array();
        if (function_exists('net_get_interfaces')) {
            $ifs = @net_get_interfaces();
            if (is_array($ifs)) {
                foreach ($ifs as $name => $info) {
                    if (empty($info['unicast']) || $name === 'lo') {
                        continue;
                    }
                    foreach ($info['unicast'] as $u) {
                        if (isset($u['address']) && filter_var($u['address'], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                            $ips[] = $u['address'];
                        }
                    }
                }
            }
        }
        return $ips;
    }
}
