<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Modulo de administracion del webphone (menu PBX > Webphone Lite).
 * Etapa 2b: asistente instalador (6 pasos), diagnostico, alta de anexos (uno, rango, CSV), perfil heredable, usuarios y
 * ajustes. La pagina es una sola vista (themes/default/js/wizard.js + css/wizard.css) que habla con este mismo archivo
 * por JSON (index.php?menu=webphone_kit&rawmode=yes, POST, cabecera X-WPK-CSRF). Toda decision de permisos y toda
 * validacion ocurre aqui, en el servidor (libs/WpkAuth.class.php y libs/WpkApi.class.php).
 *
 * Se conserva de la etapa 2: activar y desactivar usuarios, ajustes con validacion estricta, token CSRF de sesion,
 * salida escapada y consultas parametrizadas. El secreto SIP no se muestra nunca (este modulo ni siquiera puede leerlo).
 */
include_once "libs/paloSantoGrid.class.php";
include_once "libs/paloSantoForm.class.php";

function _moduleContent(&$smarty, $module_name)
{
    include_once "modules/$module_name/configs/default.conf.php";
    include_once "modules/$module_name/libs/paloSantoWebphoneKit.class.php";
    include_once "modules/$module_name/libs/WpkSystem.class.php";
    include_once "modules/$module_name/libs/WpkRtp.class.php";
    include_once "modules/$module_name/libs/WpkAuth.class.php";
    include_once "modules/$module_name/libs/WpkPlan.class.php";
    include_once "modules/$module_name/libs/WpkDoctor.class.php";
    include_once "modules/$module_name/libs/WpkApi.class.php";

    // Idioma segun la configuracion de Issabel; si no existe el archivo se usa en
    $lang = get_language();
    // El portugues de Brasil se llama br o pt-br en Issabel; este modulo lo guarda como pt_BR.lang
    if (in_array(strtolower($lang), array("br", "pt-br", "pt_br", "pt"), true)) $lang = "pt_BR";
    $base_dir = dirname($_SERVER['SCRIPT_FILENAME']);
    $lang_file = "modules/$module_name/lang/$lang.lang";
    if (file_exists("$base_dir/$lang_file")) include_once "$lang_file";
    else include_once "modules/$module_name/lang/en.lang";

    global $arrConf;
    global $arrConfModule;
    global $arrLang;
    global $arrLangModule;
    $arrConf = array_merge($arrConf, $arrConfModule);
    $arrLang = array_merge($arrLang, $arrLangModule);

    // En paloDB, connStatus === false significa conexion correcta
    $pDB    = new paloDB($arrConf['dsn_conn_database']);
    $pdbACL = new paloDB($arrConf['issabel_dsn']['acl']);
    $pACL   = new paloACL($pdbACL);

    $me   = isset($_SESSION['issabel_user']) ? (string)$_SESSION['issabel_user'] : '';
    $auth = new WpkAuth($pACL, $me);
    $wpa  = isset($_GET['wpa']) && is_string($_GET['wpa']) ? $_GET['wpa'] : '';

    // Primera barrera: acceso al menu propio (el marco ya lo comprueba; aqui se repite, no se confia en una sola capa)
    if (!$auth->menu()) {
        if ($wpa !== '') return wpkJson(array('ok' => false, 'error' => 'forbidden', 'need' => 'menu'), 403);
        $smarty->assign("mb_title", _tr("ERROR"));
        $smarty->assign("mb_message", wpkEsc(_tr("You do not have access to this module")));
        return "";
    }

    $svc = new paloSantoWebphoneKit($pDB);
    if ($pDB->connStatus) {
        if ($wpa !== '') return wpkJson(array('ok' => false, 'error' => 'db'), 500);
        $smarty->assign("mb_title", _tr("ERROR"));
        $smarty->assign("mb_message", wpkEsc(_tr("Cannot connect to the webphone database")));
        return "";
    }
    $api = new WpkApi($svc, $pACL, $auth);

    if ($wpa !== '') return wpkApi($api, $auth, $wpa);

    // Compatibilidad con la etapa 2 (formularios sin JavaScript): mismas reglas, mismo token
    $isPost = (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST');
    if ($isPost && (isset($_POST['wpk_enable']) || isset($_POST['wpk_disable']) || isset($_POST['wpk_save_settings']))) {
        $msg = wpkLegacyPost($smarty, $api, $auth);
        $smarty->assign("mb_title", _tr($msg[0]));
        $smarty->assign("mb_message", wpkEsc($msg[1]));
    }
    return wpkPage($module_name, $api, $lang);
}

// ------------------------------------------------------------------ utilidades

function wpkEsc($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function wpkJson(array $body, $status = 200)
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, private');
        header('Pragma: no-cache');
        header('X-Content-Type-Options: nosniff');
    }
    return json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
}

/** Accion de la API. GET solo para la plantilla CSV; todo lo demas es POST JSON con token CSRF en cabecera. */
function wpkApi(WpkApi $api, WpkAuth $auth, $wpa)
{
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
    if ($wpa === 'csv_template') {
        if ($method !== 'GET') return wpkJson(array('ok' => false, 'error' => 'method'), 405);
        $deny = $auth->check(array('ext'));
        if ($deny !== null) return wpkJson(array('ok' => false) + $deny, 403);
        if (!headers_sent()) {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="webphone-anexos.csv"');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }
        return WpkPlan::template();
    }
    if ($method !== 'POST') return wpkJson(array('ok' => false, 'error' => 'method'), 405);
    if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && !in_array($_SERVER['HTTP_SEC_FETCH_SITE'], array('same-origin', 'none'), true)) {
        return wpkJson(array('ok' => false, 'error' => 'origin'), 403);
    }
    $ct = isset($_SERVER['CONTENT_TYPE']) ? strtolower((string)$_SERVER['CONTENT_TYPE']) : '';
    if (strpos($ct, 'application/json') !== 0) return wpkJson(array('ok' => false, 'error' => 'content_type'), 415);
    $tok = isset($_SERVER['HTTP_X_WPK_CSRF']) ? (string)$_SERVER['HTTP_X_WPK_CSRF'] : '';
    if (!WpkApi::csrfOk($tok)) return wpkJson(array('ok' => false, 'error' => 'csrf'), 403);
    $raw = file_get_contents('php://input', false, null, 0, 700001);
    if ($raw === false || strlen($raw) > 700000) return wpkJson(array('ok' => false, 'error' => 'too_big'), 413);
    $in = json_decode($raw, true);
    if (!is_array($in)) return wpkJson(array('ok' => false, 'error' => 'bad_json'), 400);
    $r = $api->handle($wpa, $in);
    if (isset($r['_csv'])) {
        if (!headers_sent()) {
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="webphone-resultado.csv"');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }
        return $r['_csv'];
    }
    $status = (isset($r['error']) && $r['error'] === 'forbidden') ? 403 : 200;
    return wpkJson($r, $status);
}

/** Formularios de la etapa 2 (activar, desactivar, guardar ajustes) sin JavaScript. */
function wpkLegacyPost($smarty, WpkApi $api, WpkAuth $auth)
{
    $t = (isset($_POST['wpk_csrf']) && is_string($_POST['wpk_csrf'])) ? $_POST['wpk_csrf'] : '';
    if (!WpkApi::csrfOk($t)) {
        return array("ERROR", _tr("Request rejected: invalid or missing security token. Reload the page and try again."));
    }
    if (!$auth->isAdmin()) {
        return array("ERROR", _tr("Only administrators can use this module"));
    }
    if (isset($_POST['wpk_save_settings'])) {
        $in = array('settings' => array(
            'ws_path' => isset($_POST['ws_path']) && is_string($_POST['ws_path']) ? $_POST['ws_path'] : '',
            'stun_servers' => isset($_POST['stun_servers']) && is_string($_POST['stun_servers']) ? $_POST['stun_servers'] : '',
            'register_expires' => isset($_POST['register_expires']) && is_string($_POST['register_expires']) ? $_POST['register_expires'] : '',
        ));
        $cur = $api->state();
        $in['settings']['ext_min'] = (string)$cur['ext_range'][0];
        $in['settings']['ext_max'] = (string)$cur['ext_range'][1];
        $r = $api->handle('settings_save', $in);
        if (!empty($r['ok'])) return array("Message", _tr("Settings saved"));
        return array("Validation Error", _tr("The following fields contain errors"));
    }
    $ids = (isset($_POST['ids']) && is_array($_POST['ids'])) ? $_POST['ids'] : array();
    $r = $api->handle('users_toggle', array('enable' => isset($_POST['wpk_enable']), 'ids' => $ids));
    $msg = (isset($_POST['wpk_enable']) ? _tr("Users enabled") : _tr("Users disabled")) . ": " . (int)$r['done'];
    if ($r['skipped'] > 0) $msg .= ". " . _tr("Skipped (no valid extension, or extension already in use)") . ": " . (int)$r['skipped'];
    if ($r['not_webphone'] > 0) $msg .= ". " . _tr("Warning: the extension of some enabled users is not a WebRTC extension") . ": " . (int)$r['not_webphone'];
    if ($r['done'] === 0 && $r['skipped'] === 0) $msg = _tr("No users selected");
    return array("Message", $msg);
}

/** Textos del servidor que el cliente necesita aparte de su propio objeto i18n (nombres de pestanas y avisos de pagina). */
function wpkBootLang()
{
    $keys = array("Webphone Lite", "Enable", "Disable", "Settings", "Users", "Save", "Required field");
    $o = array();
    foreach ($keys as $k) $o[$k] = _tr($k);
    return $o;
}

function wpkPage($module_name, WpkApi $api, $lang)
{
    $state = $api->state();
    $map = array('es' => 'es', 'en' => 'en', 'pt_BR' => 'pt-BR');
    $boot = array(
        'csrf'     => WpkApi::csrfToken(),
        'endpoint' => 'index.php?menu=' . $module_name . '&rawmode=yes',
        'lang'     => isset($map[$lang]) ? $map[$lang] : 'en',
        'state'    => $state,
        'tab'      => (isset($_GET['tab']) && is_string($_GET['tab']) && in_array($_GET['tab'], array('diagnostic', 'anexos', 'users', 'settings', 'wizard'), true)) ? $_GET['tab'] : '',
    );
    $json = json_encode($boot, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    // Inicio rapido (una pantalla) por omision para el administrador; ?tab=advanced abre el asistente completo de siempre
    $adv = (isset($_GET['tab']) && $_GET['tab'] === 'advanced');
    if ($adv) $boot['tab'] = '';
    $boot['quick'] = (!$adv && $boot['tab'] === '' && !empty($state['caps']['admin']));
    $json = json_encode($boot, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    $dir = dirname($_SERVER['SCRIPT_FILENAME']) . "/modules/$module_name/themes/default";
    $v = '0.5.2-' . (is_file("$dir/js/wizard.js") ? filemtime("$dir/js/wizard.js") : 0);
    $base = "modules/" . wpkEsc($module_name) . "/themes/default";
    $html  = "<link rel='stylesheet' href='$base/css/wizard.css?v=" . wpkEsc($v) . "' />\n";
    $html .= "<div id='wpa-root' class='wpa' data-theme='auto'></div>\n";
    // Sin JavaScript: el mismo formulario de la etapa 2 (token CSRF incluido) y un aviso
    $html .= "<noscript><div class='wpa-noscript'><p>" . wpkEsc(_tr("This page needs JavaScript. Without it you can still enable or disable users with this form.")) . "</p>"
           . "<form method='POST' action='?menu=" . wpkEsc($module_name) . "'><input type='hidden' name='wpk_csrf' value='" . wpkEsc(WpkApi::csrfToken()) . "' />"
           . "<label>" . wpkEsc(_tr("User ids")) . " <input type='text' name='ids[]' /></label> "
           . "<button type='submit' name='wpk_enable' value='1'>" . wpkEsc(_tr("Enable")) . "</button> "
           . "<button type='submit' name='wpk_disable' value='1'>" . wpkEsc(_tr("Disable")) . "</button></form></div></noscript>\n";
    $html .= "<script type='application/json' id='wpa-boot'>" . $json . "</script>\n";
    // Orden: textos, nucleo (DOM, red, comprobaciones del navegador), vistas y aplicacion (esta se monta sola)
    $scripts = $boot['quick'] ? array('wizard-core.js', 'quick.js') : array('wizard-i18n.js', 'wizard-core.js', 'wizard-views.js', 'wizard.js');
    foreach ($scripts as $js) {
        $html .= "<script src='$base/js/$js?v=" . wpkEsc($v) . "'></script>\n";
    }
    return $html;
}
?>
