/* Contacto: validación on blur/submit (RF-008) y centros de ayuda (RF-007). */
document.addEventListener('DOMContentLoaded', () => {
  const esc = window.PreveSUy?.esc || ((s) => String(s ?? ''));
  const API = window.PV_API_BASE || '';

  /* ---------- Validación de formulario ---------- */
  const form = document.getElementById('contactForm');
  const status = document.getElementById('formStatus');
  const setErr = (id, msg) => {
    const el = document.querySelector(`.field-error[data-for="${id}"]`);
    if (el) el.textContent = msg || '';
  };
  const validators = {
    nombre: (v) => v.trim().length >= 2 || 'Ingresá tu nombre (mínimo 2 caracteres).',
    correo: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Ingresá un correo electrónico válido.',
    mensaje: (v) => v.trim().length >= 10 || 'El mensaje debe tener al menos 10 caracteres.',
  };
  const checkField = (input) => {
    const rule = validators[input.id];
    if (!rule) return true;
    const res = rule(input.value);
    setErr(input.id, res === true ? '' : res);
    return res === true;
  };

  form.querySelectorAll('input, textarea').forEach((input) => {
    input.addEventListener('blur', () => checkField(input));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const fields = [...form.querySelectorAll('input, textarea')];
    const valid = fields.map(checkField).every(Boolean);
    if (!valid) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await fetch(`${API}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('nombre').value,
          email: document.getElementById('correo').value,
          message: document.getElementById('mensaje').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) {
          const map = { name: 'nombre', email: 'correo', body: 'mensaje' };
          Object.entries(data.fields).forEach(([k, m]) => setErr(map[k] || k, m));
        }
        status.textContent = data.error || 'No se pudo enviar.';
        status.style.color = '#c0392b';
        return;
      }
      form.reset();
      status.style.color = '#1e8e5a';
      status.textContent = data.message;
    } catch {
      status.style.color = '#c0392b';
      status.textContent = 'Error de conexión. Intentá nuevamente.';
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- Centros de ayuda con filtro ---------- */
  const grid = document.getElementById('centersGrid');
  const search = document.getElementById('centerSearch');
  let debounce;
  const loadCenters = () => {
    const q = search.value.trim();
    fetch(`${API}/api/centers${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => r.json())
      .then(({ items }) => {
        grid.innerHTML = (items || []).map((c) => `
          <article class="center-card">
            <h3>${esc(c.name)}</h3>
            <p>${esc(c.address)}</p>
            <a href="tel:${esc(String(c.phone).replace(/\s/g, ''))}" class="center-phone">${esc(c.phone)}</a>
            <small>${esc(c.dept)}</small>
          </article>`).join('') ||
          '<p class="muted">No se encontraron resultados.</p>';
      })
      .catch(() => { grid.innerHTML = '<p class="muted">No fue posible cargar los centros.</p>'; });
  };
  search?.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(loadCenters, 300); });
  window.addEventListener('pv:centers-changed', loadCenters);
  loadCenters();
});
