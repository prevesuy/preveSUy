/* Herramientas: filtros por categoría/edad y buscador con debounce (300 ms). */
document.addEventListener('DOMContentLoaded', () => {
  const PV = window.PreveSUy || {};
  const esc = PV.esc || ((s) => String(s ?? ''));
  const icon = PV.icon || ((n) => `<span class="material-symbols-rounded" aria-hidden="true">${n}</span>`);
  const API = window.PV_API_BASE || '';

  const CATEGORIAS = [
    ['todas', 'Todas'], ['linea', 'Líneas de ayuda'], ['guia', 'Guías'],
    ['video', 'Videos'], ['contacto', 'Contactos'], ['educativo', 'Educativo'],
  ];
  const CAT_LABELS = Object.fromEntries(CATEGORIAS);
  const CAT_ICONS = { linea: 'call', guia: 'menu_book', video: 'play_circle', contacto: 'groups', educativo: 'school' };
  const EDADES = [['todas', 'Todas'], ['ninos', 'Niños'], ['adolescentes', 'Adolescentes'], ['adultos', 'Adultos']];
  const EDAD_LABELS = { ninos: 'Niños', adolescentes: 'Adolescentes', adultos: 'Adultos', todos: 'Todas las edades' };

  let categoriaActiva = 'todas';
  let edadActiva = 'todas';
  let textoBusqueda = '';

  const grid = document.getElementById('resourceGrid');
  const chipsCategoria = document.getElementById('chipsCategoria');
  const chipsEdad = document.getElementById('chipsEdad');
  const buscador = document.getElementById('resourceSearch');

  const renderChips = (container, items, activeValue, key) => {
    container.innerHTML = items.map(([val, label]) =>
      `<button type="button" class="chip ${val === activeValue ? 'active' : ''}" data-${key}="${val}">${label}</button>`
    ).join('');
    container.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (key === 'categoria') categoriaActiva = chip.dataset.categoria;
        else edadActiva = chip.dataset.edad;
        render();
      });
    });
  };

  const empty = (title, sub, ic = 'search_off') =>
    `<div class="empty-state">${icon(ic)}<strong>${title}</strong><span>${sub}</span></div>`;

  const renderGrid = (items) => {
    if (!items.length) { grid.innerHTML = empty('Sin resultados', 'Probá con otra búsqueda o cambiá los filtros.'); return; }
    grid.innerHTML = items.map((r) => `
      <article class="resource-card" data-cid="${r.id}" data-ctitle="${esc(r.title)}" data-chref="herramientas.html">
        ${PV.favBtn ? PV.favBtn(r.id) : ''}
        <div class="resource-meta">
          <span class="tag category">${icon(CAT_ICONS[r.type] || 'folder')} ${esc(CAT_LABELS[r.type] || r.type)}</span>
          <span class="tag age">${esc(EDAD_LABELS[r.age] || r.age)}</span>
        </div>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.body)}</p>
        ${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Ver más</a>` : '<a href="soporteAyuda.html">Ver más</a>'}
      </article>`).join('');
  };

  let debounce;
  const fetchResources = () => {
    const params = new URLSearchParams();
    if (categoriaActiva !== 'todas') params.set('category', categoriaActiva);
    if (edadActiva !== 'todas') params.set('age', edadActiva);
    if (textoBusqueda) params.set('q', textoBusqueda);
    fetch(`${API}/api/resources?${params}`)
      .then((r) => r.json())
      .then(({ items }) => renderGrid(items || []))
      .catch(() => { grid.innerHTML = empty('Error de conexión', 'No fue posible cargar los recursos.', 'cloud_off'); });
  };

  const render = () => {
    renderChips(chipsCategoria, CATEGORIAS, categoriaActiva, 'categoria');
    renderChips(chipsEdad, EDADES, edadActiva, 'edad');
    fetchResources();
  };

  buscador?.addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      textoBusqueda = e.target.value.trim().toLowerCase();
      fetchResources();
    }, 300);
  });

  window.addEventListener('pv:content-changed', fetchResources);
  render();
});
