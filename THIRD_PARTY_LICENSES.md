<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<!-- Copyright (C) 2026 Galcyon -->
# Licencias de terceros del cliente webphone

Generado por `client-src/licenses.mjs` desde los `package.json` y archivos de licencia instalados en `client-src/node_modules`.
Las dependencias de EJECUCION son el codigo que viaja dentro de `webphone.js`. Las herramientas de compilacion y de
prueba (vite, esbuild, rollup, axe-core y sus dependencias) NO se distribuyen. Los avisos de las licencias de ejecucion
tambien van como comentario `/*! ... */` al principio de `webphone.js`.

## Dependencias de ejecucion (dentro del bundle)

| Paquete | Version | Licencia |
|---------|---------|----------|
| events | 3.3.0 | MIT |
| jssip | 3.13.8 | MIT |
| sdp-transform | 2.15.0 | MIT |

## Herramientas solo de compilacion y de prueba (devDependencies, no se distribuyen)

Estan fuera del bundle. `axe-core` lo carga solo el arnes de pruebas (`harness/run3b.mjs`) para auditar la accesibilidad
de la interfaz en un navegador de pruebas; su codigo no se copia ni se enlaza en el cliente.

| Paquete | Version | Licencia | Uso |
|---------|---------|----------|-----|
| axe-core | 4.14.0 | MPL-2.0 | auditoria de accesibilidad en las pruebas |
| vite | 7.3.7 | MIT | compilacion |

## events 3.3.0 (MIT)

```
MIT

Copyright Joyent, Inc. and other Node contributors.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## jssip 3.13.8 (MIT)

Sitio: https://jssip.net

```
Name: JsSIP
Author: José Luis Millán <jmillan@aliax.net>
Core Developer: Iñaki Baz Castillo <ibc@aliax.net>
Copyright (c) 2012-2015 José Luis Millán - Versatica <https://github.com/versatica/>


License: The MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## sdp-transform 2.15.0 (MIT)

```
(The MIT License)

Copyright (c) 2013 Eirik Albrigtsen

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
