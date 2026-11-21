// Punto de entrada: arma la base de datos, la API y sirve la pantalla.
const express = require('express');
const path = require('path');
const { startDb } = require('./src/db');
const buildApi = require('./src/api');

async function main() {
  const db = await startDb();               // conecta y deja las tablas listas
  const app = express();

  app.use(express.json({ limit: '50kb' }));
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api', buildApi(db));            // todas las rutas /api/...
  app.use(express.static(path.join(__dirname, 'public'))); // la pantalla (HTML, CSS, JS)

  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => console.log('Minibar Tilo escuchando en el puerto ' + port));
}

main().catch(err => { console.error(err); process.exit(1); });
