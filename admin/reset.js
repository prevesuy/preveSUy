document.addEventListener('DOMContentLoaded', () => {
  const token = location.hash.slice(1);
  const err = document.getElementById('resetError');
  const ok = document.getElementById('resetOk');

  if (!token) {
    err.textContent = 'El enlace es inválido o está incompleto.';
    err.hidden = false;
  }

  const ADMIN_API = location.port === '4000' ? '' : '/admin';

  document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const p1 = document.getElementById('rPass').value;
    const p2 = document.getElementById('rPass2').value;
    const fe = (id, m) => { document.querySelector(`.field-error[data-for="${id}"]`).textContent = m || ''; };
    fe('rPass'); fe('rPass2');
    let bad = false;
    if (p1.length < 8) { fe('rPass', 'Mínimo 8 caracteres.'); bad = true; }
    if (p1 !== p2) { fe('rPass2', 'Las contraseñas no coinciden.'); bad = true; }
    if (bad) return;
    try {
      const res = await fetch(`${ADMIN_API}/api/auth/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: p1 }),
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error; err.hidden = false; return; }
      ok.textContent = data.message;
      setTimeout(() => { location.href = 'index.html'; }, 1800);
    } catch {
      err.textContent = 'No se pudo conectar con el servidor.'; err.hidden = false;
    }
  });
});
