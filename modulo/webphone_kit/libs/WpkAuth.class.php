<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Permisos del modulo, decididos SIEMPRE en el servidor (esconder un boton no cuenta). Reglas verificadas en el LAB:
 *   1. acceso al menu propio: isUserAuthorizedById($idUser, 'access', 'webphone_kit')
 *   2. privilegio pbxadmin|extensions: hasModulePrivilege(user, 'pbxadmin', 'extensions')  (libs/paloSantoACL.class.php)
 *      para crear o modificar anexos
 *   3. checkRange: solo si la sesion trae $_SESSION['AMP_user'] (la crea IssabelPBX al entrar en pbxadmin);
 *      en Issabel el unico ampuser es admin con rango vacio, asi que casi siempre es verdadero
 *   4. grupo administrator para todo lo que cambia la configuracion del sistema (bloques *_custom.conf, helper,
 *      perfil, ajustes, grupo "Agente web", activar o desactivar usuarios)
 * Asignar un anexo a OTRO usuario ademas exige ser administrator o tener el privilegio userlist|editany.
 * extensions_batch de fabrica NO hace las comprobaciones 2 y 3 (solo el acceso al menu): este modulo no copia ese patron.
 */
class WpkAuth
{
    private $pACL;
    private $user;
    private $idUser = null;

    function __construct($pACL, $user)
    {
        $this->pACL = $pACL;
        $this->user = (string) $user;
        if ($this->user !== '') {
            $id = $pACL->getIdUser($this->user);
            $this->idUser = ($id === false || $id === null) ? null : (int) $id;
        }
    }

    function user()
    {
        return $this->user;
    }

    function menu()
    {
        return $this->idUser !== null && $this->pACL->isUserAuthorizedById($this->idUser, 'access', 'webphone_kit') ? true : false;
    }

    function canExt()
    {
        return $this->user !== '' && $this->pACL->hasModulePrivilege($this->user, 'pbxadmin', 'extensions') ? true : false;
    }

    function isAdmin()
    {
        return $this->user !== '' && $this->pACL->isUserAdministratorGroup($this->user) ? true : false;
    }

    /** El mismo privilegio que el framework exige para la pantalla Configuracion de SIP de Asterisk (pbxadmin, sipsettings). */
    function canSipSettings()
    {
        return $this->user !== '' && $this->pACL->hasModulePrivilege($this->user, 'pbxadmin', 'sipsettings') ? true : false;
    }

    function canAssignOthers()
    {
        return $this->isAdmin() || ($this->user !== '' && $this->pACL->hasModulePrivilege($this->user, 'userlist', 'editany'));
    }

    /** checkRange de IssabelPBX: solo cuenta si existe AMP_user en la sesion. */
    static function checkRange($ext)
    {
        if (!isset($_SESSION['AMP_user'])) {
            return true;
        }
        $a = (array) $_SESSION['AMP_user'];
        $low = isset($a['_extension_low']) ? (string) $a['_extension_low'] : '';
        $high = isset($a['_extension_high']) ? (string) $a['_extension_high'] : '';
        if ($low === '' && $high === '') {
            return true;
        }
        return ((int) $ext >= (int) $low) && ((int) $ext <= (int) $high);
    }

    /**
     * Comprueba lo que pide una accion. $need: 'menu' (siempre), 'ext', 'admin'.
     * Devuelve null si todo esta bien o array('error'=>'forbidden','need'=>...) con el primer requisito que falta.
     */
    function check(array $need)
    {
        if (!$this->menu()) {
            return array('error' => 'forbidden', 'need' => 'menu');
        }
        foreach ($need as $n) {
            if ($n === 'ext' && !$this->canExt()) {
                return array('error' => 'forbidden', 'need' => 'ext');
            }
            if ($n === 'admin' && !$this->isAdmin()) {
                return array('error' => 'forbidden', 'need' => 'admin');
            }
        }
        return null;
    }
}
