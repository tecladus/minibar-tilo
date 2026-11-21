// Pantalla de la app: Hotel Tilo · Control de Minibares
// Orden del archivo: 1) estado  2) comunicación con el servidor
// 3) pantallas  4) acciones (botones)  5) arranque.

// ============ 1) ESTADO ============
const state = {
  token: null, user: null,          // sesión
  data: { products: [], rooms: [], reports: [] },   // datos sincronizados del servidor
  admin: null,                      // datos de administración (personal, habitaciones, productos)
  loginUser: '', pin: '', error: '',// pantalla de ingreso seguro
  pinLoading: false,                // indicador de progreso durante verificación
  openMenuId: null,                 // id del empleado con el menú de tres puntos abierto
  openSelectId: null,               // id del custom select actualmente desplegado
  customValues: { 'p-icon': '💧', 'n-role': 'hk', 'r-staff': '' }, // valores seleccionados en custom selects
  formDrafts: {},                   // preserva texto escrito al interactuar con selects
  room: null, draft: {},            // habitación abierta y faltantes seleccionados
  tab: 'pend', range: 'today',      // pestaña activa y rango del tablero
  historyRange: 'all',              // rango del historial: today, 7d, 30d, 60d, all
  historyStatus: 'all',             // estado: all, done, pending, ok
  historySearch: '',                // buscador de historial
  busy: false, banner: '', signature: '', offline: false, first: true,
};
const app = document.getElementById('app');

// ============ 2) COMUNICACIÓN CON EL SERVIDOR ============
async function api(url, method = 'GET', body) {
  try {
    const res = await fetch('/api' + url, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (state.token || ''),
      },
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null };
  }
}

async function refresh() {
  if (!state.token) return;
  const r = await api('/data');
  if (r.status === 401) return logout();
  if (!r.ok) {
    if (!state.offline) { state.offline = true; draw(); }
    return;
  }
  const wasOffline = state.offline;
  state.offline = false;
  const signature = JSON.stringify(r.json);
  if (signature === state.signature && !wasOffline) return;
  state.signature = signature;
  announceNew(r.json.reports);
  state.data = r.json;
  const typing = ['INPUT', 'SELECT'].includes(document.activeElement ? document.activeElement.tagName : '');
  if (!state.busy && !typing) draw();
}

function announceNew(newReports) {
  if (state.first || !canRestock()) { state.first = false; return; }
  const known = new Set(state.data.reports.map(r => r.id));
  const fresh = newReports.filter(r => r.status === 'pending' && !known.has(r.id));
  if (!fresh.length) return;
  state.banner = 'Nuevo aviso de reposición: habitación ' + fresh.map(r => r.room).join(', ');
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (e) {}
}

// ============ 3) PANTALLAS & HELPERS ============
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const canRestock = () => state.user && ['rs', 'admin'].includes(state.user.role);
const productName = id => (state.data.products.find(p => p.id == id) || { name: 'Producto' }).name;
const minutes = ms => {
  const m = Math.round(ms / 60000);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
};
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const latestToday = room => state.data.reports.find(r => r.room === room && r.createdAt >= startOfToday());

function formatDateTime(ts) {
  if (!ts) return '–';
  const d = new Date(Number(ts));
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${mins} hs`;
}

function formatTimeOnly(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${mins} hs`;
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 0) return 'Ahora';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Hace un momento';
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  return `Hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

// Detección y formato exclusivo de iconos para PRODUCTOS
function getProductIcon(p) {
  if (!p) return '📦';
  const val = (p.color || '').trim();
  if (val && !val.startsWith('#')) return val; // si ya es emoji
  const n = (p.name || '').toLowerCase();
  if (n.includes('con gas')) return '🫧';
  if (n.includes('agua')) return '💧';
  if (n.includes('gaseosa') || n.includes('coca') || n.includes('sprite') || n.includes('cola')) return '🥤';
  if (n.includes('cerveza') || n.includes('beer')) return '🍺';
  if (n.includes('vino') || n.includes('wine')) return '🍷';
  if (n.includes('champagne') || n.includes('espumante')) return '🍾';
  if (n.includes('choc') || n.includes('dulce') || n.includes('alfajor')) return '🍫';
  if (n.includes('snack') || n.includes('papa') || n.includes('mani') || n.includes('maní') || n.includes('salado')) return '🍿';
  if (n.includes('gallet') || n.includes('cookie')) return '🍪';
  if (n.includes('cafe') || n.includes('café') || n.includes('té') || n.includes('te')) return '☕';
  if (n.includes('jugo') || n.includes('juice')) return '🧃';
  if (n.includes('shampoo') || n.includes('jabon') || n.includes('jabón') || n.includes('crema')) return '🧴';
  return '🏷️';
}

// Componente de Select Personalizado: el check se ubica siempre en el END (derecha) con el mismo padding exacto
function customSelectHtml({ id, value, options, act = 'selectCustomOption', className = '', dataExtra = {} }) {
  const currentVal = value !== undefined ? String(value) : (String(state.customValues[id] || (options[0] ? options[0].value : '')));
  const currentOpt = options.find(o => String(o.value) === currentVal) || options[0] || { label: '', value: '' };
  const isOpen = state.openSelectId === id;
  const extraAttrs = Object.entries(dataExtra).map(([k, v]) => `data-${k}="${h(v)}"`).join(' ');

  return `
    <div class="custom-select-wrapper ${className} ${isOpen ? 'is-open' : ''}" id="csw-${h(id)}">
      <button type="button" class="custom-select-trigger" data-act="toggleCustomSelect" data-select-id="${h(id)}" ${extraAttrs}>
        <span class="custom-select-trigger-label">${h(currentOpt.label)}</span>
        <span class="custom-select-trigger-arrow">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </span>
      </button>
      <input type="hidden" id="${h(id)}" value="${h(currentVal)}">
      ${isOpen ? `
        <div class="custom-select-dropdown">
          ${options.map(opt => {
            const isSel = String(opt.value) === currentVal;
            return `
              <div class="cs-option ${isSel ? 'is-selected' : ''}" data-act="${act}" data-select-id="${h(id)}" data-value="${h(opt.value)}" ${extraAttrs}>
                <span class="cs-option-label">${h(opt.label)}</span>
                <span class="cs-option-check">
                  ${isSel ? `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ` : ''}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function draw() {
  const u = state.user;
  const roleName = { admin: 'Administración', hk: 'Limpieza', rs: 'Room service' };

  const head = `
    <header>
      <div class="header-content">
        <div class="brand">
          <div class="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 21h18"></path>
              <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
              <path d="M9 7h1"></path><path d="M9 11h1"></path><path d="M9 15h1"></path>
              <path d="M14 7h1"></path><path d="M14 11h1"></path><path d="M14 15h1"></path>
            </svg>
          </div>
          <div class="brand-text">
            <span class="brand-name">Hotel Tilo</span>
            <span class="brand-sub">Minibar</span>
          </div>
        </div>
        ${u ? `
          <div class="user-nav">
            <div class="user-pill">
              <span class="user-initial">${h(u.name.charAt(0).toUpperCase())}</span>
              <div class="user-details">
                <span class="user-title">${h(u.name)}</span>
                <span class="user-role-tag">${h(roleName[u.role] || u.role)}</span>
              </div>
            </div>
            <button class="logout-btn" data-act="logout" title="Cerrar sesión">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>Salir</span>
            </button>
          </div>
        ` : ''}
      </div>
    </header>
  `;

  const off = state.offline ? '<div class="banner">Sin conexión a internet. Reintentando…</div>' : '';
  let body;
  if (!u) body = loginView();
  else if (u.role === 'hk') body = state.room ? roomView() : roomsView();
  else body = staffView();

  app.innerHTML = head + '<main>' + off + body + '</main>';
}

// Pantalla de ingreso seguro: nombre arriba y código abajo
function loginView() {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
    `<button class="pad-num" data-act="digit" data-n="${n}" ${state.pinLoading ? 'disabled' : ''}>${n}</button>`
  ).join('');

  return `
    <div class="card login-card">
      <div class="login-brand-header">
        <h1>Ingreso al Sistema</h1>
        <p class="muted">Escribí tu nombre de usuario y tu código PIN</p>
      </div>

      <div class="login-user-input-box">
        <label class="login-label" for="login-user">Nombre o Usuario</label>
        <input id="login-user" class="input" placeholder="Ej. admin, Ana, Luis" value="${h(state.loginUser)}" autocomplete="username" ${state.pinLoading ? 'disabled' : ''}>
      </div>

      <label class="login-label" style="text-align:center">Código PIN (4 números)</label>
      <div class="dots-wrapper">
        <div class="dots ${state.error ? 'dots-shake' : ''}">
          ${[0, 1, 2, 3].map(i => `<i class="${i < state.pin.length ? 'f' : ''}"></i>`).join('')}
        </div>
      </div>

      <div class="pin-status-area">
        ${state.pinLoading ? `
          <div class="pin-progress">
            <div class="pin-progress-header">
              <div class="spinner"></div>
              <div class="pin-progress-text">
                <strong>Verificando credenciales…</strong>
              </div>
            </div>
            <div class="progress-bar-container"><div class="progress-bar-val"></div></div>
          </div>
        ` : state.error ? `
          <div class="err-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${h(state.error)}</span>
          </div>
        ` : `
          <div class="pin-help">Ingresá tu clave de 4 dígitos con el teclado</div>
        `}
      </div>

      <div class="pad">
        ${digits}
        <button class="pad-action" data-act="clear" ${state.pinLoading ? 'disabled' : ''} title="Limpiar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <span class="pad-action-text">Limpiar</span>
        </button>
        <button class="pad-num" data-act="digit" data-n="0" ${state.pinLoading ? 'disabled' : ''}>0</button>
        <button class="pad-action" data-act="erase" ${state.pinLoading || !state.pin.length ? 'disabled' : ''} title="Borrar">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="18" x2="18" y2="12"></line></svg>
          <span class="pad-action-text">Borrar</span>
        </button>
      </div>

      <div class="login-test-hint">
        Modo prueba: podés ingresar con usuario <b>admin</b> y código <b>0000</b>.
      </div>
    </div>
  `;
}

// ----- Limpieza: Lista de habitaciones asignadas -----
function roomsView() {
  const counts = { total: state.data.rooms.length, wait: 0, ok: 0, new: 0 };
  state.data.rooms.forEach(({ number }) => {
    const r = latestToday(number);
    if (!r) counts.new++;
    else if (r.status === 'pending') counts.wait++;
    else counts.ok++;
  });

  const rows = state.data.rooms.map(({ number }) => {
    const r = latestToday(number);
    const [cls, label] = !r
      ? ['new', 'Sin revisar']
      : r.status === 'pending'
      ? ['wait', 'Esperando reposición']
      : ['ok', 'Listo'];
    return `
      <button class="room-card ${cls}" data-act="room" data-room="${h(number)}">
        <div class="room-card-left">
          <span class="room-number">Habitación ${h(number)}</span>
        </div>
        <div class="room-card-right">
          <span class="tag ${cls}">${label}</span>
          <span class="room-arrow">›</span>
        </div>
      </button>
    `;
  }).join('');

  return `
    <div class="page-header">
      <h1>Tus Habitaciones</h1>
      <div class="room-summary-pills">
        <span class="summary-pill ok">${counts.ok} listas</span>
        <span class="summary-pill wait">${counts.wait} pendientes</span>
        <span class="summary-pill new">${counts.new} sin revisar</span>
      </div>
    </div>
    <div class="rooms-grid">
      ${rows || '<p class="muted empty-state-box">No tenés habitaciones asignadas. Avisale a administración.</p>'}
    </div>
  `;
}

// ----- Limpieza: Detalle de habitación para marcar faltantes -----
function roomView() {
  const open = latestToday(state.room);
  const back = `
    <button class="btn btn-secondary back-nav-btn" data-act="home">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      <span>Volver a habitaciones</span>
    </button>
  `;

  if (open && open.status === 'pending') {
    return `
      ${back}
      <div class="room-header-box">
        <h1>Habitación ${h(state.room)}</h1>
      </div>
      <div class="card pending-alert-card">
        <div class="tag-row">
          <span class="tag wait">Aviso en curso</span>
          <span class="time-ago">Hace ${minutes(Date.now() - open.createdAt)}</span>
        </div>
        <p class="pending-notice">Room service ya fue notificado de los faltantes para esta habitación.</p>
        <div class="items-summary">${itemsHtml(open.items)}</div>
      </div>
    `;
  }

  const total = Object.values(state.draft).reduce((a, b) => a + b, 0);
  const rows = state.data.products.map(p => {
    const qty = state.draft[p.id] || 0;
    return `
      <div class="card product-counter-card">
        <div class="product-details">
          <span class="product-icon-badge">${getProductIcon(p)}</span>
          <span class="product-title">${h(p.name)}</span>
        </div>
        <div class="stepper">
          <button class="stepper-btn minus" data-act="minus" data-id="${p.id}" ${qty === 0 ? 'disabled' : ''} aria-label="Restar">−</button>
          <span class="stepper-qty ${qty > 0 ? 'active' : ''}">${qty}</span>
          <button class="stepper-btn plus" data-act="plus" data-id="${p.id}" aria-label="Sumar">+</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    ${back}
    <div class="room-header-box">
      <h1>Habitación ${h(state.room)}</h1>
      <p class="muted">Marcá cuántas unidades faltan reponer de cada producto.</p>
    </div>
    <div class="products-list">${rows}</div>
    <div class="bottom-bar">
      <button class="btn btn-primary btn-block btn-lg" data-act="send" ${total && !state.busy ? '' : 'disabled'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        <span>Avisar a room service ${total ? `(${total})` : ''}</span>
      </button>
      <button class="btn btn-outline btn-block" data-act="complete" ${state.busy ? 'disabled' : ''}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>No falta nada (Todo completo)</span>
      </button>
    </div>
  `;
}

const itemsHtml = items => {
  const entries = Object.entries(items || {}).filter(([_, n]) => n > 0);
  if (!entries.length) return '<span class="item-chip none">Sin faltantes marcados</span>';
  return entries.map(([id, n]) => {
    const prod = state.data.products.find(p => p.id == id);
    const icon = getProductIcon(prod);
    return `<span class="item-chip"><span style="font-size:16px">${icon}</span> <b class="chip-qty">${n}</b> <span class="chip-name">${h(productName(id))}</span></span>`;
  }).join('');
};

// ----- Room service y administración: Pestañas -----
function staffView() {
  const pending = state.data.reports.filter(r => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const tabs = [
    ['pend', `Pendientes ${pending.length ? `(${pending.length})` : ''}`],
    ['dash', 'Tablero'],
    ['history', 'Historial']
  ];
  if (state.user.role === 'admin') tabs.push(['staff', 'Personal'], ['rooms', 'Habitaciones'], ['products', 'Productos']);

  const bar = `
    <div class="tabs-nav-container">
      <div class="tabs-nav">
        ${tabs.map(([k, t]) => `
          <button class="tab-btn ${state.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">
            ${k === 'pend' && pending.length ? `<span class="badge-dot"></span>` : ''}
            <span>${t}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  const banner = state.banner ? `<div class="banner banner-alert">${h(state.banner)}</div>` : '';
  const views = {
    pend: () => pendingView(pending),
    dash: dashboardView,
    history: historyView,
    staff: adminStaffView,
    rooms: adminRoomsView,
    products: adminProductsView
  };

  return banner + bar + (state.tab !== 'pend' && state.tab !== 'dash' && state.tab !== 'history' && !state.admin
    ? '<div class="loading-state"><div class="spinner"></div><p class="muted">Cargando datos…</p></div>'
    : views[state.tab]());
}

// Vista de reposiciones pendientes
function pendingView(list) {
  if (!list.length) return `
    <div class="empty-state-box card">
      <h3 style="font-size:18px;margin-bottom:6px">Todo al día</h3>
      <p class="muted">No hay avisos pendientes de reposición en este momento.</p>
    </div>
  `;

  return `
    <div class="pending-list">
      ${list.map(r => {
        const elapsed = Date.now() - r.createdAt;
        const late = elapsed > 3600000;
        return `
          <div class="card pending-card ${late ? 'is-late' : ''}">
            <div class="pending-card-header">
              <div class="room-badge-pill">Habitación ${h(r.room)}</div>
              <span class="tag ${late ? 'late' : 'wait'}">
                Hace ${minutes(elapsed)}
              </span>
            </div>
            <div class="reporter-line">
              <span class="muted">Avisó: <b>${h(r.byName)}</b></span>
            </div>
            <div class="pending-items-box">
              <div class="pending-items-title">Falta reponer:</div>
              <div class="items-chips">${itemsHtml(r.items)}</div>
            </div>
            <button class="btn btn-success btn-block" data-act="done" data-id="${r.id}" ${state.busy ? 'disabled' : ''}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Ya repuse esta habitación</span>
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Tablero de métricas y estadísticas
function dashboardView() {
  const from = state.range === 'today' ? startOfToday() : Date.now() - 7 * 86400000;
  const reports = state.data.reports.filter(r => r.createdAt >= from);
  const times = reports.filter(r => r.status === 'done').map(r => r.doneAt - r.createdAt);
  const used = {};
  reports.forEach(r => Object.entries(r.items).forEach(([id, n]) => used[id] = (used[id] || 0) + n));
  const max = Math.max(1, ...Object.values(used));
  const avg = times.length ? minutes(times.reduce((a, b) => a + b, 0) / times.length) : '–';
  const slow = times.length ? minutes(Math.max(...times)) : '–';

  return `
    <div class="dash-range-bar">
      <div class="segmented-control">
        <button class="seg-btn ${state.range === 'today' ? 'active' : ''}" data-act="range" data-range="today">Hoy</button>
        <button class="seg-btn ${state.range === 'week' ? 'active' : ''}" data-act="range" data-range="week">Últimos 7 días</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="card stat-card">
        <b class="stat-num">${times.length}</b>
        <span class="stat-label">Repuestos</span>
      </div>
      <div class="card stat-card">
        <b class="stat-num">${avg}</b>
        <span class="stat-label">Tiempo promedio</span>
      </div>
      <div class="card stat-card">
        <b class="stat-num">${slow}</b>
        <span class="stat-label">El más lento</span>
      </div>
    </div>

    <div class="admin-section-header">
      <h2>Consumo total por producto</h2>
    </div>
    <div class="card chart-card">
      ${state.data.products.map(p => {
        const count = used[p.id] || 0;
        const pct = Math.round((count / max) * 100);
        const icon = getProductIcon(p);
        return `
          <div class="bar-row">
            <div class="bar-label">
              <span style="font-size:18px">${icon}</span>
              <span class="bar-name">${h(p.name)}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%"></div>
            </div>
            <b class="bar-qty">${count}</b>
          </div>
        `;
      }).join('')}
    </div>
    <p class="muted dash-footer-text">Total de avisos procesados: ${reports.length}. El tiempo se mide desde el aviso de limpieza hasta "Ya repuse".</p>
  `;
}

// ----- Historial y Auditoría de Reposiciones -----
function getFilteredHistory() {
  const allReports = state.data.reports || [];
  const search = (state.historySearch || '').toLowerCase().trim();
  const range = state.historyRange || 'all';
  const status = state.historyStatus || 'all';

  const now = Date.now();
  const dayMs = 86400000;
  let fromTime = 0;
  if (range === 'today') fromTime = startOfToday();
  else if (range === '7d') fromTime = now - 7 * dayMs;
  else if (range === '30d') fromTime = now - 30 * dayMs;
  else if (range === '60d') fromTime = now - 60 * dayMs; // 2 meses

  return allReports.filter(r => {
    if (fromTime > 0 && r.createdAt < fromTime) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (search) {
      const matchRoom = String(r.room).toLowerCase().includes(search);
      const matchBy = String(r.byName || '').toLowerCase().includes(search);
      const matchDoneBy = String(r.doneByName || '').toLowerCase().includes(search);
      if (!matchRoom && !matchBy && !matchDoneBy) return false;
    }
    return true;
  });
}

function renderHistoryCards() {
  const filtered = getFilteredHistory();
  if (filtered.length === 0) {
    return `
      <div class="card empty-state-box">
        <h3 style="font-size:17px;margin-bottom:6px">No se encontraron registros</h3>
        <p class="muted">No hay movimientos que coincidan con los filtros seleccionados.</p>
      </div>
    `;
  }

  return `
    <div class="history-list">
      ${filtered.map(r => {
        const isDone = r.status === 'done';
        const isPending = r.status === 'pending';

        const statusTag = isDone
          ? '<span class="history-badge done"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Repuesto</span>'
          : isPending
          ? '<span class="history-badge pending">⏳ Pendiente</span>'
          : '<span class="history-badge ok">✓ Sin faltantes</span>';

        const repTime = isDone && r.doneAt ? minutes(r.doneAt - r.createdAt) : null;

        return `
          <div class="card history-card ${h(r.status)}">
            <div class="history-card-header">
              <div class="history-card-header-left">
                <span class="history-room-pill">Habitación ${h(r.room)}</span>
                ${statusTag}
              </div>
              <div class="history-card-header-right">
                <span class="history-datetime">${formatDateTime(r.createdAt)}</span>
                <span class="history-timeago">(${formatTimeAgo(r.createdAt)})</span>
              </div>
            </div>

            <div class="history-actors-grid">
              <div class="history-actor-item">
                <span class="actor-role-label">Registró faltante (Limpieza)</span>
                <div class="actor-info">
                  <div class="actor-avatar hk">${h((r.byName || 'L').charAt(0))}</div>
                  <div class="actor-text">
                    <span class="actor-name">${h(r.byName || 'Personal de limpieza')}</span>
                    <span class="actor-time">Avisó a las ${formatTimeOnly(r.createdAt)}</span>
                  </div>
                </div>
              </div>

              <div class="history-actor-item">
                <span class="actor-role-label">Repuso (Room service)</span>
                <div class="actor-info">
                  ${isDone ? `
                    <div class="actor-avatar rs">${h((r.doneByName || 'R').charAt(0))}</div>
                    <div class="actor-text">
                      <span class="actor-name">${h(r.doneByName || 'Personal de Room service')}</span>
                      <span class="actor-time">Repuso a las ${formatTimeOnly(r.doneAt)}${repTime ? ` · Tardó ${repTime}` : ''}</span>
                    </div>
                  ` : isPending ? `
                    <div class="actor-avatar pending">⏳</div>
                    <div class="actor-text">
                      <span class="actor-name text-warning" style="color:var(--warning);font-weight:700">En espera de reposición</span>
                      <span class="actor-time">Aviso enviado a Room service</span>
                    </div>
                  ` : `
                    <div class="actor-avatar ok">✓</div>
                    <div class="actor-text">
                      <span class="actor-name" style="color:var(--mut);font-weight:600">Revisión preventiva</span>
                      <span class="actor-time">Minibar completo</span>
                    </div>
                  `}
                </div>
              </div>
            </div>

            <div class="history-items-row">
              <span class="history-items-label">Productos:</span>
              <div class="items-chips">
                ${itemsHtml(r.items)}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function historyView() {
  const allReports = state.data.reports || [];
  const range = state.historyRange || 'all';
  const status = state.historyStatus || 'all';

  const totalCount = allReports.length;
  const doneCount = allReports.filter(r => r.status === 'done').length;
  const pendingCount = allReports.filter(r => r.status === 'pending').length;
  const okCount = allReports.filter(r => r.status === 'ok').length;

  return `
    <div class="page-header">
      <div class="history-header-titles">
        <h1>Historial de Reposiciones</h1>
        <p class="muted" style="margin-top:4px;font-size:14px">Registro permanente de auditoría: trazabilidad de quién registró faltantes, quién repuso y consumo por habitación.</p>
      </div>
      <div class="room-summary-pills" style="margin-top:14px">
        <span class="summary-pill ok">${doneCount} repuestos</span>
        <span class="summary-pill wait">${pendingCount} pendientes</span>
        <span class="summary-pill new">${okCount} sin faltantes</span>
        <span class="summary-pill" style="background:#f1f5f9;color:var(--ink-secondary)">${totalCount} totales</span>
      </div>
    </div>

    <div class="card history-filters-card">
      <div class="history-search-row">
        <div class="history-search-input-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input id="history-search-input" class="history-search-input" placeholder="Buscar por habitación (ej. 201) o personal (ej. Ana, Luis)..." value="${h(state.historySearch || '')}">
          ${state.historySearch ? `
            <button class="clear-search-btn" data-act="clearHistorySearch" title="Borrar búsqueda">✕</button>
          ` : ''}
        </div>
      </div>

      <div class="history-filters-grid">
        <div class="filter-group">
          <label class="filter-label">Período:</label>
          <div class="history-segmented">
            <button class="h-seg-btn ${range === 'today' ? 'active' : ''}" data-act="setHistoryRange" data-range="today">Hoy</button>
            <button class="h-seg-btn ${range === '7d' ? 'active' : ''}" data-act="setHistoryRange" data-range="7d">7 días</button>
            <button class="h-seg-btn ${range === '30d' ? 'active' : ''}" data-act="setHistoryRange" data-range="30d">30 días</button>
            <button class="h-seg-btn ${range === '60d' ? 'active' : ''}" data-act="setHistoryRange" data-range="60d">2 meses</button>
            <button class="h-seg-btn ${range === 'all' ? 'active' : ''}" data-act="setHistoryRange" data-range="all">Todo</button>
          </div>
        </div>

        <div class="filter-group">
          <label class="filter-label">Estado:</label>
          <div class="history-segmented">
            <button class="h-seg-btn ${status === 'all' ? 'active' : ''}" data-act="setHistoryStatus" data-status="all">Todos</button>
            <button class="h-seg-btn ${status === 'done' ? 'active' : ''}" data-act="setHistoryStatus" data-status="done">Repuestos</button>
            <button class="h-seg-btn ${status === 'pending' ? 'active' : ''}" data-act="setHistoryStatus" data-status="pending">Pendientes</button>
            <button class="h-seg-btn ${status === 'ok' ? 'active' : ''}" data-act="setHistoryStatus" data-status="ok">Sin faltantes</button>
          </div>
        </div>
      </div>
    </div>

    <div class="history-list-wrapper">
      ${renderHistoryCards()}
    </div>
  `;
}

// ----- Administración: Personal -----
function adminStaffView() {
  const roleName = { admin: 'Administración', hk: 'Limpieza', rs: 'Room service' };
  return `
    <div class="admin-section-header">
      <h2>Agregar persona</h2>
    </div>
    <div class="card form-card">
      <div class="form-grid">
        <input id="n-name" class="input" placeholder="Nombre completo" value="${h((state.formDrafts && state.formDrafts['n-name']) || '')}">
        ${customSelectHtml({
          id: 'n-role',
          value: state.customValues['n-role'] || 'hk',
          options: [
            { value: 'hk', label: 'Limpieza' },
            { value: 'rs', label: 'Room service' },
            { value: 'admin', label: 'Administración' },
          ],
        })}
        <input id="n-pin" class="input" inputmode="numeric" maxlength="4" placeholder="Código PIN (4 números)" value="${h((state.formDrafts && state.formDrafts['n-pin']) || '')}">
      </div>
      <button class="btn btn-primary" data-act="addStaff">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Agregar persona</span>
      </button>
    </div>

    <div class="admin-section-header">
      <h2>Equipo de Personal (${state.admin.staff.length})</h2>
    </div>
    <div class="staff-admin-list">
      ${state.admin.staff.map(s => `
        <div class="card staff-card ${s.active ? '' : 'is-inactive'}">
          <div class="staff-header-row">
            <div class="staff-name-col">
              <div class="staff-name-line">
                <span class="user-initial sm">${h(s.name.charAt(0).toUpperCase())}</span>
                <b class="staff-name">${h(s.name)}</b>
              </div>
              <div class="staff-meta">
                <span class="role-badge role-${s.role}">${roleName[s.role]}</span>
                ${!s.active
                  ? '<span class="status-badge inactive"><span class="status-dot"></span>Desactivado</span>'
                  : s.status === 'lunch'
                  ? '<span class="status-badge lunch"><span class="status-dot"></span>Almorzando</span>'
                  : '<span class="status-badge active"><span class="status-dot"></span>Activo</span>'
                }
              </div>
            </div>

            <div class="menu-container">
              <button class="menu-dots-btn" data-act="toggleMenu" data-id="${s.id}" title="Opciones">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2.2"></circle>
                  <circle cx="12" cy="12" r="2.2"></circle>
                  <circle cx="12" cy="19" r="2.2"></circle>
                </svg>
              </button>
              ${state.openMenuId == s.id ? `
                <div class="dropdown-menu">
                  <button class="dropdown-item" data-act="rename" data-id="${s.id}" data-name="${h(s.name)}">
                    <span class="dropdown-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </span>
                    <span class="dropdown-label">Cambiar nombre</span>
                  </button>
                  <button class="dropdown-item" data-act="newPin" data-id="${s.id}">
                    <span class="dropdown-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </span>
                    <span class="dropdown-label">Cambiar código PIN</span>
                  </button>
                  ${s.active ? `
                    <button class="dropdown-item" data-act="toggleLunch" data-id="${s.id}" data-status="${s.status || 'active'}">
                      <span class="dropdown-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                      </span>
                      <span class="dropdown-label">${s.status === 'lunch' ? 'Marcar como Activo' : 'Marcar como Almorzando'}</span>
                    </button>
                  ` : ''}
                  <div class="dropdown-divider"></div>
                  <button class="dropdown-item ${s.active ? 'danger' : 'success'}" data-act="toggleStaff" data-id="${s.id}" data-active="${s.active}">
                    <span class="dropdown-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.active ? '<circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>' : '<polyline points="20 6 9 17 4 12"></polyline>'}</svg>
                    </span>
                    <span class="dropdown-label">${s.active ? 'Desactivar empleado' : 'Activar empleado'}</span>
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ----- Administración: Habitaciones (sin "Asignada a", nombre directo, ellipsis y check a la derecha) -----
function adminRoomsView() {
  const cleaners = state.admin.staff.filter(s => s.role === 'hk' && s.active);
  const cleanerOptions = [
    { value: '', label: 'Sin asignar' },
    ...cleaners.map(c => ({ value: c.id, label: c.name }))
  ];

  return `
    <div class="admin-section-header">
      <h2>Agregar habitación</h2>
    </div>
    <div class="card form-card">
      <div class="form-grid">
        <input id="r-number" class="input" placeholder="Número de habitación (ej. 205)" value="${h((state.formDrafts && state.formDrafts['r-number']) || '')}">
        ${customSelectHtml({
          id: 'r-staff',
          value: state.customValues['r-staff'] || '',
          options: cleanerOptions,
        })}
      </div>
      <button class="btn btn-primary" data-act="addRoom">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Agregar habitación</span>
      </button>
    </div>

    <div class="admin-section-header">
      <h2>Habitaciones (${state.admin.rooms.length})</h2>
    </div>
    <div class="rooms-admin-list">
      ${state.admin.rooms.map(r => `
        <div class="card room-admin-card">
          <div class="room-admin-number">${h(r.number)}</div>
          ${customSelectHtml({
            id: 'room-' + r.number,
            value: r.assigned_to || '',
            options: cleanerOptions,
            act: 'assignRoomSelect',
            className: 'room-select-custom',
            dataExtra: { room: r.number },
          })}
          <button class="btn-sm btn-danger" data-act="delRoom" data-room="${h(r.number)}" title="Borrar habitación">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>Borrar</span>
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

// ----- Administración: Productos (Custom select con check a la derecha y mismo padding) -----
function adminProductsView() {
  const icons = [
    { icon: '💧', label: 'Agua mineral' },
    { icon: '🫧', label: 'Agua con gas' },
    { icon: '🥤', label: 'Gaseosa / Refresco' },
    { icon: '🍺', label: 'Cerveza' },
    { icon: '🍷', label: 'Vino / Copa' },
    { icon: '🍾', label: 'Champagne / Espumante' },
    { icon: '🍫', label: 'Chocolate / Dulce' },
    { icon: '🍿', label: 'Snack salado / Papas' },
    { icon: '🍪', label: 'Galletitas / Alfajor' },
    { icon: '☕', label: 'Café / Té' },
    { icon: '🧃', label: 'Jugo natural' },
    { icon: '🧴', label: 'Amenities / Tocador' },
    { icon: '📦', label: 'Otro producto' },
  ];

  return `
    <div class="admin-section-header">
      <h2>Agregar producto</h2>
    </div>
    <div class="card form-card">
      <div class="form-grid">
        <input id="p-name" class="input" placeholder="Nombre del producto (ej. Cerveza Andes)" value="${h((state.formDrafts && state.formDrafts['p-name']) || '')}">
        ${customSelectHtml({
          id: 'p-icon',
          value: state.customValues['p-icon'] || '💧',
          options: icons.map(i => ({ value: i.icon, label: `${i.icon} ${i.label}` })),
        })}
      </div>
      <button class="btn btn-primary" data-act="addProduct">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Agregar producto</span>
      </button>
    </div>

    <div class="admin-section-header">
      <h2>Productos del minibar</h2>
    </div>
    <div class="products-admin-list">
      ${state.admin.products.map(p => `
        <div class="card product-admin-card ${p.active ? '' : 'is-inactive'}">
          <div class="product-info-row">
            <span class="product-icon-badge">${getProductIcon(p)}</span>
            <span class="product-admin-name">${h(p.name)}</span>
            ${!p.active ? '<span class="status-badge inactive"><span class="status-dot"></span>Inactivo</span>' : ''}
          </div>
          <button class="btn-sm ${p.active ? 'btn-danger' : 'btn-success'}" data-act="toggleProduct" data-id="${p.id}" data-active="${p.active}">
            ${p.active ? `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
              <span>Quitar</span>
            ` : `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Poner</span>
            `}
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

// ============ 4) ACCIONES ============
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.style.display = 'none', 2600);
}
const val = id => document.getElementById(id) ? document.getElementById(id).value.trim() : '';

function logout() {
  Object.assign(state, {
    token: null, user: null, loginUser: '', pin: '', pinLoading: false,
    openMenuId: null, openSelectId: null, room: null, draft: {}, admin: null, tab: 'pend', signature: ''
  });
  localStorage.removeItem('tilo_session');
  draw();
}

async function loadAdmin() {
  const r = await api('/admin/all');
  if (r.ok) state.admin = r.json;
}

async function adminCall(url, method, body, okText) {
  state.openMenuId = null;
  state.openSelectId = null;
  const r = await api(url, method, body);
  if (!r.ok) toast(r.status === 409 ? 'Ya existe.' : 'No se pudo guardar. Revisá los datos.');
  else {
    if (okText) toast(okText);
    await loadAdmin();
  }
  draw();
}

const actions = {
  // Manejo de select personalizado
  toggleCustomSelect: d => {
    state.openSelectId = (state.openSelectId === d.selectId ? null : d.selectId);
    state.openMenuId = null;
  },
  selectCustomOption: d => {
    state.customValues[d.selectId] = d.value;
    state.openSelectId = null;
    const hid = document.getElementById(d.selectId);
    if (hid) hid.value = d.value;
  },
  assignRoomSelect: async d => {
    state.openSelectId = null;
    await adminCall('/admin/rooms/' + d.room, 'PUT', { assignedTo: d.value ? Number(d.value) : null }, 'Habitación asignada.');
  },

  // Manejo de menú contextual de 3 puntos
  toggleMenu: d => {
    state.openMenuId = (state.openMenuId == d.id ? null : d.id);
    state.openSelectId = null;
  },
  toggleLunch: d => {
    const nextStatus = d.status === 'lunch' ? 'active' : 'lunch';
    return adminCall('/admin/staff/' + d.id, 'PUT', { status: nextStatus },
      nextStatus === 'lunch' ? 'Personal marcado como almorzando.' : 'Personal marcado como activo.');
  },

  // Acciones de login
  clear: () => {
    if (state.pinLoading) return;
    state.pin = '';
    state.error = '';
  },
  erase: () => {
    if (state.pinLoading) return;
    state.pin = state.pin.slice(0, -1);
    state.error = '';
  },
  async digit(d) {
    if (state.pinLoading || state.pin.length >= 4) return;
    state.pin += d.n;
    state.error = '';

    const userInp = document.getElementById('login-user');
    if (userInp) state.loginUser = userInp.value.trim();

    if (state.pin.length < 4) {
      draw();
      return;
    }

    if (!state.loginUser) {
      state.error = 'Por favor escribí tu nombre o usuario arriba.';
      state.pin = '';
      draw();
      if (userInp) userInp.focus();
      return;
    }

    state.pinLoading = true;
    draw();

    const pin = state.pin;
    try {
      const r = await api('/login', 'POST', { username: state.loginUser, pin });
      if (!r.ok) {
        state.pinLoading = false;
        state.pin = '';
        state.error = (r.json && r.json.error) ? r.json.error : 'Usuario o código incorrecto.';
        draw();
        return;
      }

      state.pinLoading = false;
      state.pin = '';
      Object.assign(state, {
        token: r.json.token,
        user: r.json.user,
        error: '',
        first: true,
        tab: 'pend'
      });
      localStorage.setItem('tilo_session', JSON.stringify({ token: state.token, user: state.user }));
      await refresh();
      state.signature = '';
      if (state.user.role === 'admin') await loadAdmin();
      draw();
    } catch (err) {
      state.pinLoading = false;
      state.pin = '';
      state.error = 'Error de conexión con el servidor.';
      draw();
    }
  },
  logout,
  room: d => { state.room = d.room; state.draft = {}; },
  home: () => { state.room = null; state.draft = {}; },
  plus: d => { state.draft[d.id] = Math.min(20, (state.draft[d.id] || 0) + 1); },
  minus: d => { state.draft[d.id] = Math.max(0, (state.draft[d.id] || 0) - 1); },
  async send() { await sendReport('pending'); },
  async complete() { await sendReport('ok'); },
  async done(d) {
    if (state.busy) return;
    state.busy = true;
    draw();
    const r = await api('/reports/' + d.id + '/done', 'POST');
    state.busy = false;
    toast(r.ok ? 'Reposición registrada con éxito.' : 'No se pudo guardar. Probá de nuevo.');
    await refresh();
  },
  tab: async d => {
    state.tab = d.tab;
    state.banner = '';
    state.openMenuId = null;
    state.openSelectId = null;
    if (!['pend', 'dash', 'history'].includes(d.tab)) await loadAdmin();
  },
  range: d => { state.range = d.range; },
  setHistoryRange: d => { state.historyRange = d.range; draw(); },
  setHistoryStatus: d => { state.historyStatus = d.status; draw(); },
  clearHistorySearch: () => {
    state.historySearch = '';
    const inp = document.getElementById('history-search-input');
    if (inp) inp.value = '';
    draw();
  },

  // Acciones de administración
  addStaff: () => {
    const name = val('n-name');
    const role = state.customValues['n-role'] || val('n-role') || 'hk';
    const pin = val('n-pin');
    delete (state.formDrafts || {})['n-name'];
    delete (state.formDrafts || {})['n-pin'];
    return adminCall('/admin/staff', 'POST', { name, role, pin }, 'Persona agregada.');
  },
  rename: d => {
    const name = prompt('Nombre nuevo:', d.name);
    return name && adminCall('/admin/staff/' + d.id, 'PUT', { name }, 'Nombre modificado.');
  },
  newPin: d => {
    const pin = prompt('Código nuevo (4 números):');
    return pin && adminCall('/admin/staff/' + d.id, 'PUT', { pin }, 'Código modificado.');
  },
  toggleStaff: d => adminCall('/admin/staff/' + d.id, 'PUT', { active: d.active !== 'true' }),
  addRoom: () => {
    const number = val('r-number');
    const assignedTo = state.customValues['r-staff'] || val('r-staff') || null;
    delete (state.formDrafts || {})['r-number'];
    return adminCall('/admin/rooms', 'POST', { number, assignedTo }, 'Habitación agregada.');
  },
  delRoom: d => confirm('¿Borrar la habitación ' + d.room + '?') && adminCall('/admin/rooms/' + d.room, 'DELETE'),
  addProduct: () => {
    const name = val('p-name');
    const color = state.customValues['p-icon'] || val('p-icon') || '💧';
    delete (state.formDrafts || {})['p-name'];
    return adminCall('/admin/products', 'POST', { name, color }, 'Producto agregado.');
  },
  toggleProduct: d => adminCall('/admin/products/' + d.id, 'PUT', { active: d.active !== 'true' }),
};

async function sendReport(status) {
  if (state.busy) return;
  state.busy = true;
  draw();
  const r = await api('/reports', 'POST', { room: state.room, status, items: state.draft });
  state.busy = false;
  if (r.ok) {
    toast(status === 'pending' ? 'Aviso enviado a room service.' : 'Habitación marcada completa.');
    state.room = null;
    state.draft = {};
  } else {
    toast(r.status === 409 ? 'Esa habitación ya tiene un aviso pendiente.' : 'No se pudo enviar. Probá de nuevo.');
  }
  await refresh();
  state.signature = '';
}

async function onEvent(e) {
  const el = e.target.closest('[data-act]');

  // Si hace clic fuera del menú de tres puntos o de los custom selects, los cerramos
  let needRedraw = false;
  if (!e.target.closest('.menu-container') && state.openMenuId !== null) {
    state.openMenuId = null;
    needRedraw = true;
  }
  if (!e.target.closest('.custom-select-wrapper') && state.openSelectId !== null) {
    state.openSelectId = null;
    needRedraw = true;
  }
  if (needRedraw && !el) draw();

  // Si cambia el input de usuario de login, guardar valor en state
  if (e.target.id === 'login-user') {
    state.loginUser = e.target.value;
  }

  if (!el || (e.type === 'change') !== (el.tagName === 'SELECT')) return;
  try {
    await actions[el.dataset.act](el.dataset, el);
  } catch (err) {
    console.error(err);
    toast('Ocurrió un error inesperado.');
  }
  draw();
}

document.addEventListener('click', onEvent);
document.addEventListener('change', onEvent);
document.addEventListener('input', e => {
  if (e.target.id === 'login-user') state.loginUser = e.target.value;
  if (e.target.id === 'history-search-input') {
    state.historySearch = e.target.value;
    const listWrapper = document.querySelector('.history-list-wrapper');
    if (listWrapper) {
      listWrapper.innerHTML = renderHistoryCards();
    } else {
      draw();
    }
  }
  if (['p-name', 'n-name', 'n-pin', 'r-number'].includes(e.target.id)) {
    state.formDrafts = state.formDrafts || {};
    state.formDrafts[e.target.id] = e.target.value;
  }
});

// Atajos de teclado en pantalla de PIN
document.addEventListener('keydown', e => {
  if (state.user || state.pinLoading) return;
  if (document.activeElement && document.activeElement.id === 'login-user') {
    if (e.key === 'Enter') {
      const padFirst = document.querySelector('.pad-num');
      if (padFirst) padFirst.focus();
    }
    return;
  }
  if (e.key >= '0' && e.key <= '9') {
    actions.digit({ n: e.key });
  } else if (e.key === 'Backspace') {
    actions.erase();
    draw();
  } else if (e.key === 'Escape') {
    actions.clear();
    draw();
  }
});

// ============ 5) ARRANQUE ============
(async function start() {
  try {
    const s = JSON.parse(localStorage.getItem('tilo_session') || 'null');
    if (s) { state.token = s.token; state.user = s.user; }
  } catch (e) {}
  if (state.user && state.user.role === 'admin') await loadAdmin();
  draw();
  await refresh();
  setInterval(refresh, 3000);
  setInterval(() => {
    if (canRestock() && !state.busy && ['pend', 'dash'].includes(state.tab)) draw();
  }, 60000);
})();
