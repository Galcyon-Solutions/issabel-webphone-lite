// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Genera ../THIRD_PARTY_LICENSES.md desde las licencias reales de las dependencias de ejecucion instaladas.
//   node licenses.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDeps, readRootPkg } from './deps.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '..', 'THIRD_PARTY_LICENSES.md');
const deps = runtimeDeps();
let md = '<!-- SPDX-License-Identifier: GPL-2.0-or-later -->\n<!-- Copyright (C) 2026 Galcyon -->\n';
md += '# Licencias de terceros del cliente webphone\n\n';
md += 'Generado por `client-src/licenses.mjs` desde los `package.json` y archivos de licencia instalados en `client-src/node_modules`.\n';
md += 'Las dependencias de EJECUCION son el codigo que viaja dentro de `webphone.js`. Las herramientas de compilacion y de\n';
md += 'prueba (vite, esbuild, rollup, axe-core y sus dependencias) NO se distribuyen. Los avisos de las licencias de ejecucion\n';
md += 'tambien van como comentario `/*! ... */` al principio de `webphone.js`.\n\n';
md += '## Dependencias de ejecucion (dentro del bundle)\n\n';
md += '| Paquete | Version | Licencia |\n|---------|---------|----------|\n';
for (const d of deps) md += `| ${d.name} | ${d.version} | ${d.license} |\n`;

// Herramientas que solo se usan para compilar o probar: NO viajan dentro de webphone.js ni del modulo.
const dev = Object.keys(readRootPkg().devDependencies || {}).sort();
md += '\n## Herramientas solo de compilacion y de prueba (devDependencies, no se distribuyen)\n\n';
md += 'Estan fuera del bundle. `axe-core` lo carga solo el arnes de pruebas (`harness/run3b.mjs`) para auditar la accesibilidad\n';
md += 'de la interfaz en un navegador de pruebas; su codigo no se copia ni se enlaza en el cliente.\n\n';
md += '| Paquete | Version | Licencia | Uso |\n|---------|---------|----------|-----|\n';
for (const n of dev) {
  const pk = JSON.parse(readFileSync(join(ROOT, 'node_modules', n, 'package.json'), 'utf8'));
  const lic = typeof pk.license === 'string' ? pk.license : (pk.license && pk.license.type) || 'DESCONOCIDA';
  md += `| ${n} | ${pk.version} | ${lic} | ${n === 'axe-core' ? 'auditoria de accesibilidad en las pruebas' : 'compilacion'} |\n`;
}

for (const d of deps) {
  md += `\n## ${d.name} ${d.version} (${d.license})\n\n`;
  if (d.homepage) md += `Sitio: ${d.homepage}\n\n`;
  md += '```\n' + (d.text || '(el paquete no trae archivo de licencia)') + '\n```\n';
}
writeFileSync(OUT, md);
console.log('THIRD_PARTY_LICENSES.md: ' + deps.map(d => `${d.name}@${d.version}`).join(', ') + ' | dev: ' + dev.join(', '));
