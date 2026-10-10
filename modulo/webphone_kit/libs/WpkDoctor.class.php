<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Doctor del servidor (comprobaciones S1 a S14 de la guia) y deteccion de la conexion segura. PHP como el usuario
 * asterisk, SOLO LECTURA: sockets a 127.0.0.1, "asterisk -rx" de consulta y el verbo "status" del helper root.
 * Nunca lee claves privadas (del certificado del 443 solo se lee la parte publica que el servidor ya entrega).
 * Cada comprobacion devuelve un nivel (ok, warn, bad o skip), un codigo corto y parametros escalares: los textos
 * humanos viven en el cliente (es, en y pt-BR). El campo "fix" dice como se resuelve y de que tipo es:
 *   auto  lo resuelve el modulo solo (bloque BEGIN/END en un *_custom.conf, o un verbo del helper root)
 *   le    lleva al modulo sec_letsencrypt de Issabel
 *   ext   lleva a la edicion de la extension en IssabelPBX
 *   cmd   un comando para root, con su reversa
 *   ca    guia para instalar una CA local
 *   link  enlace a otra pantalla de Issabel
 */
class WpkDoctor
{
    const CA_BUNDLE = '/etc/pki/tls/certs/ca-bundle.crt';

    private $c;          // contexto
    private $checks = array();
    private $audit = null;
    private $helper = null;
    private $ssl = null;

    /** $ctx: host, ws_path, usage (inside|outside|both), client_ms (hora del navegador), stun (cadena), profile, webphone_exts, users_enabled (mapa user=>ext). */
    function __construct(array $ctx)
    {
        $this->c = $ctx;
    }

    private function add($id, $level, $code, $critical, array $p = array(), $fix = null)
    {
        $this->checks[] = array('id' => $id, 'scope' => 'server', 'level' => $level, 'code' => $code, 'critical' => $critical, 'p' => $p, 'fix' => $fix);
    }

    private static function auto($id, array $extra = array())
    {
        return array_merge(array('kind' => 'auto', 'id' => $id), $extra);
    }

    // ------------------------------------------------------------------ utilidades de red

    /** Conexion TLS al 443 local. Devuelve array(recurso, certificado parseado|null, error). */
    private function tls($verify)
    {
        $host = $this->c['host'];
        $opts = array('ssl' => array('capture_peer_cert' => true, 'verify_peer' => $verify, 'verify_peer_name' => $verify,
                                     'peer_name' => $host, 'SNI_enabled' => true, 'SNI_server_name' => $host, 'allow_self_signed' => false));
        if ($verify) {
            $opts['ssl']['cafile'] = self::CA_BUNDLE;
        }
        $fp = @stream_socket_client('ssl://127.0.0.1:443', $errno, $errstr, 5, STREAM_CLIENT_CONNECT, stream_context_create($opts));
        if (!$fp) {
            return array(null, null, $errno);
        }
        $params = stream_context_get_params($fp);
        $cert = null;
        if (isset($params['options']['ssl']['peer_certificate'])) {
            $cert = @openssl_x509_parse($params['options']['ssl']['peer_certificate']);
        }
        return array($fp, is_array($cert) ? $cert : null, 0);
    }

    private static function sanList(array $cert)
    {
        $san = isset($cert['extensions']['subjectAltName']) ? (string) $cert['extensions']['subjectAltName'] : '';
        $out = array('dns' => array(), 'ip' => array());
        foreach (explode(',', $san) as $part) {
            $part = trim($part);
            if (strpos($part, 'DNS:') === 0) {
                $out['dns'][] = strtolower(substr($part, 4));
            } elseif (strpos($part, 'IP Address:') === 0) {
                $out['ip'][] = strtolower(substr($part, 11));
            }
        }
        return $out;
    }

    private static function sanCovers(array $san, $host)
    {
        $host = strtolower($host);
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return in_array($host, $san['ip'], true);
        }
        foreach ($san['dns'] as $d) {
            if ($d === $host) {
                return true;
            }
            if (strpos($d, '*.') === 0 && substr_count($host, '.') === substr_count($d, '.')
                && substr($host, strpos($host, '.')) === substr($d, 1)) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ deteccion de la conexion segura

    /** Datos del certificado del 443 y del acceso actual. Se calcula una vez. */
    function ssl()
    {
        if ($this->ssl !== null) {
            return $this->ssl;
        }
        $host = $this->c['host'];
        $isIp = filter_var($host, FILTER_VALIDATE_IP) !== false;
        $s = array('host' => $host, 'host_kind' => $isIp ? 'ip' : 'name', 'tls' => false, 'class' => 'none', 'days' => null,
                   'san_ok' => false, 'issuer' => '', 'san' => array(), 'server_ips' => WpkSystem::serverIps(), 'port80' => false,
                   'resolves' => null, 'resolved_private' => null, 'public_name' => false, 'case' => 'b', 'ip_private' => null);
        list($fp, $cert) = $this->tls(false);
        if ($fp) {
            $s['tls'] = true;
            fclose($fp);
        }
        if ($cert) {
            $s['days'] = (int) floor(($cert['validTo_time_t'] - time()) / 86400);
            $s['issuer'] = isset($cert['issuer']['CN']) ? mb_substr((string) $cert['issuer']['CN'], 0, 60, 'UTF-8') : '';
            $san = self::sanList($cert);
            $s['san'] = array_slice(array_merge($san['dns'], $san['ip']), 0, 8);
            $s['san_ok'] = self::sanCovers($san, $host);
            $selfSigned = (isset($cert['subject']) && isset($cert['issuer']) && $cert['subject'] === $cert['issuer']);
            list($fp2) = $this->tls(true);
            if ($fp2) {
                fclose($fp2);
                $s['class'] = 'public';
            } else {
                $s['class'] = $selfSigned ? 'self' : 'local';
            }
        }
        $f = @fsockopen('127.0.0.1', 80, $en, $es, 2);
        if ($f) {
            $s['port80'] = true;
            fclose($f);
        }
        if ($isIp) {
            $s['ip_private'] = WpkSystem::isPrivateIp($host);
            $s['case'] = $s['ip_private'] ? 'b' : 'a';
        } else {
            $ip = gethostbyname($host);
            $s['resolves'] = ($ip !== $host && filter_var($ip, FILTER_VALIDATE_IP) !== false);
            $s['resolved_private'] = $s['resolves'] ? WpkSystem::isPrivateIp($ip) : null;
            $s['public_name'] = (strpos($host, '.') !== false)
                && preg_match('/\.(local|localdomain|lan|internal|home|corp|intranet)$/i', $host) !== 1;
            $s['case'] = ($s['public_name'] && $s['resolves'] && !$s['resolved_private']) ? 'd' : 'c';
        }
        $this->ssl = $s;
        return $s;
    }

    // ------------------------------------------------------------------ lectura de Asterisk

    private function helperStatus()
    {
        if ($this->helper === null) {
            $this->helper = WpkSystem::helper('status');
        }
        return $this->helper;
    }

    private function audit()
    {
        if ($this->audit === null) {
            $this->audit = WpkSystem::provision(array('action' => 'audit', 'profile' => $this->c['profile']), 90);
        }
        return $this->audit;
    }

    private static function pjsipField($txt, $key)
    {
        // [ \t] y no \s: con \s el valor vacio se tragaria la linea siguiente
        return preg_match('/^[ \t]*' . preg_quote($key, '/') . '[ \t]*:[ \t]*(.*)$/m', $txt, $m) ? trim($m[1]) : '';
    }

    // ------------------------------------------------------------------ ejecucion

    function run()
    {
        $this->s1();
        $this->s2();
        $this->s3();
        $this->s4();
        $this->s5();
        $this->s6();
        $this->s7();
        $this->s8();
        $this->s9();
        $this->s10_s11_s13();
        $this->s12();
        $this->s14();
        $this->s15();
        usort($this->checks, function ($a, $b) {
            return (int) substr($a['id'], 1) - (int) substr($b['id'], 1);
        });
        return array('checks' => $this->checks, 'ssl' => $this->ssl(), 'ssl_fix' => $this->sslFix($this->ssl()), 'calls' => WpkSystem::activeCalls(),
                     'helper' => array('present' => $this->helperStatus()['present'], 'kv' => $this->helperStatus()['kv']));
    }

    private function s1()
    {
        $s = $this->ssl();
        if ($s['tls']) {
            $this->add('S1', 'ok', 'ok', true);
        } else {
            $this->add('S1', 'bad', 'notls', true, array(), array('kind' => 'cmd',
                'cmd' => "dnf install -y mod_ssl && httpd -t && systemctl reload httpd",
                'undo' => 'dnf remove -y mod_ssl && systemctl reload httpd'));
        }
    }

    private function s2()
    {
        $s = $this->ssl();
        if (!$s['tls'] || $s['days'] === null) {
            $this->add('S2', 'skip', 'nocert', false);
            return;
        }
        $p = array('days' => $s['days'], 'issuer' => $s['issuer'], 'class' => $s['class'], 'host' => $s['host']);
        if ($s['days'] < 0) {
            $this->add('S2', 'bad', 'expired', true, $p, $this->sslFix($s));
        } elseif (!$s['san_ok']) {
            $this->add('S2', 'warn', 'san', false, $p, $this->sslFix($s));
        } elseif ($s['days'] < 30) {
            $this->add('S2', 'warn', 'soon', false, $p, $this->sslFix($s));
        } elseif ($s['class'] === 'self') {
            $this->add('S2', 'warn', 'self', false, $p, $this->sslFix($s));
        } else {
            $this->add('S2', 'ok', $s['class'] === 'public' ? 'public' : 'local', false, $p);
        }
    }

    /** Resolver de la conexion segura segun el caso (a, b, c o d). */
    function sslFix(array $s)
    {
        switch ($s['case']) {
            case 'd':
                return $s['port80']
                    ? array('kind' => 'le', 'url' => 'index.php?menu=sec_letsencrypt', 'host' => $s['host'])
                    : array('kind' => 'cmd', 'cmd' => 'certbot certonly --standalone -d ' . $this->safeHost($s['host']), 'undo' => 'certbot delete --cert-name ' . $this->safeHost($s['host']));
            case 'a':
                return array('kind' => 'cmd',
                    'cmd' => 'certbot certonly --preferred-profile shortlived --webroot --webroot-path /var/www/html --ip-address ' . $this->safeHost($s['host']),
                    'undo' => 'certbot delete --cert-name ' . $this->safeHost($s['host']), 'needs' => 'certbot>=5.4');
            case 'c':
                return array('kind' => 'cmd',
                    'cmd' => 'certbot certonly --manual --preferred-challenges dns -d ' . $this->safeHost($s['host']),
                    'undo' => 'certbot delete --cert-name ' . $this->safeHost($s['host']), 'alt' => 'ca');
            default:
                return array('kind' => 'ca');
        }
    }

    private function safeHost($h)
    {
        return preg_match('/^[A-Za-z0-9.:-]{1,253}$/', $h) === 1 ? $h : 'HOST';
    }

    private function s3()
    {
        $need = array('res_pjsip_transport_websocket' => true, 'res_http_websocket' => true, 'res_srtp' => true, 'res_crypto' => true, 'codec_opus' => false);
        $missing = array();
        $opus = true;
        foreach ($need as $mod => $crit) {
            $o = WpkSystem::asterisk('module show like ' . $mod);
            $running = preg_match('/^' . preg_quote($mod, '/') . '\.so\s.*\bRunning\b/m', $o) === 1;
            if (!$running) {
                if ($crit) {
                    $missing[] = $mod;
                } else {
                    $opus = false;
                }
            }
        }
        if (count($missing) > 0) {
            $this->add('S3', 'bad', 'missing', true, array('mods' => implode(',', $missing)),
                self::auto('module_load', array('mod' => $missing[0], 'persist_note' => true)));
        } elseif (!$opus) {
            $this->add('S3', 'warn', 'noopus', false, array(), self::auto('module_load', array('mod' => 'codec_opus')));
        } else {
            $this->add('S3', 'ok', 'ok', true);
        }
    }

    private function s4()
    {
        $o = WpkSystem::asterisk('pjsip show transports');
        if (preg_match('/^\s*Transport:\s+transport-wss\s/m', $o)) {
            $this->add('S4', 'ok', 'ok', true);
        } else {
            $this->add('S4', 'bad', 'notransport', true, array(), array('kind' => 'link', 'url' => 'index.php?menu=pbxadmin', 'label' => 'pjsip'));
        }
    }

    private function wsUpgrade()
    {
        $host = $this->c['host'];
        $path = $this->c['ws_path'];
        $opts = array('ssl' => array('verify_peer' => false, 'verify_peer_name' => false, 'peer_name' => $host, 'SNI_enabled' => true, 'SNI_server_name' => $host));
        $fp = @stream_socket_client('ssl://127.0.0.1:443', $en, $es, 5, STREAM_CLIENT_CONNECT, stream_context_create($opts));
        if (!$fp) {
            return 0;
        }
        stream_set_timeout($fp, 5);
        $key = base64_encode(random_bytes(16));
        $req = "GET $path HTTP/1.1\r\nHost: $host\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: $key\r\n"
             . "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: sip\r\nOrigin: https://$host\r\n\r\n";
        fwrite($fp, $req);
        $line = (string) fgets($fp, 256);
        fclose($fp);
        return preg_match('#^HTTP/1\.[01] (\d{3})#', $line, $m) ? (int) $m[1] : 0;
    }

    private function s5()
    {
        $code = $this->wsUpgrade();
        if ($code === 101) {
            $this->add('S5', 'ok', 'ok', true, array('path' => $this->c['ws_path']));
            return;
        }
        $h = $this->helperStatus();
        $fix = null;
        $hc = isset($h['kv']['apache_conf']) ? $h['kv']['apache_conf'] : '';
        if ($this->c['ws_path'] === '/kit-ws' && $h['present'] && $hc === 'absent') {
            $fix = self::auto('ws_install', array('undo_id' => 'ws_remove'));
        } elseif ($this->c['ws_path'] === '/kit-ws' && !$h['present']) {
            $fix = array('kind' => 'cmd', 'cmd' => 'bash /usr/share/webphone_kit/install.sh --helper', 'undo' => 'bash /usr/share/webphone_kit/install.sh --helper-quitar', 'needs' => 'helper');
        } else {
            $fix = array('kind' => 'cmd', 'cmd' => 'httpd -t && apachectl graceful', 'undo' => '', 'needs' => 'proxy');
        }
        $this->add('S5', 'bad', $code === 0 ? 'noconn' : 'http' . $code, true, array('status' => $code, 'path' => $this->c['ws_path'],
            'helper' => $h['present'] ? 'yes' : 'no', 'apache_conf' => $hc), $fix);
    }

    private function s6()
    {
        $o = WpkSystem::asterisk('http show status');
        $b8088 = preg_match('/Server Enabled and Bound to\s+(\S+):8088/', $o, $m) ? $m[1] : '';
        $b8089 = preg_match('/HTTPS Server Enabled and Bound to\s+(\S+):8089/', $o, $m2) ? $m2[1] : '';
        $loop = array('127.0.0.1', '::1', 'localhost');
        $p = array('b8088' => $b8088, 'b8089' => $b8089);
        $fix = self::auto('http_loopback', array('undo_id' => 'http_loopback_undo', 'needs_calls' => true));
        if ($b8088 === '') {
            $this->add('S6', 'skip', 'off', false, $p);
        } elseif (!in_array($b8088, $loop, true)) {
            $this->add('S6', 'bad', 'exposed', false, $p, $fix);
        } elseif ($b8089 !== '' && !in_array($b8089, $loop, true)) {
            $this->add('S6', 'warn', 'tls_public', false, $p, $fix);
        } else {
            $this->add('S6', 'ok', 'ok', false, $p);
        }
    }

    /**
     * S7: audio (RTP) e ICE. Con ICE apagado es "bad". Si no, el rango efectivo (rtp show settings) se juzga contra las
     * llamadas esperadas (ctx expected_calls, por defecto 10): muy amplio o insuficiente es "warn" con el Resolver rtp_range
     * (formula en WpkRtp), y el resto "ok". Los puertos UDP exactos que debe abrir el firewall van en los parametros.
     */
    private function s7()
    {
        $o = WpkSystem::asterisk('rtp show settings');
        list($start, $end) = WpkRtp::parseSettings($o);
        $ice = preg_match('/ICE support:\s+(\w+)/', $o, $m) ? strtolower($m[1]) === 'yes' : false;
        $calls = isset($this->c['expected_calls']) ? WpkRtp::parseCalls($this->c['expected_calls']) : null;
        if ($calls === null) {
            $calls = WpkRtp::DEFAULT_CALLS;
        }
        $ports = WpkRtp::ports($calls);
        $p = array('start' => $start, 'end' => $end, 'calls' => $calls, 'ports' => $ports, 'rec_end' => $start + $ports,
                   'docker' => WpkRtp::inDocker() ? 'yes' : 'no',
                   'custom' => WpkSystem::blockRead('rtp_custom.conf', 'rtp-range') !== null ? 'yes' : 'no',
                   'source' => WpkRtp::definedByPbx() ? 'issabelpbx' : 'custom',
                   'priv' => !empty($this->c['can_sip']) ? 'yes' : 'no', 'applied' => WpkRtp::applied() ? 'yes' : 'no');
        // Si IssabelPBX define el rango, el Resolver lo cambia ALLI (sipsettings + retrieve_conf) con el privilegio de esa pantalla;
        // sin el privilegio solo se guia a la pantalla. Si no lo define, un bloque en rtp_custom.conf.
        $fix = ($p['source'] === 'issabelpbx' && $p['priv'] === 'no')
            ? array('kind' => 'link', 'label' => 'rtpsip', 'url' => '/admin/config.php?type=setup&display=sipsettings', 'rtp' => true,
                    'calls' => $calls, 'start' => $start, 'rec_end' => $start + $ports)
            : self::auto('rtp_range', array('undo_id' => 'rtp_range_undo', 'needs_input' => 'calls', 'needs_calls' => true,
                                             'calls' => $calls, 'start' => $start, 'rec_end' => $start + $ports,
                                             'via' => $p['source'] === 'issabelpbx' ? 'pbx' : 'block'));
        if (!$ice) {
            $this->add('S7', 'bad', 'noice', false, $p, self::auto('rtp_ice', array('undo_id' => 'rtp_ice_undo')));
        } elseif ($start < 1 || $end <= $start) {
            $this->add('S7', 'bad', 'unreadable', false, $p);
        } else {
            $j = WpkRtp::judge($start, $end, $calls);
            if ($j === 'ok') {
                // Aplicado por este asistente: queda el Deshacer a la vista
                $this->add('S7', 'ok', 'ok', false, $p, ($p['applied'] === 'yes' || $p['custom'] === 'yes') ? self::auto('rtp_range_undo', array('undo' => true)) : null);
            } else {
                $this->add('S7', 'warn', $j, false, $p, $fix);
            }
        }
    }

    private function s8()
    {
        $usage = $this->c['usage'];
        $o = WpkSystem::asterisk('pjsip show transport transport-wss');
        $ext = self::pjsipField($o, 'external_media_address');
        $localNet = self::pjsipField($o, 'local_net');
        $priv = false;
        foreach (WpkSystem::serverIps() as $ip) {
            if (WpkSystem::isPrivateIp($ip)) {
                $priv = true;
            }
        }
        $p = array('external' => $ext, 'local_net' => $localNet, 'private' => $priv ? 'yes' : 'no', 'usage' => $usage);
        if ($usage === 'inside') {
            $this->add('S8', 'ok', 'inside', false, $p);
        } elseif ($ext !== '') {
            $this->add('S8', 'ok', 'set', false, $p, self::auto('external_addr_undo', array('undo' => true)));
        } elseif (!$priv) {
            $this->add('S8', 'ok', 'public', false, $p);
        } else {
            $this->add('S8', 'warn', 'needed', false, $p, self::auto('external_addr', array('needs_input' => 'ip', 'undo_id' => 'external_addr_undo', 'needs_calls' => true)));
        }
    }

    private function s9()
    {
        $usage = $this->c['usage'];
        $stun = trim((string) $this->c['stun']);
        $o = WpkSystem::asterisk('rtp show settings');
        $srvStun = preg_match('/STUN address:\s+(\S+)/', $o, $m) ? $m[1] : '';
        $hasStun = $stun !== '' || ($srvStun !== '' && $srvStun !== '0.0.0.0:0');
        $p = array('stun' => $hasStun ? 'yes' : 'no', 'usage' => $usage);
        if ($usage === 'inside') {
            $this->add('S9', 'ok', 'inside', false, $p);
        } elseif (!$hasStun) {
            $this->add('S9', 'warn', 'nostun', false, $p, self::auto('stun_default', array('undo_id' => 'stun_default_undo', 'consent' => 'external_service')));
        } else {
            // TURN no se puede detectar de forma fiable desde aqui: se avisa siempre que haya usuarios de afuera
            $this->add('S9', 'warn', 'noturn', false, $p);
        }
    }

    private function s10_s11_s13()
    {
        $a = $this->audit();
        if (empty($a['ok'])) {
            $this->add('S10', 'skip', 'unavailable', false);
            $this->add('S11', 'skip', 'unavailable', false);
            $this->add('S13', 'skip', 'unavailable', false);
            return;
        }
        $anexos = isset($a['anexos']) ? $a['anexos'] : array();
        // S10: codecs
        $badCodec = array();
        $needRepair = array();
        foreach ($anexos as $x) {
            if (isset($x['changes'])) {
                foreach ($x['changes'] as $ch) {
                    if ($ch['f'] === 'allow' && stripos($ch['from'], 'opus') === false && stripos($ch['from'], 'ulaw') === false) {
                        $badCodec[] = $x['ext'];
                    }
                }
                if (count($x['changes']) > 0) {
                    $needRepair[] = $x['ext'];
                }
            }
        }
        if (count($anexos) === 0) {
            $this->add('S10', 'skip', 'noanexos', false);
        } elseif (count($badCodec) > 0) {
            $this->add('S10', 'bad', 'nocodec', false, array('exts' => implode(',', array_slice($badCodec, 0, 10))),
                self::auto('repair', array('exts' => array_slice($badCodec, 0, 100))));
        } else {
            $this->add('S10', 'ok', 'ok', false);
        }
        // S11: anexos webphone completos, y usuarios activados cuya extension NO es de tipo webphone
        $webSet = array_flip($this->c['webphone_exts']);
        $notWeb = array();
        foreach ($this->c['users_enabled'] as $u => $e) {
            if (!isset($webSet[$e])) {
                $notWeb[$u] = $e;
            }
        }
        if (count($notWeb) > 0) {
            $first = array_values($notWeb);
            $this->add('S11', 'warn', 'notweb', false, array('ext' => $first[0], 'count' => count($notWeb)),
                array('kind' => 'ext', 'ext' => $first[0], 'url' => '/admin/config.php?type=setup&display=extensions&extdisplay=' . rawurlencode($first[0])));
        } elseif (count($anexos) === 0) {
            $this->add('S11', 'warn', 'none', false);
        } elseif (count($needRepair) > 0) {
            $this->add('S11', 'warn', 'repair', false, array('count' => count($needRepair), 'exts' => implode(',', array_slice($needRepair, 0, 10))),
                self::auto('repair', array('exts' => array_slice($needRepair, 0, 200), 'preview' => true)));
        } else {
            $this->add('S11', 'ok', 'ok', false, array('count' => count($anexos)));
        }
        // S13: anexos WebRTC con chan_sip
        $leg = isset($a['legacy_sip']) ? $a['legacy_sip'] : array();
        if (count($leg) > 0) {
            $this->add('S13', 'bad', 'chansip', true, array('ext' => $leg[0], 'count' => count($leg)),
                array('kind' => 'ext', 'ext' => $leg[0], 'url' => '/admin/config.php?type=setup&display=extensions&extdisplay=' . rawurlencode($leg[0])));
        } else {
            $this->add('S13', 'ok', 'ok', true);
        }
    }

    /**
     * S15: chan_sip (el SIP antiguo) tambien se ofrece como dueno del WebSocket "sip" (sip.conf: websocket_enabled, por omision
     * si). Cuando esta cargado y no lo apaga nadie, atiende los REGISTER del navegador con su propia configuracion y el
     * anexo PJSIP responde "Wrong password" aunque la clave sea correcta. Se lee solo configuracion: nada se ejecuta.
     */
    private function s15()
    {
        $o = WpkSystem::asterisk('module show like chan_sip');
        if (preg_match('/^chan_sip\.so\s.*\bRunning\b/m', $o) !== 1) {
            $this->add('S15', 'ok', 'nosip', true);
            return;
        }
        $off = false;
        foreach (glob('/etc/asterisk/sip*.conf') ?: array() as $f) {
            $t = @file_get_contents($f);
            if ($t !== false && preg_match('/^[ \t]*websocket_enabled[ \t]*=[ \t]*(no|0|false|off)\b/mi', $t) === 1) {
                $off = true;
                break;
            }
        }
        if ($off) {
            $this->add('S15', 'ok', 'off', true);
            return;
        }
        $this->add('S15', 'bad', 'sipws', true, array(), self::auto('sip_ws_off', array('undo_id' => 'sip_ws_off_undo', 'needs_calls' => true)));
    }

    private function s12()
    {
        list($code, $out) = WpkSystem::run(array('/usr/bin/timedatectl', 'show', '-p', 'NTPSynchronized', '--value'), null, 10);
        $sync = trim($out);
        $skew = null;
        if (!empty($this->c['client_ms'])) {
            $skew = (int) round(abs(time() - ($this->c['client_ms'] / 1000)));
        }
        $p = array('skew' => $skew === null ? -1 : $skew);
        if ($skew !== null && $skew > 120) {
            $this->add('S12', 'warn', 'skew', false, $p, array('kind' => 'cmd', 'cmd' => 'chronyc makestep && timedatectl set-ntp true', 'undo' => 'timedatectl set-ntp false'));
        } elseif ($code === 0 && $sync === 'no') {
            $this->add('S12', 'warn', 'nosync', false, $p, array('kind' => 'cmd', 'cmd' => 'timedatectl set-ntp true && chronyc makestep', 'undo' => 'timedatectl set-ntp false'));
        } elseif ($code === 0 && $sync === 'yes') {
            $this->add('S12', 'ok', 'ok', false, $p);
        } else {
            // En contenedores o sin systemd no hay forma de saberlo: solo cuenta la hora del navegador
            $this->add('S12', $skew === null ? 'skip' : 'ok', $skew === null ? 'unknown' : 'clientonly', false, $p);
        }
    }

    private function s14()
    {
        $h = $this->helperStatus();
        if (!$h['present']) {
            $this->add('S14', 'skip', 'nohelper', false);
            return;
        }
        $fw = isset($h['kv']['firewall']) ? $h['kv']['firewall'] : 'unknown';
        if ($fw === 'open' || $fw === 'rtp_open') {
            $this->add('S14', 'ok', $fw, false);
        } elseif ($fw === 'rtp_closed') {
            list($rs, $re) = WpkRtp::effective();
            $range = ($rs > 0 && $re > $rs) ? ($rs . ':' . $re) : '10000:20000';
            $this->add('S14', 'warn', 'closed', false, array(), array('kind' => 'cmd',
                'cmd' => 'iptables -I INPUT -p udp --dport ' . $range . ' -j ACCEPT',
                'undo' => 'iptables -D INPUT -p udp --dport ' . $range . ' -j ACCEPT', 'note' => 'persist'));
        } else {
            $this->add('S14', 'skip', 'unknown', false);
        }
    }
}
