<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Acciones del asistente (etapa 2b). Se llaman por POST con JSON desde index.php?menu=webphone_kit&rawmode=yes, con el
 * token CSRF de la sesion en la cabecera X-WPK-CSRF. Cada accion declara lo que exige (menu, ext, admin) y el
 * servidor lo comprueba ANTES de hacer nada (WpkAuth). Las respuestas son JSON con {ok:true,...} o {ok:false,error:codigo}.
 * Nunca viaja un secreto SIP en una respuesta: el provisionador no los devuelve y aqui no se leen.
 */
class WpkApi
{
    private $svc;
    private $auth;
    private $pACL;
    private $user;

    /** accion => requisitos (ademas del menu, que siempre se exige) */
    static $ACTIONS = array(
        'state'          => array(),
        'doctor'         => array('admin'),
        'fix'            => array('admin'),
        'wizard_save'    => array('admin'),
        'settings_save'  => array('admin'),
        'profile_save'   => array('admin'),
        'profile_revert' => array('admin'),
        'plan'           => array('ext'),
        'apply'          => array('ext'),
        'repair_plan'    => array('ext'),
        'repair_apply'   => array('ext'),
        'export_csv'     => array('ext'),
        'users_list'     => array('admin'),
        'users_toggle'   => array('admin'),
        'group_create'   => array('admin'),
        'group_remove'   => array('admin'),
    );

    function __construct($svc, $pACL, WpkAuth $auth)
    {
        $this->svc = $svc;
        $this->pACL = $pACL;
        $this->auth = $auth;
        $this->user = $auth->user();
    }

    static function csrfToken()
    {
        if (empty($_SESSION['wpk_csrf']) || !is_string($_SESSION['wpk_csrf'])) {
            $_SESSION['wpk_csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['wpk_csrf'];
    }

    static function csrfOk($t)
    {
        return is_string($t) && $t !== '' && isset($_SESSION['wpk_csrf']) && is_string($_SESSION['wpk_csrf']) && hash_equals($_SESSION['wpk_csrf'], $t);
    }

    static function host()
    {
        $h = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        if (preg_match('/^(?:[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]{2,45}\])(?::[0-9]{1,5})?$/', $h) !== 1) {
            return array('', '');
        }
        $name = preg_replace('/:[0-9]{1,5}$/', '', $h);
        return array(trim($name, '[]'), $h);
    }

    /** Despacha una accion. Devuelve array (se serializa como JSON). */
    function handle($action, array $in)
    {
        if (!isset(self::$ACTIONS[$action])) {
            return array('ok' => false, 'error' => 'unknown_action');
        }
        $deny = $this->auth->check(self::$ACTIONS[$action]);
        if ($deny !== null) {
            return array('ok' => false) + $deny;
        }
        $m = 'a_' . $action;
        return $this->$m($in);
    }

    // ------------------------------------------------------------------ estado

    function state()
    {
        list($hostName, $hostRaw) = self::host();
        list($min, $max) = $this->svc->getExtRange();
        $act = $this->svc->getActivations();
        $web = $this->svc->webphoneExtensionList();
        $enabled = 0;
        foreach ($act as $a) {
            if ($a['enabled'] === 1) {
                $enabled++;
            }
        }
        $gid = $this->pACL->getIdGroup('Agente web');
        $leId = $this->pACL->getIdUser($this->user);
        $le = ($leId !== false && $leId !== null && is_dir('/var/www/html/modules/sec_letsencrypt')
            && $this->pACL->isUserAuthorizedById($leId, 'access', 'sec_letsencrypt'));
        return array(
            'ok'         => true,
            'caps'       => array('menu' => $this->auth->menu(), 'ext' => $this->auth->canExt(), 'admin' => $this->auth->isAdmin(),
                                  'assign_others' => $this->auth->canAssignOthers()),
            'user'       => $this->user,
            'wizard'     => $this->svc->getWizard(),
            'settings'   => array_intersect_key($this->svc->getSettings(), array_flip(array('ws_path', 'stun_servers', 'register_expires', 'expected_calls'))),
            'profile'    => $this->svc->getProfile(),
            'profile_prev' => $this->svc->getPreviousProfile() !== null,
            'ext_range'  => array($min, $max),
            'counts'     => array('users' => (int) $this->pACL->getNumUsers(), 'enabled' => $enabled, 'webphone' => count($web)),
            'group'      => array('exists' => ($gid !== false && $gid !== null), 'name' => 'Agente web'),
            'host'       => array('name' => $hostName, 'raw' => $hostRaw),
            'urls'       => array('le' => $le ? 'index.php?menu=sec_letsencrypt' : '', 'pbx_init' => '/admin/',
                                  'pbx_edit' => '/admin/config.php?type=setup&display=extensions&extdisplay=',
                                  'users' => 'index.php?menu=userlist', 'agent_console' => 'index.php?menu=agent_console'),
            'version'    => '0.5.2',
        );
    }

    function a_state(array $in)
    {
        return $this->state();
    }

    // ------------------------------------------------------------------ doctor y resolvers

    function a_doctor(array $in)
    {
        list($hostName) = self::host();
        $set = $this->svc->getSettings();
        $wiz = $this->svc->getWizard();
        $usage = isset($wiz['data']['usage']) ? $wiz['data']['usage'] : 'inside';
        if (isset($in['usage']) && in_array($in['usage'], array('inside', 'outside', 'both'), true)) {
            $usage = $in['usage'];
        }
        // llamadas simultaneas esperadas (rango RTP): lo que manda el cliente, lo guardado en el asistente o en wp_setting, o 10
        $calls = null;
        foreach (array(isset($in['expected_calls']) ? $in['expected_calls'] : null,
                       isset($wiz['data']['expected_calls']) ? $wiz['data']['expected_calls'] : null,
                       isset($set['expected_calls']) ? $set['expected_calls'] : null) as $cand) {
            $calls = WpkRtp::parseCalls($cand);
            if ($calls !== null) {
                break;
            }
        }
        $act = $this->svc->getActivations();
        $en = array();
        foreach ($act as $u => $a) {
            if ($a['enabled'] === 1) {
                $en[$u] = $a['extension'];
            }
        }
        $ctx = array(
            'host' => $hostName !== '' ? $hostName : '127.0.0.1',
            'ws_path' => isset($set['ws_path']) ? $set['ws_path'] : '/kit-ws',
            'usage' => $usage,
            'can_sip' => $this->auth->canSipSettings(),
            'expected_calls' => $calls !== null ? $calls : WpkRtp::DEFAULT_CALLS,
            'client_ms' => isset($in['client_ms']) && is_numeric($in['client_ms']) ? (float) $in['client_ms'] : 0,
            'stun' => isset($set['stun_servers']) ? $set['stun_servers'] : '',
            'profile' => $this->svc->getProfile(),
            'webphone_exts' => $this->svc->webphoneExtensionList(),
            'users_enabled' => $en,
        );
        $d = new WpkDoctor($ctx);
        $r = $d->run();
        $r['ok'] = true;
        $r['usage'] = $usage;
        $st = $this->state();
        $r['urls'] = $st['urls'];
        return $r;
    }

    private function callsGuard(array $in)
    {
        $calls = WpkSystem::activeCalls();
        if ($calls > 0 && empty($in['confirm_calls'])) {
            return array('ok' => false, 'error' => 'calls_active', 'calls' => $calls);
        }
        return null;
    }

    /**
     * Resolver del aviso de audio: acota el rango RTP segun las llamadas simultaneas esperadas (formula en WpkRtp).
     * Valida (entero de 1 a 2000), pide confirmacion con llamadas activas, lee el rango efectivo (rtpstart se conserva) y elige la via:
     *  - IssabelPBX define rtpend en rtp_additional.conf (lo normal; Asterisk usa la PRIMERA definicion): exige el privilegio de la
     *    pantalla Configuracion de SIP de Asterisk (pbxadmin, sipsettings) y cambia el rango con las funciones del modulo sipsettings
     *    mas UN retrieve_conf (bin/rtp_range.php). Sin ese privilegio responde no_sip_privilege (el cliente guia a esa pantalla).
     *  - Si no lo define, un bloque 'rtp-range' en rtp_custom.conf (rtpstart y rtpend).
     * En las dos: recarga res_rtp_asterisk.so (el rango nuevo vale para las asignaciones NUEVAS de puertos; las llamadas en curso
     * conservan los suyos) y VERIFICA en "rtp show settings". Si no coincide, o si el cambio toco otros archivos generados, lo
     * deshace (el estado previo vuelve exacto) y responde rtp_overridden o rtp_side_effects.
     */
    private function rtpRange(array $in, array $p)
    {
        $calls = WpkRtp::parseCalls(isset($p['calls']) ? $p['calls'] : null);
        if ($calls === null) {
            return array('ok' => false, 'error' => 'bad_calls');
        }
        if (($g = $this->callsGuard($in)) !== null) return $g;
        list($start, $end) = WpkRtp::effective();
        if ($start < 1 || $end <= $start) {
            return array('ok' => false, 'error' => 'rtp_unreadable');
        }
        $want = $start + WpkRtp::ports($calls);
        if ($want > WpkRtp::MAX_PORT) {
            return array('ok' => false, 'error' => 'rtp_overflow', 'start' => $start, 'want_end' => $want);
        }
        $this->svc->setSetting('expected_calls', (string) $calls);
        if ($end === $want) {
            return array('ok' => true, 'unchanged' => true, 'start' => $start, 'end' => $end, 'calls' => $calls,
                         'undo' => (WpkRtp::applied() || WpkSystem::blockRead('rtp_custom.conf', 'rtp-range') !== null) ? 'rtp_range_undo' : '');
        }
        if (WpkRtp::definedByPbx()) {
            if (!$this->auth->canSipSettings()) {
                return array('ok' => false, 'error' => 'no_sip_privilege', 'start' => $start, 'want_end' => $want, 'eff_start' => $start, 'eff_end' => $end);
            }
            return $this->rtpViaPbx($start, $end, $want, $calls);
        }
        return $this->rtpViaBlock($start, $end, $want, $calls);
    }

    /** Via IssabelPBX: sipsettings_edit + un retrieve_conf (bin/rtp_range.php), recarga y verificacion. */
    private function rtpViaPbx($start, $end, $want, $calls)
    {
        $t = WpkSystem::rtpTool(array('action' => 'apply', 'start' => $start, 'end' => $want));
        if (empty($t['ok'])) {
            $r = $this->rtpRollbackPbx($start, $end);
            return array('ok' => false, 'error' => 'rtp_tool_failed', 'start' => $start, 'want_end' => $want, 'restored' => $r['restored']);
        }
        // retrieve_conf solo debe haber cambiado rtp_additional.conf; cualquier otro archivo es un efecto lateral
        $side = array_values(array_diff(isset($t['changed']) && is_array($t['changed']) ? $t['changed'] : array(), array('rtp_additional.conf')));
        WpkSystem::asterisk('module reload res_rtp_asterisk.so');
        list($s2, $e2) = $this->rtpWaitFor($start, $want);
        if (count($side) === 0 && $s2 === $start && $e2 === $want) {
            return array('ok' => true, 'start' => $start, 'end' => $want, 'calls' => $calls, 'undo' => 'rtp_range_undo');
        }
        $r = $this->rtpRollbackPbx($start, $end);
        return array('ok' => false, 'error' => count($side) > 0 ? 'rtp_side_effects' : 'rtp_overridden', 'start' => $start, 'want_end' => $want,
                     'eff_start' => $s2, 'eff_end' => $e2, 'orig_end' => $end, 'files' => implode(',', array_slice($side, 0, 5)), 'restored' => $r['restored']);
    }

    /** Deshace la via IssabelPBX: restaura el estado previo exacto, regenera, recarga y comprueba el rango original. */
    private function rtpRollbackPbx($start, $end)
    {
        $u = WpkSystem::rtpTool(array('action' => 'undo'));
        WpkSystem::asterisk('module reload res_rtp_asterisk.so');
        list($s3, $e3) = $this->rtpWaitFor($start, $end);
        return array('restored' => (!empty($u['ok']) && !empty($u['identical']) && $s3 === $start && $e3 === $end), 'tool' => $u);
    }

    /** Via bloque: rtp_custom.conf (solo si IssabelPBX no define rtpend). */
    private function rtpViaBlock($start, $end, $want, $calls)
    {
        $pre = WpkSystem::fileSnapshot('rtp_custom.conf');
        if ($pre === null) {
            return array('ok' => false, 'error' => 'not_writable');
        }
        $r = WpkSystem::blockWrite('rtp_custom.conf', 'rtp-range', WpkRtp::blockBody($start, $want));
        if ($r !== true) return array('ok' => false, 'error' => $r);
        WpkSystem::asterisk('module reload res_rtp_asterisk.so');
        list($s2, $e2) = $this->rtpWaitFor($start, $want);
        if ($s2 === $start && $e2 === $want) {
            return array('ok' => true, 'start' => $start, 'end' => $want, 'calls' => $calls, 'undo' => 'rtp_range_undo');
        }
        // No quedo: otra linea (anterior) lo pisa. Se deshace el bloque, el archivo vuelve a su contenido exacto y se recarga.
        WpkSystem::blockRemove('rtp_custom.conf', 'rtp-range');
        WpkSystem::fileRestore('rtp_custom.conf', $pre);
        WpkSystem::asterisk('module reload res_rtp_asterisk.so');
        list($s3, $e3) = WpkRtp::effective();
        $restored = ($s3 === $start && $e3 === $end);
        return array('ok' => false, 'error' => $restored ? 'rtp_overridden' : 'rtp_rollback_failed', 'start' => $start, 'want_end' => $want,
                     'eff_start' => $s2, 'eff_end' => $e2, 'orig_end' => $end, 'restored' => $restored);
    }

    /** Deshacer: restaura sipsettings y los archivos generados al estado previo exacto (si se aplico por IssabelPBX) y quita el bloque. */
    private function rtpRangeUndo(array $in)
    {
        if (($g = $this->callsGuard($in)) !== null) return $g;
        $out = array('ok' => true);
        if (WpkRtp::applied()) {
            if (!$this->auth->canSipSettings()) {
                return array('ok' => false, 'error' => 'no_sip_privilege');
            }
            $u = WpkSystem::rtpTool(array('action' => 'undo'));
            if (empty($u['ok'])) {
                return array('ok' => false, 'error' => (isset($u['error']) && $u['error'] === 'not_identical') ? 'rtp_not_identical' : 'rtp_tool_failed',
                             'files' => implode(',', array_slice(isset($u['changed']) && is_array($u['changed']) ? $u['changed'] : array(), 0, 5)));
            }
            $out['identical'] = true;
        }
        $r = WpkSystem::blockRemove('rtp_custom.conf', 'rtp-range');
        if ($r !== true) return array('ok' => false, 'error' => $r);
        WpkSystem::asterisk('module reload res_rtp_asterisk.so');
        return $out;
    }

    /** Espera (hasta ~1 s) a que "rtp show settings" muestre el rango pedido. Devuelve el rango efectivo visto. */
    private function rtpWaitFor($start, $end)
    {
        $seen = array(0, 0);
        for ($i = 0; $i < 4; $i++) {
            $seen = WpkRtp::effective();
            if ($seen[0] === $start && $seen[1] === $end) {
                break;
            }
            usleep(250000);
        }
        return $seen;
    }

    /**
     * El WebSocket lo reclama el modulo que carga primero. Descargar y cargar el transporte de PJSIP "en caliente" deja a
     * Asterisk sin poder ENVIAR peticiones a los telefonos WebSocket: el telefono registra, pero OPTIONS y las llamadas
     * entrantes (la cola, el login del agente) fallan con PJSIP_EUNSUPTRANSPORT hasta el siguiente reinicio. Por eso se
     * hace un reinicio limpio. Quien llama ya comprobo que no hay llamadas activas.
     */
    private function reloadWsOwner()
    {
        WpkSystem::asterisk('core restart now');
        sleep(4);
        for ($i = 0; $i < 12; $i++) {
            if (stripos(WpkSystem::asterisk('core waitfullybooted'), 'fully booted') !== false) {
                return;
            }
            sleep(2);
        }
    }

    function a_fix(array $in)
    {
        $id = isset($in['id']) && is_string($in['id']) ? $in['id'] : '';
        $p = isset($in['params']) && is_array($in['params']) ? $in['params'] : array();
        switch ($id) {
            case 'http_loopback':
                if (($g = $this->callsGuard($in)) !== null) return $g;
                $r = WpkSystem::blockWrite('http_custom.conf', 'http-loopback', "bindaddr=127.0.0.1\ntlsbindaddr=127.0.0.1:8089");
                if ($r !== true) return array('ok' => false, 'error' => $r);
                WpkSystem::asterisk('module reload http');
                return array('ok' => true, 'undo' => 'http_loopback_undo');
            case 'http_loopback_undo':
                if (($g = $this->callsGuard($in)) !== null) return $g;
                $r = WpkSystem::blockRemove('http_custom.conf', 'http-loopback');
                if ($r !== true) return array('ok' => false, 'error' => $r);
                WpkSystem::asterisk('module reload http');
                return array('ok' => true);
            case 'sip_ws_off':
                if (($g = $this->callsGuard($in)) !== null) return $g;
                $r = WpkSystem::blockWrite('sip_general_custom.conf', 'sip-ws-off', "websocket_enabled=no");
                if ($r !== true) return array('ok' => false, 'error' => $r);
                $this->reloadWsOwner();
                return array('ok' => true, 'undo' => 'sip_ws_off_undo');
            case 'sip_ws_off_undo':
                if (($g = $this->callsGuard($in)) !== null) return $g;
                $r = WpkSystem::blockRemove('sip_general_custom.conf', 'sip-ws-off');
                if ($r !== true) return array('ok' => false, 'error' => $r);
                $this->reloadWsOwner();
                return array('ok' => true);
            case 'rtp_ice':
                $r = WpkSystem::blockWrite('rtp_custom.conf', 'rtp-ice', 'icesupport=yes');
                if ($r !== true) return array('ok' => false, 'error' => $r);
                WpkSystem::asterisk('module reload res_rtp_asterisk.so');
                return array('ok' => true, 'undo' => 'rtp_ice_undo');
            case 'rtp_ice_undo':
                $r = WpkSystem::blockRemove('rtp_custom.conf', 'rtp-ice');
                if ($r !== true) return array('ok' => false, 'error' => $r);
                WpkSystem::asterisk('module reload res_rtp_asterisk.so');
                return array('ok' => true);
            case 'rtp_range':
                return $this->rtpRange($in, $p);
            case 'rtp_range_undo':
                return $this->rtpRangeUndo($in);
            case 'external_addr':
                if (($g = $this->callsGuard($in)) !== null) return $g;
                $ip = isset($p['ip']) && is_string($p['ip']) ? trim($p['ip']) : '';
                if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) return array('ok' => false, 'error' => 'bad_ip');
                $net = isset($p['local_net']) && is_string($p['local_net']) ? trim($p['local_net']) : '';
                if ($net === '') {
                    foreach (WpkSystem::serverIps() as $sip) {
                        if (WpkSystem::isPrivateIp($sip)) { $net = preg_replace('/\.\d+$/', '.0', $sip) . '/24'; break; }
                    }
                }
                if ($net !== '' && preg_match('#^(\d{1,3}\.){3}\d{1,3}/\d{1,2}$#', $net) !== 1) return array('ok' => false, 'error' => 'bad_net');
                $body = "[transport-wss](+)\nexternal_media_address=$ip\nexternal_signaling_address=$ip" . ($net !== '' ? "\nlocal_net=$net" : '');
                $r = WpkSystem::blockWrite('pjsip_custom.conf', 'external-addr', $body);
                if ($r !== true) return array('ok' => false, 'error' => $r);
                WpkSystem::asterisk('module reload res_pjsip.so');
                return array('ok' => true, 'undo' => 'external_addr_undo');
            case 'external_addr_undo':
                if (($g = $this->callsGuard($in)) !== null) return $g;
                $r = WpkSystem::blockRemove('pjsip_custom.conf', 'external-addr');
                if ($r !== true) return array('ok' => false, 'error' => $r);
                WpkSystem::asterisk('module reload res_pjsip.so');
                return array('ok' => true);
            case 'stun_default':
                if (empty($p['consent'])) return array('ok' => false, 'error' => 'consent_required');
                $set = $this->svc->getSettings();
                if (trim((string) $set['stun_servers']) !== '') return array('ok' => true, 'unchanged' => true);
                if (!$this->svc->setSetting('stun_servers', 'stun:stun.l.google.com:19302')) return array('ok' => false, 'error' => 'db');
                return array('ok' => true, 'undo' => 'stun_default_undo');
            case 'stun_default_undo':
                $set = $this->svc->getSettings();
                if ($set['stun_servers'] === 'stun:stun.l.google.com:19302') $this->svc->setSetting('stun_servers', '');
                return array('ok' => true);
            case 'module_load':
                $mod = isset($p['mod']) && is_string($p['mod']) ? $p['mod'] : '';
                if (!in_array($mod, array('res_pjsip_transport_websocket', 'res_http_websocket', 'codec_opus', 'res_srtp', 'res_crypto'), true)) {
                    return array('ok' => false, 'error' => 'bad_module');
                }
                WpkSystem::asterisk('module load ' . $mod . '.so');
                return array('ok' => true);
            case 'ws_install':
            case 'ws_remove':
                $h = WpkSystem::helper($id === 'ws_install' ? 'install_ws' : 'remove_ws');
                if (!$h['present']) return array('ok' => false, 'error' => 'helper_missing');
                if (!$h['ok']) return array('ok' => false, 'error' => isset($h['kv']['error']) ? $h['kv']['error'] : 'helper_failed');
                return array('ok' => true, 'result' => isset($h['kv']['result']) ? $h['kv']['result'] : '', 'undo' => (($id === 'ws_install' && isset($h['kv']['result']) && $h['kv']['result'] === 'installed') ? 'ws_remove' : ''));
        }
        return array('ok' => false, 'error' => 'unknown_fix');
    }

    // ------------------------------------------------------------------ asistente, ajustes y perfil

    function a_wizard_save(array $in)
    {
        $step = isset($in['step']) ? (int) $in['step'] : 1;
        $done = !empty($in['done']);
        $data = isset($in['data']) && is_array($in['data']) ? $in['data'] : array();
        // lo guardado antes se conserva si no se manda de nuevo
        $cur = $this->svc->getWizard();
        $data = array_merge($cur['data'], paloSantoWebphoneKit::cleanWizardData($data));
        if (isset($data['expected_calls'])) {
            // se recuerda tambien en wp_setting (la pregunta de llamadas simultaneas del paso 4) para reanudar
            $this->svc->setSetting('expected_calls', (string) $data['expected_calls']);
        }
        return $this->svc->saveWizard($step, $done, $data) ? array('ok' => true, 'wizard' => $this->svc->getWizard()) : array('ok' => false, 'error' => 'db');
    }

    function a_settings_save(array $in)
    {
        $s = isset($in['settings']) && is_array($in['settings']) ? $in['settings'] : array();
        $flat = array();
        foreach (array('ws_path', 'stun_servers', 'register_expires') as $k) {
            $flat[$k] = isset($s[$k]) && is_string($s[$k]) ? $s[$k] : (isset($s[$k]) && is_numeric($s[$k]) ? (string) $s[$k] : '');
        }
        list($clean, $errors) = paloSantoWebphoneKit::validateSettings($flat);
        $min = isset($s['ext_min']) ? (string) $s['ext_min'] : '';
        $max = isset($s['ext_max']) ? (string) $s['ext_max'] : '';
        if (preg_match('/^[0-9]{3,6}$/', $min) !== 1 || preg_match('/^[0-9]{3,6}$/', $max) !== 1 || (int) $min > (int) $max) {
            $errors[] = 'ext_range';
        }
        if (count($errors) > 0) {
            return array('ok' => false, 'error' => 'validation', 'fields' => array_values(array_unique($errors)));
        }
        if (!$this->svc->saveSettings($clean) || !$this->svc->saveExtRange($min, $max)) {
            return array('ok' => false, 'error' => 'db');
        }
        return array('ok' => true, 'settings' => array_intersect_key($this->svc->getSettings(), array_flip(array('ws_path', 'stun_servers', 'register_expires'))), 'ext_range' => array((int) $min, (int) $max));
    }

    function a_profile_save(array $in)
    {
        list($p, $errors) = paloSantoWebphoneKit::validateProfile(isset($in['profile']) ? $in['profile'] : null);
        if (count($errors) > 0) {
            return array('ok' => false, 'error' => 'validation', 'fields' => $errors);
        }
        if (!$this->svc->saveProfile($p)) {
            return array('ok' => false, 'error' => 'db');
        }
        return array('ok' => true, 'profile' => $this->svc->getProfile(), 'profile_prev' => $this->svc->getPreviousProfile() !== null);
    }

    function a_profile_revert(array $in)
    {
        $prev = $this->svc->getPreviousProfile();
        if ($prev === null) {
            return array('ok' => false, 'error' => 'no_previous');
        }
        if (!$this->svc->saveProfile($prev)) {
            return array('ok' => false, 'error' => 'db');
        }
        return array('ok' => true, 'profile' => $this->svc->getProfile(), 'profile_prev' => $this->svc->getPreviousProfile() !== null);
    }

    // ------------------------------------------------------------------ alta de anexos

    private function rowsFromInput(array $in)
    {
        $mode = isset($in['mode']) && is_string($in['mode']) ? $in['mode'] : '';
        if ($mode === 'one') {
            $user = isset($in['user']) && is_string($in['user']) ? $in['user'] : '';
            if (!empty($in['self'])) {
                $user = $this->user;
            }
            return WpkPlan::oneRow(isset($in['name']) ? $in['name'] : '', isset($in['ext']) ? $in['ext'] : '', $user);
        }
        if ($mode === 'range') {
            return WpkPlan::rangeRows(isset($in['from']) ? $in['from'] : '', isset($in['to']) ? $in['to'] : '', isset($in['prefix']) ? $in['prefix'] : '');
        }
        if ($mode === 'csv') {
            return WpkPlan::parseCsv(isset($in['csv']) ? $in['csv'] : '');
        }
        return array('rows' => array(), 'error' => 'bad_mode');
    }

    /** Arma las filas, las valida en seco y devuelve array(rows validadas, resumen, error, calls). */
    private function buildPlan(array $in)
    {
        $parsed = $this->rowsFromInput($in);
        if ($parsed['error'] !== null) {
            return array(null, null, $parsed['error'], 0, null);
        }
        $prov = WpkSystem::provision(array('action' => 'plan', 'rows' => array_map(function ($r) { return array('ext' => $r['ext']); }, $parsed['rows'])), 90);
        if (empty($prov['ok'])) {
            return array(null, null, 'provision_failed', 0, null);
        }
        $users = array();
        $all = $this->pACL->getUsers();
        if (is_array($all)) {
            foreach ($all as $u) {
                $users[(string) $u[1]] = ($u[3] === null) ? '' : (string) $u[3];
            }
        }
        list($min, $max) = $this->svc->getExtRange();
        $ctx = array('min' => $min, 'max' => $max, 'existing' => isset($prov['exists']) ? $prov['exists'] : array(), 'users' => $users,
                     'me' => $this->user, 'canAssignOthers' => $this->auth->canAssignOthers(), 'checkRange' => array('WpkAuth', 'checkRange'));
        $rows = WpkPlan::validate($parsed['rows'], $ctx);
        return array($rows, WpkPlan::summary($rows), null, isset($prov['calls']) ? (int) $prov['calls'] : 0, $prov);
    }

    function a_plan(array $in)
    {
        list($rows, $sum, $err, $calls, $prov) = $this->buildPlan($in);
        if ($err !== null) {
            return array('ok' => false, 'error' => $err);
        }
        return array('ok' => true, 'rows' => $rows, 'summary' => $sum, 'calls' => $calls, 'profile' => $this->svc->getProfile(),
                     'opus' => !empty($prov['opus']));
    }

    function a_apply(array $in)
    {
        if (empty($in['confirm'])) {
            return array('ok' => false, 'error' => 'confirm_required');
        }
        list($rows, $sum, $err, $calls) = $this->buildPlan($in);
        if ($err !== null) {
            return array('ok' => false, 'error' => $err);
        }
        if ($calls > 0 && empty($in['confirm_calls'])) {
            return array('ok' => false, 'error' => 'calls_active', 'calls' => $calls);
        }
        $good = array();
        foreach ($rows as $r) {
            if ($r['status'] === 'ok') {
                $good[] = array('line' => $r['line'], 'ext' => $r['ext'], 'name' => $r['name']);
            }
        }
        $byLine = array();
        foreach ($rows as $r) {
            $byLine[$r['line']] = $r;
        }
        $results = array();
        $batch = '';
        $rc = 0;
        $rl = 0;
        if (count($good) > 0) {
            $prov = WpkSystem::provision(array('action' => 'create', 'profile' => $this->svc->getProfile(), 'rows' => $good), 280);
            if (empty($prov['ok'])) {
                return array('ok' => false, 'error' => isset($prov['error']) ? $prov['error'] : 'provision_failed');
            }
            $batch = $prov['batch'];
            $rc = (int) $prov['retrieve_conf'];
            $rl = (int) $prov['reload_pjsip'];
            foreach ($prov['results'] as $pr) {
                $src = $byLine[$pr['line']];
                $res = array('line' => $pr['line'], 'ext' => $pr['ext'], 'name' => $src['name'], 'user' => $src['user'], 'status' => $pr['status'],
                             'code' => isset($pr['code']) ? $pr['code'] : '');
                if ($pr['status'] === 'created' && $src['user'] !== '') {
                    $okA = $this->pACL->setUserExtension($src['user'], $src['ext']) && $this->svc->setEnabled($src['user'], $src['ext'], true);
                    if (!$okA) {
                        $res['code'] = 'user_assign_failed';
                    }
                }
                $results[$pr['line']] = $res;
            }
        }
        foreach ($rows as $r) {
            if ($r['status'] !== 'ok') {
                $results[$r['line']] = array('line' => $r['line'], 'ext' => $r['ext'], 'name' => $r['name'], 'user' => $r['user'],
                                             'status' => 'skipped', 'code' => $r['codes'][0]['c']);
            }
        }
        ksort($results);
        $out = array_values($results);
        $created = 0;
        $skipped = 0;
        $failed = 0;
        foreach ($out as $x) {
            if ($x['status'] === 'created') $created++;
            elseif ($x['status'] === 'skipped') $skipped++;
            else $failed++;
        }
        return array('ok' => true, 'batch' => $batch, 'results' => $out, 'counts' => array('created' => $created, 'skipped' => $skipped, 'failed' => $failed),
                     'retrieve_conf' => $rc, 'reload_pjsip' => $rl);
    }

    function a_export_csv(array $in)
    {
        $rows = isset($in['rows']) && is_array($in['rows']) ? $in['rows'] : array();
        $clean = array();
        foreach (array_slice($rows, 0, 500) as $r) {
            if (!is_array($r)) continue;
            $clean[] = array('line' => isset($r['line']) ? (int) $r['line'] : 0, 'ext' => isset($r['ext']) ? (string) $r['ext'] : '',
                             'name' => isset($r['name']) ? (string) $r['name'] : '', 'user' => isset($r['user']) ? (string) $r['user'] : '',
                             'status' => isset($r['status']) ? (string) $r['status'] : '', 'code' => isset($r['code']) ? (string) $r['code'] : '');
        }
        return array('ok' => true, '_csv' => WpkPlan::exportResult($clean));
    }

    // ------------------------------------------------------------------ Reparar y Aplicar a todos

    private function repairTargets(array $in)
    {
        $all = $this->svc->webphoneExtensionList();
        if (!empty($in['all'])) {
            $list = $all;
        } else {
            $list = array();
            foreach ((isset($in['exts']) && is_array($in['exts']) ? $in['exts'] : array()) as $e) {
                if (is_string($e) && preg_match('/^[0-9]{3,6}$/', $e) === 1 && in_array($e, $all, true)) {
                    $list[] = $e;
                }
            }
        }
        $ok = array();
        foreach (array_unique($list) as $e) {
            if (WpkAuth::checkRange($e)) {
                $ok[] = $e;
            }
        }
        return array_slice($ok, 0, 500);
    }

    function a_repair_plan(array $in)
    {
        $list = $this->repairTargets($in);
        if (count($list) === 0) {
            return array('ok' => true, 'anexos' => array(), 'summary' => array('total' => 0, 'with_changes' => 0));
        }
        $r = WpkSystem::provision(array('action' => 'audit', 'exts' => $list, 'profile' => $this->svc->getProfile()), 120);
        if (empty($r['ok'])) {
            return array('ok' => false, 'error' => 'provision_failed');
        }
        $with = 0;
        foreach ($r['anexos'] as $a) {
            if (!empty($a['changes'])) $with++;
        }
        return array('ok' => true, 'anexos' => $r['anexos'], 'summary' => array('total' => count($r['anexos']), 'with_changes' => $with), 'calls' => (int) $r['calls']);
    }

    function a_repair_apply(array $in)
    {
        if (empty($in['confirm'])) {
            return array('ok' => false, 'error' => 'confirm_required');
        }
        $list = $this->repairTargets($in);
        if (count($list) === 0) {
            return array('ok' => false, 'error' => 'nothing_to_do');
        }
        $calls = WpkSystem::activeCalls();
        if ($calls > 0 && empty($in['confirm_calls'])) {
            return array('ok' => false, 'error' => 'calls_active', 'calls' => $calls);
        }
        $r = WpkSystem::provision(array('action' => 'repair', 'exts' => $list, 'profile' => $this->svc->getProfile()), 280);
        if (empty($r['ok'])) {
            return array('ok' => false, 'error' => isset($r['error']) ? $r['error'] : 'provision_failed');
        }
        return array('ok' => true, 'batch' => $r['batch'], 'results' => $r['results'], 'retrieve_conf' => (int) $r['retrieve_conf'], 'reload_pjsip' => (int) $r['reload_pjsip']);
    }

    // ------------------------------------------------------------------ usuarios

    function a_users_list(array $in)
    {
        $page = isset($in['page']) ? max(1, (int) $in['page']) : 1;
        $q = isset($in['q']) && is_string($in['q']) ? mb_strtolower(trim($in['q']), 'UTF-8') : '';
        $users = $this->pACL->getUsers();
        if (!is_array($users)) $users = array();
        $act = $this->svc->getActivations();
        $web = $this->svc->getWebphoneExtensions();
        $rows = array();
        foreach ($users as $u) {
            $name = (string) $u[1];
            $desc = (string) $u[2];
            $ext = $u[3] === null ? '' : (string) $u[3];
            if ($q !== '' && mb_strpos(mb_strtolower($name . ' ' . $desc . ' ' . $ext, 'UTF-8'), $q) === false) continue;
            $a = isset($act[$name]) ? $act[$name] : null;
            if ($a !== null && $a['enabled'] === 1 && $a['extension'] === $ext && $ext !== '') $state = 'yes';
            elseif ($a !== null && $a['enabled'] === 1) $state = 'outdated';
            else $state = 'no';
            $kind = $ext === '' ? 'none' : (!empty($web[$ext]) ? 'yes' : 'no');
            $rows[] = array('id' => (int) $u[0], 'name' => $name, 'desc' => $desc, 'ext' => $ext, 'state' => $state, 'webrtc' => $kind);
        }
        $per = 20;
        $total = count($rows);
        $pages = max(1, (int) ceil($total / $per));
        $page = min($page, $pages);
        return array('ok' => true, 'rows' => array_slice($rows, ($page - 1) * $per, $per), 'total' => $total, 'page' => $page, 'pages' => $pages);
    }

    function a_users_toggle(array $in)
    {
        $enable = !empty($in['enable']);
        $ids = isset($in['ids']) && is_array($in['ids']) ? $in['ids'] : array();
        $done = 0;
        $skipped = 0;
        $notWebphone = 0;
        $web = $this->svc->getWebphoneExtensions();
        foreach (array_slice($ids, 0, 200) as $id) {
            if (!(is_int($id) || (is_string($id) && ctype_digit($id)))) continue;
            $rows = $this->pACL->getUsers((int) $id);
            if (!is_array($rows) || count($rows) !== 1) continue;
            $name = (string) $rows[0][1];
            $ext = $rows[0][3] === null ? '' : (string) $rows[0][3];
            if ($enable) {
                if (preg_match('/^[0-9]{1,20}$/', $ext) !== 1 || $this->svc->extensionTakenByOther($name, $ext)) { $skipped++; continue; }
                if (empty($web[$ext])) $notWebphone++;
                if ($this->svc->setEnabled($name, $ext, true)) $done++; else $skipped++;
            } else {
                if ($this->svc->setEnabled($name, $ext, false)) $done++; else $skipped++;
            }
        }
        return array('ok' => true, 'done' => $done, 'skipped' => $skipped, 'not_webphone' => $notWebphone);
    }

    // ------------------------------------------------------------------ grupo "Agente web"

    private function backupAcl()
    {
        $dir = WpkSystem::STATE_DIR . '/backup';
        if (!is_dir($dir)) @mkdir($dir, 0700, true);
        $dst = $dir . '/acl.db.' . date('Ymd-His');
        $old = umask(0177);
        $ok = @copy('/var/www/db/acl.db', $dst);
        umask($old);
        return $ok ? basename($dst) : null;
    }

    function a_group_create(array $in)
    {
        if (empty($in['confirm'])) {
            return array('ok' => false, 'error' => 'confirm_required');
        }
        $bk = $this->backupAcl();
        if ($bk === null) {
            return array('ok' => false, 'error' => 'backup_failed');
        }
        $gid = $this->pACL->getIdGroup('Agente web');
        $existed = ($gid !== false && $gid !== null);
        if (!$existed) {
            if (!$this->pACL->createGroup('Agente web', 'Webphone kit: agente web (webphone y consola de agente)')) {
                return array('ok' => false, 'error' => 'create_failed');
            }
            $gid = $this->pACL->getIdGroup('Agente web');
        }
        $rid = $this->pACL->getIdResource('agent_console');
        if ($rid === false || $rid === null) {
            return array('ok' => false, 'error' => 'no_agent_console', 'backup' => $bk);
        }
        $row = $this->pACL->_DB->getFirstRowQuery(
            "SELECT COUNT(*) FROM acl_group_permission WHERE id_group = ? AND id_resource = ? AND id_action = (SELECT id FROM acl_action WHERE name = 'access')",
            false, array((int) $gid, (int) $rid));
        $has = is_array($row) && isset($row[0]) && (int) $row[0] > 0;
        if (!$has) {
            $this->pACL->saveGroupPermission((int) $gid, array((int) $rid));
        }
        return array('ok' => true, 'group_id' => (int) $gid, 'existed' => $existed, 'backup' => $bk);
    }

    /** Reversa del grupo: solo si lo creo este modulo (descripcion con la marca) y no tiene usuarios. */
    function a_group_remove(array $in)
    {
        if (empty($in['confirm'])) {
            return array('ok' => false, 'error' => 'confirm_required');
        }
        $gid = $this->pACL->getIdGroup('Agente web');
        if ($gid === false || $gid === null) {
            return array('ok' => true, 'removed' => false);
        }
        $g = $this->pACL->getGroups((int) $gid);
        if (!is_array($g) || count($g) !== 1 || strpos((string) $g[0][2], 'Webphone kit:') !== 0) {
            return array('ok' => false, 'error' => 'not_ours');
        }
        if ($this->pACL->HaveUsersTheGroup((int) $gid)) {
            return array('ok' => false, 'error' => 'group_has_users');
        }
        if ($this->backupAcl() === null) {
            return array('ok' => false, 'error' => 'backup_failed');
        }
        return $this->pACL->deleteGroup((int) $gid) ? array('ok' => true, 'removed' => true) : array('ok' => false, 'error' => 'delete_failed');
    }
}
