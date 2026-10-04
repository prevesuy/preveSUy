/* Novedades: feed de contenido publicado con búsqueda y actualización en vivo. */
document.addEventListener('DOMContentLoaded', () => {
  const PV = window.PreveSUy || {};
  const esc = PV.esc || ((s) => String(s ?? ''));
  const icon = PV.icon || ((n) => `<span class="material-symbols-rounded" aria-hidden="true">${n}</span>`);
  const API = window.PV_API_BASE || '';

  const TIPOS = [['todos', 'Todos'], ['noticia', 'Noticias'], ['aviso', 'Avisos'], ['articulo', 'Artículos'], ['campana', 'Campañas']];
  const TYPE_LABELS = Object.fromEntries(TIPOS);
  const NEWS_TYPES = 'noticia,aviso,articulo,campana';
  const TYPE_ICONS = { noticia: 'article', aviso: 'campaign', articulo: 'menu_book', campana: 'eco' };

  let tipoActivo = 'todos';
  let textoBusqueda = '';

  const list = document.getElementById('newsList');
  const chips = document.getElementById('chipsTipo');
  const buscador = document.getElementById('newsSearch');

  const renderChips = () => {
    chips.innerHTML = TIPOS.map(([val, label]) =>
      `<button type="button" class="chip ${val === tipoActivo ? 'active' : ''}" data-tipo="${val}">${label}</button>`
    ).join('');
    chips.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => { tipoActivo = chip.dataset.tipo; renderChips(); load(); });
    });
  };

  const empty = (title, sub, ic = 'article') =>
    `<div class="empty-state">${icon(ic)}<strong>${title}</strong><span>${sub}</span></div>`;

  const render = (items) => {
    if (!items.length) { list.innerHTML = empty('Sin resultados', 'Probá con otra búsqueda o cambiá el filtro.'); return; }
    list.innerHTML = items.map((c) => `
      <article class="news-card" data-cid="${c.id}" data-ctitle="${esc(c.title)}" data-chref="novedades.html">
        ${PV.favBtn ? PV.favBtn(c.id) : ''}
        ${c.image
          ? (/\.(mp4|webm)(\?|$)/.test(c.image)
            ? `<video class="thumb" src="${esc(c.image)}" controls preload="metadata"></video>`
            : `<img class="thumb" src="${esc(c.image)}" alt="">`)
          : `<div class="thumb placeholder" aria-hidden="true">${icon(TYPE_ICONS[c.type] || 'article')}</div>`}
        <div class="meta">
          <span class="tag type">${esc(TYPE_LABELS[c.type] || c.type)}</span>
          <span class="tag">${esc((c.published_at || '').slice(0, 10))}</span>
          ${(c.tags || []).slice(0, 5).map((t) => `<span class="tag age">#${esc(t)}</span>`).join('')}
        </div>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.body)}</p>
        ${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">Ver más</a>` : ''}
      </article>`).join('');
  };

  let debounce;
  const load = () => {
    const params = new URLSearchParams({ types: NEWS_TYPES });
    if (tipoActivo !== 'todos') params.set('type', tipoActivo);
    if (textoBusqueda) params.set('q', textoBusqueda);
    fetch(`${API}/api/contents?${params}`)
      .then((r) => r.json())
      .then(({ items }) => render(items || []))
      .catch(() => { list.innerHTML = empty('Sin conexión', 'No fue posible cargar las novedades.', 'cloud_off'); });
  };

  buscador?.addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { textoBusqueda = e.target.value.trim().toLowerCase(); load(); }, 300);
  });

  // Actualización en tiempo real cuando el admin publica/edita contenido
  window.addEventListener('pv:content-changed', load);

  renderChips();
  load();
});
