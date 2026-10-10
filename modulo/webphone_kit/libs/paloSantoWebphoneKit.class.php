<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Acceso a datos y validaciones del modulo de administracion del webphone.
 * Usa la capa paloDB del framework con consultas preparadas. El usuario MySQL del modulo (webphone_web) solo
 * escribe wp_user y wp_setting y lee la vista v_webphone_ext; no toca la base asterisk ni ve secretos SIP.
 */
class paloSantoWebphoneKit
{
    var $_DB;
    var $errMsg = "";

    function __construct(&$pDB)
    {
        $this->_DB = $pDB;
        if (is_object($pDB)) $this->errMsg = $pDB->errMsg;
    }

    // ---------------------------------------------------------------- Validaciones (listas cerradas, sin regex laxas)

    /** Ruta WebSocket: /algo/otro, sin "..", sin "//". La misma regla que api/config.php. */
    static function validWsPath($p)
    {
        return is_string($p) && preg_match('#^/[A-Za-z0-9._~/-]{1,100}$#', $p) === 1
            && strpos($p, '..') === false && strpos($p, '//') === false;
    }

    /** stun:host[:puerto] o stuns:host[:puerto]. */
    static function validStun($s)
    {
        return is_string($s) && preg_match('#^stuns?:[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$#', $s) === 1;
    }

    /**
     * Valida y normaliza los ajustes enviados por el formulario.
     * @return array(array $limpios, array $errores)  $errores = lista de claves de texto de interfaz
     */
    static function validateSettings($in)
    {
        $errors = array();
        $clean  = array();

        $ws = isset($in['ws_path']) ? trim((string)$in['ws_path']) : '';
        if (!self::validWsPath($ws)) $errors[] = "WebSocket path";
        $clean['ws_path'] = $ws;

        $raw = isset($in['stun_servers']) ? (string)$in['stun_servers'] : '';
        $list = array();
        foreach (preg_split('/[\r\n,]+/', $raw) as $s) {
            $s = trim($s);
            if ($s === '') continue;
            if (!self::validStun($s)) { $errors[] = "STUN servers"; $list = array(); break; }
            $list[] = $s;
        }
        if (count($list) > 5) $errors[] = "STUN servers";
        $clean['stun_servers'] = implode(',', array_unique($list));

        $ex = isset($in['register_expires']) ? trim((string)$in['register_expires']) : '';
        if (preg_match('/^[0-9]{2,4}$/', $ex) !== 1 || (int)$ex < 60 || (int)$ex > 3600) $errors[] = "Registration expiry (seconds)";
        $clean['register_expires'] = $ex;

        return array($clean, array_values(array_unique($errors)));
    }

    // ---------------------------------------------------------------- Ajustes

    function getSettings()
    {
        $rows = $this->_DB->fetchTable("SELECT k, v FROM wp_setting", true);
        $out = array('ws_path' => '/kit-ws', 'stun_servers' => '', 'register_expires' => '600');
        if (is_array($rows)) foreach ($rows as $r) $out[$r['k']] = $r['v'];
        else $this->errMsg = $this->_DB->errMsg;
        return $out;
    }

    function saveSettings($clean)
    {
        foreach (array('ws_path', 'stun_servers', 'register_expires') as $k) {
            $ok = $this->_DB->genQuery(
                "INSERT INTO wp_setting (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
                array($k, (string)$clean[$k]));
            if (!$ok) { $this->errMsg = $this->_DB->errMsg; return false; }
        }
        return true;
    }

    // ---------------------------------------------------------------- Usuarios

    /** username => array('extension' => ..., 'enabled' => 0|1) */
    function getActivations()
    {
        $rows = $this->_DB->fetchTable("SELECT username, extension, enabled FROM wp_user", true);
        $out = array();
        if (is_array($rows)) foreach ($rows as $r) $out[$r['username']] = array('extension' => $r['extension'], 'enabled' => (int)$r['enabled']);
        else $this->errMsg = $this->_DB->errMsg;
        return $out;
    }

    /** extension => true si la extension PJSIP es de tipo webphone (transport-wss). */
    function getWebphoneExtensions()
    {
        $rows = $this->_DB->fetchTable("SELECT extension, is_webphone FROM v_webphone_ext", true);
        $out = array();
        if (is_array($rows)) foreach ($rows as $r) $out[$r['extension']] = ((int)$r['is_webphone'] === 1);
        else $this->errMsg = $this->_DB->errMsg;
        return $out;
    }

    /** Otro usuario ya activado con esa extension? */
    function extensionTakenByOther($username, $extension)
    {
        $r = $this->_DB->getFirstRowQuery(
            "SELECT COUNT(*) FROM wp_user WHERE extension = ? AND enabled = 1 AND username <> ?",
            false, array($extension, $username));
        return is_array($r) && (int)$r[0] > 0;
    }

    /** Activa (con la extension actual del usuario) o desactiva. Solo escribe wp_user. */
    function setEnabled($username, $extension, $enabled)
    {
        if (!$enabled) {
            // Desactivar nunca crea filas: solo apaga la que exista
            $ok = $this->_DB->genQuery("UPDATE wp_user SET enabled = 0 WHERE username = ?", array($username));
        } else {
            $ok = $this->_DB->genQuery(
                "INSERT INTO wp_user (username, extension, enabled) VALUES (?, ?, 1) "
              . "ON DUPLICATE KEY UPDATE extension = VALUES(extension), enabled = 1",
                array($username, $extension));
        }
        if (!$ok) $this->errMsg = $this->_DB->errMsg;
        return $ok ? true : false;
    }

    // ---------------------------------------------------------------- Etapa 2b: perfil heredable

    static function defaultProfile()
    {
        return array('v' => 1, 'codecs' => 'auto', 'recording' => 'dontcare', 'callwaiting' => true, 'outbound_cid' => '');
    }

    /** Normaliza un perfil (lista cerrada de valores). Lo desconocido se descarta, no se acepta. */
    static function normProfile($p)
    {
        $d = self::defaultProfile();
        if (!is_array($p)) return $d;
        if (isset($p['codecs']) && in_array($p['codecs'], array('auto', 'g711'), true)) $d['codecs'] = $p['codecs'];
        if (isset($p['recording']) && in_array($p['recording'], array('dontcare', 'always', 'never', 'ondemand'), true)) $d['recording'] = $p['recording'];
        if (isset($p['callwaiting'])) $d['callwaiting'] = (bool)$p['callwaiting'];
        if (isset($p['outbound_cid']) && is_string($p['outbound_cid']) && preg_match('/^[0-9+*#() \-]{0,32}$/', $p['outbound_cid']) === 1) {
            $d['outbound_cid'] = trim($p['outbound_cid']);
        }
        return $d;
    }

    /** Valida lo que manda la persona: devuelve array(perfil, errores) sin descartar en silencio. */
    static function validateProfile($in)
    {
        $errors = array();
        if (!is_array($in)) return array(self::defaultProfile(), array('profile'));
        if (!isset($in['codecs']) || !in_array($in['codecs'], array('auto', 'g711'), true)) $errors[] = 'codecs';
        if (!isset($in['recording']) || !in_array($in['recording'], array('dontcare', 'always', 'never', 'ondemand'), true)) $errors[] = 'recording';
        if (!isset($in['callwaiting']) || !is_bool($in['callwaiting'])) $errors[] = 'callwaiting';
        if (!isset($in['outbound_cid']) || !is_string($in['outbound_cid']) || preg_match('/^[0-9+*#() \-]{0,32}$/', $in['outbound_cid']) !== 1) $errors[] = 'outbound_cid';
        return array(self::normProfile($in), $errors);
    }

    function getProfile()
    {
        $r = $this->_DB->getFirstRowQuery("SELECT v FROM wp_setting WHERE k = 'profile'", false);
        if (is_array($r) && isset($r[0])) {
            $j = json_decode((string)$r[0], true);
            if (is_array($j)) return self::normProfile($j);
        }
        return self::defaultProfile();
    }

    function getPreviousProfile()
    {
        $r = $this->_DB->getFirstRowQuery("SELECT v FROM wp_setting WHERE k = 'profile_prev'", false);
        if (is_array($r) && isset($r[0])) {
            $j = json_decode((string)$r[0], true);
            if (is_array($j)) return self::normProfile($j);
        }
        return null;
    }

    /** Guarda el perfil y deja el anterior como profile_prev (para volver atras). */
    function saveProfile($new)
    {
        $new = self::normProfile($new);
        $cur = $this->getProfile();
        if ($cur !== $new) {
            $ok = $this->_DB->genQuery("INSERT INTO wp_setting (k, v) VALUES ('profile_prev', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", array(json_encode($cur)));
            if (!$ok) { $this->errMsg = $this->_DB->errMsg; return false; }
        }
        $ok = $this->_DB->genQuery("INSERT INTO wp_setting (k, v) VALUES ('profile', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", array(json_encode($new)));
        if (!$ok) { $this->errMsg = $this->_DB->errMsg; return false; }
        return true;
    }

    /** Rango de numeros de anexo que el asistente acepta (valores por defecto 100 a 99999). */
    function getExtRange()
    {
        $min = 100; $max = 99999;
        $rows = $this->_DB->fetchTable("SELECT k, v FROM wp_setting WHERE k IN ('ext_min','ext_max')", true);
        if (is_array($rows)) foreach ($rows as $r) {
            if (preg_match('/^[0-9]{1,6}$/', (string)$r['v']) !== 1) continue;
            if ($r['k'] === 'ext_min') $min = (int)$r['v'];
            if ($r['k'] === 'ext_max') $max = (int)$r['v'];
        }
        return array($min, $max);
    }

    function saveExtRange($min, $max)
    {
        foreach (array('ext_min' => $min, 'ext_max' => $max) as $k => $v) {
            $ok = $this->_DB->genQuery("INSERT INTO wp_setting (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", array($k, (string)(int)$v));
            if (!$ok) { $this->errMsg = $this->_DB->errMsg; return false; }
        }
        return true;
    }

    function setSetting($k, $v)
    {
        $ok = $this->_DB->genQuery("INSERT INTO wp_setting (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", array($k, (string)$v));
        if (!$ok) $this->errMsg = $this->_DB->errMsg;
        return $ok ? true : false;
    }

    // ---------------------------------------------------------------- Etapa 2b: estado del asistente (wp_wizard)

    /** array('step'=>int,'done'=>bool,'data'=>array). Si la tabla no existe todavia devuelve el estado inicial. */
    function getWizard()
    {
        $out = array('step' => 1, 'done' => false, 'data' => array());
        $r = $this->_DB->getFirstRowQuery("SELECT step, done, data FROM wp_wizard WHERE id = 1", true);
        if (is_array($r)) {
            $out['step'] = max(1, min(6, (int)$r['step']));
            $out['done'] = ((int)$r['done'] === 1);
            $j = json_decode((string)$r['data'], true);
            if (is_array($j)) $out['data'] = $j;
        }
        return $out;
    }

    /** Lista cerrada de claves que el asistente recuerda (nada de secretos). */
    static function cleanWizardData($d)
    {
        $out = array();
        if (!is_array($d)) return $out;
        if (isset($d['usage']) && in_array($d['usage'], array('inside', 'outside', 'both'), true)) $out['usage'] = $d['usage'];
        if (isset($d['expected_calls']) && (is_int($d['expected_calls']) || (is_string($d['expected_calls']) && preg_match('/^[1-9][0-9]{0,3}$/', $d['expected_calls']) === 1))
            && (int)$d['expected_calls'] >= 1 && (int)$d['expected_calls'] <= 2000) $out['expected_calls'] = (int)$d['expected_calls'];
        if (isset($d['ssl_case']) && in_array($d['ssl_case'], array('a', 'b', 'c', 'd'), true)) $out['ssl_case'] = $d['ssl_case'];
        if (isset($d['ssl_choice']) && in_array($d['ssl_choice'], array('le', 'cmd', 'ca', 'manual'), true)) $out['ssl_choice'] = $d['ssl_choice'];
        if (isset($d['mode']) && in_array($d['mode'], array('one', 'range', 'csv'), true)) $out['mode'] = $d['mode'];
        if (isset($d['sub']) && is_string($d['sub']) && preg_match('/^[a-z_]{1,20}$/', $d['sub']) === 1) $out['sub'] = $d['sub'];
        if (isset($d['public_host']) && is_string($d['public_host']) && preg_match('/^[A-Za-z0-9.:-]{1,80}$/', $d['public_host']) === 1) $out['public_host'] = $d['public_host'];
        if (isset($d['created']) && is_numeric($d['created'])) $out['created'] = max(0, min(100000, (int)$d['created']));
        return $out;
    }

    function saveWizard($step, $done, $data)
    {
        $step = max(1, min(6, (int)$step));
        $json = json_encode(self::cleanWizardData($data));
        $ok = $this->_DB->genQuery(
            "INSERT INTO wp_wizard (id, step, done, data, updated_by) VALUES (1, ?, ?, ?, ?) "
          . "ON DUPLICATE KEY UPDATE step = VALUES(step), done = VALUES(done), data = VALUES(data), updated_by = VALUES(updated_by)",
            array($step, $done ? 1 : 0, $json, isset($_SESSION['issabel_user']) ? substr((string)$_SESSION['issabel_user'], 0, 100) : ''));
        if (!$ok) $this->errMsg = $this->_DB->errMsg;
        return $ok ? true : false;
    }

    /** extensiones que hoy son de tipo webphone (transport-wss), tal como las ve la vista de lectura. */
    function webphoneExtensionList()
    {
        $out = array();
        foreach ($this->getWebphoneExtensions() as $e => $isWeb) if ($isWeb) $out[] = (string)$e;
        sort($out);
        return $out;
    }
}
?>
