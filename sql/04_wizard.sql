-- SPDX-License-Identifier: GPL-2.0-or-later
-- Copyright (C) 2026 Galcyon
--
-- Etapa 2b: estado reanudable del asistente. Migracion idempotente (se repite en cada actualizacion y no borra datos).
-- Una sola fila (id = 1): paso actual, si el asistente se completo y un JSON chico con lo que la persona fue eligiendo
-- (uso interno o externo, caso de conexion segura, modo de alta). No guarda claves ni secretos.
USE kit_webphone;

CREATE TABLE IF NOT EXISTS wp_wizard (
  id         TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  step       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  done       TINYINT(1) NOT NULL DEFAULT 0,
  data       VARCHAR(2000) NOT NULL DEFAULT '{}',
  updated_by VARCHAR(100) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO wp_wizard (id, step, done, data) VALUES (1, 1, 0, '{}');

-- Valores por defecto de la etapa 2b (INSERT IGNORE: no pisa lo que el administrador ya cambio).
-- profile: plantilla heredable de los anexos del webphone (JSON versionado, ver paloSantoWebphoneKit::defaultProfile()).
-- ext_min y ext_max: rango de numeros de anexo que el asistente acepta.
INSERT IGNORE INTO wp_setting (k, v) VALUES
  ('profile',     '{"v":1,"codecs":"auto","recording":"dontcare","callwaiting":true,"outbound_cid":""}'),
  ('ext_min',     '100'),
  ('ext_max',     '99999');

-- Minimo privilegio: el modulo de administracion (webphone_web) solo necesita leer y escribir esta tabla. 03_grants.sql
-- ya revoco todo y volvio a otorgar lo suyo; este GRANT se suma despues (el orden alfabetico de los archivos lo garantiza).
-- Sin DELETE ni DROP: la fila unica solo se actualiza.
GRANT SELECT, INSERT, UPDATE ON kit_webphone.wp_wizard TO 'webphone_web'@'localhost';
FLUSH PRIVILEGES;
