// Todas las rutas de la API. Cada rol solo puede hacer lo suyo.
const express = require('express');
const crypto = require('crypto');
const { hashPin, checkPin } = require('./pin');

module.exports = function buildApi(db) {
  const api = express.Router();
  const fail = (res, code, msg, extra = {}) => res.status(code).json({ error: msg, ...extra });
  const isPin = v => /^\d{4}$/.test(String(v));
  const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); fail(res, 500, 'error interno'); });

  // ---------- Sesión y permisos ----------
  async function auth(req, res, next) {
    const token = (req.headers.authorization || '').slice(7);
    if (!token) return fail(res, 401, 'sin sesion');
    const { rows } = await db.query(
      'SELECT s.id, s.name, s.role, COALESCE(s.status, \'active\') AS status FROM sessions t JOIN staff s ON s.id = t.staff_id WHERE t.token = $1 AND s.active = true', [token]);
    if (!rows.length) return fail(res, 401, 'sesión inválida o expirada');
    req.user = rows[0];
    next();
  }
  const only = (...roles) => (req, res, next) =>
    roles.includes(req.user.role) ? next() : fail(res, 403, 'sin permiso');
  const A = fn => [auth, wrap(fn)];                       // ruta con sesión
  const R = (roles, fn) => [auth, only(...roles), wrap(fn)]; // ruta con sesión y rol

  // ---------- Login con control de fuerza bruta y rate-limiting ----------
  const attempts = {}; // Memoria de intentos fallidos por IP + usuario

  api.post('/login', wrap(async (req, res) => {
    const { username, staffId, pin } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const targetKey = String(username || staffId || '').trim().toLowerCase();
    const lockKey = `${clientIp}::${targetKey}`;
    const now = Date.now();
    const t = attempts[lockKey] || { n: 0, until: 0 };

    // Si la cuenta o IP está bloqueada temporalmente:
    if (now < t.until) {
      const waitSec = Math.ceil((t.until - now) / 1000);
      return res.status(429).json({
        error: `Acceso bloqueado por seguridad. Demasiados intentos. Esperá ${waitSec} segundos.`,
        retryAfter: waitSec
      });
    }

    // Búsqueda de usuario (por nombre/usuario o por ID)
    let staffRow = null;
    const { rows: staffList } = await db.query('SELECT * FROM staff WHERE active = true');
    if (targetKey) {
      staffRow = staffList.find(s => {
        const sName = s.name.toLowerCase().trim();
        return sName === targetKey ||
          (targetKey === 'admin' && s.role === 'admin') ||
          (targetKey === 'administracion' && s.role === 'admin') ||
          (targetKey === 'administración' && s.role === 'admin') ||
          (String(s.id) === targetKey);
      });
    } else if (staffId) {
      staffRow = staffList.find(s => s.id == staffId);
    }

    // Validación de usuario y PIN
    if (!staffRow || !isPin(pin) || !checkPin(String(pin), staffRow.pin_hash)) {
      t.n++;
      let waitTime = 0;
      if (t.n >= 10) waitTime = 30 * 60 * 1000;       // 30 min bloqueo tras 10 fallos
      else if (t.n >= 7) waitTime = 5 * 60 * 1000;     // 5 min bloqueo tras 7 fallos
      else if (t.n >= 5) waitTime = 60 * 1000;         // 1 min bloqueo tras 5 fallos

      if (waitTime > 0) {
        t.until = now + waitTime;
        attempts[lockKey] = t;
        const waitMin = Math.ceil(waitTime / 60000);
        return res.status(429).json({
          error: `Superaste los intentos permitidos. Bloqueado temporalmente por ${waitMin} minuto${waitMin > 1 ? 's' : ''}.`,
          retryAfter: Math.ceil(waitTime / 1000)
        });
      }

      attempts[lockKey] = t;
      const left = 5 - t.n;
      return res.status(401).json({
        error: `Usuario o código incorrecto. Te quedan ${left} ${left === 1 ? 'intento' : 'intentos'}.`
      });
    }

    // Credenciales correctas: limpiar intentos fallidos
    delete attempts[lockKey];

    // Token criptográfico seguro de 256 bits (32 bytes)
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions (token, staff_id, created_at) VALUES ($1,$2,$3)', [token, staffRow.id, now]);

    res.json({
      token,
      user: {
        id: staffRow.id,
        name: staffRow.name,
        role: staffRow.role,
        status: staffRow.status || 'active'
      }
    });
  }));

  // Lista pública de staff (solo para sugerencias/auxilio si hiciera falta, sin revelar roles)
  api.get('/staff', wrap(async (req, res) => {
    const { rows } = await db.query('SELECT id, name FROM staff WHERE active = true ORDER BY name');
    res.json(rows);
  }));

  // ---------- Datos del sistema ----------
  async function loadReports(user) {
    const base = `SELECT r.id, r.room, r.status, r.created_at, r.done_at, s.name AS by_name
                  FROM reports r JOIN staff s ON s.id = r.staff_id`;
    const { rows } = user.role === 'hk'
      ? await db.query(base + ' WHERE r.room IN (SELECT number FROM rooms WHERE assigned_to = $1) ORDER BY r.created_at DESC LIMIT 500', [user.id])
      : await db.query(base + ' ORDER BY r.created_at DESC LIMIT 500');
    const reports = rows.map(r => ({
      id: r.id, room: r.room, status: r.status, byName: r.by_name,
      createdAt: Number(r.created_at), doneAt: r.done_at ? Number(r.done_at) : null, items: {}
    }));
    if (reports.length) {
      const marks = reports.map((_, i) => '$' + (i + 1)).join(',');
      const items = await db.query(`SELECT report_id, product_id, qty FROM report_items WHERE report_id IN (${marks})`, reports.map(r => r.id));
      const byId = Object.fromEntries(reports.map(r => [r.id, r]));
      items.rows.forEach(i => { byId[i.report_id].items[i.product_id] = i.qty; });
    }
    return reports;
  }

  api.get('/data', ...A(async (req, res) => {
    const products = (await db.query('SELECT id, name, color, active FROM products WHERE active = true ORDER BY id')).rows;
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
    const items = [];
    for (const [pid, qty] of Object.entries(wanted)) {
      const n = Math.min(20, Math.floor(Number(qty)) || 0);
      const ok = n > 0 && (await db.query('SELECT 1 FROM products WHERE id = $1 AND active = true', [Number(pid)])).rows.length;
      if (ok) items.push([Number(pid), n]);
    }
    const status = req.body.status === 'pending' ? 'pending' : 'ok';
    if (status === 'pending' && !items.length) return fail(res, 400, 'vacio');

    const r = await db.query('INSERT INTO reports (room, staff_id, status, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
      [room, req.user.id, status, Date.now()]);
    for (const [pid, n] of items) {
      await db.query('INSERT INTO report_items (report_id, product_id, qty) VALUES ($1,$2,$3)', [r.rows[0].id, pid, n]);
    }
    res.status(201).json({ id: r.rows[0].id });
  }));

  // ---------- Room service: marcar repuesto ----------
  api.post('/reports/:id/done', ...R(['rs', 'admin'], async (req, res) => {
    const r = await db.query("UPDATE reports SET status = 'done', done_at = $1, done_by = $2 WHERE id = $3 AND status = 'pending' RETURNING id",
      [Date.now(), req.user.id, Number(req.params.id)]);
    res.json({ updated: r.rows.length });
  }));

  // ---------- Administración ----------
  api.get('/admin/all', ...R(['admin'], async (req, res) => {
    res.json({
      staff: (await db.query("SELECT id, name, role, active, COALESCE(status, 'active') AS status FROM staff ORDER BY role, name")).rows,
      rooms: (await db.query('SELECT number, assigned_to FROM rooms ORDER BY number')).rows,
      products: (await db.query('SELECT id, name, color, active FROM products ORDER BY id')).rows,
    });
  }));

  api.post('/admin/staff', ...R(['admin'], async (req, res) => {
    const { name, role, pin } = req.body;
    if (!name || !['hk', 'rs', 'admin'].includes(role) || !isPin(pin)) return fail(res, 400, 'datos inválidos');
    await db.query('INSERT INTO staff (name, role, pin_hash, status) VALUES ($1,$2,$3,$4)', [String(name).slice(0, 40), role, hashPin(String(pin)), 'active']);
    res.status(201).json({ ok: true });
  }));

  api.put('/admin/staff/:id', ...R(['admin'], async (req, res) => {
    const id = Number(req.params.id);
    const { name, active, status, pin } = req.body;
    if (id === req.user.id && active === false) return fail(res, 400, 'No podés desactivarte a vos mismo');

    if (name !== undefined) {
      await db.query('UPDATE staff SET name = $1 WHERE id = $2', [String(name).slice(0, 40), id]);
    }
    if (active !== undefined) {
      await db.query('UPDATE staff SET active = $1 WHERE id = $2', [!!active, id]);
      if (!active) {
        await db.query('DELETE FROM sessions WHERE staff_id = $1', [id]); // Cierra sesiones del desactivado
      }
    }
    if (status !== undefined) {
      const cleanStatus = status === 'lunch' ? 'lunch' : 'active';
      await db.query('UPDATE staff SET status = $1 WHERE id = $2', [cleanStatus, id]);
    }
    if (pin !== undefined) {
      if (!isPin(pin)) return fail(res, 400, 'El código debe ser de 4 números');
      await db.query('UPDATE staff SET pin_hash = $1 WHERE id = $2', [hashPin(String(pin)), id]);
      await db.query('DELETE FROM sessions WHERE staff_id = $1', [id]); // Obliga a re-loguearse con el nuevo PIN
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
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return fail(res, 400, 'nombre');
    const icon = String(req.body.color || req.body.icon || '📦').slice(0, 50);
    await db.query('INSERT INTO products (name, color) VALUES ($1,$2)', [name, icon]);
    res.status(201).json({ ok: true });
  }));

  api.put('/admin/products/:id', ...R(['admin'], async (req, res) => {
    await db.query('UPDATE products SET active = $1 WHERE id = $2', [!!req.body.active, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  return api;
};
