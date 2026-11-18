# Vital Market Café

Cáscara instalable (PWA) de Vital Market Café. Abre la aplicación que vive en Apps Script,
guarda una copia en el equipo y permite vender sin internet (las ventas se envían solas al volver).

- `vmc-nucleo.js`: cola de ventas, clave anti-duplicados y copia local (probado con `node tests/nucleo.test.js`).
- `vmc-shell.js`: abre la aplicación, imita `google.script.run` y muestra el aviso de conexión.
- `sw.js` y `manifest.webmanifest`: instalación y apertura sin internet.

No contiene datos, claves ni el código del negocio: eso vive en el Google Sheet y en Apps Script.
