import http from 'node:http';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { initDb } from './db.js';
import { handlePublicApi, apiError } from './public-api.js';
import { adminRouterInstance, gateOk } from './admin-api.js';
import { serveStatic, securityHeaders, sendJson, HttpError, applyHelmet } from './http-utils.js';

await initDb();

const ADMIN_DIR = path.join(ROOT, 'admin');

/*puerto 3000*/
const publicServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const pathname = url.pathname;
  await applyHelmet(req, res);
  for (const [k, v] of Object.entries(securityHeaders())) res.setHeader(k, v);
  try {
    if (pathname.startsWith('/api/')) {
      const handled = await handlePublicApi(req, res, pathname);
      if (!handled) sendJson(res, 404, { error: 'Recurso no encontrado.' });
      return;
    }
    const target = pathname === '/' ? '/index.html' : pathname;
    const served = serveStatic(res, ROOT, target);
    if (!served) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 - Página no encontrada</h1><p><a href="/">Volver al inicio</a></p>');
    }
  } catch (e) {
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
    else { console.error('[public]', e); apiError(res, e); }
  }
});

/*puerto 4000 */
const adminServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const pathname = url.pathname;
  await applyHelmet(req, res);
  for (const [k, v] of Object.entries(securityHeaders(true))) res.setHeader(k, v);
  try {
    if (pathname.startsWith('/api/')) {
      const handled = await adminRouterInstance.dispatch(req, res, pathname);
      if (!handled) sendJson(res, 404, { error: 'Recurso no encontrado.' });
      return;
    }

    /* ===== Vista previa del sitio dentro del panel (requiere PIN) =====
       /preview/*     → archivos públicos (mismos HTML/CSS/JS, mismo origen)
       /preview-api/* → API pública de solo consulta para esa vista          */
    if (pathname === '/preview-api' || pathname.startsWith('/preview-api/')) {
      if (!gateOk(req)) { sendJson(res, 403, { error: 'Acceso denegado.' }); return; }
      const sub = pathname.slice('/preview-api'.length); // ya incluye /api/...
      const handled = await handlePublicApi(req, res, sub);
      if (!handled) sendJson(res, 404, { error: 'Recurso no encontrado.' });
      return;
    }
    if (pathname === '/preview' || pathname.startsWith('/preview/')) {
      if (!gateOk(req)) { serveStatic(res, ADMIN_DIR, '/gate.html'); return; }
      const sub = pathname.slice('/preview'.length) || '/';
      const target = sub === '/' ? '/index.html' : sub;
      // site.js detecta el modo preview por el path (/preview/*) — sin scripts inline (CSP).
      const served = serveStatic(res, ROOT, target);
      if (!served) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); }
      return;
    }

    // Sin cookie de puerta válida solo se sirve la pantalla de PIN.
    if (!gateOk(req)) {
      if (pathname === '/' || pathname === '/index.html' || pathname === '/reset.html') {
        serveStatic(res, ADMIN_DIR, '/gate.html');
        return;
      }
    } else if (pathname === '/' ) {
      serveStatic(res, ADMIN_DIR, '/index.html');
      return;
    }

    const map = {
      '/gate.html': '/gate.html', '/index.html': '/index.html', '/reset.html': '/reset.html',
      '/admin.css': '/admin.css', '/admin.js': '/admin.js',
      '/gate.js': '/gate.js', '/reset.js': '/reset.js',
    };
    if (map[pathname]) { serveStatic(res, ADMIN_DIR, map[pathname]); return; }
    if (pathname.startsWith('/assets/')) { serveStatic(res, path.join(ROOT, 'assets'), pathname.slice(7)); return; }
    if (pathname.startsWith('/uploads/')) { serveStatic(res, path.join(ROOT, 'uploads'), pathname.slice(8)); return; }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  } catch (e) {
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
    else { console.error('[admin]', e); sendJson(res, 500, { error: 'Error interno del servidor.' }); }
  }
});

const onListenError = (port) => (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[prevesuy] El puerto ${port} ya está en uso — probablemente ya hay una instancia corriendo. Cerrala o cambiá PORT_PUBLIC/PORT_ADMIN.`);
    process.exit(1);
  }
  throw e;
};
publicServer.on('error', onListenError(config.publicPort));
adminServer.on('error', onListenError(config.adminPort));

publicServer.listen(config.publicPort, config.host, () => {
  console.log(`[prevesuy] Sitio público  → http://127.0.0.1:${config.publicPort}`);
});
adminServer.listen(config.adminPort, config.host, () => {
  console.log(`[prevesuy] Panel admin    → http://127.0.0.1:${config.adminPort}  (PIN configurado)`);
});
