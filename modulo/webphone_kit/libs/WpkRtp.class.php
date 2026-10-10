<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Rango de puertos de audio (RTP): validacion de las llamadas esperadas, formula y lectura del rango efectivo.
 *
 * FORMULA (la misma en el cliente, themes/default/js/wizard-core.js, WPA.rtp.ports):
 *   puertos necesarios = llamadas simultaneas x 4
 *       una llamada entre dos telefonos usa 2 tramos de audio y cada tramo ocupa un par de puertos UDP (RTP y RTCP)
 *   con margen x2, es decir llamadas x 8, redondeado HACIA ARRIBA a multiplos de 100 y con un minimo de 100.
 *   rtpstart se conserva con el valor efectivo actual (se lee de "rtp show settings") y rtpend = rtpstart + puertos.
 * PRECEDENCIA (verificada en el LAB, Asterisk 20.12): res_rtp_asterisk usa la PRIMERA definicion de rtpstart y rtpend que encuentra
 * en rtp.conf. IssabelPBX genera rtp_additional.conf con esas dos lineas (desde Configuracion de SIP de Asterisk, Rangos de
 * puertos RTP) y rtp.conf lo incluye ANTES que rtp_custom.conf: el bloque 'rtp-range' del modulo solo gana si rtp_additional.conf
 * NO define rtpend (rtpstart se conserva igual, da lo mismo). Por eso el Resolver lo comprueba antes de escribir y, de todos modos, verifica despues.
 * Ejemplos con rtpstart 10000: 10 llamadas = 100 puertos (10000 a 10100), 500 = 4000 (10000 a 14000), 2000 = 16000 (10000 a 26000).
 */
class WpkRtp
{
    const MIN_CALLS = 1;
    const MAX_CALLS = 2000;
    const DEFAULT_CALLS = 10;
    /** Mas ancho que esto el rango se considera "muy amplio" (salvo que las llamadas esperadas lo pidan). */
    const WIDE_PORTS = 2000;
    const MAX_PORT = 65535;

    /**
     * Valida las llamadas esperadas. Acepta un entero (o una cadena de solo digitos sin ceros a la izquierda) de 1 a 2000.
     * Rechaza vacio, 0, negativos, decimales (1.5 o 10.0), texto, notacion cientifica (1e3), booleanos y arreglos.
     * @return int|null  el entero, o null si no es valido
     */
    static function parseCalls($v)
    {
        if (is_int($v)) {
            $n = $v;
        } elseif (is_string($v) && preg_match('/^[1-9][0-9]{0,3}$/', $v) === 1) {
            $n = (int) $v;
        } else {
            return null;
        }
        return ($n >= self::MIN_CALLS && $n <= self::MAX_CALLS) ? $n : null;
    }

    /** Puertos que se piden para $calls llamadas (formula del encabezado). */
    static function ports($calls)
    {
        $need = (int) $calls * 4 * 2;
        return max(100, (int) (ceil($need / 100) * 100));
    }

    /** Parsea la salida de "rtp show settings": array(start, end) (0 si no se pudo leer). */
    static function parseSettings($txt)
    {
        $start = preg_match('/Port start:\s+(\d+)/', (string) $txt, $m) ? (int) $m[1] : 0;
        $end = preg_match('/Port end:\s+(\d+)/', (string) $txt, $m) ? (int) $m[1] : 0;
        return array($start, $end);
    }

    /** Rango efectivo hoy en Asterisk. */
    static function effective()
    {
        return self::parseSettings(WpkSystem::asterisk('rtp show settings'));
    }

    /** Cuerpo del bloque 'rtp-range'. */
    static function blockBody($start, $end)
    {
        return 'rtpstart=' . (int) $start . "\nrtpend=" . (int) $end;
    }

    /** Archivo que IssabelPBX genera con el rango (rtp.conf lo incluye antes que rtp_custom.conf). Cambiable solo en pruebas. */
    static $ADDITIONAL = '/etc/asterisk/rtp_additional.conf';

    /**
     * El rango lo define IssabelPBX: rtp_additional.conf trae rtpend (Asterisk se queda con la PRIMERA definicion, asi que un
     * rtpend en el bloque de rtp_custom.conf no tendria efecto). El rtpstart no importa: el modulo siempre lo conserva igual.
     */
    static function definedByPbx()
    {
        $t = is_readable(self::$ADDITIONAL) ? file_get_contents(self::$ADDITIONAL) : '';
        return is_string($t) && preg_match('/^[ \t]*rtpend[ \t]*=/mi', $t) === 1;
    }

    /** Estado previo guardado por bin/rtp_range.php cuando el rango se cambio por la via de IssabelPBX. Cambiable solo en pruebas. */
    static $SNAP_FILE = '/var/lib/asterisk/webphone_kit/rtp_range.snap.json';

    /** El rango esta cambiado por la via de IssabelPBX (hay un estado previo guardado que Deshacer restaura). */
    static function applied()
    {
        return is_file(self::$SNAP_FILE);
    }

    /** Servidor dentro de un contenedor Docker o Podman. */
    static function inDocker()
    {
        return is_file('/.dockerenv') || is_file('/run/.containerenv');
    }

    /**
     * Juicio del rango efectivo frente a las llamadas esperadas: 'ok', 'wide' (muy amplio) o 'short' (insuficiente).
     * Insuficiente: menos de llamadas x 4 puertos (ni siquiera el minimo sin margen).
     * Muy amplio: mas de 2000 puertos Y mas que los que piden las llamadas esperadas (con su margen).
     */
    static function judge($start, $end, $calls)
    {
        $width = $end - $start;
        if ($width < $calls * 4) {
            return 'short';
        }
        if ($width > max(self::WIDE_PORTS, self::ports($calls))) {
            return 'wide';
        }
        return 'ok';
    }
}
