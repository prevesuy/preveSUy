/* Soporte: módulos de afrontamiento (RF-006) — acordeón + respiración 4-7-8 guiada. */
document.addEventListener('DOMContentLoaded', () => {
  const esc = window.PreveSUy?.esc || ((s) => String(s ?? ''));
  const API = window.PV_API_BASE || '';

  /* ---------- Ejercicios desde la API ---------- */
  const list = document.getElementById('exerciseList');
  const loadExercises = () => fetch(`${API}/api/exercises`)
    .then((r) => r.json())
    .then(({ items }) => {
      list.innerHTML = (items || []).map((ex, i) => `
        <div class="acc-item" data-cid="${ex.id}" data-ctitle="${esc(ex.title)}" data-chref="soporteAyuda.html">
          ${window.PreveSUy?.favBtn ? window.PreveSUy.favBtn(ex.id) : ''}
          <button type="button" class="acc-head" aria-expanded="false" aria-controls="acc-${ex.id}">
            <span>${esc(ex.title)}</span><span class="acc-icon material-symbols-rounded" aria-hidden="true">add</span>
          </button>
          <div class="acc-body" id="acc-${ex.id}" hidden>
            <p>${esc(ex.body)}</p>
            ${ex.link ? `<a href="${esc(ex.link)}" target="_blank" rel="noopener">Ver material →</a>` : ''}
          </div>
        </div>`).join('') || '<p class="muted">No se encontraron ejercicios disponibles.</p>';
    })
    .catch(() => { list.innerHTML = '<p class="muted">No fue posible cargar los ejercicios.</p>'; });

  list?.addEventListener('click', (e) => {
    const head = e.target.closest('.acc-head');
    if (!head) return;
    const body = document.getElementById(head.getAttribute('aria-controls'));
    const open = head.getAttribute('aria-expanded') === 'true';
    head.setAttribute('aria-expanded', String(!open));
    head.querySelector('.acc-icon').textContent = open ? 'add' : 'remove';
    body.hidden = open;
    if (!open) window.PreveSUy?.track('exercise_view', head.textContent.trim());
  });
  window.addEventListener('pv:content-changed', loadExercises);
  loadExercises();

  /* ---------- Respiración 4-7-8 con temporizador ---------- */
  const circle = document.getElementById('breathCircle');
  const label = document.getElementById('breathText');
  const startBtn = document.getElementById('breathStart');
  const stopBtn = document.getElementById('breathStop');
  const PHASES = [['Inhalá', 4], ['Retené', 7], ['Exhalá', 8]];
  let timer = null, phase = 0, count = 0;

  const step = () => {
    const [name, dur] = PHASES[phase];
    label.textContent = `${name}… ${dur - count}`;
    circle.classList.toggle('grow', phase === 0);
    circle.classList.toggle('hold', phase === 1);
    if (++count >= dur) { count = 0; phase = (phase + 1) % PHASES.length; }
  };
  const stop = () => {
    clearInterval(timer); timer = null;
    label.textContent = 'Listo';
    circle.classList.remove('grow', 'hold');
  };
  startBtn?.addEventListener('click', () => {
    if (timer) return;
    phase = 0; count = 0; step();
    timer = setInterval(step, 1000);
    window.PreveSUy?.track('exercise_view', 'Respiración 4-7-8');
  });
  stopBtn?.addEventListener('click', stop);
});
