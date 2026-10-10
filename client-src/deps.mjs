// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Ayudante de compilacion: recorre las dependencias de EJECUCION instaladas (jssip y sus transitivas) y devuelve su
// nombre, version, licencia y texto de licencia reales leidos de node_modules. Lo usan vite.config.js (aviso del
// bundle) y licenses.mjs (THIRD_PARTY_LICENSES.md).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NM = join(ROOT, 'node_modules');

export function readRootPkg() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
}

function licenseText(dir) {
  const f = readdirSync(dir).find(n => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(n));
  return f ? readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim() : '';
}

// Paquetes que vite.config.js sustituye por src/debug-stub.js: su codigo NO esta en el bundle, asi que no se listan.
const STUBBED = new Set(['debug', 'ms']);

export function runtimeDeps() {
  const seen = new Map();
  const walk = name => {
    if (seen.has(name) || STUBBED.has(name)) return;
    const dir = join(NM, name);
    if (!existsSync(join(dir, 'package.json'))) throw new Error('dependencia no instalada: ' + name);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const lic = typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || 'DESCONOCIDA';
    seen.set(name, { name, version: pkg.version, license: lic, homepage: pkg.homepage || '', text: licenseText(dir) });
    Object.keys(pkg.dependencies || {}).forEach(walk);
  };
  Object.keys(readRootPkg().dependencies || {}).forEach(walk);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
