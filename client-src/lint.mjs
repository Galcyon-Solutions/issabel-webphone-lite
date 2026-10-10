// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Lint basico sin dependencias: sintaxis (node --check) y patrones prohibidos en el codigo propio y en el bundle.
import { readdirSync, readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD = join(HERE, '..', 'modulo', 'webphone_kit', 'themes', 'default');
let bad = 0;
const fail = m => { console.log('  FALLA ' + m); bad++; };

const srcs = readdirSync(join(HERE, 'src')).map(n => join(HERE, 'src', n));
const own = [...srcs, ...['deps.mjs', 'licenses.mjs', 'lint.mjs', 'vite.config.js', 'build.sh'].map(n => join(HERE, n))];
for (const f of srcs.filter(f => f.endsWith('.js'))) {
  const tmp = join(mkdtempSync(join(tmpdir(), 'wpk-lint-')), 'x.mjs');
  copyFileSync(f, tmp);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (r.status !== 0) fail('sintaxis ' + f + ': ' + r.stderr.split('\n')[0]);
}
const bundle = join(MOD, 'js', 'webphone.js');
const r = spawnSync(process.execPath, ['--check', bundle], { encoding: 'utf8' });
if (r.status !== 0) fail('sintaxis del bundle: ' + r.stderr.split('\n')[0]);

const DASH = new RegExp('[\\u2013\\u2014]');
const FORBID = [
  [/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/, 'HTML dinamico'],
  [/\beval\s*\(|new Function\s*\(/, 'eval o Function'],
  [/(localStorage|sessionStorage)[^;\n]*pass/i, 'clave en almacenamiento'],
  [/document\.cookie\s*=/, 'escritura de cookies'],
  [DASH, 'guion largo'],
  [/XMLHttpRequest|navigator\.sendBeacon|https?:\/\//, 'red externa o telemetria'],
];
for (const f of own) {
  const text = readFileSync(f, 'utf8');
  if (!/SPDX-License-Identifier: GPL-2\.0-or-later/.test(text) || !/Copyright \(C\) 2026 Galcyon/.test(text)) fail('falta cabecera SPDX/Copyright en ' + f);
  if (f.endsWith('lint.mjs')) continue;
  for (const [re, why] of FORBID) if (re.test(text)) fail(`${why} en ${f}`);
}
const btxt = readFileSync(bundle, 'utf8');
if (DASH.test(btxt)) fail('guion largo en el bundle');
if (!/\/\*!/.test(btxt) || !/The MIT License/.test(btxt) || !/JsSIP/.test(btxt)) fail('falta el aviso MIT de JsSIP en el bundle');
if (/sourceMappingURL/.test(btxt)) fail('el bundle referencia un sourcemap');
console.log(bad ? `lint: ${bad} problema(s)` : 'lint: OK');
process.exit(bad ? 1 : 0);
