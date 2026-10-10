-- SPDX-License-Identifier: GPL-2.0-or-later
-- Copyright (C) 2026 Galcyon
--
-- Vistas de kit_webphone. Se crean con DEFINER root y SQL SECURITY DEFINER: quien lee la vista no necesita ningun
-- permiso sobre las tablas de la base asterisk. Idempotente (CREATE OR REPLACE).
USE kit_webphone;

-- Lo unico que lee el endpoint api/config.php (usuario webphone_ro, que solo tiene SELECT sobre esta vista).
-- Devuelve filas SOLO de usuarios activados (wp_user.enabled = 1) cuya extension es PJSIP con transport-wss.
-- Incluye el secreto SIP: por eso el usuario de lectura no puede leer asterisk.sip directamente.
-- Los ajustes globales viajan en las mismas filas para que webphone_ro no necesite otra tabla.
CREATE OR REPLACE DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW v_webphone_cfg AS
SELECT
  u.username  AS username,
  u.extension AS extension,
  sec.data    AS secret,
  trn.data    AS transport,
  COALESCE(NULLIF(usr.name, ''), u.extension) AS display_name,
  (SELECT s.v FROM kit_webphone.wp_setting s WHERE s.k = 'ws_path')          AS ws_path,
  (SELECT s.v FROM kit_webphone.wp_setting s WHERE s.k = 'stun_servers')     AS stun_servers,
  (SELECT s.v FROM kit_webphone.wp_setting s WHERE s.k = 'register_expires') AS register_expires,
  (SELECT s.v FROM kit_webphone.wp_setting s WHERE s.k = 'ringtone_enabled') AS ringtone_enabled,
  (SELECT s.v FROM kit_webphone.wp_setting s WHERE s.k = 'ringback_enabled') AS ringback_enabled
FROM kit_webphone.wp_user u
JOIN asterisk.devices d   ON d.id = u.extension AND d.tech = 'pjsip'
JOIN asterisk.sip sec     ON sec.id = d.id AND sec.keyword = 'secret'
JOIN asterisk.sip trn     ON trn.id = d.id AND trn.keyword = 'transport'
LEFT JOIN asterisk.users usr ON usr.extension = d.id
WHERE u.enabled = 1
  AND trn.data = 'transport-wss';

-- Lo que lee el modulo de administracion (webphone_web) para saber que extensiones son de tipo webphone.
-- Sin secretos ni otros datos del endpoint.
CREATE OR REPLACE DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW v_webphone_ext AS
SELECT
  d.id     AS extension,
  trn.data AS transport,
  (trn.data = 'transport-wss') AS is_webphone
FROM asterisk.devices d
JOIN asterisk.sip trn ON trn.id = d.id AND trn.keyword = 'transport'
WHERE d.tech = 'pjsip';
