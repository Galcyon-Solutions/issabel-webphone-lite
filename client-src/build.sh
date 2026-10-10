#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Galcyon
#
# Compila el cliente del webphone (en tu maquina, nunca en el servidor: Issabel no trae Node).
#   bash client-src/build.sh [--check]
# Hace: npm ci --ignore-scripts, npm run build, THIRD_PARTY_LICENSES.md, lint y BUNDLE.sha256.
#   --check   compila y comprueba que BUNDLE.sha256 NO cambia (reproducibilidad); sale con error si cambia.
# El resultado va a modulo/webphone_kit/themes/default/{js/webphone.js,css/webphone.css}. No toca ningun servidor.
set -euo pipefail
CS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT="$(dirname "$CS")"
die() { echo "ERROR: $*" >&2; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || die "no hay node/npm en esta maquina"
[ -f "$CS/package.json" ] && [ -f "$CS/package-lock.json" ] || die "faltan package.json o package-lock.json"
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
if [ "$CHECK" = 1 ] && [ -f "$CS/BUNDLE.sha256" ]; then cp "$CS/BUNDLE.sha256" "$CS/.BUNDLE.sha256.prev"; fi

cd "$CS"
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node licenses.mjs
node lint.mjs

MOD="$UNIT/modulo"
JS=webphone_kit/themes/default/js/webphone.js
CSS=webphone_kit/themes/default/css/webphone.css
[ -f "$MOD/$JS" ] && [ -f "$MOD/$CSS" ] || die "la compilacion no produjo webphone.js y webphone.css"
if find "$MOD" -name '*.map' | grep -q .; then die "hay sourcemaps en el modulo"; fi
{
  echo "# SPDX-License-Identifier: GPL-2.0-or-later"
  echo "# Copyright (C) 2026 Galcyon"
  echo "# Generado por client-src/build.sh. Verificar desde modulo/:  sha256sum -c --quiet ../client-src/BUNDLE.sha256"
  echo "# node $(node -v | tr -d v)  npm $(npm -v)  jssip $(node -p "require('./node_modules/jssip/package.json').version")  vite $(node -p "require('./node_modules/vite/package.json').version")"
  echo "# package-lock.json sha256 $(sha256sum --text package-lock.json | cut -d' ' -f1)"
  echo "# bytes webphone.js $(wc -c < "$MOD/$JS" | tr -d ' ')  webphone.css $(wc -c < "$MOD/$CSS" | tr -d ' ')"
  ( cd "$MOD" && sha256sum --text "$JS" "$CSS" | sed 's/ \*/  /' )
} > "$CS/BUNDLE.sha256"
sed 's/^/  /' "$CS/BUNDLE.sha256"

if [ "$CHECK" = 1 ] && [ -f "$CS/.BUNDLE.sha256.prev" ]; then
  if cmp -s "$CS/.BUNDLE.sha256.prev" "$CS/BUNDLE.sha256"; then
    echo "REPRODUCIBLE: BUNDLE.sha256 no cambio"; rm -f "$CS/.BUNDLE.sha256.prev"
  else
    echo "NO REPRODUCIBLE: BUNDLE.sha256 cambio"; diff "$CS/.BUNDLE.sha256.prev" "$CS/BUNDLE.sha256" || true; exit 1
  fi
fi
