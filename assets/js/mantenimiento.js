/* Página de mantenimiento: reintenta contra /api/health y vuelve al inicio
   cuando el servicio se recupera. */
setInterval(() => {
  fetch('/api/health', { cache: 'no-store' })
    .then((r) => { if (r.ok) location.replace('/'); })
    .catch(() => {});
}, 30000);
