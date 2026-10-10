-- SPDX-License-Identifier: GPL-2.0-or-later
-- Copyright (C) 2026 Galcyon
--
-- Usuarios MySQL de webphone con el minimo privilegio. __CLAVE_WEB__ y __CLAVE_RO__ los sustituye install.sh
-- en el servidor (las claves nunca estan en el repo). Se ejecuta por la entrada estandar, no por mysql -e.
-- GRANT solo suma: por eso primero se revoca todo y luego se otorga exactamente lo definido.

-- Modulo de administracion (menu de Issabel). Sin acceso a la base asterisk.
CREATE USER IF NOT EXISTS 'webphone_web'@'localhost' IDENTIFIED BY '__CLAVE_WEB__';
ALTER USER 'webphone_web'@'localhost' IDENTIFIED BY '__CLAVE_WEB__';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'webphone_web'@'localhost';
GRANT SELECT, INSERT, UPDATE ON kit_webphone.wp_user    TO 'webphone_web'@'localhost';
GRANT SELECT, INSERT, UPDATE ON kit_webphone.wp_setting TO 'webphone_web'@'localhost';
GRANT SELECT ON kit_webphone.v_webphone_ext TO 'webphone_web'@'localhost';

-- Endpoint de configuracion (api/config.php): SOLO SELECT sobre la vista. No lee asterisk.sip ni ninguna tabla.
CREATE USER IF NOT EXISTS 'webphone_ro'@'localhost' IDENTIFIED BY '__CLAVE_RO__';
ALTER USER 'webphone_ro'@'localhost' IDENTIFIED BY '__CLAVE_RO__';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'webphone_ro'@'localhost';
GRANT SELECT ON kit_webphone.v_webphone_cfg TO 'webphone_ro'@'localhost';

FLUSH PRIVILEGES;
