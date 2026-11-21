// Base de datos.
//  - Con DATABASE_URL (Supabase u otro PostgreSQL): datos reales, permanentes.
//  - Sin DATABASE_URL: base temporal en memoria (se borra al reiniciar), ideal para probar.
const { hashPin } = require('./pin');

function createPool() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  const { newDb } = require('pg-mem');
  console.log('Sin DATABASE_URL: usando base temporal en memoria.');
  return new (newDb().adapters.createPg().Pool)();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  id serial PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,              -- 'admin', 'hk' (limpieza) o 'rs' (room service)
  pin_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' -- 'active' o 'lunch'
);
CREATE TABLE IF NOT EXISTS rooms (
  number text PRIMARY KEY,
  assigned_to integer REFERENCES staff(id)   -- quién la limpia
);
CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS reports (          -- un aviso de limpieza por habitación
  id serial PRIMARY KEY,
  room text NOT NULL,
  staff_id integer NOT NULL REFERENCES staff(id),
  status text NOT NULL,                       -- 'pending' (falta reponer), 'done' (repuesto), 'ok' (todo completo)
  created_at bigint NOT NULL,                 -- hora en que avisó limpieza (la pone el servidor)
  done_at bigint,                             -- hora en que repuso room service
  done_by integer REFERENCES staff(id)
);
CREATE TABLE IF NOT EXISTS report_items (     -- qué faltaba en cada aviso
  report_id integer NOT NULL REFERENCES reports(id),
  product_id integer NOT NULL REFERENCES products(id),
  qty integer NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  staff_id integer NOT NULL REFERENCES staff(id),
  created_at bigint NOT NULL DEFAULT 0
);`;

// Datos de ejemplo, solo si la base está vacía.
async function seed(db) {
  const { rows } = await db.query('SELECT count(*) AS n FROM staff');
  if (Number(rows[0].n) > 0) return;

  const people = [
    ['Administración', 'admin', '0000'],
    ['Ana', 'hk', '1111'],
    ['Rosa', 'hk', '2222'],
    ['Marta', 'hk', '3333'],
    ['Luis (mañana)', 'rs', '9001'],
    ['Sofía (tarde)', 'rs', '9002']
  ];
  const ids = [];
  for (const [name, role, pin] of people) {
    const r = await db.query('INSERT INTO staff (name, role, pin_hash, status) VALUES ($1,$2,$3,$4) RETURNING id', [name, role, hashPin(pin), 'active']);
    ids.push(r.rows[0].id);
  }
  const floors = [[2, ids[1]], [3, ids[2]], [4, ids[3]]];       // piso -> persona de limpieza
  for (const [floor, staffId] of floors) {
    for (let i = 1; i <= 6; i++) {
      await db.query('INSERT INTO rooms (number, assigned_to) VALUES ($1,$2)', [floor + '0' + i, staffId]);
    }
  }

  const products = [
    ['Agua', '💧'],
    ['Agua con gas', '🫧'],
    ['Gaseosa', '🥤'],
    ['Cerveza', '🍺'],
    ['Snack salado', '🍿'],
    ['Chocolate', '🍫']
  ];
  for (const [name, color] of products) {
    await db.query('INSERT INTO products (name, color) VALUES ($1,$2)', [name, color]);
  }
}

async function startDb() {
  const db = createPool();
  await db.query(SCHEMA);
  // Compatibilidad con bases de datos ya existentes en Supabase
  try {
    await db.query("ALTER TABLE staff ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'");
  } catch (e) {}
  try {
    await db.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at bigint NOT NULL DEFAULT 0");
  } catch (e) {}
  await seed(db);
  return db;
}

module.exports = { startDb };
