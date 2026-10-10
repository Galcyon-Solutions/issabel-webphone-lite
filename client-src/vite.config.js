// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Galcyon
// Un solo webphone.js y un solo webphone.css, sin hash ni sourcemaps, dentro del tema del modulo.
import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDeps, readRootPkg } from './deps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = readRootPkg();

// Aviso legal al inicio del bundle: licencia propia y texto completo de cada licencia de terceros (MIT de JsSIP incluido).
const banner = (() => {
  const deps = runtimeDeps();
  let t = `/*! webphone_kit client ${pkg.version}\n * SPDX-License-Identifier: GPL-2.0-or-later\n * Copyright (C) 2026 Galcyon\n *\n`;
  t += ' * Incluye software de terceros (JsSIP y sus dependencias). Avisos de licencia:\n';
  for (const d of deps) {
    t += ` *\n * ---- ${d.name} ${d.version} (${d.license}) ----\n`;
    t += d.text.replace(/\*\//g, '* /').split('\n').map(l => (' * ' + l).replace(/\s+$/, '')).join('\n') + '\n';
  }
  return t + ' */';
})();

// Se antepone al chunk final (despues de minificar) para que el aviso legal no se pierda.
const legalBanner = {
  name: 'wpk-legal-banner',
  enforce: 'post',
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) if (f.type === 'chunk') f.code = banner + String.fromCharCode(10) + f.code;
  },
};

// WPK_GALLERY=1 compila la galeria de estados (cliente + vista previa) a ../testsite/gallery/, aparte del bundle de produccion.
const GALLERY = process.env.WPK_GALLERY === '1';

export default defineConfig({
  root: HERE,
  // JsSIP pide el paquete "debug" para su traza interna, que el cliente siempre apaga: se cambia por un sustituto vacio.
  resolve: { alias: { debug: resolve(HERE, 'src/debug-stub.js') } },
  plugins: [legalBanner],
  publicDir: false,
  logLevel: 'info',
  build: {
    outDir: GALLERY ? resolve(HERE, '../testsite/gallery') : resolve(HERE, '../modulo/webphone_kit/themes/default'),
    emptyOutDir: false,          // el tema ya tiene otros archivos (settings.tpl): nunca se vacia
    sourcemap: false,
    cssCodeSplit: false,
    minify: 'esbuild',
    target: 'es2020',
    reportCompressedSize: false,
    lib: { entry: resolve(HERE, GALLERY ? 'src/gallery-entry.js' : 'src/main.js'), name: 'WebphoneKitBundle', formats: ['iife'], cssFileName: GALLERY ? 'webphone-gallery' : 'webphone' },
    rollupOptions: {
      output: {
        entryFileNames: GALLERY ? 'webphone-gallery.js' : 'js/webphone.js',
        assetFileNames: a => ((a.names || []).some(n => n.endsWith('.css')) ? (GALLERY ? 'webphone-gallery.css' : 'css/webphone.css') : 'assets/[name][extname]'),
        inlineDynamicImports: true,
      },
    },
  },
  define: { 'process.env.NODE_ENV': '"production"' },
});
