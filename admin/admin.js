/* PREVESUY — Panel de administración (vainilla JS) */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const TOKEN_KEY = 'pv_admin_token';
  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';

  // Local: la API admin vive en el mismo origen :4000 → '/api/...'
  // Vercel: mismo dominio que el sitio → se sirve bajo '/admin/api/...'
  const ADMIN_API = window.PV_ADMIN_API ?? (location.port === '4000' ? '' : '/admin');

  /* ---------- Fetch con auth ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(ADMIN_API + path, {
      ...opts,
      headers: {
        ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token()}`,
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 && !path.includes('/auth/')) {
      showLogin('Tu sesión expiró o fue cerrada. Volvé a iniciar sesión.');
      throw new Error('Sesión expirada');
    }
    if (res.status === 403) {
      throw new Error('La sesión del PIN venció. Recargá la página e ingresalo nuevamente.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.fields = data.fields; e.status = res.status; throw e; }
    return data;
  }

  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, 3200);
  };

  const fieldError = (id, msg) => {
    const el = $(`.field-error[data-for="${id}"]`);
    if (el) el.textContent = msg || '';
  };
  const clearFieldErrors = (scope) => $$('.field-error', scope).forEach((e) => { e.textContent = ''; });

  /* ---------- Login / bootstrap ---------- */
  // bootstrap = plataforma sin administradores: el PIN habilita el panel
  // completo y el primer admin se crea desde la sección Usuarios.
  let bootstrapMode = false;

  const showLogin = (msg) => {
    $$('.modal-overlay').forEach((m) => { m.hidden = true; });
    sessionStorage.removeItem(TOKEN_KEY);
    $('#loginBox').hidden = false;
    $('#loginView').hidden = false; $('#app').hidden = true;
    const el = $('#loginError');
    el.textContent = msg || ''; el.hidden = !msg;
  };
  const showApp = () => { $('#loginView').hidden = true; $('#app').hidden = false; };

  /* ---------- Código de seguridad (acciones sensibles) ---------- */
  // Devuelve una Promise con el PIN ingresado, o null si se cancela.
  let pinResolve = null;
  const askPin = () => new Promise((resolve) => {
    pinResolve = resolve;
    $('#pinValue').value = '';
    $('#pinError').hidden = true;
    $('#pinModal').hidden = false;
    setTimeout(() => $('#pinValue').focus(), 60);
  });
  $('#pinFormModal').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#pinValue').value.trim();
    if (!/^\d{4}$/.test(v)) {
      const el = $('#pinError');
      el.textContent = 'Ingresá el PIN de 4 dígitos.'; el.hidden = false;
      return;
    }
    $('#pinModal').hidden = true;
    const r = pinResolve; pinResolve = null; r?.(v);
  });
  const cancelPin = () => { if (pinResolve) { const r = pinResolve; pinResolve = null; r(null); } };

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(e.target);
    const loginId = $('#loginEmail').value.trim();
    const password = $('#loginPass').value;
    let bad = false;
    if (loginId.length < 3) { fieldError('loginEmail', 'Ingresá tu usuario o correo.'); bad = true; }
    if (password.length < 1) { fieldError('loginPass', 'Ingresá tu contraseña.'); bad = true; }
    if (bad) return;
    $('#loginError').hidden = true;
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: loginId, password }) });
      sessionStorage.setItem(TOKEN_KEY, data.token);
      $('#whoami').textContent = data.user.username || data.user.email;
      showApp();
      init();
    } catch (err) {
      const el = $('#loginError');
      el.textContent = err.message || 'Credenciales inválidas.'; el.hidden = false;
    }
  });

  $('#forgotLink').addEventListener('click', () => {
    $('#loginForm').hidden = true; $('#forgotForm').hidden = false;
  });
  $('#forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#forgotEmail').value.trim();
    try {
      const data = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
      $('#forgotMsg').textContent = data.message;
    } catch (err) { $('#forgotMsg').textContent = err.message; }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* noop */ }
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  /* ---------- Navegación de vistas ---------- */
  $$('.side-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.side-nav button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach((v) => { v.hidden = true; });
      $(`#view-${btn.dataset.view}`).hidden = false;
      loaders[btn.dataset.view]?.();
    });
  });

  /* ---------- Dashboard ---------- */
  const EVENT_LABELS = {
    emergency_click: 'Clicks botón emergencia', survey_useful_yes: 'Encuesta: útil',
    survey_useful_no: 'Encuesta: no útil', survey_skip: 'Encuesta omitida',
    exercise_view: 'Ejercicios vistos', page_view: 'Visitas',
  };
  async function loadDashboard() {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
    const s = await api(`/api/stats?start=${start}&end=${end}`);
    $('#statCards').innerHTML = [
      ['Publicados', s.counts.contents_published], ['Borradores', s.counts.contents_draft],
      ['Centros', s.counts.centers], ['Mensajes sin leer', s.counts.messages_unread],
      ['Mensajes total', s.counts.messages_total], ['Admins activos', s.counts.admins],
    ].map(([l, n]) => `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
    $('#msgBadge').hidden = !s.counts.messages_unread;
    $('#msgBadge').textContent = s.counts.messages_unread;

    const byDay = Object.fromEntries(s.byDay.map((x) => [x.day, x.n]));
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({ day: d, n: byDay[d] || 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.n));
    $('#dayChart').innerHTML = days.map((d) =>
      `<div class="bar" title="${d.day}: ${d.n}"><div class="col" style="height:${Math.round((d.n / max) * 110)}px"></div><span class="cap">${d.day.slice(5)}</span></div>`
    ).join('');

    const evMax = Math.max(1, ...s.byEvent.map((x) => x.n));
    $('#eventChart').innerHTML = s.byEvent.length
      ? s.byEvent.map((x) => `<div class="hrow"><span>${esc(EVENT_LABELS[x.event] || x.event)}</span><div class="hcol" style="width:${Math.round((x.n / evMax) * 100)}%"></div><strong>${x.n}</strong></div>`).join('')
      : '<p class="muted">Sin eventos en el período.</p>';
  }

  /* ---------- Contenido ---------- */
  const TYPE_LABELS = { noticia: 'Noticia', aviso: 'Aviso', articulo: 'Artículo', campana: 'Campaña', linea: 'Línea de ayuda', guia: 'Guía', video: 'Video', contacto: 'Contacto', educativo: 'Educativo', ejercicio: 'Ejercicio' };
  const AGE_LABELS = { todos: 'Todas', ninos: 'Niños', adolescentes: 'Adolescentes', adultos: 'Adultos' };
  let contentItems = [];

  async function loadContents() {
    const q = $('#contentSearch').value.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if ($('#filterType').value) params.set('type', $('#filterType').value);
    if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
    const data = await api(`/api/contents?${params}`);
    contentItems = data.items;
    $('#contentTable tbody').innerHTML = data.items.map((c) => `
      <tr>
        <td><strong>${esc(c.title)}</strong>${c.image ? ' <span class="material-symbols-rounded" style="font-size:1em">image</span>' : ''}</td>
        <td>${esc(TYPE_LABELS[c.type] || c.type)}</td>
        <td>${esc(AGE_LABELS[c.age] || c.age)}</td>
        <td><span class="pill ${c.status}">${c.status === 'published' ? 'Publicado' : 'Borrador'}</span></td>
        <td>${esc(c.updated_at)}</td>
        <td class="actions">
          <button class="btn secondary small" data-edit="${c.id}">Editar</button>
          <button class="btn danger small" data-del="${c.id}">Eliminar</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">Sin contenidos.</td></tr>';
  }

  $('#contentTable').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openEditor(contentItems.find((c) => c.id === Number(edit.dataset.edit)));
    if (del) {
      const pin = await askPin();
      if (pin == null) return;
      try {
        await api(`/api/contents/${del.dataset.del}`, { method: 'DELETE', body: JSON.stringify({ pin }) });
        toast('Contenido eliminado.'); loadContents();
      } catch (err) { toast(err.message); }
    }
  });

  let searchTm;
  $('#contentSearch').addEventListener('input', () => { clearTimeout(searchTm); searchTm = setTimeout(loadContents, 300); });
  $('#filterType').addEventListener('change', loadContents);
  $('#filterStatus').addEventListener('change', loadContents);

  /* ---------- Editor de contenido (RF-011/012/017) ---------- */
  let tags = [];
  let imageUrl = null;
  let dirty = false;
  let autosaveTimer = null;

  const renderTags = () => {
    $('#tagBox').querySelectorAll('.tag-chip').forEach((c) => c.remove());
    tags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${esc(t)} <button type="button" aria-label="Quitar">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => { tags = tags.filter((x) => x !== t); renderTags(); dirty = true; });
      $('#tagBox').insertBefore(chip, $('#cTagInput'));
    });
    $('#cTagInput').disabled = tags.length >= 5;
    $('#cTagInput').placeholder = tags.length >= 5 ? 'Máximo 5 etiquetas' : 'Escribí y pulsá Enter';
  };

  $('#cTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = $('#cTagInput').value.trim();
      if (!v) return;
      if (tags.length >= 5) { fieldError('cTagInput', 'Solo puedes agregar hasta 5 etiquetas.'); return; }
      if (!tags.includes(v)) tags.push(v);
      $('#cTagInput').value = ''; fieldError('cTagInput', ''); renderTags(); dirty = true;
    }
  });

  ['cTitle', 'cBody', 'cLink'].forEach((id) => $(`#${id}`).addEventListener('input', () => { dirty = true; }));
  ['cType', 'cArea', 'cAge', 'cStatus'].forEach((id) => $(`#${id}`).addEventListener('change', () => { dirty = true; }));

  const isVideoUrl = (u) => /\.(mp4|webm)(\?|$)/i.test(u || '');
  const showMediaPreview = (src) => {
    const img = $('#cImagePreview'), vid = $('#cVideoPreview');
    if (!src) { img.hidden = true; vid.hidden = true; $('#cImageClear').hidden = true; return; }
    if (isVideoUrl(src)) { vid.src = src; vid.hidden = false; img.hidden = true; }
    else { img.src = src; img.hidden = false; vid.hidden = true; }
    $('#cImageClear').hidden = false;
  };
  $('#cImageFile').addEventListener('change', () => {
    const f = $('#cImageFile').files[0];
    if (!f) return;
    showMediaPreview(URL.createObjectURL(f));
    dirty = true;
  });
  $('#cImageClear').addEventListener('click', () => {
    $('#cImageFile').value = ''; showMediaPreview(null);
    imageUrl = null; dirty = true;
  });

  const collectForm = () => ({
    type: $('#cType').value, area: $('#cArea').value, age: $('#cAge').value,
    title: $('#cTitle').value.trim(), body: $('#cBody').value,
    tags, image: imageUrl, link: $('#cLink').value.trim() || null,
    status: $('#cStatus').value,
  });

  async function uploadImageIfNeeded() {
    const f = $('#cImageFile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('image', f);
    const res = await api('/api/upload', { method: 'POST', body: fd });
    imageUrl = res.url;
  }

  async function saveContent(forceStatus) {
    clearFieldErrors($('#contentForm'));
    const id = $('#cId').value;
    const payload = collectForm();
    if (forceStatus) payload.status = forceStatus;
    try {
      await uploadImageIfNeeded();
      payload.image = imageUrl;
      if (id) await api(`/api/contents/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else {
        const res = await api('/api/contents', { method: 'POST', body: JSON.stringify(payload) });
        $('#cId').value = res.id;
      }
      dirty = false;
      return true;
    } catch (err) {
      if (err.fields) Object.entries(err.fields).forEach(([k, m]) => {
        const map = { title: 'cTitle', tags: 'cTagInput' };
        fieldError(map[k] || 'cTitle', m);
      });
      const el = $('#contentError');
      el.textContent = err.message; el.hidden = false;
      return false;
    }
  }

  function openEditor(item) {
    clearFieldErrors($('#contentForm'));
    $('#contentError').hidden = true;
    $('#editorTitle').textContent = item ? 'Editar contenido' : 'Nuevo contenido';
    $('#cId').value = item?.id || '';
    $('#cType').value = item?.type || 'noticia';
    $('#cArea').value = item?.area || 'salud_mental';
    $('#cAge').value = item?.age || 'todos';
    $('#cStatus').value = item?.status || 'draft';
    $('#cTitle').value = item?.title || '';
    $('#cBody').value = item?.body || '';
    $('#cLink').value = item?.link || '';
    tags = item?.tags ? [...item.tags] : [];
    renderTags();
    imageUrl = item?.image || null;
    showMediaPreview(imageUrl);
    $('#cImageFile').value = '';
    dirty = false;
    $('#editorModal').hidden = false;
    // RF-012: autoguardado cada 30 s si hubo cambios y ya existe el registro
    clearInterval(autosaveTimer);
    autosaveTimer = setInterval(async () => {
      if (!dirty || !$('#cId').value) return;
      $('#autosaveTag').hidden = true;
      if (await saveContent()) { $('#autosaveTag').hidden = false; setTimeout(() => { $('#autosaveTag').hidden = true; }, 2500); }
    }, 30000);
  }

  $('#newContentBtn').addEventListener('click', () => openEditor(null));
  $('#contentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await saveContent()) { closeModals(); toast('Contenido guardado.'); loadContents(); }
  });
  $('#publishBtn').addEventListener('click', async () => {
    if (await saveContent('published')) { closeModals(); toast('Contenido publicado.'); loadContents(); }
  });

  /* ---------- Centros ---------- */
  async function loadCenters() {
    const { items } = await api('/api/centers');
    $('#centerTable tbody').innerHTML = items.map((c) => `
      <tr>
        <td><strong>${esc(c.name)}</strong></td><td>${esc(c.address)}</td>
        <td>${esc(c.phone)}</td><td>${esc(c.dept)}</td>
        <td class="actions">
          <button class="btn secondary small" data-ce-edit="${c.id}">Editar</button>
          <button class="btn danger small" data-ce-del="${c.id}">Eliminar</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Sin centros cargados.</td></tr>';
    $('#centerTable')._items = items;
  }
  $('#centerTable').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-ce-edit]');
    const del = e.target.closest('[data-ce-del]');
    if (ed) {
      const c = $('#centerTable')._items.find((x) => x.id === Number(ed.dataset.ceEdit));
      $('#ceId').value = c.id; $('#ceName').value = c.name; $('#ceAddress').value = c.address;
      $('#cePhone').value = c.phone; $('#ceDept').value = c.dept;
      $('#centerModal').hidden = false;
    }
    if (del) {
      const pin = await askPin();
      if (pin == null) return;
      try {
        await api(`/api/centers/${del.dataset.ceDel}`, { method: 'DELETE', body: JSON.stringify({ pin }) });
        toast('Centro eliminado.'); loadCenters();
      } catch (err) { toast(err.message); }
    }
  });
  $('#newCenterBtn').addEventListener('click', () => {
    $('#centerForm').reset(); $('#ceId').value = ''; $('#centerModal').hidden = false;
  });
  $('#centerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(e.target);
    const payload = {
      name: $('#ceName').value.trim(), address: $('#ceAddress').value.trim(),
      phone: $('#cePhone').value.trim(), dept: $('#ceDept').value.trim(),
    };
    let bad = false;
    if (payload.name.length < 3) { fieldError('ceName', 'Mínimo 3 caracteres.'); bad = true; }
    if (!payload.address) { fieldError('ceAddress', 'Obligatorio.'); bad = true; }
    if (!payload.phone) { fieldError('cePhone', 'Obligatorio.'); bad = true; }
    if (bad) return;
    const id = $('#ceId').value;
    try {
      await api(id ? `/api/centers/${id}` : '/api/centers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeModals(); toast('Centro guardado.'); loadCenters();
    } catch (err) { const el = $('#centerError'); el.textContent = err.message; el.hidden = false; }
  });

  /* ---------- Mensajes ---------- */
  async function loadMessages() {
    const { items } = await api('/api/messages');
    $('#messageList').innerHTML = items.map((m) => `
      <article class="msg-card ${m.read ? '' : 'unread'}">
        <div class="meta"><strong>${esc(m.name)}</strong> &lt;${esc(m.email)}&gt; <span>${esc(m.created_at)}</span></div>
        <p>${esc(m.body)}</p>
        ${m.read ? '' : `<div><button class="btn secondary small" data-read="${m.id}">Marcar leído</button></div>`}
      </article>`).join('') || '<p class="muted">Sin mensajes.</p>';
  }
  $('#messageList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-read]');
    if (b) { await api(`/api/messages/${b.dataset.read}/read`, { method: 'PATCH' }); loadMessages(); loadDashboard(); }
  });

  /* ---------- Usuarios ---------- */
  async function loadAdmins() {
    const { items } = await api('/api/admins');
    $('#adminTable tbody').innerHTML = items.map((u) => `
      <tr>
        <td><strong>${esc(u.username || '—')}</strong></td>
        <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
        <td><span class="pill ${u.active ? 'on' : 'off'}">${u.active ? 'Activo' : 'Inactivo'}</span></td>
        <td>${esc(u.created_at)}</td>
        <td class="actions">
          <button class="btn secondary small" data-toggle="${u.id}" data-act="${u.active ? 0 : 1}">${u.active ? 'Desactivar' : 'Activar'}</button>
          <button class="btn danger small" data-udel="${u.id}">Eliminar</button>
        </td>
      </tr>`).join('');
  }
  $('#adminTable').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle]');
    const d = e.target.closest('[data-udel]');
    if (!t && !d) return;
    const pin = await askPin();
    if (pin == null) return;
    try {
      if (t) { await api(`/api/admins/${t.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ pin, active: t.dataset.act === '1' }) }); loadAdmins(); }
      if (d) { await api(`/api/admins/${d.dataset.udel}`, { method: 'DELETE', body: JSON.stringify({ pin }) }); loadAdmins(); toast('Administrador eliminado.'); }
    } catch (err) { toast(err.message); }
  });
  $('#newAdminBtn').addEventListener('click', () => { $('#adminForm').reset(); $('#adminModal').hidden = false; });
  $('#adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(e.target);
    const name = $('#aName').value.trim(), username = $('#aUser').value.trim(),
      email = $('#aEmail').value.trim(), password = $('#aPass').value;
    let bad = false;
    if (name.length < 2) { fieldError('aName', 'Nombre obligatorio.'); bad = true; }
    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) { fieldError('aUser', '3-60 caracteres: letras, números, . _ -'); bad = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fieldError('aEmail', 'Correo inválido.'); bad = true; }
    if (password.length < 8) { fieldError('aPass', 'Mínimo 8 caracteres.'); bad = true; }
    if (bad) return;
    closeModals();
    const pin = await askPin();
    if (pin == null) { $('#adminModal').hidden = false; return; }
    try {
      await api('/api/admins', { method: 'POST', body: JSON.stringify({ name, username, email, password, pin }) });
      closeModals();
      if (bootstrapMode) {
        toast('Primer administrador creado. Iniciá sesión con la nueva cuenta.');
        bootstrapMode = false;
        $('#bootstrapBanner').hidden = true;
        showLogin();
        return;
      }
      toast('Administrador creado.'); loadAdmins();
    } catch (err) {
      $('#adminModal').hidden = false;
      const el = $('#adminError'); el.textContent = err.message; el.hidden = false;
    }
  });

  /* ---------- Auditoría ---------- */
  async function loadAudit() {
    const { items } = await api('/api/audit');
    $('#auditTable tbody').innerHTML = items.map((a) => `
      <tr><td>${esc(a.created_at)}</td><td>${esc(a.user_email)}</td>
      <td><strong>${esc(a.action)}</strong></td><td>${esc(a.target)}</td><td class="muted">${esc(a.meta)}</td></tr>`
    ).join('') || '<tr><td colspan="5" class="muted">Sin registros.</td></tr>';
  }

  /* ---------- Exportar ---------- */
  async function download(path, filename) {
    const res = await fetch(ADMIN_API + path, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) { toast('No se pudo exportar.'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    a.click(); URL.revokeObjectURL(a.href);
  }
  $('#expCsv').addEventListener('click', () => {
    const p = `?start=${$('#expStart').value || '1970-01-01'}&end=${$('#expEnd').value || '2999-12-31'}`;
    download(`/api/export.csv${p}`, 'prevesuy-metricas.csv');
  });
  $('#expPdf').addEventListener('click', () => {
    const p = `?start=${$('#expStart').value || '1970-01-01'}&end=${$('#expEnd').value || '2999-12-31'}`;
    download(`/api/export.pdf${p}`, 'prevesuy-metricas.pdf');
  });

  /* ---------- Modales ---------- */
  const closeModals = () => {
    $$('.modal-overlay').forEach((m) => { m.hidden = true; });
    clearInterval(autosaveTimer);
    cancelPin();
  };
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal-overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) closeModals(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  /* ---------- Editor del sitio (vista de usuario, edición en vivo) ---------- */
  // Local: páginas públicas servidas bajo /preview/* en :4000 (mismo origen).
  // Vercel: mismo dominio → se cargan las páginas reales con ?pv=1 (modo preview).
  const PREVIEW_BASE = location.port === '4000' ? '/preview' : '';
  const previewUrl = (p) => `${PREVIEW_BASE}${p}${p.includes('?') ? '&' : '?'}pv=1`;

  const frame = $('#siteFrame');
  let editMode = false;
  const pending = { texts: {}, media: {} };

  const EDIT_CSS = `
    body.pv-editmode [data-pv-key] { outline: 2px dashed #2f80ed; outline-offset: 3px; cursor: text; border-radius: 4px; }
    body.pv-editmode [data-pv-key]:focus { outline-color: #1458b0; background: rgba(47,128,237,.07); }
    body.pv-editmode [data-pv-src] { outline: 2px dashed #9b51e0; outline-offset: 3px; cursor: pointer; }
    body.pv-editmode [data-cid] { outline: 2px dashed #f2994a; outline-offset: 3px; cursor: pointer; }
    body.pv-editmode a, body.pv-editmode input, body.pv-editmode textarea { pointer-events: none; }
    body.pv-editmode [data-cid], body.pv-editmode [data-cid] *, body.pv-editmode [data-pv-key] { pointer-events: auto; }
  `;

  const frameDoc = () => { try { return frame.contentDocument; } catch { return null; } };

  const markStatus = () => {
    const n = Object.keys(pending.texts).length + Object.keys(pending.media).length;
    $('#siteSaveBtn').disabled = !n;
    $('#siteDiscardBtn').disabled = !n && !editMode;
    $('#siteEditStatus').textContent = n
      ? `${n} cambio(s) sin publicar`
      : (editMode ? 'Modo edición activo' : 'Vista de solo lectura');
  };

  let mediaInput;
  const pickMediaFile = (el) => {
    if (!mediaInput) {
      mediaInput = document.createElement('input');
      mediaInput.type = 'file';
      mediaInput.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';
      mediaInput.addEventListener('change', async () => {
        const f = mediaInput.files[0];
        const target = mediaInput._target;
        mediaInput.value = ''; mediaInput._target = null;
        if (!f || !target) return;
        const fd = new FormData();
        fd.append('file', f);
        try {
          const res = await api('/api/upload', { method: 'POST', body: fd });
          target.setAttribute('src', res.url);
          pending.media[target.dataset.pvSrc] = res.url;
          markStatus();
          toast('Multimedia cargada. Publicá para confirmar.');
        } catch (err) { toast(err.message); }
      });
    }
    mediaInput._target = el;
    mediaInput.click();
  };

  // Clic delegado dentro del iframe: tarjeta de contenido → editor; medio → subir archivo
  async function onFrameClick(e) {
    if (!editMode) return;
    const media = e.target.closest?.('[data-pv-src]');
    const card = e.target.closest?.('[data-cid]');
    if (media) {
      e.preventDefault(); e.stopPropagation();
      pickMediaFile(media);
    } else if (card) {
      e.preventDefault(); e.stopPropagation();
      try {
        const { item } = await api(`/api/contents/${card.dataset.cid}`);
        openEditor(item);
      } catch (err) { toast(err.message); }
    }
  }

  function decorate(doc) {
    if (!doc?.body) return;
    doc.body.classList.add('pv-editmode');
    if (!doc.getElementById('pv-edit-css')) {
      const st = doc.createElement('style');
      st.id = 'pv-edit-css'; st.textContent = EDIT_CSS;
      doc.head.appendChild(st);
    }
    doc.querySelectorAll('[data-pv-key]').forEach((el) => {
      el.contentEditable = 'true';
      el.spellcheck = false;
      el.addEventListener('input', () => {
        pending.texts[el.dataset.pvKey] = el.innerText.trim();
        markStatus();
      });
    });
    doc.addEventListener('click', onFrameClick, true);
  }

  function undecorate(doc) {
    if (!doc?.body) return;
    doc.body.classList.remove('pv-editmode');
    doc.getElementById('pv-edit-css')?.remove();
    doc.querySelectorAll('[data-pv-key]').forEach((el) => { el.contentEditable = 'false'; });
    doc.removeEventListener('click', onFrameClick, true);
  }

  $('#editToggleBtn').addEventListener('click', () => {
    editMode = !editMode;
    $('#editToggleBtn').innerHTML = editMode
      ? '<span class="material-symbols-rounded">close</span> Salir de edición'
      : '<span class="material-symbols-rounded">edit</span> Activar edición';
    $('#editorHint').hidden = !editMode;
    if (editMode) decorate(frameDoc()); else undecorate(frameDoc());
    markStatus();
  });

  $('#siteSaveBtn').addEventListener('click', async () => {
    const items = { ...pending.texts, ...pending.media };
    if (!Object.keys(items).length) return;
    try {
      await api('/api/site-texts', { method: 'PUT', body: JSON.stringify({ items }) });
      pending.texts = {}; pending.media = {};
      markStatus();
      toast('Cambios publicados en el sitio en vivo.');
    } catch (err) { toast(err.message); }
  });

  $('#siteDiscardBtn').addEventListener('click', () => {
    pending.texts = {}; pending.media = {};
    try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; }
    markStatus();
  });

  $('#sitePageSel').addEventListener('change', () => {
    pending.texts = {}; pending.media = {};
    frame.src = previewUrl($('#sitePageSel').value);
    markStatus();
  });

  // Carga inicial del iframe según el entorno
  frame.src = previewUrl($('#sitePageSel').value || '/index.html');

  /* ---------- Vista "Textos": edita TODOS los textos/títulos/slogans ---------- */
  const SITE_PAGES = [
    ['Inicio', '/index.html'],
    ['Herramientas', '/public/herramientas.html'],
    ['Novedades', '/public/novedades.html'],
    ['Contacto', '/public/contactos.html'],
    ['Apoyo', '/public/soporteAyuda.html'],
    ['Sobre nosotros', '/public/sobreNosotros.html'],
    ['Términos', '/public/terminosCondiciones.html'],
  ];
  let textsDefs = []; // [{key, def, page}]
  let textsDirty = false;

  const scanPageForKeys = (page) => new Promise((resolve) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    fr.src = previewUrl(page);
    const done = (items) => { fr.remove(); resolve(items); };
    const tm = setTimeout(() => done([]), 8000);
    fr.addEventListener('load', () => {
      setTimeout(() => {
        clearTimeout(tm);
        try {
          const doc = fr.contentDocument;
          const keys = new Map();
          doc.querySelectorAll('[data-pv-key]').forEach((el) => {
            const k = el.dataset.pvKey;
            if (!keys.has(k)) keys.set(k, el.dataset.pvDef || el.textContent || '');
          });
          doc.querySelectorAll('[data-pv-src]').forEach((el) => {
            const k = el.dataset.pvSrc;
            if (!keys.has(k)) keys.set(k, el.dataset.pvDef || el.getAttribute('src') || '');
          });
          done([...keys.entries()].map(([key, def]) => ({ key, def, page })));
        } catch { done([]); }
      }, 400); // esperar a que site.js aplique textos
    });
    document.body.appendChild(fr);
  });

  async function loadTextsView() {
    const status = $('#textsStatus');
    status.textContent = 'Escaneando páginas del sitio...';
    $('#textsGroups').innerHTML = '';
    textsDefs = []; textsDirty = false;
    $('#textsSaveBtn').disabled = true;
    const { items: overrides } = await api('/api/site-texts');
    for (const [label, page] of SITE_PAGES) {
      const defs = await scanPageForKeys(page);
      if (!defs.length) continue;
      textsDefs.push(...defs);
      const group = document.createElement('div');
      group.className = 'texts-group';
      group.innerHTML = `<h3>${esc(label)}</h3>` + defs.map(({ key, def }) => {
        const val = overrides[key] ?? '';
        const isMedia = /\.(img|src|media)$/.test(key);
        const long = (def || '').length > 90;
        return `<div class="texts-item">
          <span class="k">${esc(key)}</span>
          ${isMedia
            ? `<input type="text" data-tkey="${esc(key)}" value="${esc(val)}" placeholder="URL de imagen/video subido" title="Original: ${esc(def)}">`
            : long
              ? `<textarea data-tkey="${esc(key)}" placeholder="${esc(def)}">${esc(val)}</textarea>`
              : `<input type="text" data-tkey="${esc(key)}" value="${esc(val)}" placeholder="${esc(def)}">`}
        </div>`;
      }).join('');
      $('#textsGroups').appendChild(group);
    }
    status.textContent = `${textsDefs.length} textos editables encontrados.`;
  }

  $('#textsGroups').addEventListener('input', () => { textsDirty = true; $('#textsSaveBtn').disabled = false; });
  $('#textsReloadBtn').addEventListener('click', loadTextsView);
  $('#textsSaveBtn').addEventListener('click', async () => {
    const items = {};
    $$('#textsGroups [data-tkey]').forEach((el) => {
      const v = el.value.trim();
      if (v) items[el.dataset.tkey] = v;
      else items[el.dataset.tkey] = ''; // vacío → restaura el texto original
    });
    try {
      const r = await api('/api/site-texts', { method: 'PUT', body: JSON.stringify({ items }) });
      textsDirty = false;
      $('#textsSaveBtn').disabled = true;
      toast(`${r.updated} texto(s) publicados en vivo.`);
    } catch (err) { toast(err.message); }
  });

  frame.addEventListener('load', () => {
    if (editMode) decorate(frameDoc());
    markStatus();
  });

  /* ---------- Tiempo real (SSE) ---------- */
  function connectEvents() {
    const es = new EventSource(`${ADMIN_API}/api/events`);
    es.addEventListener('content', (ev) => {
      const d = JSON.parse(ev.data);
      toast(d.action === 'published' ? `Publicado: ${d.title || ''}` : 'Contenido actualizado.');
      loadContents(); loadDashboard();
    });
    es.addEventListener('centers', () => { loadCenters(); });
    es.onerror = () => { $('#liveDot').style.background = '#c0392b'; };
    es.onopen = () => { $('#liveDot').style.background = ''; };
  }

  /* ---------- Init ---------- */
  const loaders = {
    dashboard: loadDashboard, contenido: loadContents, centros: loadCenters,
    mensajes: loadMessages, usuarios: loadAdmins, auditoria: loadAudit,
    exportar: () => {}, sitio: () => { markStatus(); }, textos: loadTextsView,
  };

  async function init() {
    if (!bootstrapMode) {
      try {
        const { user } = await api('/api/auth/me');
        $('#whoami').textContent = user.email;
      } catch { showLogin(); return; }
    } else {
      $('#whoami').textContent = 'Configuración inicial';
    }
    loadDashboard();
    loadContents();
    connectEvents();
  }

  // Arranque:
  //  - 0 admins → modo bootstrap: el PIN habilita el panel (el primer admin
  //    se crea desde Usuarios; luego se exige login).
  //  - Con admins → sesión existente o pantalla de login.
  (async () => {
    try {
      const st = await fetch(`${ADMIN_API}/api/setup/status`).then((r) => (r.ok ? r.json() : { needed: false }));
      if (st.needed) {
        bootstrapMode = true;
        $('#bootstrapBanner').hidden = false;
        showApp(); init();
        return;
      }
    } catch { /* sin cookie de PIN válida el servidor ya sirvió la puerta */ }
    if (!token()) { showLogin(); return; }
    try {
      const { user } = await api('/api/auth/me');
      $('#whoami').textContent = user.email;
      showApp(); init();
    } catch { showLogin(); }
  })();
})();
