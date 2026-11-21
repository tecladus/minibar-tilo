// Pantalla de la app. Orden del archivo: 1) estado  2) comunicación con el servidor
// 3) pantallas  4) acciones (botones)  5) arranque.

// ============ 1) ESTADO ============
const state = {
  token: null, user: null,          // sesión
  staff: [],                        // nombres para la pantalla de ingreso
  data: { products: [], rooms: [], reports: [] },   // lo que viene del servidor cada 3 segundos
  admin: null,                      // datos de administración (personal, habitaciones, productos)
  pick: null, pin: '', error: '',   // pantalla de ingreso
  room: null, draft: {},            // habitación abierta y cantidades que está marcando limpieza
  tab: 'pend', range: 'today',      // pestaña activa y período del tablero
  busy: false, banner: '', signature: '', offline: false, first: true,
};
const app = document.getElementById('app');

// ============ 2) COMUNICACIÓN CON EL SERVIDOR ============
async function api(url, method = 'GET', body) {
  try {
    const res = await fetch('/api' + url, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (state.token || '') },
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, json };
  } catch (e) { return { ok: false, status: 0, json: null }; }   // sin internet
}

// Pide los datos y vuelve a dibujar solo si algo cambió (y si no se está escribiendo).
async function refresh() {
  if (!state.token) return;
  const r = await api('/data');
  if (r.status === 401) return logout();
  if (!r.ok) { if (!state.offline) { state.offline = true; draw(); } return; }
  const wasOffline = state.offline; state.offline = false;
  const signature = JSON.stringify(r.json);
  if (signature === state.signature && !wasOffline) return;
  state.signature = signature;
  announceNew(r.json.reports);
  state.data = r.json;
  const typing = ['INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (!state.busy && !typing) draw();
}

// Room service: sonido y cartel cuando entra un aviso nuevo.
function announceNew(newReports) {
  if (state.first || !canRestock()) { state.first = false; return; }
  const known = new Set(state.data.reports.map(r => r.id));
  const fresh = newReports.filter(r => r.status === 'pending' && !known.has(r.id));
  if (!fresh.length) return;
  state.banner = 'Nuevo aviso: habitación ' + fresh.map(r => r.room).join(', ');
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), osc = ctx.createOscillator();
    osc.connect(ctx.destination); osc.frequency.value = 880; osc.start(); osc.stop(ctx.currentTime + 0.3);
    navigator.vibrate && navigator.vibrate([200, 100, 200]);
  } catch (e) {}
}

// ============ 3) PANTALLAS ============
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const canRestock = () => state.user && ['rs', 'admin'].includes(state.user.role);
const productName = id => (state.data.products.find(p => p.id == id) || { name: 'Producto' }).name;
const minutes = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const latestToday = room => state.data.reports.find(r => r.room === room && r.createdAt >= startOfToday());

function draw() {
  const u = state.user;
  const head = `<header><b>Hotel Tilo · Minibar</b><span>${u ? `<span class="who">${h(u.name)}</span><button class="header-btn" data-act="logout">Salir</button>` : ''}</span></header>`;
  const off = state.offline ? '<div class="banner">Sin internet. Reintentando…</div>' : '';
  let body;
  if (!u) body = loginView();
  else if (u.role === 'hk') body = state.room ? roomView() : roomsView();
  else body = staffView();
  app.innerHTML = head + '<main>' + off + body + '</main>';
}

function loginView() {
  if (!state.pick) {
    const roles = { admin: 'Administración', hk: 'Limpieza', rs: 'Room service' };
    return '<h1>Ingresá</h1>' + ['hk', 'rs', 'admin'].map(role => {
      const people = state.staff.filter(s => s.role === role);
      return people.length ? `<h2>${roles[role]}</h2>` + people.map(s => `<button class="main" style="margin-bottom:8px" data-act="pick" data-id="${s.id}">${h(s.name)}</button>`).join('') : '';
    }).join('');
  }
  const who = state.staff.find(s => s.id == state.pick);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="digit" data-n="${n}">${n}</button>`).join('');
  return `<h1>${h(who.name)}</h1><p class="muted" style="text-align:center">Tu código de 4 números</p>
    <div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i < state.pin.length ? 'f' : ''}"></i>`).join('')}</div>
    <div class="err">${h(state.error)}</div>
    <div class="pad">${digits}<button data-act="back">Volver</button><button data-act="digit" data-n="0">0</button><button data-act="erase">Borrar</button></div>`;
}

// ----- Limpieza -----
function roomsView() {
  const rows = state.data.rooms.map(({ number }) => {
    const r = latestToday(number);
    const [cls, label] = !r ? ['', 'Sin revisar'] : r.status === 'pending' ? ['wait', 'Esperando reposición'] : ['ok', 'Listo'];
    return `<button class="room ${cls}" data-act="room" data-room="${h(number)}"><span>Habitación ${h(number)}</span><span class="muted">${label}</span></button>`;
  }).join('');
  return '<h1>Tus habitaciones</h1>' + (rows || '<p class="muted">No tenés habitaciones asignadas. Avisale a administración.</p>');
}

function roomView() {
  const open = latestToday(state.room);
  const back = '<button class="small" data-act="home">← Volver</button>';
  if (open && open.status === 'pending')
    return `${back}<h1>Habitación ${h(state.room)}</h1><div class="card"><span class="tag wait">Ya avisaste</span><p>Room service ya sabe qué falta (hace ${minutes(Date.now() - open.createdAt)}).</p><div class="items">${itemsHtml(open.items)}</div></div>`;
  const total = Object.values(state.draft).reduce((a, b) => a + b, 0);
  const rows = state.data.products.map(p => `<div class="card product" style="--c:${h(p.color)}">
      <span class="name">${h(p.name)}</span>
      <button data-act="minus" data-id="${p.id}">−</button><span class="qty">${state.draft[p.id] || 0}</span><button data-act="plus" data-id="${p.id}">+</button></div>`).join('');
  return `${back}<h1>Habitación ${h(state.room)}</h1><p class="muted">Marcá cuántos faltan de cada producto.</p>${rows}
    <div class="bottom"><button class="main" data-act="send" ${total && !state.busy ? '' : 'disabled'}>Avisar a room service</button>
    <button data-act="complete" ${state.busy ? 'disabled' : ''}>No falta nada</button></div>`;
}
const itemsHtml = items => Object.entries(items || {}).map(([id, n]) => `<span><b>${n}</b> ${h(productName(id))}</span>`).join('') || '<span>Nada</span>';

// ----- Room service y administración -----
function staffView() {
  const pending = state.data.reports.filter(r => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const tabs = [['pend', `Pendientes (${pending.length})`], ['dash', 'Tablero']];
  if (state.user.role === 'admin') tabs.push(['staff', 'Personal'], ['rooms', 'Habitaciones'], ['products', 'Productos']);
  const bar = '<div class="tabs">' + tabs.map(([k, t]) => `<button class="${state.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${t}</button>`).join('') + '</div>';
  const banner = state.banner ? `<div class="banner">${h(state.banner)}</div>` : '';
  const views = { pend: () => pendingView(pending), dash: dashboardView, staff: adminStaffView, rooms: adminRoomsView, products: adminProductsView };
  return banner + bar + (state.tab !== 'pend' && state.tab !== 'dash' && !state.admin ? '<p class="muted">Cargando…</p>' : views[state.tab]());
}

function pendingView(list) {
  if (!list.length) return '<p class="muted" style="text-align:center;margin-top:50px">No hay nada para reponer.</p>';
  return list.map(r => {
    const late = Date.now() - r.createdAt > 3600000;
    return `<div class="card"><div class="row"><b style="font-size:26px">Habitación ${h(r.room)}</b><span class="tag ${late ? 'late' : 'wait'}">Hace ${minutes(Date.now() - r.createdAt)}</span></div>
      <p class="muted">Avisó ${h(r.byName)}</p><div class="items">${itemsHtml(r.items)}</div>
      <button class="main" data-act="done" data-id="${r.id}" ${state.busy ? 'disabled' : ''}>Ya repuse</button></div>`;
  }).join('');
}

function dashboardView() {
  const from = state.range === 'today' ? startOfToday() : Date.now() - 7 * 86400000;
  const reports = state.data.reports.filter(r => r.createdAt >= from);
  const times = reports.filter(r => r.status === 'done').map(r => r.doneAt - r.createdAt);
  const used = {};                                               // consumo = cantidad que limpieza dijo que faltaba
  reports.forEach(r => Object.entries(r.items).forEach(([id, n]) => used[id] = (used[id] || 0) + n));
  const max = Math.max(1, ...Object.values(used));
  const avg = times.length ? minutes(times.reduce((a, b) => a + b, 0) / times.length) : '–';
  const slow = times.length ? minutes(Math.max(...times)) : '–';
  return `<div class="tabs"><button class="${state.range === 'today' ? 'on' : ''}" data-act="range" data-range="today">Hoy</button><button class="${state.range === 'week' ? 'on' : ''}" data-act="range" data-range="week">7 días</button></div>
    <div class="stats"><div class="card"><b>${times.length}</b><span class="muted">repuestos</span></div><div class="card"><b>${avg}</b><span class="muted">tiempo promedio</span></div><div class="card"><b>${slow}</b><span class="muted">el más lento</span></div></div>
    <h2>Consumo por producto</h2><div class="card">${state.data.products.map(p => `<div class="bar"><span>${h(p.name)}</span><span class="t"><div style="width:${(used[p.id] || 0) / max * 100}%"></div></span><b>${used[p.id] || 0}</b></div>`).join('')}</div>
    <p class="muted">Minibares revisados: ${reports.length}. El tiempo se mide desde el aviso de limpieza hasta "Ya repuse".</p>`;
}

function adminStaffView() {
  const roleName = { admin: 'Administración', hk: 'Limpieza', rs: 'Room service' };
  return `<h2>Agregar persona</h2><div class="card form"><input id="n-name" placeholder="Nombre"><select id="n-role"><option value="hk">Limpieza</option><option value="rs">Room service</option><option value="admin">Administración</option></select>
    <input id="n-pin" inputmode="numeric" maxlength="4" placeholder="Código de 4 números"><button class="main" data-act="addStaff">Agregar</button></div>
    <h2>Personal</h2>` + state.admin.staff.map(s => `<div class="card ${s.active ? '' : 'off'}"><div class="row"><div><b>${h(s.name)}</b><div class="muted">${roleName[s.role]}${s.active ? '' : ' · desactivado'}</div></div></div>
    <div class="row" style="margin-top:8px"><button class="small" data-act="rename" data-id="${s.id}" data-name="${h(s.name)}">Cambiar nombre</button><button class="small" data-act="newPin" data-id="${s.id}">Cambiar código</button><button class="small" data-act="toggleStaff" data-id="${s.id}" data-active="${s.active}">${s.active ? 'Desactivar' : 'Activar'}</button></div></div>`).join('');
}

function adminRoomsView() {
  const cleaners = state.admin.staff.filter(s => s.role === 'hk' && s.active);
  const options = sel => '<option value="">Sin asignar</option>' + cleaners.map(c => `<option value="${c.id}" ${c.id == sel ? 'selected' : ''}>${h(c.name)}</option>`).join('');
  return `<h2>Agregar habitación</h2><div class="card form"><input id="r-number" placeholder="Número (ej. 205)"><select id="r-staff">${options(null)}</select><button class="main" data-act="addRoom">Agregar</button></div>
    <h2>Habitaciones (${state.admin.rooms.length})</h2>` + state.admin.rooms.map(r => `<div class="card row"><b style="font-size:22px">${h(r.number)}</b>
    <select data-act="assign" data-room="${h(r.number)}" style="max-width:190px">${options(r.assigned_to)}</select><button class="small" data-act="delRoom" data-room="${h(r.number)}">Borrar</button></div>`).join('');
}

function adminProductsView() {
  const colors = ['#2b7bb9', '#5a9bd4', '#c0392b', '#c98a0b', '#7a5c3e', '#5b3a29', '#2e7d32', '#6d4c91'];
  return `<h2>Agregar producto</h2><div class="card form"><input id="p-name" placeholder="Nombre"><select id="p-color">${colors.map(c => `<option value="${c}" style="color:${c}">■ ${c}</option>`).join('')}</select><button class="main" data-act="addProduct">Agregar</button></div>
    <h2>Productos del minibar</h2>` + state.admin.products.map(p => `<div class="card product ${p.active ? '' : 'off'}" style="--c:${h(p.color)}"><span class="name">${h(p.name)}</span><button class="small" style="width:auto" data-act="toggleProduct" data-id="${p.id}" data-active="${p.active}">${p.active ? 'Quitar' : 'Poner'}</button></div>`).join('');
}

// ============ 4) ACCIONES (lo que pasa al tocar cada botón) ============
function toast(text) { const t = document.getElementById('toast'); t.textContent = text; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 2500); }
const val = id => document.getElementById(id).value.trim();

function logout() {
  Object.assign(state, { token: null, user: null, pick: null, pin: '', room: null, draft: {}, admin: null, tab: 'pend', signature: '' });
  localStorage.removeItem('tilo_session'); draw();
}

async function loadAdmin() { const r = await api('/admin/all'); if (r.ok) state.admin = r.json; }

// Ejecuta una acción de administración, avisa el resultado y recarga las listas.
async function adminCall(url, method, body, okText) {
  const r = await api(url, method, body);
  if (!r.ok) toast(r.status === 409 ? 'Ya existe.' : 'No se pudo guardar. Revisá los datos.');
  else { if (okText) toast(okText); await loadAdmin(); }
  draw();
}

const actions = {
  pick: d => { state.pick = d.id; state.pin = ''; state.error = ''; },
  back: () => { state.pick = null; state.pin = ''; state.error = ''; },
  erase: () => { state.pin = state.pin.slice(0, -1); },
  async digit(d) {
    state.pin += d.n; if (state.pin.length < 4) return;
    const pin = state.pin; state.pin = '';
    const r = await api('/login', 'POST', { staffId: state.pick, pin });
    if (!r.ok) { state.error = r.status === 429 ? 'Muchos intentos. Esperá 1 minuto.' : r.status === 0 ? 'Sin internet.' : 'Código incorrecto.'; return; }
    Object.assign(state, { token: r.json.token, user: r.json.user, pick: null, error: '', first: true, tab: 'pend' });
    localStorage.setItem('tilo_session', JSON.stringify({ token: state.token, user: state.user }));
    await refresh(); state.signature = '';
    if (state.user.role === 'admin') await loadAdmin();
  },
  logout,
  room: d => { state.room = d.room; state.draft = {}; },
  home: () => { state.room = null; state.draft = {}; },
  plus: d => { state.draft[d.id] = Math.min(20, (state.draft[d.id] || 0) + 1); },
  minus: d => { state.draft[d.id] = Math.max(0, (state.draft[d.id] || 0) - 1); },
  async send() { await sendReport('pending'); },
  async complete() { await sendReport('ok'); },
  async done(d) {
    if (state.busy) return; state.busy = true; draw();
    const r = await api('/reports/' + d.id + '/done', 'POST');
    state.busy = false; toast(r.ok ? 'Anotado.' : 'No se pudo guardar. Probá de nuevo.'); await refresh();
  },
  tab: async d => { state.tab = d.tab; state.banner = ''; if (!['pend', 'dash'].includes(d.tab)) await loadAdmin(); },
  range: d => { state.range = d.range; },
  // --- administración ---
  addStaff: () => adminCall('/admin/staff', 'POST', { name: val('n-name'), role: val('n-role'), pin: val('n-pin') }, 'Persona agregada.'),
  rename: d => { const name = prompt('Nombre nuevo:', d.name); return name && adminCall('/admin/staff/' + d.id, 'PUT', { name }, 'Nombre cambiado.'); },
  newPin: d => { const pin = prompt('Código nuevo (4 números):'); return pin && adminCall('/admin/staff/' + d.id, 'PUT', { pin }, 'Código cambiado.'); },
  toggleStaff: d => adminCall('/admin/staff/' + d.id, 'PUT', { active: d.active !== 'true' }),
  addRoom: () => adminCall('/admin/rooms', 'POST', { number: val('r-number'), assignedTo: val('r-staff') }, 'Habitación agregada.'),
  assign: (d, el) => adminCall('/admin/rooms/' + d.room, 'PUT', { assignedTo: el.value }, 'Asignada.'),
  delRoom: d => confirm('¿Borrar la habitación ' + d.room + '?') && adminCall('/admin/rooms/' + d.room, 'DELETE'),
  addProduct: () => adminCall('/admin/products', 'POST', { name: val('p-name'), color: val('p-color') }, 'Producto agregado.'),
  toggleProduct: d => adminCall('/admin/products/' + d.id, 'PUT', { active: d.active !== 'true' }),
};

async function sendReport(status) {
  if (state.busy) return; state.busy = true; draw();
  const r = await api('/reports', 'POST', { room: state.room, status, items: state.draft });
  state.busy = false;
  if (r.ok) { toast(status === 'pending' ? 'Aviso enviado.' : 'Anotado.'); state.room = null; state.draft = {}; }
  else toast(r.status === 409 ? 'Esa habitación ya tiene un aviso.' : 'No se pudo enviar. Probá de nuevo.');
  await refresh(); state.signature = '';
}

async function onEvent(e) {
  const el = e.target.closest('[data-act]');
  if (!el || (e.type === 'change') !== (el.tagName === 'SELECT')) return;   // clicks en botones, cambios en listas
  try { await actions[el.dataset.act](el.dataset, el); } catch (err) { toast('Ocurrió un error.'); }
  draw();
}
document.addEventListener('click', onEvent);
document.addEventListener('change', onEvent);

// ============ 5) ARRANQUE ============
(async function start() {
  const staff = await api('/staff');
  if (staff.ok) state.staff = staff.json;
  try { const s = JSON.parse(localStorage.getItem('tilo_session') || 'null'); if (s) { state.token = s.token; state.user = s.user; } } catch (e) {}
  if (state.user && state.user.role === 'admin') await loadAdmin();
  draw(); await refresh();
  setInterval(refresh, 3000);                                                     // datos nuevos cada 3 segundos
  setInterval(() => { if (canRestock() && !state.busy && ['pend', 'dash'].includes(state.tab)) draw(); }, 60000); // actualiza "hace X min"
})();
