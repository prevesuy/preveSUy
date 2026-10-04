import { db, nowSql, fmtDate } from './db.js';
import { ok, fail, readJson, sseSubscribe, makeRouter, HttpError } from './http-utils.js';
import { cleanText, isEmail, rateLimit, rateLimitFail } from './security.js';

export const TOOL_TYPES = ['linea', 'guia', 'video', 'contacto', 'educativo'];
export const ALL_TYPES = [...TOOL_TYPES, 'ejercicio', 'noticia', 'aviso', 'articulo', 'campana'];
export const AGES = ['ninos', 'adolescentes', 'adultos', 'todos'];
export const AREAS = ['salud_mental', 'suicidio', 'adicciones', 'violencia', 'general'];
const TRACK_EVENTS = ['emergency_click', 'survey_useful_yes', 'survey_useful_no', 'survey_skip', 'exercise_view', 'page_view', 'favorite'];

const row = (c) => ({
  id: Number(c.id), type: c.type, area: c.area, age: c.age, title: c.title, body: c.body,
  tags: JSON.parse(c.tags || '[]'), image: c.image, link: c.link,
  published_at: fmtDate(c.published_at), updated_at: fmtDate(c.updated_at),
});

export function publicRouter() {
  const r = makeRouter();

  r.get('/api/health', (req, res) => ok(res, { ok: true }));

  // Versión del contenido: el cliente la sondea cuando SSE no está disponible (Vercel)
  r.get('/api/version', async (req, res) => {
    const v = await db.get("SELECT value FROM settings WHERE key = 'version'");
    ok(res, { v: v?.value || '0' });
  });

  // Config pública (slogan, líneas de emergencia, textos editables)
  r.get('/api/config', async (req, res) => {
    const rows = await db.all('SELECT key, value FROM settings');
    const s = Object.fromEntries(rows.map((x) => [x.key, x.value]));
    const texts = Object.fromEntries(
      (await db.all('SELECT key, value FROM site_texts')).map((x) => [x.key, x.value])
    );
    ok(res, {
      slogan: s.slogan,
      phonePrimary: s.phone_primary,
      phonePrimaryDesc: s.phone_primary_desc,
      phonesSecondary: JSON.parse(s.phones_secondary || '[]'),
      texts,
    });
  });

  // RF-005/RF-009: recursos filtrados por edad, categoría y texto (server-side)
  r.get('/api/resources', async (req, res, p, query) => {
    const conds = ["status = 'published'", `type IN (${TOOL_TYPES.map(() => '?').join(',')})`];
    const args = [...TOOL_TYPES];
    if (query.category && query.category !== 'todas') {
      if (!TOOL_TYPES.includes(query.category)) return fail(res, 400, 'La categoría seleccionada no es válida.');
      conds.push('type = ?'); args.push(query.category);
    }
    if (query.age && query.age !== 'todas') {
      if (!AGES.includes(query.age)) return fail(res, 400, 'La categoría seleccionada no es válida.');
      conds.push("(age = ? OR age = 'todos')"); args.push(query.age);
    }
    if (query.q) {
      conds.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)');
      const like = `%${String(query.q).slice(0, 80)}%`;
      args.push(like, like, like);
    }
    const rows = await db.all(
      `SELECT * FROM contents WHERE ${conds.join(' AND ')} ORDER BY published_at DESC, id DESC LIMIT 60`,
      ...args
    );
    ok(res, { items: rows.map(row) });
  });

  // RF-007: novedades ordenadas cronológicamente + búsqueda
  r.get('/api/contents', async (req, res, p, query) => {
    const conds = ["status = 'published'"];
    const args = [];
    const typeList = query.types ? String(query.types).split(',') : (query.type ? [query.type] : []);
    if (typeList.length) {
      if (!typeList.every((t) => ALL_TYPES.includes(t))) return fail(res, 400, 'Tipo inválido.');
      conds.push(`type IN (${typeList.map(() => '?').join(',')})`); args.push(...typeList);
    }
    if (query.area && AREAS.includes(query.area)) { conds.push('area = ?'); args.push(query.area); }
    if (query.age && query.age !== 'todas') {
      if (!AGES.includes(query.age)) return fail(res, 400, 'La categoría seleccionada no es válida.');
      conds.push("(age = ? OR age = 'todos')"); args.push(query.age);
    }
    if (query.q) {
      conds.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)');
      const like = `%${String(query.q).slice(0, 80)}%`;
      args.push(like, like, like);
    }
    const limit = Math.min(Number(query.limit) || 50, 100);
    const rows = await db.all(
      `SELECT * FROM contents WHERE ${conds.join(' AND ')} ORDER BY published_at DESC, id DESC LIMIT ?`,
      ...args, limit
    );
    ok(res, { items: rows.map(row) });
  });

  r.get('/api/contents/:id', async (req, res, { id }) => {
    const c = await db.get("SELECT * FROM contents WHERE id = ? AND status = 'published'", Number(id));
    if (!c) return fail(res, 404, 'Contenido no encontrado.');
    ok(res, { item: row(c) });
  });

  r.get('/api/exercises', async (req, res, p, query) => {
    const conds = ["status = 'published'", "type = 'ejercicio'"];
    const args = [];
    if (query.age && query.age !== 'todas') {
      if (!AGES.includes(query.age)) return fail(res, 400, 'La categoría seleccionada no es válida.');
      conds.push("(age = ? OR age = 'todos')"); args.push(query.age);
    }
    const rows = await db.all(`SELECT * FROM contents WHERE ${conds.join(' AND ')} ORDER BY published_at DESC`, ...args);
    ok(res, { items: rows.map(row) });
  });

  // RF-007: centros de ayuda locales con filtro
  r.get('/api/centers', async (req, res, p, query) => {
    let rows;
    if (query.q) {
      const like = `%${String(query.q).slice(0, 80)}%`;
      rows = await db.all(
        'SELECT * FROM centers WHERE name LIKE ? OR address LIKE ? OR dept LIKE ? ORDER BY dept, name',
        like, like, like
      );
    } else {
      rows = await db.all('SELECT * FROM centers ORDER BY dept, name');
    }
    ok(res, { items: rows.map((c) => ({ ...c, id: Number(c.id), created_at: fmtDate(c.created_at) })) });
  });

  // Formulario de contacto con validación server-side (RF-008)
  r.post('/api/contact', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'x';
    const rl = rateLimit(`contact:${ip}`, 5, 60_000, 120_000);
    if (!rl.ok) return fail(res, 429, `Demasiados envíos. Esperá ${rl.retryAfter}s.`);
    const b = await readJson(req);
    const errors = {};
    const name = cleanText(b.name, 80);
    const email = cleanText(b.email, 120);
    const body = cleanText(b.body ?? b.message, 2000);
    if (name.length < 2) errors.name = 'Ingresá tu nombre (mínimo 2 caracteres).';
    if (!isEmail(email)) errors.email = 'Ingresá un correo electrónico válido.';
    if (body.length < 10) errors.body = 'El mensaje debe tener al menos 10 caracteres.';
    if (Object.keys(errors).length) { rateLimitFail(`contact:${ip}`, 5, 60_000, 120_000); return fail(res, 422, 'Revisá los campos del formulario.', { fields: errors }); }
    await db.run('INSERT INTO messages (name, email, body, created_at) VALUES (?, ?, ?, ?)', name, email, body, nowSql());
    ok(res, { ok: true, message: 'Tu mensaje fue recibido. Gracias por contactarte con PREVESUY.' });
  });

  // RF-013: métricas anonimizadas — jamás se guarda IP ni cabeceras.
  // Deduplicación por sesión (sid = ID anónimo del visitante en localStorage):
  // una métrica cuenta UNA vez por usuario, no por cantidad de clics.
  r.post('/api/track', async (req, res) => {
    const b = await readJson(req, 4096);
    const event = cleanText(b.event, 40);
    if (!TRACK_EVENTS.includes(event)) return fail(res, 400, 'Evento inválido.');
    const meta = cleanText(typeof b.meta === 'string' ? b.meta : JSON.stringify(b.meta ?? {}), 200);
    const sid = cleanText(b.sid, 64);
    if (sid) {
      if (event === 'survey_useful_yes' || event === 'survey_useful_no') {
        // Voto de encuesta: un solo voto por sesión y página — el último reemplaza.
        await db.run("DELETE FROM analytics WHERE sid = ? AND meta = ? AND event LIKE 'survey_useful_%'", sid, meta);
      } else {
        const exists = await db.get(
          'SELECT id FROM analytics WHERE event = ? AND sid = ? AND meta = ? LIMIT 1',
          event, sid, meta);
        if (exists) return ok(res, { ok: true, deduped: true });
      }
    }
    await db.run('INSERT INTO analytics (event, meta, sid, created_at) VALUES (?, ?, ?, ?)', event, meta, sid, nowSql());
    ok(res, { ok: true });
  });

  // SSE: notificaciones en tiempo real (local; en Vercel el cliente usa /api/version)
  r.get('/api/events', (req, res) => sseSubscribe(req, res));

  return r;
}

export function handlePublicApi(req, res, pathname) {
  return publicRouterInstance.dispatch(req, res, pathname);
}
const publicRouterInstance = publicRouter();

export function apiError(res, e) {
  if (e instanceof HttpError) return fail(res, e.status, e.message);
  console.error('[api]', e);
  return fail(res, 500, 'Error interno del servidor.');
}
