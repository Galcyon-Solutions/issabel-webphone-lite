<?php
/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Copyright (C) 2026 Galcyon
 *
 * Alta de anexos: lectura del CSV, armado de las filas de las tres formas (uno, rango, CSV), validacion EN SECO y
 * exportacion segura del resultado. No toca la base, ni Asterisk, ni IssabelPBX: solo decide que filas son validas.
 *
 * Limites: 500 filas y 256 KB; UTF-8; columnas display_name, extension e issabel_user (opcional). El CSV solo ASIGNA
 * usuarios que ya existen en Issabel: nunca crea usuarios. El resultado exportable no lleva secretos y se protege
 * contra inyeccion de formulas (una celda que empieza con = + - @ tabulador o retorno de carro se antepone con un
 * apostrofe).
 */
class WpkPlan
{
    const MAX_ROWS  = 500;
    const MAX_BYTES = 262144;

    /** Plantilla descargable (con BOM para que Excel respete los acentos). */
    static function template()
    {
        return "\xEF\xBB\xBF" . "display_name,extension,issabel_user\r\n"
             . "Recepcion,7501,\r\n"
             . "Ana Torres,7502,atorres\r\n";
    }

    /** Antepone un apostrofe a lo que una hoja de calculo ejecutaria como formula. */
    static function csvCell($v)
    {
        $s = (string) $v;
        if ($s !== '' && strpos("=+-@\t\r", $s[0]) !== false) {
            $s = "'" . $s;
        }
        if (strpbrk($s, ",\"\r\n") !== false) {
            $s = '"' . str_replace('"', '""', $s) . '"';
        }
        return $s;
    }

    /** CSV del resultado: sin secretos por construccion (solo recibe linea, anexo, nombre, usuario, estado y codigo). */
    static function exportResult(array $rows)
    {
        $out = "\xEF\xBB\xBF" . "line,extension,display_name,issabel_user,status,detail\r\n";
        foreach (array_slice($rows, 0, self::MAX_ROWS) as $r) {
            $out .= implode(',', array(
                self::csvCell(isset($r['line']) ? (int) $r['line'] : 0),
                self::csvCell(isset($r['ext']) ? $r['ext'] : ''),
                self::csvCell(isset($r['name']) ? $r['name'] : ''),
                self::csvCell(isset($r['user']) ? $r['user'] : ''),
                self::csvCell(isset($r['status']) ? $r['status'] : ''),
                self::csvCell(isset($r['code']) ? $r['code'] : ''),
            )) . "\r\n";
        }
        return $out;
    }

    /**
     * Lee el CSV. Devuelve array('rows'=>[...], 'error'=>codigo|null). Cada fila: line (numero de linea del archivo),
     * name, ext, user. La primera fila util debe ser el encabezado.
     */
    static function parseCsv($text)
    {
        if (!is_string($text) || $text === '') {
            return array('rows' => array(), 'error' => 'csv_empty');
        }
        if (strlen($text) > self::MAX_BYTES) {
            return array('rows' => array(), 'error' => 'csv_too_big');
        }
        if (strncmp($text, "\xEF\xBB\xBF", 3) === 0) {
            $text = substr($text, 3);
        }
        // U+FFFD (EF BF BD) es lo que deja un lector al encontrar bytes que no son UTF-8
        if (!mb_check_encoding($text, 'UTF-8') || strpos($text, "\0") !== false || strpos($text, "\xEF\xBF\xBD") !== false) {
            return array('rows' => array(), 'error' => 'csv_encoding');
        }
        $lines = preg_split('/\r\n|\n|\r/', $text);
        $first = null;
        foreach ($lines as $l) {
            if (trim($l) !== '') {
                $first = $l;
                break;
            }
        }
        if ($first === null) {
            return array('rows' => array(), 'error' => 'csv_empty');
        }
        $delim = (substr_count($first, ';') > substr_count($first, ',')) ? ';' : ',';
        $header = null;
        $cols = array();
        $rows = array();
        foreach ($lines as $i => $l) {
            $lineNo = $i + 1;
            if (trim($l) === '') {
                continue;
            }
            $cells = str_getcsv($l, $delim, '"', '');
            if ($header === null) {
                $header = array_map(function ($c) { return strtolower(trim((string) $c)); }, $cells);
                foreach (array('display_name', 'extension') as $need) {
                    $k = array_search($need, $header, true);
                    if ($k === false) {
                        return array('rows' => array(), 'error' => 'csv_header');
                    }
                    $cols[$need] = $k;
                }
                $k = array_search('issabel_user', $header, true);
                $cols['issabel_user'] = ($k === false) ? null : $k;
                continue;
            }
            if (count($rows) >= self::MAX_ROWS) {
                return array('rows' => array(), 'error' => 'csv_too_many');
            }
            $rows[] = array(
                'line' => $lineNo,
                'name' => isset($cells[$cols['display_name']]) ? trim((string) $cells[$cols['display_name']]) : '',
                'ext'  => isset($cells[$cols['extension']]) ? trim((string) $cells[$cols['extension']]) : '',
                'user' => ($cols['issabel_user'] !== null && isset($cells[$cols['issabel_user']])) ? trim((string) $cells[$cols['issabel_user']]) : '',
            );
        }
        if (count($rows) === 0) {
            return array('rows' => array(), 'error' => 'csv_empty');
        }
        return array('rows' => $rows, 'error' => null);
    }

    /** Filas de un rango desde-hasta con prefijo de nombre. */
    static function rangeRows($from, $to, $prefix)
    {
        if (!is_string($from) || !is_string($to) || preg_match('/^[0-9]{3,6}$/', $from) !== 1 || preg_match('/^[0-9]{3,6}$/', $to) !== 1) {
            return array('rows' => array(), 'error' => 'range_bad');
        }
        $a = (int) $from;
        $b = (int) $to;
        if ($a > $b) {
            return array('rows' => array(), 'error' => 'range_bad');
        }
        if ($b - $a + 1 > self::MAX_ROWS) {
            return array('rows' => array(), 'error' => 'range_too_many');
        }
        $prefix = is_string($prefix) ? trim($prefix) : '';
        if (mb_strlen($prefix, 'UTF-8') > 25) {
            return array('rows' => array(), 'error' => 'range_prefix');
        }
        $rows = array();
        $n = 0;
        for ($e = $a; $e <= $b; $e++) {
            $n++;
            $ext = (string) $e;
            $rows[] = array('line' => $n, 'name' => trim($prefix . ' ' . $ext), 'ext' => $ext, 'user' => '');
        }
        return array('rows' => $rows, 'error' => null);
    }

    /** Una sola fila. */
    static function oneRow($name, $ext, $user)
    {
        return array('rows' => array(array('line' => 1, 'name' => is_string($name) ? trim($name) : '', 'ext' => is_string($ext) ? trim($ext) : '',
                                           'user' => is_string($user) ? trim($user) : '')), 'error' => null);
    }

    /**
     * Validacion en seco. $ctx: min, max (rango de numeros), existing (mapa ext=>true de anexos que ya existen en
     * IssabelPBX), users (mapa usuario=>extension actual de Issabel), me (usuario de la sesion), canAssignOthers (bool),
     * checkRange (callable).
     * Devuelve las filas con 'status' ('ok'|'error') y 'codes' (lista de array('c'=>codigo,'n'=>numero opcional)).
     */
    static function validate(array $rows, array $ctx)
    {
        $byExt = array();
        $byUser = array();
        foreach ($rows as $r) {
            if ($r['ext'] !== '') {
                $byExt[$r['ext']][] = $r['line'];
            }
            if ($r['user'] !== '') {
                $byUser[$r['user']][] = $r['line'];
            }
        }
        $out = array();
        foreach ($rows as $r) {
            $codes = array();
            $name = $r['name'];
            $ext = $r['ext'];
            $user = $r['user'];
            if ($name === '') {
                $codes[] = array('c' => 'name_empty');
            } elseif (mb_strlen($name, 'UTF-8') > 40 || preg_match('/^[^\x00-\x1F\x7F"\\\\<>;|`$]+$/u', $name) !== 1) {
                $codes[] = array('c' => 'bad_chars');
            } elseif (strpos("=+-@", $name[0]) !== false) {
                $codes[] = array('c' => 'formula_start');
            }
            if (preg_match('/^[0-9]{3,6}$/', $ext) !== 1) {
                $codes[] = array('c' => 'bad_ext');
            } else {
                $n = (int) $ext;
                if ($n < (int) $ctx['min'] || $n > (int) $ctx['max']) {
                    $codes[] = array('c' => 'out_of_range');
                } elseif (!call_user_func($ctx['checkRange'], $ext)) {
                    $codes[] = array('c' => 'range_denied');
                }
                if (isset($byExt[$ext]) && count($byExt[$ext]) > 1) {
                    foreach ($byExt[$ext] as $other) {
                        if ($other !== $r['line']) {
                            $codes[] = array('c' => 'dup_in_file', 'n' => $other);
                            break;
                        }
                    }
                }
                if (!empty($ctx['existing'][$ext])) {
                    $codes[] = array('c' => 'ext_exists');
                }
            }
            if ($user !== '') {
                if (preg_match('/^[A-Za-z0-9._@-]{1,50}$/', $user) !== 1) {
                    $codes[] = array('c' => 'bad_chars_user');
                } elseif (!array_key_exists($user, $ctx['users'])) {
                    $codes[] = array('c' => 'user_missing');
                } else {
                    if ($ctx['users'][$user] !== '' && $ctx['users'][$user] !== $ext) {
                        $codes[] = array('c' => 'user_has_ext', 'n' => $ctx['users'][$user]);
                    }
                    if ($user !== $ctx['me'] && !$ctx['canAssignOthers']) {
                        $codes[] = array('c' => 'user_forbidden');
                    }
                    if (isset($byUser[$user]) && count($byUser[$user]) > 1) {
                        foreach ($byUser[$user] as $other) {
                            if ($other !== $r['line']) {
                                $codes[] = array('c' => 'user_dup', 'n' => $other);
                                break;
                            }
                        }
                    }
                }
            }
            $out[] = array('line' => $r['line'], 'name' => $name, 'ext' => $ext, 'user' => $user,
                           'status' => count($codes) === 0 ? 'ok' : 'error', 'codes' => $codes);
        }
        return $out;
    }

    static function summary(array $rows)
    {
        $ok = 0;
        $err = 0;
        $by = array();
        foreach ($rows as $r) {
            if ($r['status'] === 'ok') {
                $ok++;
            } else {
                $err++;
                foreach ($r['codes'] as $c) {
                    $by[$c['c']] = isset($by[$c['c']]) ? $by[$c['c']] + 1 : 1;
                }
            }
        }
        return array('total' => count($rows), 'ok' => $ok, 'errors' => $err, 'by_code' => $by);
    }
}
