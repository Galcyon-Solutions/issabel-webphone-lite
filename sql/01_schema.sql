-- SPDX-License-Identifier: GPL-2.0-or-later
-- Copyright (C) 2026 Galcyon
--
-- Esquema de kit_webphone (unidad webphone). install.sh lo ejecuta por la entrada estandar como root de MariaDB.
-- Idempotente: se repite en cada actualizacion y no borra datos.
CREATE DATABASE IF NOT EXISTS kit_webphone CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE kit_webphone;

-- Marca de propiedad: install.sh y uninstall.sh no tocan una base ajena sin esta fila
CREATE TABLE IF NOT EXISTS kit_meta (
  meta_key   VARCHAR(40) NOT NULL PRIMARY KEY,
  meta_value VARCHAR(120) NOT NULL
) ENGINE=InnoDB;
INSERT INTO kit_meta (meta_key, meta_value) VALUES ('owner', 'webphone')
  ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);

-- Activacion del webphone por usuario de Issabel (acl_user.name). Es la unica tabla que escribe el modulo de
-- administracion. El nombre se compara exacto (utf8mb4_bin): "WP_A" y "wp_a" son usuarios distintos en Issabel.
-- "extension" es la extension que tenia el usuario al activarlo: si despues cambia en acl_user, la vista
-- deja de devolver la fila (falla cerrada) hasta que el administrador vuelva a activarlo.
CREATE TABLE IF NOT EXISTS wp_user (
  username   VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  extension  VARCHAR(20) NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wp_user_ext (extension)
) ENGINE=InnoDB;

-- Ajustes globales (clave/valor). Los valida el modulo de administracion; el endpoint los vuelve a validar.
CREATE TABLE IF NOT EXISTS wp_setting (
  k VARCHAR(40)  NOT NULL PRIMARY KEY,
  v VARCHAR(500) NOT NULL
) ENGINE=InnoDB;

-- Valores por defecto: INSERT IGNORE no pisa lo que el administrador ya cambio.
INSERT IGNORE INTO wp_setting (k, v) VALUES
  ('ws_path',          '/kit-ws'),
  ('stun_servers',     ''),
  ('register_expires', '600'),
  ('ringtone_enabled', '1'),
  ('ringback_enabled', '1');
