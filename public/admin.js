// ============================================================
//  CleanPro Admin Dashboard — Full JS
//  Features: Real-time order notifications + sound, register,
//            smart filters, CSV export, live stats polling
// ============================================================

const API = '/api';

// ── State ──────────────────────────────────────────────────
let authToken     = null;
let currentUser   = null;
let categories    = [];
let allProducts   = [];
let allOrders     = [];
let statsInterval = null;
let currentOrder  = null;
let currentTab    = 'overview';
let lastOrderCount = 0;  // for new-order detection
let notifEnabled  = true;

// ── XSS Protection ─────────────────────────────────────────
function esc(v) {
  if (v == null) return '';
  const d = document.createElement('div');
  d.textContent = String(v);
  return d.innerHTML;
}

// ── Auth ───────────────────────────────────────────────────
const getToken  = ()  => localStorage.getItem('adminToken');
const saveToken = (t) => localStorage.setItem('adminToken', t);
const clearAuth = ()  => { localStorage.removeItem('adminToken'); localStorage.removeItem('adminUser'); };

function authHeaders(json = false) {
  const h = { 'Authorization': `Bearer ${getToken()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// ── Button loading state ────────────────────────────────────
function setBtnLoading(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  if (on) { btn.dataset.orig = btn.textContent; btn.textContent = 'Loading…'; }
  else    { btn.textContent  = btn.dataset.orig || btn.textContent; }
}

// ── Toast ───────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const c   = document.getElementById('toast-container');
  const el  = document.createElement('div');
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '✓'}</span><span class="toast-msg">${esc(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.transition = '.3s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(50px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ── Clock ───────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('t-clock');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };
  tick(); setInterval(tick, 1000);
}

// ════════════════════════════════════════════════════════════
//  NEW ORDER NOTIFICATION SYSTEM
// ════════════════════════════════════════════════════════════

// Generate a beep sound using Web Audio API
function playOrderSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const playTone = (freq, start, duration, type = 'sine') => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.05);
    };

    // Pleasant 3-tone chime: C5, E5, G5
    playTone(523, 0,    0.25);
    playTone(659, 0.25, 0.25);
    playTone(784, 0.5,  0.4);
  } catch (e) {
    console.warn('Audio not available:', e);
  }
}

function showNewOrderNotification(order) {
  // Remove any existing notif
  document.querySelectorAll('.order-notif').forEach(el => el.remove());

  const el   = document.createElement('div');
  el.className = 'order-notif';
  el.innerHTML = `
    <div class="notif-header">
      <div class="notif-icon-wrap">🛒</div>
      <div>
        <div class="notif-title">NEW ORDER</div>
        <div class="notif-sub">Just arrived</div>
      </div>
    </div>
    <div class="notif-body">
      <strong>${esc(order.customerName)}</strong> placed an order<br>
      ${order.items?.length || 0} item(s) · <strong style="color:var(--brand)">EGP ${parseFloat(order.totalAmount||0).toFixed(2)}</strong>
    </div>
    <div class="notif-footer">
      <span>${new Date(order.createdAt||Date.now()).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      <button class="notif-dismiss" onclick="this.closest('.order-notif').remove()">Dismiss ✕</button>
    </div>
  `;

  // Click notification → go to orders
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('notif-dismiss')) return;
    switchTab('orders');
    el.remove();
  });

  document.body.appendChild(el);

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    if (el.parentNode) {
      el.style.transition   = '.4s';
      el.style.opacity      = '0';
      el.style.transform    = 'translateX(80px)';
      setTimeout(() => el.remove(), 400);
    }
  }, 8000);
}

// ════════════════════════════════════════════════════════════
//  AUTH — LOGIN & REGISTER
// ════════════════════════════════════════════════════════════

// Tab switching on login page
document.getElementById('tab-login-btn')?.addEventListener('click', () => {
  document.getElementById('tab-login-btn').classList.add('active');
  document.getElementById('tab-register-btn').classList.remove('active');
  document.getElementById('login-form-wrap').classList.remove('hidden');
  document.getElementById('register-form-wrap').classList.add('hidden');
});

document.getElementById('tab-register-btn')?.addEventListener('click', () => {
  document.getElementById('tab-register-btn').classList.add('active');
  document.getElementById('tab-login-btn').classList.remove('active');
  document.getElementById('register-form-wrap').classList.remove('hidden');
  document.getElementById('login-form-wrap').classList.add('hidden');
});

// Login
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  setBtnLoading(btn, true);

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Login failed'; return; }

    authToken   = data.token;
    currentUser = data.admin;
    saveToken(authToken);
    localStorage.setItem('adminUser', JSON.stringify(data.admin));
    showDashboard();
  } catch { errEl.textContent = 'Connection error. Try again.'; }
  finally  { setBtnLoading(btn, false); }
});

// Register
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn   = document.getElementById('register-btn');
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  setBtnLoading(btn, true);

  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const phone    = document.getElementById('reg-phone').value.trim();
  const password = document.getElementById('reg-password').value;
  const token    = document.getElementById('reg-token').value.trim();

  if (password.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    setBtnLoading(btn, false);
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res  = await fetch(`${API}/auth/register`, {
      method : 'POST',
      headers,
      body   : JSON.stringify({ username, email, phone, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Registration failed'; return; }

    // Auto login after register
    authToken   = data.token;
    currentUser = data.admin;
    saveToken(authToken);
    localStorage.setItem('adminUser', JSON.stringify(data.admin));
    toast(`Welcome, ${username}! Account created.`);
    showDashboard();
  } catch { errEl.textContent = 'Connection error. Try again.'; }
  finally  { setBtnLoading(btn, false); }
});

// Logout
document.getElementById('logout-btn')?.addEventListener('click', () => {
  clearAuth();
  stopStats();
  authToken = null; currentUser = null; lastOrderCount = 0;
  document.getElementById('dashboard-section').classList.add('hidden');
  document.getElementById('login-section').classList.remove('hidden');
  toast('Signed out');
});

async function checkAuth() {
  const token = getToken();
  const user  = localStorage.getItem('adminUser');
  if (!token || !user) return showLogin();
  authToken   = token;
  currentUser = JSON.parse(user);

  try {
    const res = await fetch(`${API}/auth/me`, { headers: authHeaders() });
    if (res.ok) showDashboard();
    else { clearAuth(); showLogin(); }
  } catch { showLogin(); }
}

function showLogin() {
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('dashboard-section').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');

  const initials = (currentUser?.username || 'A')[0].toUpperCase();
  ['sb-avatar','t-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = initials;
  });

  const nameEl = document.getElementById('sb-user-name');
  const roleEl = document.getElementById('sb-user-role');
  if (nameEl) nameEl.textContent = currentUser?.username || 'Admin';
  if (roleEl) roleEl.textContent = currentUser?.role     || 'admin';

  startClock();
  loadAll();
  startStats();
  setupSearch();
}

// ════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ════════════════════════════════════════════════════════════

function switchTab(name) {
  currentTab = name;

  document.querySelectorAll('.sb-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => {
    const isActive = t.id === `tab-${name}`;
    t.classList.toggle('active', isActive);
    t.classList.toggle('hidden', !isActive);
  });

  const titles = {
    overview: 'Overview', products: 'Products',
    categories: 'Categories', orders: 'Orders', 'add-product': 'Add Product',
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[name] || name;

  if (name === 'add-product') resetProductForm();
}

document.querySelectorAll('[data-tab]').forEach(el => {
  el.addEventListener('click', function () {
    const tab = this.dataset.tab;
    if (tab) switchTab(tab);
  });
});

// ════════════════════════════════════════════════════════════
//  SIDEBAR
// ════════════════════════════════════════════════════════════

document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('mobile-open');
});

// ════════════════════════════════════════════════════════════
//  LOAD ALL
// ════════════════════════════════════════════════════════════

async function loadAll() {
  await Promise.all([loadCategories(), loadProducts(), loadOrders()]);
  renderOverview();
}

// ════════════════════════════════════════════════════════════
//  STATS POLLING — with NEW ORDER detection
// ════════════════════════════════════════════════════════════

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`, { headers: authHeaders() });
    if (!res.ok) { if (res.status === 401) showLogin(); return; }
    const s = await res.json();

    animateCount('stat-products', s.totalProducts || 0);
    animateCount('stat-orders',   s.totalOrders   || 0);

    document.getElementById('stat-sales').textContent = `EGP ${(s.totalSales || 0).toFixed(0)}`;

    const pending = s.ordersByStatus?.pending || 0;
    animateCount('stat-pending', pending);

    // Notif bell
    const nb = document.getElementById('notif-count');
    if (nb) { nb.textContent = pending; nb.classList.toggle('hidden', pending === 0); }

    // Sidebar badges
    const bp = document.getElementById('badge-products');
    if (bp) bp.textContent = s.totalProducts || '';
    const bo = document.getElementById('badge-orders');
    if (bo) bo.textContent = pending || '';

    // ── NEW ORDER DETECTION ──
    const totalNow = s.totalOrders || 0;
    if (lastOrderCount > 0 && totalNow > lastOrderCount) {
      // Reload orders to get the new ones
      const prevLen = allOrders.length;
      await loadOrders();

      // Find orders newer than the previous last one
      const newOrders = allOrders.slice(0, totalNow - lastOrderCount);

      if (newOrders.length > 0) {
        playOrderSound();

        // Show notification for the latest new order
        showNewOrderNotification(newOrders[0]);

        // If more than one, show toast for extras
        if (newOrders.length > 1) {
          toast(`${newOrders.length} new orders received!`, 'info');
        }

        renderOverview();
      }
    }

    lastOrderCount = totalNow;
    renderStatusBreakdown(s.ordersByStatus || {});

  } catch (e) { console.error('Stats error:', e); }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent.replace(/\D/g,'')) || 0;
  if (current === target) return;
  const diff = Math.abs(target - current);
  const step = Math.max(1, Math.ceil(diff / 20));
  const dir  = target > current ? 1 : -1;
  let   val  = current;
  const iv   = setInterval(() => {
    val += dir * step;
    if ((dir > 0 && val >= target) || (dir < 0 && val <= target)) {
      val = target;
      clearInterval(iv);
    }
    el.textContent = val;
  }, 30);
}

function renderStatusBreakdown(statusObj) {
  const container = document.getElementById('status-bars');
  if (!container) return;

  const statuses = ['pending','confirmed','delivered','cancelled'];
  const colors   = { pending:'#ffb800', confirmed:'#0099ff', delivered:'#00ff87', cancelled:'#ff4466' };
  const total    = statuses.reduce((s, k) => s + (statusObj[k] || 0), 0);

  if (total === 0) {
    container.innerHTML = '<p style="color:var(--t3);font-size:13px;padding:8px 0">No orders yet.</p>';
    return;
  }

  container.innerHTML = statuses.map(st => {
    const count = statusObj[st] || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="sbar-row">
        <span class="sbar-label">${st}</span>
        <div class="sbar-track">
          <div class="sbar-fill" style="width:${pct}%;background:${colors[st]}"></div>
        </div>
        <span class="sbar-num">${count}</span>
      </div>`;
  }).join('');
}

function startStats() {
  if (statsInterval) return;
  loadStats();
  statsInterval = setInterval(loadStats, 8000); // poll every 8 seconds
}

function stopStats() {
  clearInterval(statsInterval);
  statsInterval = null;
}

// Notif bell → switch to orders
document.getElementById('notif-btn')?.addEventListener('click', () => switchTab('orders'));

// ════════════════════════════════════════════════════════════
//  OVERVIEW
// ════════════════════════════════════════════════════════════

function renderOverview() {
  renderRecentOrders();
  renderLowStock();
}

function renderRecentOrders() {
  const el = document.getElementById('recent-orders');
  if (!el) return;
  const recent = [...allOrders].slice(0, 5);
  if (!recent.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><span class="empty-text">No orders yet</span></div>';
    return;
  }
  const dotColors = { pending:'#ffb800', confirmed:'#0099ff', delivered:'#00ff87', cancelled:'#ff4466' };
  el.innerHTML = recent.map(o => `
    <div class="mini-row">
      <div class="mini-dot" style="background:${dotColors[o.status] || '#555'}"></div>
      <div class="mini-info">
        <div class="mini-name">${esc(o.customerName)}</div>
        <div class="mini-sub">${new Date(o.createdAt).toLocaleDateString()} · <span class="pill pill-${esc(o.status)}">${esc(o.status)}</span></div>
      </div>
      <div class="mini-val">EGP ${parseFloat(o.totalAmount||0).toFixed(0)}</div>
    </div>`).join('');
}

function renderLowStock() {
  const el    = document.getElementById('low-stock-list');
  const count = document.getElementById('low-stock-count');
  if (!el) return;

  const low = allProducts.filter(p => p.stock <= 5).sort((a,b) => a.stock - b.stock).slice(0, 6);
  if (count) count.textContent = low.length ? `${low.length} items` : '';

  if (!low.length) {
    el.innerHTML = '<p style="color:var(--brand);font-size:13px;padding:8px 0">✓ All products well-stocked</p>';
    return;
  }

  el.innerHTML = low.map(p => {
    const color = p.stock === 0 ? 'var(--rose)' : 'var(--amber)';
    return `
      <div class="mini-row">
        <div class="mini-dot" style="background:${color}"></div>
        <div class="mini-info">
          <div class="mini-name">${esc(p.name)}</div>
          <div class="mini-sub">${esc(p.category)}</div>
        </div>
        <div class="mini-val" style="color:${color}">${p.stock} left</div>
      </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
//  CATEGORIES
// ════════════════════════════════════════════════════════════

async function loadCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    if (!res.ok) throw new Error();
    categories = await res.json();
    populateCategoryDropdowns();
    renderCategories();
  } catch { toast('Failed to load categories', 'error'); }
}

function populateCategoryDropdowns() {
  const addOpts    = '<option value="">Select category…</option>' + categories.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  const filterOpts = '<option value="">All Categories</option>'   + categories.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');

  ['product-category','edit-product-category'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = addOpts;
  });

  const filterEl = document.getElementById('product-cat-filter');
  if (filterEl) filterEl.innerHTML = filterOpts;
}

function renderCategories() {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;
  if (!categories.length) {
    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">◎</span><span class="empty-text">No categories yet</span></div>';
    return;
  }
  const countMap = {};
  allProducts.forEach(p => { countMap[p.category] = (countMap[p.category] || 0) + 1; });

  grid.innerHTML = categories.map(c => `
    <div class="cat-card">
      <div class="cat-name">${esc(c.name)}</div>
      <div class="cat-desc">${esc(c.description) || '<em style="color:var(--t3)">No description</em>'}</div>
      <span class="cat-count">${countMap[c.name] || 0} products</span>
      <div class="cat-actions">
        <button class="btn-secondary btn-sm" onclick="editCategory('${esc(c._id)}')">Edit</button>
        <button class="btn-danger btn-sm"    onclick="deleteItem('${esc(c._id)}','category')">Delete</button>
      </div>
    </div>`).join('');
}

document.getElementById('add-category-btn')?.addEventListener('click', openAddCategory);
document.getElementById('qa-add-category')?.addEventListener('click', openAddCategory);

function openAddCategory() {
  document.getElementById('category-modal-title').textContent = 'New Category';
  document.getElementById('category-id').value = '';
  document.getElementById('category-form').reset();
  openModal('category-modal');
}

function editCategory(id) {
  const c = categories.find(x => x._id === id);
  if (!c) return;
  document.getElementById('category-modal-title').textContent = 'Edit Category';
  document.getElementById('category-id').value          = c._id;
  document.getElementById('category-name').value        = c.name;
  document.getElementById('category-description').value = c.description || '';
  openModal('category-modal');
}

document.getElementById('category-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn  = e.target.querySelector('[type=submit]');
  const id   = document.getElementById('category-id').value;
  const name = document.getElementById('category-name').value.trim();
  const desc = document.getElementById('category-description').value;
  if (!name) return toast('Category name required', 'error');
  setBtnLoading(btn, true);
  try {
    const res  = await fetch(id ? `${API}/categories/${id}` : `${API}/categories`, {
      method : id ? 'PUT' : 'POST',
      headers: authHeaders(true),
      body   : JSON.stringify({ name, description: desc }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed', 'error'); return; }
    toast('Category saved!');
    closeModal('category-modal');
    await loadCategories();
  } catch { toast('Error', 'error'); }
  finally  { setBtnLoading(btn, false); }
});

['close-category-modal','cancel-category-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => closeModal('category-modal'))
);

// ════════════════════════════════════════════════════════════
//  PRODUCTS
// ════════════════════════════════════════════════════════════

async function loadProducts() {
  try {
    const res = await fetch(`${API}/products?all=true`);
    if (!res.ok) throw new Error();
    allProducts = await res.json();
    renderProducts();
  } catch { toast('Failed to load products', 'error'); }
}

function renderProducts(list = null) {
  const grid     = document.getElementById('products-grid');
  if (!grid) return;
  const products = list !== null ? list : allProducts;

  if (!products.length) {
    grid.innerHTML = '<div class="empty-state"><span class="empty-icon">⬡</span><span class="empty-text">No products found</span></div>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const stockClass = p.stock === 0 ? 'stock-out' : p.stock <= 5 ? 'stock-low' : 'stock-ok';
    const stockLabel = p.stock === 0 ? 'Out of stock' : `${p.stock} in stock`;
    const imgSrc     = p.image && !p.image.includes('placeholder') ? p.image : null;

    return `
      <div class="product-card">
        <div class="product-img-wrap">
          ${imgSrc
            ? `<img src="${esc(imgSrc)}" alt="${esc(p.name)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=product-img-ph>🧴</div>'">`
            : '<div class="product-img-ph">🧴</div>'}
        </div>
        <div class="product-body">
          <div class="product-name">${esc(p.name)}</div>
          <div class="product-desc">${esc(p.description) || ''}</div>
          <div class="product-meta">
            <span class="product-price">EGP ${parseFloat(p.price).toFixed(2)}</span>
            <span class="stock-pill ${stockClass}">${stockLabel}</span>
            <span class="product-cat">${esc(p.category)}</span>
          </div>
        </div>
        <div class="product-actions">
          <button class="btn-secondary btn-sm" onclick="editProduct('${esc(p._id)}')">Edit</button>
          <button class="btn-danger btn-sm"    onclick="deleteItem('${esc(p._id)}','product')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function applyProductFilters() {
  const search = (document.getElementById('product-search')?.value || '').toLowerCase();
  const cat    = document.getElementById('product-cat-filter')?.value || '';
  const stock  = document.getElementById('product-stock-filter')?.value || '';
  let list     = [...allProducts];
  if (search) list = list.filter(p => p.name.toLowerCase().includes(search) || p.category.toLowerCase().includes(search));
  if (cat)    list = list.filter(p => p.category === cat);
  if (stock === 'low') list = list.filter(p => p.stock > 0 && p.stock <= 5);
  if (stock === 'out') list = list.filter(p => p.stock === 0);
  renderProducts(list);
}

['product-search','product-cat-filter','product-stock-filter'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', applyProductFilters)
);

// Add product
document.getElementById('product-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-product-btn');
  setBtnLoading(btn, true);

  const fd = new FormData();
  fd.append('name',        document.getElementById('product-name').value.trim());
  fd.append('description', document.getElementById('product-description').value);
  fd.append('price',       document.getElementById('product-price').value);
  fd.append('stock',       document.getElementById('product-stock').value);
  fd.append('category',    document.getElementById('product-category').value);
  const img = document.getElementById('product-image').files[0];
  if (img) fd.append('image', img);

  try {
    const res  = await fetch(`${API}/products`, { method:'POST', headers:authHeaders(), body:fd });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to add product', 'error'); return; }
    toast('Product added!');
    resetProductForm();
    await loadProducts();
    loadStats();
    renderOverview();
    switchTab('products');
  } catch { toast('Error', 'error'); }
  finally  { setBtnLoading(btn, false); }
});

document.getElementById('reset-product-btn')?.addEventListener('click', resetProductForm);

function resetProductForm() {
  document.getElementById('product-form').reset();
  document.getElementById('product-id').value = '';
  document.getElementById('product-form-title').textContent = 'Add New Product';
  document.getElementById('submit-product-btn').textContent = 'Add Product';
  const prev = document.getElementById('image-preview');
  if (prev) { prev.innerHTML = ''; prev.classList.add('hidden'); }
  const ph = document.getElementById('upload-placeholder');
  if (ph) ph.style.display = '';
}

// Edit product
async function editProduct(id) {
  try {
    const res = await fetch(`${API}/products/${id}`);
    if (!res.ok) throw new Error();
    const p = await res.json();

    document.getElementById('edit-product-id').value          = p._id;
    document.getElementById('edit-product-name').value        = p.name;
    document.getElementById('edit-product-description').value = p.description || '';
    document.getElementById('edit-product-price').value       = p.price;
    document.getElementById('edit-product-stock').value       = p.stock;
    document.getElementById('edit-product-category').value   = p.category;

    const prev = document.getElementById('edit-image-preview');
    const ph   = document.getElementById('edit-upload-placeholder');
    if (p.image && !p.image.includes('placeholder')) {
      prev.innerHTML = `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="this.style.display='none'">`;
      prev.classList.remove('hidden');
      if (ph) ph.style.display = 'none';
    } else {
      prev.innerHTML = ''; prev.classList.add('hidden');
      if (ph) ph.style.display = '';
    }

    openModal('edit-modal');
  } catch { toast('Failed to load product', 'error'); }
}

document.getElementById('edit-product-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  setBtnLoading(btn, true);

  const id = document.getElementById('edit-product-id').value;
  const fd = new FormData();
  fd.append('name',        document.getElementById('edit-product-name').value.trim());
  fd.append('description', document.getElementById('edit-product-description').value);
  fd.append('price',       document.getElementById('edit-product-price').value);
  fd.append('stock',       document.getElementById('edit-product-stock').value);
  fd.append('category',    document.getElementById('edit-product-category').value);
  const img = document.getElementById('edit-product-image').files[0];
  if (img) fd.append('image', img);

  try {
    const res  = await fetch(`${API}/products/${id}`, { method:'PUT', headers:authHeaders(), body:fd });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to update', 'error'); return; }
    toast('Product updated!');
    closeModal('edit-modal');
    await loadProducts();
    loadStats();
    renderOverview();
  } catch { toast('Error', 'error'); }
  finally  { setBtnLoading(btn, false); }
});

['close-edit-modal','cancel-edit-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => closeModal('edit-modal'))
);

// Upload previews
function setupUploadPreview(inputId, previewId, phId) {
  document.getElementById(inputId)?.addEventListener('change', function () {
    const prev = document.getElementById(previewId);
    const ph   = document.getElementById(phId);
    if (!this.files[0]) return;
    const reader = new FileReader();
    reader.onload = ev => {
      prev.innerHTML = `<img src="${ev.target.result}" alt="Preview">`;
      prev.classList.remove('hidden');
      if (ph) ph.style.display = 'none';
    };
    reader.readAsDataURL(this.files[0]);
  });
}

setupUploadPreview('product-image',      'image-preview',      'upload-placeholder');
setupUploadPreview('edit-product-image', 'edit-image-preview', 'edit-upload-placeholder');

// ════════════════════════════════════════════════════════════
//  ORDERS
// ════════════════════════════════════════════════════════════

async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders`, { headers:authHeaders() });
    if (!res.ok) { if (res.status === 401) showLogin(); throw new Error(); }
    allOrders = await res.json();
    renderOrders();
  } catch { /* silent on polling */ }
}

function renderOrders(list = null) {
  const tbody  = document.getElementById('orders-tbody');
  if (!tbody) return;
  const orders = list !== null ? list : allOrders;

  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:32px;">No orders found.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td class="order-id-cell">#${esc(o._id.slice(-8).toUpperCase())}</td>
      <td>
        <div class="cust-name">${esc(o.customerName)}</div>
        <div class="cust-email">${esc(o.customerEmail)}</div>
      </td>
      <td style="color:var(--t2)">${o.items?.length || 0} items</td>
      <td style="font-family:'Space Mono',monospace;font-weight:700;color:var(--brand)">EGP ${parseFloat(o.totalAmount||0).toFixed(2)}</td>
      <td><span class="pill pill-${esc(o.status)}">${esc(o.status)}</span></td>
      <td style="color:var(--t3);font-family:'Space Mono',monospace;font-size:11px">${new Date(o.createdAt).toLocaleDateString()}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-secondary btn-sm" onclick="viewOrder('${esc(o._id)}')">View</button>
          <button class="btn-ghost btn-sm"     onclick="openStatusModal('${esc(o._id)}','${esc(o.status)}')">Status</button>
        </div>
      </td>
    </tr>`).join('');
}

function applyOrderFilters() {
  const search = (document.getElementById('order-search')?.value || '').toLowerCase();
  const status = document.getElementById('order-status-filter')?.value || '';
  let list = [...allOrders];
  if (search) list = list.filter(o =>
    o.customerName.toLowerCase().includes(search) ||
    o.customerEmail.toLowerCase().includes(search) ||
    o._id.includes(search)
  );
  if (status) list = list.filter(o => o.status === status);
  renderOrders(list);
}

['order-search','order-status-filter'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', applyOrderFilters)
);

// View order
async function viewOrder(id) {
  try {
    const res = await fetch(`${API}/orders/${id}`, { headers:authHeaders() });
    if (!res.ok) throw new Error();
    const o = await res.json();
    currentOrder = o;

    document.getElementById('view-order-id').textContent    = `#${o._id.slice(-8).toUpperCase()}`;
    document.getElementById('view-order-date').textContent  = new Date(o.createdAt).toLocaleString();
    document.getElementById('view-order-total').textContent = `EGP ${parseFloat(o.totalAmount||0).toFixed(2)}`;
    document.getElementById('view-order-status').innerHTML  = `<span class="pill pill-${esc(o.status)}">${esc(o.status)}</span>`;
    document.getElementById('view-order-customer').innerHTML =
      `<strong>${esc(o.customerName)}</strong><br>${esc(o.customerEmail)}<br>${esc(o.customerPhone||'')}<br><span style="color:var(--t3)">${esc(o.address||'')}</span>`;

    document.getElementById('view-order-items').innerHTML = (o.items||[]).map(it => `
      <div class="order-item-row">
        <span class="oir-name">${esc(it.name||'')}</span>
        <span class="oir-qty">×${it.quantity||1}</span>
        <span class="oir-price">EGP ${parseFloat(it.price||0).toFixed(2)}</span>
      </div>`).join('');

    openModal('view-modal');
  } catch { toast('Error loading order','error'); }
}

['close-view-modal','close-view-modal-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => closeModal('view-modal'))
);

// Status modal — pre-select current status
function openStatusModal(orderId, currentStatus) {
  document.getElementById('status-order-id').value = orderId;
  const sel = document.getElementById('order-status');
  if (sel && currentStatus) sel.value = currentStatus;
  openModal('status-modal');
}

document.getElementById('status-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn    = e.target.querySelector('[type=submit]');
  const id     = document.getElementById('status-order-id').value;
  const status = document.getElementById('order-status').value;
  setBtnLoading(btn, true);
  try {
    const res  = await fetch(`${API}/orders/${id}/status`, {
      method : 'PUT',
      headers: authHeaders(true),
      body   : JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed','error'); return; }
    toast('Status updated!');
    closeModal('status-modal');
    await loadOrders();
    loadStats();
    renderOverview();
  } catch { toast('Error','error'); }
  finally  { setBtnLoading(btn, false); }
});

['close-status-modal','cancel-status-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => closeModal('status-modal'))
);

// Print invoice
function printInvoice() {
  if (!currentOrder) return toast('No order selected','error');
  const o = currentOrder;
  const w = window.open('','_blank','width=800,height=900');
  const rows = (o.items||[]).map(it => `
    <tr>
      <td>${esc(it.name||'')}</td>
      <td>${it.quantity||1}</td>
      <td>EGP ${parseFloat(it.price||0).toFixed(2)}</td>
      <td>EGP ${(parseFloat(it.price||0)*(it.quantity||1)).toFixed(2)}</td>
    </tr>`).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>Invoice #${o._id.slice(-8).toUpperCase()}</title><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;padding:40px;color:#111;background:#fff}
    .logo{font-size:22px;font-weight:900;margin-bottom:4px}
    .logo em{color:#00cc6a;font-style:normal}
    .sub{color:#666;font-size:13px;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #ddd;padding:10px;text-align:left;font-size:13px}
    th{background:#f5f5f5;font-weight:700}
    .total{font-weight:700;font-size:17px;margin-top:16px;color:#00cc6a}
    .footer{margin-top:40px;color:#aaa;font-size:12px;border-top:1px solid #eee;padding-top:16px}
    h3{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px}
  </style></head><body>
  <div class="logo">Clean<em>Pro</em></div>
  <p class="sub">Invoice · Order #${o._id.slice(-8).toUpperCase()} · ${new Date(o.createdAt).toLocaleString()}</p>
  <h3>Bill To</h3>
  <p>${esc(o.customerName)}<br>${esc(o.customerEmail)}<br>${esc(o.customerPhone||'')}<br>${esc(o.address||'')}</p>
  <table><thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p class="total">Total: EGP ${parseFloat(o.totalAmount||0).toFixed(2)}</p>
  <p class="footer">Thank you for shopping with CleanPro.</p>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}

// ════════════════════════════════════════════════════════════
//  DELETE
// ════════════════════════════════════════════════════════════

function deleteItem(id, type) {
  document.getElementById('delete-item-id').value   = id;
  document.getElementById('delete-item-type').value = type;
  openModal('delete-modal');
}

document.getElementById('confirm-delete-btn')?.addEventListener('click', async () => {
  const btn  = document.getElementById('confirm-delete-btn');
  const id   = document.getElementById('delete-item-id').value;
  const type = document.getElementById('delete-item-type').value;
  setBtnLoading(btn, true);
  try {
    const ep  = type === 'product' ? 'products' : 'categories';
    const res = await fetch(`${API}/${ep}/${id}`, { method:'DELETE', headers:authHeaders() });
    const data= await res.json();
    if (!res.ok) { toast(data.error || `Failed to delete ${type}`,'error'); return; }
    toast(`${type[0].toUpperCase()+type.slice(1)} deleted`);
    closeModal('delete-modal');
    if (type === 'product') { await loadProducts(); renderOverview(); }
    else                    { await loadCategories(); }
    loadStats();
  } catch { toast('Error','error'); }
  finally  { setBtnLoading(btn, false); }
});

['close-delete-modal','cancel-delete-btn'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => closeModal('delete-modal'))
);

// ════════════════════════════════════════════════════════════
//  EXPORT CSV
// ════════════════════════════════════════════════════════════

function exportOrdersCSV() {
  if (!allOrders.length) { toast('No orders to export','error'); return; }
  const header = ['Order ID','Customer','Email','Phone','Address','Items','Total (EGP)','Status','Date'];
  const rows   = allOrders.map(o => [
    o._id, o.customerName, o.customerEmail,
    o.customerPhone || '', (o.address || '').replace(/,/g,' '),
    (o.items||[]).length, parseFloat(o.totalAmount||0).toFixed(2),
    o.status, new Date(o.createdAt).toLocaleDateString(),
  ]);
  const csv  = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `orders-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported!');
}

document.getElementById('export-orders-btn')?.addEventListener('click', exportOrdersCSV);
document.getElementById('qa-export')?.addEventListener('click', exportOrdersCSV);

// ════════════════════════════════════════════════════════════
//  GLOBAL SEARCH
// ════════════════════════════════════════════════════════════

function setupSearch() {
  const input = document.getElementById('global-search');
  const dd    = document.getElementById('search-dropdown');
  if (!input || !dd) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }

    const results = [];
    allProducts.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
      .slice(0,4).forEach(p => results.push({ type:'Product', label:p.name, sub:`EGP ${parseFloat(p.price).toFixed(2)} · ${p.category}`, tab:'products' }));

    allOrders.filter(o => o.customerName.toLowerCase().includes(q) || o.customerEmail.toLowerCase().includes(q) || o._id.includes(q))
      .slice(0,3).forEach(o => results.push({ type:'Order', label:o.customerName, sub:`EGP ${parseFloat(o.totalAmount||0).toFixed(2)} · ${o.status}`, tab:'orders' }));

    if (!results.length) {
      dd.innerHTML = '<div class="search-empty">No results found</div>';
    } else {
      dd.innerHTML = results.map((r, i) => `
        <div class="search-result-item" data-i="${i}">
          <div style="flex:1">
            <div style="font-weight:600;color:var(--t1);font-size:13px;">${esc(r.label)}</div>
            <div style="font-size:11px;color:var(--t3);">${esc(r.sub)}</div>
          </div>
          <span class="sri-type">${esc(r.type)}</span>
        </div>`).join('');

      dd.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          const i = parseInt(el.dataset.i);
          switchTab(results[i].tab);
          dd.classList.add('hidden');
          input.value = '';
        });
      });
    }

    dd.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dd.contains(e.target)) dd.classList.add('hidden');
  });
}

// ════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ════════════════════════════════════════════════════════════

function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('hidden'); document.body.style.overflow = ''; }
}

document.querySelectorAll('.overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay:not(.hidden)').forEach(m => closeModal(m.id));
  }
});

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', checkAuth);
