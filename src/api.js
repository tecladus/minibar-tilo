// Todas las rutas de la API. Cada rol solo puede hacer lo suyo.
const express = require('express');
const crypto = require('crypto');
const { hashPin, checkPin } = require('./pin');

module.exports = function buildApi(db) {
  const api = express.Router();
  const fail = (res, code, msg) => res.status(code).json({ error: msg });
  const isPin = v => /^\d{4}$/.test(String(v));
  const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); fail(res, 500, 'error'); });

  // ---------- Sesión y permisos ----------
  async function auth(req, res, next) {
    const token = (req.headers.authorization || '').slice(7);
    const { rows } = await db.query(
      'SELECT s.id, s.name, s.role FROM sessions t JOIN staff s ON s.id = t.staff_id WHERE t.token = $1 AND s.active = true', [token]);
    if (!rows.length) return fail(res, 401, 'sin sesion');
    req.user = rows[0];
    next();
  }
  const only = (...roles) => (req, res, next) =>
    roles.includes(req.user.role) ? next() : fail(res, 403, 'sin permiso');
  const A = fn => [auth, wrap(fn)];                       // ruta con sesión
  const R = (roles, fn) => [auth, only(...roles), wrap(fn)]; // ruta con sesión y rol

  // ---------- Login ----------
  api.get('/staff', wrap(async (req, res) => {            // lista de nombres para la pantalla de ingreso
    const { rows } = await db.query('SELECT id, name, role FROM staff WHERE active = true ORDER BY role, name');
    res.json(rows);
  }));

  const attempts = {};                                    // bloqueo de 1 minuto tras 5 claves malas
  api.post('/login', wrap(async (req, res) => {
    const { staffId, pin } = req.body;
    const t = attempts[staffId] || { n: 0, until: 0 };
    if (Date.now() < t.until) return fail(res, 429, 'espera');
    const { rows } = await db.query('SELECT * FROM staff WHERE id = $1 AND active = true', [Number(staffId)]);
    if (!rows.length || !isPin(pin) || !checkPin(String(pin), rows[0].pin_hash)) {
      t.n++; if (t.n >= 5) { t.until = Date.now() + 60000; t.n = 0; }
      attempts[staffId] = t;
      return fail(res, 401, 'clave');
    }
    attempts[staffId] = { n: 0, until: 0 };
    const token = crypto.randomBytes(24).toString('hex');
    await db.query('INSERT INTO sessions (token, staff_id) VALUES ($1,$2)', [token, rows[0].id]);
    res.json({ token, user: { id: rows[0].id, name: rows[0].name, role: rows[0].role } });
  }));

  // ---------- Datos que ve cada persona ----------
  async function loadReports(user) {
    const base = `SELECT r.id, r.room, r.status, r.created_at, r.done_at, s.name AS by_name
                  FROM reports r JOIN staff s ON s.id = r.staff_id`;
    const { rows } = user.role === 'hk'
      ? await db.query(base + ' WHERE r.room IN (SELECT number FROM rooms WHERE assigned_to = $1) ORDER BY r.created_at DESC LIMIT 500', [user.id])
      : await db.query(base + ' ORDER BY r.created_at DESC LIMIT 500');
    const reports = rows.map(r => ({ id: r.id, room: r.room, status: r.status, byName: r.by_name,
      createdAt: Number(r.created_at), doneAt: r.done_at ? Number(r.done_at) : null, items: {} }));
    if (reports.length) {
      const marks = reports.map((_, i) => '$' + (i + 1)).join(',');
      const items = await db.query(`SELECT report_id, product_id, qty FROM report_items WHERE report_id IN (${marks})`, reports.map(r => r.id));
      const byId = Object.fromEntries(reports.map(r => [r.id, r]));
      items.rows.forEach(i => { byId[i.report_id].items[i.product_id] = i.qty; });
    }
    return reports;
  }

  api.get('/data', ...A(async (req, res) => {
    const products = (await db.query('SELECT id, name, color FROM products WHERE active = true ORDER BY id')).rows;
    const rooms = req.user.role === 'hk'
      ? (await db.query('SELECT number FROM rooms WHERE assigned_to = $1 ORDER BY number', [req.user.id])).rows
      : (await db.query('SELECT number FROM rooms ORDER BY number')).rows;
    res.json({ products, rooms, reports: await loadReports(req.user) });
  }));

  // ---------- Limpieza: avisar qué falta ----------
  api.post('/reports', ...R(['hk'], async (req, res) => {
    const room = String(req.body.room);
    const mine = await db.query('SELECT 1 FROM rooms WHERE number = $1 AND assigned_to = $2', [room, req.user.id]);
    if (!mine.rows.length) return fail(res, 403, 'habitacion ajena');
    const open = await db.query("SELECT 1 FROM reports WHERE room = $1 AND status = 'pending'", [room]);
    if (open.rows.length) return fail(res, 409, 'ya avisaste');

    const wanted = req.body.status === 'pending' ? req.body.items || {} : {};
    const items = [];                                      // [idProducto, cantidad] validados
    for (const [pid, qty] of Object.entries(wanted)) {
      const n = Math.min(20, Math.floor(Number(qty)) || 0);
      const ok = n > 0 && (await db.query('SELECT 1 FROM products WHERE id = $1 AND active = true', [Number(pid)])).rows.length;
      if (ok) items.push([Number(pid), n]);
    }
    const status = req.body.status === 'pending' ? 'pending' : 'ok';
    if (status === 'pending' && !items.length) return fail(res, 400, 'vacio');

    const r = await db.query('INSERT INTO reports (room, staff_id, status, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
      [room, req.user.id, status, Date.now()]);
    for (const [pid, n] of items)
      await db.query('INSERT INTO report_items (report_id, product_id, qty) VALUES ($1,$2,$3)', [r.rows[0].id, pid, n]);
    res.status(201).json({ id: r.rows[0].id });
  }));

  // ---------- Room service: marcar repuesto ----------
  api.post('/reports/:id/done', ...R(['rs', 'admin'], async (req, res) => {
    const r = await db.query("UPDATE reports SET status = 'done', done_at = $1, done_by = $2 WHERE id = $3 AND status = 'pending' RETURNING id",
      [Date.now(), req.user.id, Number(req.params.id)]);
    res.json({ updated: r.rows.length });                  // si otra persona ya lo hizo, no cambia nada
  }));

  // ---------- Administración ----------
  api.get('/admin/all', ...R(['admin'], async (req, res) => {
    res.json({
      staff: (await db.query('SELECT id, name, role, active FROM staff ORDER BY role, name')).rows,
      rooms: (await db.query('SELECT number, assigned_to FROM rooms ORDER BY number')).rows,
      products: (await db.query('SELECT id, name, color, active FROM products ORDER BY id')).rows,
    });
  }));

  api.post('/admin/staff', ...R(['admin'], async (req, res) => {
    const { name, role, pin } = req.body;
    if (!name || !['hk', 'rs', 'admin'].includes(role) || !isPin(pin)) return fail(res, 400, 'datos');
    await db.query('INSERT INTO staff (name, role, pin_hash) VALUES ($1,$2,$3)', [String(name).slice(0, 40), role, hashPin(String(pin))]);
    res.status(201).json({ ok: true });
  }));

  api.put('/admin/staff/:id', ...R(['admin'], async (req, res) => {
    const id = Number(req.params.id), { name, active, pin } = req.body;
    if (id === req.user.id && active === false) return fail(res, 400, 'no podes desactivarte');
    if (name !== undefined) await db.query('UPDATE staff SET name = $1 WHERE id = $2', [String(name).slice(0, 40), id]);
    if (active !== undefined) await db.query('UPDATE staff SET active = $1 WHERE id = $2', [!!active, id]);
    if (pin !== undefined) {
      if (!isPin(pin)) return fail(res, 400, 'clave de 4 numeros');
      await db.query('UPDATE staff SET pin_hash = $1 WHERE id = $2', [hashPin(String(pin)), id]);
    }
    res.json({ ok: true });
  }));

  api.post('/admin/rooms', ...R(['admin'], async (req, res) => {
    const number = String(req.body.number || '').trim().slice(0, 10);
    if (!number) return fail(res, 400, 'numero');
    const dup = await db.query('SELECT 1 FROM rooms WHERE number = $1', [number]);
    if (dup.rows.length) return fail(res, 409, 'ya existe');
    await db.query('INSERT INTO rooms (number, assigned_to) VALUES ($1,$2)', [number, req.body.assignedTo ? Number(req.body.assignedTo) : null]);
    res.status(201).json({ ok: true });
  }));

  api.put('/admin/rooms/:number', ...R(['admin'], async (req, res) => {
    await db.query('UPDATE rooms SET assigned_to = $1 WHERE number = $2', [req.body.assignedTo ? Number(req.body.assignedTo) : null, req.params.number]);
    res.json({ ok: true });
  }));

  api.delete('/admin/rooms/:number', ...R(['admin'], async (req, res) => {
    await db.query('DELETE FROM rooms WHERE number = $1', [req.params.number]);
    res.json({ ok: true });
  }));

  api.post('/admin/products', ...R(['admin'], async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 30);
    if (!name) return fail(res, 400, 'nombre');
    await db.query('INSERT INTO products (name, color) VALUES ($1,$2)', [name, String(req.body.color || '#2b7bb9').slice(0, 7)]);
    res.status(201).json({ ok: true });
  }));

  api.put('/admin/products/:id', ...R(['admin'], async (req, res) => {
    await db.query('UPDATE products SET active = $1 WHERE id = $2', [!!req.body.active, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  return api;
};
