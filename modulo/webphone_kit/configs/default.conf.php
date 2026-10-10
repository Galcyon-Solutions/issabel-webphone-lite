<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Configuracion del modulo webphone_kit. La clave NO va en el repo: el marcador de la DSN se sustituye en el
 * servidor con install.sh, leyendo web_pass de /etc/asterisk/webphone.conf.
 */
    global $arrConf;
    global $arrConfModule;

    $arrConfModule['module_name']       = 'webphone_kit';
    $arrConfModule['templates_dir']     = 'themes';
    $arrConfModule['dsn_conn_database'] = 'mysql://webphone_web:REEMPLAZAR_CLAVE@localhost/kit_webphone';
?>
