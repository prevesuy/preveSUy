/* PREVESUY — lógica global del sitio público */
document.addEventListener('DOMContentLoaded', () => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const icon = (name, extra = '') => `<span class="material-symbols-rounded" aria-hidden="true"${extra}>${name}</span>`;

  // Vista previa dentro del panel admin:
  //  - local (:4000): páginas servidas bajo /preview/* con API en /preview-api
  //  - Vercel: mismas páginas con ?pv=1 en el mismo dominio
  // (se detecta por ruta/query porque el CSP bloquea scripts inline inyectados)
  const inPreviewPath = location.pathname.startsWith('/preview');
  const API = window.PV_API_BASE || (inPreviewPath ? '/preview-api' : '');
  const PREVIEW = !!window.PV_PREVIEW || inPreviewPath || new URLSearchParams(location.search).has('pv');

  /* ---------- Session ID del visitante (anónimo) ---------- */
  let sessionId = localStorage.getItem('pv_sid');
  if (!sessionId) {
    sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    localStorage.setItem('pv_sid', sessionId);
  }

  /* ---------- Métricas anonimizadas ---------- */
  const track = (event, meta = '') => {
    if (PREVIEW) return;
    fetch(`${API}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, meta: String(meta).slice(0, 180), sid: sessionId }),
    }).catch(() => {});
  };

  /* ---------- Navegación ---------- */
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.main-nav a, .site-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    const normalizedHref = href.replace(/\\/g, '/').split('/').pop();
    const isActive = normalizedHref === currentPath;
    if (isActive) link.classList.add('active');
  });

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.querySelector('.material-symbols-rounded').textContent = isOpen ? 'close' : 'menu';
    });
  }

  document.querySelectorAll('[data-scroll]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const target = document.getElementById(btn.getAttribute('data-scroll'));
      if (target) { event.preventDefault(); target.scrollIntoView({ block: 'start' }); }
    });
  });

  track('page_view', document.body.dataset.page || currentPath);

  /* Si el servidor no responde, mostrar la página de mantenimiento.
     Un reintento cubre el cold start de funciones serverless. */
  if (!PREVIEW) {
    const checkServer = (retries) => fetch(`${API}/api/health`, { cache: 'no-store' })
      .then((r) => { if (!r.ok && r.status >= 500) throw new Error('down'); })
      .catch(() => {
        if (retries > 0) setTimeout(() => checkServer(retries - 1), 3000);
        else location.replace('/mantenimiento.html');
      });
    checkServer(1);
  }

  /* ---------- Accesibilidad: tamaño de fuente y contraste ---------- */
  const root = document.documentElement;
  let fontSize = Number(localStorage.getItem('pv_font')) || 16;
  const applyFont = () => { root.style.fontSize = `${fontSize}px`; localStorage.setItem('pv_font', String(fontSize)); };
  const applyContrast = (on) => {
    document.body.classList.toggle('high-contrast', on);
    localStorage.setItem('pv_contrast', on ? '1' : '0');
    $$('#btnContrast').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  };

  applyFont();
  if (localStorage.getItem('pv_contrast') === '1') {
    document.body.classList.add('high-contrast');
    $$('#btnContrast').forEach((b) => b.setAttribute('aria-pressed', 'true'));
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnFontMinus')) { fontSize = Math.max(13, fontSize - 1); applyFont(); }
    if (e.target.closest('#btnFontPlus')) { fontSize = Math.min(20, fontSize + 1); applyFont(); }
    if (e.target.closest('#btnContrast')) applyContrast(!document.body.classList.contains('high-contrast'));
  });

  /* ---------- Toast ---------- */
  let toastEl;
  const toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'pv-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastEl._tm); toastEl._tm = setTimeout(() => { toastEl.hidden = true; }, 3600);
  };
  window.PreveSUy = { track, toast, esc, icon, PREVIEW };

  /* ---------- Textos editables del sitio (editor visual del admin) ---------- */
  let texts = {};
  const applyTexts = (map) => {
    texts = map || {};
    $$('[data-pv-key]').forEach((el) => {
      const k = el.dataset.pvKey;
      if (el.dataset.pvDef === undefined) el.dataset.pvDef = el.textContent;
      el.textContent = (k in texts && texts[k] !== '') ? texts[k] : el.dataset.pvDef;
    });
    $$('[data-pv-src]').forEach((el) => {
      const k = el.dataset.pvSrc;
      if (el.dataset.pvDef === undefined) el.dataset.pvDef = el.getAttribute('src') || '';
      el.setAttribute('src', texts[k] || el.dataset.pvDef);
    });
    $$('[data-pv-href]').forEach((el) => {
      const k = el.dataset.pvHref;
      if (el.dataset.pvDef === undefined) el.dataset.pvDef = el.getAttribute('href') || '';
      if (texts[k]) el.setAttribute('href', texts[k]);
    });
  };
  window.PreveSUy.applyTexts = applyTexts;

  /* ---------- Favoritos y vistos recientemente (localStorage) ---------- */
  const FAV_KEY = 'pv_favs';
  const RECENT_KEY = 'pv_recent';
  const getJson = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
  const favs = () => getJson(FAV_KEY);
  const recents = () => getJson(RECENT_KEY);
  const isFav = (id) => favs().some((f) => f.id === id);

  const toggleFav = (item) => {
    let list = favs();
    if (isFav(item.id)) list = list.filter((f) => f.id !== item.id);
    else { list.unshift({ ...item, at: Date.now() }); list = list.slice(0, 40); track('favorite', item.title); }
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
    renderFavButtons();
    renderActivity();
    return isFav(item.id);
  };
  const addRecent = (item) => {
    let list = recents().filter((r) => r.id !== item.id);
    list.unshift({ ...item, at: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
    renderActivity();
  };
  window.PreveSUy.isFav = isFav;
  window.PreveSUy.toggleFav = toggleFav;
  window.PreveSUy.addRecent = addRecent;

  // Botón de favorito que cada página puede inyectar en sus tarjetas
  window.PreveSUy.favBtn = (id) =>
    `<button type="button" class="fav-btn ${isFav(id) ? 'active' : ''}" data-fav="${id}" aria-label="Guardar en favoritos" aria-pressed="${isFav(id)}">${icon('favorite')}</button>`;

  const renderFavButtons = () => {
    $$('.fav-btn').forEach((b) => {
      const on = isFav(Number(b.dataset.fav));
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  };
  window.PreveSUy.renderFavButtons = renderFavButtons;

  // Clic en corazón de una tarjeta [data-cid]
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.fav-btn');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const card = b.closest('[data-cid]');
    const title = card?.dataset.ctitle || card?.querySelector('h3,strong')?.textContent || 'Contenido';
    const href = card?.dataset.chref || location.pathname.split('/').pop();
    toggleFav({ id: Number(b.dataset.fav), title: title.trim(), href });
    toast(isFav(Number(b.dataset.fav)) ? 'Guardado en favoritos.' : 'Quitado de favoritos.');
  });

  // Registrar "visto" al abrir una tarjeta con enlace
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-cid] a[href]');
    if (!link) return;
    const card = link.closest('[data-cid]');
    addRecent({
      id: Number(card.dataset.cid),
      title: (card.dataset.ctitle || card.querySelector('h3,strong')?.textContent || 'Contenido').trim(),
      href: link.getAttribute('href'),
    });
  });

  /* ---------- Sección "Tu actividad" (favoritos + recientes) ---------- */
  const activityBox = document.getElementById('myActivity');
  const renderActivity = () => {
    if (!activityBox) return;
    const f = favs().slice(0, 5);
    const r = recents().slice(0, 5);
    const mk = (items, ic, emptyMsg) => items.length
      ? items.map((x) => `
        <a class="activity-item" href="${esc(x.href)}" data-cid="${x.id}">
          ${icon(ic)}<span>${esc(x.title)}</span><small>${new Date(x.at).toLocaleDateString('es-UY')}</small>
        </a>`).join('')
      : `<p class="muted tiny">${emptyMsg}</p>`;
    activityBox.innerHTML = `
      <div class="activity-cols">
        <div>
          <h3>${icon('favorite')} <span data-pv-key="home.act.fav">Tus favoritos</span></h3>
          <div class="activity-list">${mk(f, 'bookmark', 'Todavía no guardaste contenido.')}</div>
        </div>
        <div>
          <h3>${icon('history')} <span data-pv-key="home.act.recent">Visto recientemente</span></h3>
          <div class="activity-list">${mk(r, 'history', 'Aún no viste contenido.')}</div>
        </div>
      </div>`;
    applyTexts(texts);
  };

  /* ---------- Config + botón de emergencia ---------- */
  const buildFab = (cfg) => {
    if (document.querySelector('.emergency-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'emergency-fab';
    fab.setAttribute('aria-label', 'Ayuda inmediata: abrir líneas de emergencia');
    fab.innerHTML = `${icon('emergency')} <span data-pv-key="site.fab">Ayuda inmediata</span>`;
    document.body.appendChild(fab);

    let panel;
    const openPanel = () => {
      if (panel) { panel.remove(); panel = null; return; }
      panel = document.createElement('div');
      panel.className = 'emergency-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Líneas de ayuda inmediata');
      const secondary = (cfg.phonesSecondary || []).map((p) =>
        `<div class="line"><div><strong>${esc(p.label)}</strong><br><small>Línea de apoyo</small></div><a href="tel:${esc(String(p.number).replace(/\s/g, ''))}">${esc(p.number)}</a></div>`
      ).join('');
      panel.innerHTML = `
        <button class="close" aria-label="Cerrar">${icon('close')}</button>
        <h3>Líneas de ayuda inmediata</h3>
        <p class="sub">${esc(cfg.phonePrimaryDesc || 'Atención gratuita y confidencial')}</p>
        <div class="line primary"><div><strong>Línea principal</strong><br><small>${esc(cfg.phonePrimaryDesc || '')}</small></div>
          <a href="tel:${esc(String(cfg.phonePrimary || '0800 0777').replace(/\s/g, ''))}">${esc(cfg.phonePrimary || '0800 0777')}</a></div>
        ${secondary}`;
      panel.querySelector('.close').addEventListener('click', () => { panel.remove(); panel = null; });
      document.body.appendChild(panel);
      track('emergency_click', document.body.dataset.page || '');
    };
    fab.addEventListener('click', openPanel);
  };

  const loadConfig = () => fetch(`${API}/api/config`).then((r) => r.json()).then((cfg) => {
    applyTexts(cfg.texts);
    if (cfg.slogan) $$('.slogan').forEach((s) => { if (!('site.slogan' in (texts || {}))) s.textContent = cfg.slogan; });
    buildFab(cfg);
    renderActivity();
  }).catch(() => {
    // Sin API el botón de emergencia igual debe existir (0800 0777 es obligatorio)
    buildFab({ phonePrimary: '0800 0777', phonePrimaryDesc: '', phonesSecondary: [] });
  });
  loadConfig();

  /* ---------- Modal de privacidad ---------- */
  const PRIVACY_TEXT = `
    <p><strong>Acuerdo de Confidencialidad y Privacidad</strong></p>
    <p>PREVESUY es un espacio de prevención y orientación. La información que brindes en encuestas o formularios se utiliza únicamente para mejorar los recursos disponibles.</p>
    <ul>
      <li>Tus respuestas son anónimas: no registramos tu identidad ni tu dirección IP.</li>
      <li>Los datos recopilados se muestran solo como estadísticas agregadas.</li>
      <li>La información del sitio es orientativa y no sustituye la atención profesional.</li>
      <li>Ante una emergencia, comunicate con las líneas de ayuda inmediata.</li>
      <li>Podés dejar de participar en cualquier momento sin consecuencia alguna.</li>
      <li>El contenido compartido es tratado con confidencialidad por el equipo.</li>
      <li>Ninguna respuesta será utilizada con fines comerciales.</li>
      <li>Para ejercer tus derechos sobre datos personales, escribinos por contacto.</li>
      <li>El equipo trabaja junto al Grupo de Apoyo en Prevención del Suicidio.</li>
      <li>Al aceptar, confirmás que leíste y comprendiste este acuerdo.</li>
    </ul>`;

  function requirePrivacy(cb) {
    if (localStorage.getItem('privacy_accepted') === 'true') { cb(); return; }
    const overlay = document.createElement('div');
    overlay.className = 'pv-modal-overlay';
    overlay.innerHTML = `
      <div class="pv-modal" role="dialog" aria-modal="true" aria-labelledby="pvTitle">
        <header><h2 id="pvTitle">Acuerdo de Confidencialidad y Privacidad</h2></header>
        <div class="pv-scroll" id="pvScroll">${PRIVACY_TEXT}</div>
        <footer>
          <button class="btn-cancel" type="button">Cancelar</button>
          <button class="btn-acc" type="button" disabled>Leí todo y acepto</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    const scrollBox = overlay.querySelector('#pvScroll');
    const acceptBtn = overlay.querySelector('.btn-acc');
    scrollBox.addEventListener('scroll', () => {
      if (scrollBox.scrollTop + scrollBox.clientHeight >= scrollBox.scrollHeight - 4) acceptBtn.disabled = false;
    });
    if (scrollBox.scrollHeight <= scrollBox.clientHeight + 4) acceptBtn.disabled = false;
    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem('privacy_accepted', 'true');
      overlay.remove();
      cb();
    });
  }
  window.PreveSUy.requirePrivacy = requirePrivacy;

  /* ---------- Encuestas "¿te fue útil?" (un voto por sesión, reemplazable) ---------- */
  const votes = JSON.parse(localStorage.getItem('pv_votes') || '{}');
  $$('[data-survey]').forEach((box) => {
    const page = document.body.dataset.page || '';
    const mark = () => $$('[data-sv]', box).forEach((b) => b.classList.toggle('sel', b.dataset.sv === votes[page]));
    if (votes[page]) {
      mark();
      const q = $('p', box); if (q) q.insertAdjacentHTML('afterend', '<p class="muted tiny sv-thanks">¡Gracias por tu respuesta!</p>');
    }
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sv]');
      if (!btn) return;
      requirePrivacy(() => {
        votes[page] = btn.dataset.sv;
        localStorage.setItem('pv_votes', JSON.stringify(votes));
        track(`survey_useful_${btn.dataset.sv}`, page);
        mark();
        if (!$('.sv-thanks', box)) {
          const q = $('p', box); if (q) q.insertAdjacentHTML('afterend', '<p class="muted tiny sv-thanks">¡Gracias por tu respuesta!</p>');
        }
      });
    });
  });

  /* ---------- Últimas novedades en el inicio ---------- */
  const newsBox = document.getElementById('latestNews');
  if (newsBox) {
    const NEWS_TYPES = 'noticia,aviso,articulo,campana';
    const TYPE_LABELS = { noticia: 'Noticia', aviso: 'Aviso', articulo: 'Artículo', campana: 'Campaña' };
    const loadNews = () => fetch(`${API}/api/contents?types=${NEWS_TYPES}&limit=4`)
      .then((r) => r.json())
      .then(({ items }) => {
        newsBox.innerHTML = (items || []).map((c) => `
          <a class="resource-item" href="public/novedades.html" data-cid="${c.id}" data-ctitle="${esc(c.title)}">
            ${icon('article')}
            <strong>${esc(c.title)}</strong>
            <small>${esc(TYPE_LABELS[c.type] || c.type)} · ${esc((c.published_at || '').slice(0, 10))}</small>
          </a>`).join('') || `<div class="empty-state">${icon('article')}<strong>Nada por aquí todavía</strong><span>Cuando se publique contenido vas a verlo acá.</span></div>`;
      }).catch(() => { newsBox.innerHTML = `<div class="empty-state">${icon('cloud_off')}<strong>Sin conexión</strong><span>No se pudieron cargar las novedades.</span></div>`; });
    loadNews();
    window.addEventListener('pv:content-changed', loadNews);
  }

  renderActivity();

  /* ---------- Tiempo real: SSE con respaldo de polling (Vercel) ---------- */
  const notifyContent = (d) => {
    if (d?.action === 'published') toast(`Nuevo contenido: ${d.title || ''}`);
    window.dispatchEvent(new CustomEvent('pv:content-changed', { detail: d || {} }));
  };
  const notifyCenters = () => window.dispatchEvent(new CustomEvent('pv:centers-changed'));

  let lastVersion = '';
  const pollVersion = async () => {
    try {
      const { v } = await fetch(`${API}/api/version`).then((r) => r.json());
      if (lastVersion && v !== lastVersion) { notifyContent({ action: 'updated' }); notifyCenters(); loadConfig(); }
      lastVersion = v;
    } catch { /* sin conexión */ }
  };

  let polling = null;
  const startPolling = () => {
    if (polling) return;
    pollVersion();
    polling = setInterval(pollVersion, 20_000);
  };

  try {
    const es = new EventSource(`${API}/api/events`);
    let sseFailed = false;
    es.addEventListener('content', (ev) => notifyContent(JSON.parse(ev.data)));
    es.addEventListener('centers', () => notifyCenters());
    es.addEventListener('site', () => loadConfig());
    es.onerror = () => {
      if (sseFailed) return;
      sseFailed = true;
      es.close();
      startPolling(); // respaldo serverless
    };
  } catch { startPolling(); }
});
