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
    ['Luis', 'rs', '9001'],
    ['Sofía', 'rs', '9002']
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
  const prodIds = [];
  for (const [name, color] of products) {
    const pr = await db.query('INSERT INTO products (name, color) VALUES ($1,$2) RETURNING id', [name, color]);
    prodIds.push(pr.rows[0].id);
  }

  // Semilla de historial de reportes para que el hotel y el evaluador puedan auditar registros pasados
  const now = Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const sampleReports = [
    // [room, cleanerStaffId, status, createdAt, doneAt, restockerStaffId, [[prodIndex, qty]]]
    ['201', ids[1], 'done', now - 50 * minute, now - 22 * minute, ids[4], [[0, 2], [3, 1]]], // Ana -> Luis hace ~40 min
    ['203', ids[1], 'pending', now - 25 * minute, null, null, [[2, 1], [4, 1]]],            // Ana pendiente
    ['302', ids[2], 'done', now - 1 * day - 2 * hour, now - 1 * day - 1 * hour - 40 * minute, ids[5], [[2, 2], [5, 1]]], // Rosa -> Sofía ayer
    ['305', ids[2], 'done', now - 5 * day, now - 5 * day + 18 * minute, ids[4], [[0, 1], [4, 1]]], // Rosa -> Luis hace 5 días
    ['404', ids[3], 'ok', now - 12 * day, null, null, []],                                  // Marta completa sin faltantes hace 12 días
    ['402', ids[3], 'done', now - 22 * day, now - 22 * day + 31 * minute, ids[5], [[3, 2], [1, 1]]], // Marta -> Sofía hace 22 días
    ['205', ids[1], 'done', now - 45 * day, now - 45 * day + 15 * minute, ids[4], [[0, 2], [3, 2]]], // Ana -> Luis hace 45 días (1.5 meses)
    ['301', ids[2], 'done', now - 62 * day, now - 62 * day + 20 * minute, ids[5], [[4, 2], [5, 2]]], // Rosa -> Sofía hace 2 meses (62 días)
  ];

  for (const [room, hkId, status, createdAt, doneAt, rsId, items] of sampleReports) {
    const rep = await db.query(
      'INSERT INTO reports (room, staff_id, status, created_at, done_at, done_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [room, hkId, status, createdAt, doneAt, rsId]
    );
    for (const [pIdx, qty] of items) {
      await db.query(
        'INSERT INTO report_items (report_id, product_id, qty) VALUES ($1,$2,$3)',
        [rep.rows[0].id, prodIds[pIdx], qty]
      );
    }
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
  try {
    await db.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS done_by integer REFERENCES staff(id)");
  } catch (e) {}
  try {
    await db.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS done_at bigint");
  } catch (e) {}
  try {
    await db.query("UPDATE staff SET name = 'Luis' WHERE name LIKE 'Luis%'");
    await db.query("UPDATE staff SET name = 'Sofía' WHERE name LIKE 'Sofía%' OR name LIKE 'Sofia%'");
  } catch (e) {}
  await seed(db);
  return db;
}

module.exports = { startDb };
