document.addEventListener('DOMContentLoaded', () => {
  const inputs = [...document.querySelectorAll('#pinBoxes input')];
  const form = document.getElementById('pinForm');
  const err = document.getElementById('pinError');
  // Local (:4000) la API va en el mismo origen; en Vercel bajo /admin/api/*
  const ADMIN_API = location.port === '4000' ? '' : '/admin';

  inputs[0].focus();
  inputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '');
      digits.slice(0, 4).split('').forEach((d, j) => { if (inputs[j]) inputs[j].value = d; });
      if (digits.length >= 4) form.requestSubmit();
      else if (digits.length) inputs[Math.min(digits.length, 3)].focus();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const pin = inputs.map((i) => i.value).join('');
    if (pin.length !== 4) { err.textContent = 'Ingresá los 4 dígitos.'; err.hidden = false; return; }
    try {
      const res = await fetch(`${ADMIN_API}/api/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        err.textContent = data.error || 'PIN incorrecto.';
        err.hidden = false;
        inputs.forEach((i) => { i.value = ''; });
        inputs[0].focus();
        return;
      }
      location.href = 'index.html';
    } catch {
      err.textContent = 'No se pudo conectar con el servidor.';
      err.hidden = false;
    }
  });
});
