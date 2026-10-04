/*
 * Función serverless (Vercel): única entrada de API.
 *  /api/*        → API pública
 *  /admin/api/*  → API del panel (se elimina el prefijo /admin antes de despachar)
 * La separación de "puertos" local (3000/4000) se traduce en Vercel a rutas.
 *
 * Los imports del código de servidor se hacen de forma dinámica porque Vercel
 * puede compilar este archivo a CommonJS: require() de módulos ESM rompe el
 * arranque (ERR_REQUIRE_ESM); import() funciona en ambos mundos.
 */
export const config = { maxDuration: 30 };

let mod;
let ready;
const load = () => (mod ??= Promise.all([
  import('../server/db.js'),
  import('../server/public-api.js'),
  import('../server/admin-api.js'),
  import('../server/http-utils.js'),
]).then(([dbm, pub, adm, hu]) => ({ dbm, pub, adm, hu })));

const MAINTENANCE = '/mantenimiento.html';
const wantsHtml = (req) => (req.headers.accept || '').includes('text/html');

export default async function handler(req, res) {
  let ctx;
  try {
    const { dbm, pub, adm, hu } = await load();
    const { sendJson, securityHeaders, HttpError, applyHelmet } = hu;
    await applyHelmet(req, res);
    await (ready ??= dbm.initDb());
    const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
    const pathname = url.pathname;
    const isAdminPath = pathname.startsWith('/admin/api/');
    for (const [k, v] of Object.entries(securityHeaders(isAdminPath))) res.setHeader(k, v);
    ctx = { sendJson, pub, HttpError, adm, isAdminPath, pathname };
    if (isAdminPath) {
      const sub = '/api' + pathname.slice('/admin/api'.length);
      const handled = await adm.adminRouterInstance.dispatch(req, res, sub);
      if (!handled) sendJson(res, 404, { error: 'Recurso no encontrado.' });
      return;
    }
    const handled = await pub.handlePublicApi(req, res, pathname);
    if (!handled) sendJson(res, 404, { error: 'Recurso no encontrado.' });
  } catch (e) {
    // Falla catastrófica (módulos, DB, helmet): páginas → mantenimiento, APIs → 503.
    if (!(e instanceof ctx?.HttpError ?? Error)) {
      console.error('[api:fatal]', e);
      if (!res.headersSent && wantsHtml(req)) {
        res.writeHead(302, { Location: MAINTENANCE });
        return res.end();
      }
    }
    const sendJson = ctx?.sendJson ?? ((r, s, d) => { r.writeHead(s, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(d)); });
    if (e instanceof ctx?.HttpError ?? false) sendJson(res, e.status, { error: e.message });
    else if (!res.headersSent) sendJson(res, 503, { error: 'Servicio temporalmente no disponible.' });
    else res.end();
  }
}
