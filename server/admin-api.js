import { db, audit, nowSql, fmtDate, bumpVersion } from './db.js';
import { config } from './config.js';
import {
  ok, fail, readJson, readMultipart, saveUpload, setCookie, parseCookies,
  sseSubscribe, sseBroadcast, makeRouter, HttpError,
} from './http-utils.js';
import {
  signToken, verifyToken, hashPassword, verifyPassword, randomToken, sha256,
  rateLimit, rateLimitFail, rateLimitClear, cleanText, isEmail, pick,
} from './security.js';
import { ALL_TYPES, AGES, AREAS } from './public-api.js';
import { buildPdf } from './pdf.js';

const ipOf = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

// Emite por SSE (local) y marca la versión para el polling (serverless)
const broadcast = async (event, data) => { await bumpVersion(); sseBroadcast(event, data); };

const UPLOAD_URL_RX = /^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif|mp4|webm)$/;
const BLOB_URL_RX = /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/[a-zA-Z0-9._-]+$/;
const isMediaUrl = (v) => UPLOAD_URL_RX.test(v) || BLOB_URL_RX.test(v);

/* ---------- Verificación de puerta PIN y sesión admin ---------- */
function gateOk(req) {
  const c = parseCookies(req);
  const body = verifyToken(c.pv_gate || '');
  return !!body && body.kind === 'gate';
}

async function requireAdmin(req) {
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // EventSource no puede enviar Authorization: se acepta la cookie HttpOnly (SameSite=Strict)
  const token = bearer || parseCookies(req).pv_admin || '';
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'admin') return null;
  const sess = await db.get('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
    sha256(token), Date.now());
  if (!sess) return null;
  const user = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', sess.user_id);
  if (!user || user.role !== 'admin') return null;
  return user;
}

const issueSession = async (user, res) => {
  const signed = signToken({ kind: 'admin', uid: user.id }, config.tokenTtlMs);
  await db.run('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    user.id, sha256(signed), Date.now() + config.tokenTtlMs);
  setCookie(res, 'pv_admin', signed, { maxAge: config.tokenTtlMs });
  return signed;
};

/* ---------- Modo bootstrap: 0 admins → el PIN habilita el panel completo ---------- */
const BOOTSTRAP = { id: null, email: 'bootstrap', name: 'Configuración inicial', username: 'bootstrap', role: 'admin', bootstrap: true };
const adminsCount = async () =>
  Number((await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n);

async function requireAccess(req) {
  const u = await requireAdmin(req);
  if (u) return u;
  // Sin administradores aún: la cookie del PIN alcanza (hasta crear el primero)
  if ((await adminsCount()) === 0) return BOOTSTRAP;
  return null;
}

// Acciones sensibles: exigen reingresar el código de seguridad en la petición
const pinOk = (b) => String(b?.pin ?? '') === config.adminPin;
const PIN_ERROR = 'Código de seguridad incorrecto.';

/* ---------- Validación autoritativa de contenido (RF-011) ---------- */
function validateContent(b) {
  const errors = {};
  const data = pick(b, ['type', 'area', 'age', 'title', 'body', 'tags', 'image', 'link', 'status']);
  data.title = cleanText(data.title, 200);
  data.body = cleanText(data.body, 20000);
  if (!data.title || data.title.length < 3) errors.title = 'El título es obligatorio (mínimo 3 caracteres).';
  else if (data.title.length > 120) errors.title = 'El título excede el límite de 120 caracteres.';
  if (!ALL_TYPES.includes(data.type)) errors.type = 'Tipo de contenido inválido.';
  if (!AREAS.includes(data.area)) errors.area = 'Área inválida.';
  if (!AGES.includes(data.age)) errors.age = 'Franja etaria inválida.';
  if (!Array.isArray(data.tags)) data.tags = [];
  data.tags = data.tags.map((t) => cleanText(t, 30)).filter(Boolean).slice(0, 8);
  if (data.tags.length > 5) errors.tags = 'Solo puedes agregar hasta 5 etiquetas.';
  if (data.status && !['draft', 'published'].includes(data.status)) errors.status = 'Estado inválido.';
  if (data.link && !/^https?:\/\/|^\/|^[a-zA-Z0-9.]+$/i.test(String(data.link))) errors.link = 'Enlace inválido.';
  data.link = cleanText(data.link, 300) || null;
  if (data.image && !isMediaUrl(String(data.image))) {
    data.image = null; // una ruta de imagen manipulada nunca se persiste
  }
  data.image = data.image || null;
  data.status = data.status || 'draft';
  return { data, errors };
}

const contentRow = (c) => ({
  ...c, id: Number(c.id), tags: JSON.parse(c.tags || '[]'),
  created_at: fmtDate(c.created_at), updated_at: fmtDate(c.updated_at), published_at: fmtDate(c.published_at),
});

export function adminRouter() {
  const r = makeRouter();

  /* ===== Puerta de acceso por PIN (solo el PIN habilita el panel) ===== */
  r.post('/api/gate', async (req, res) => {
    const ip = ipOf(req);
    const rl = rateLimit(`gate:${ip}`, 5, 60_000, 300_000);
    if (!rl.ok) return fail(res, 429, `Demasiados intentos. Esperá ${rl.retryAfter}s.`);
    const b = await readJson(req);
    if (String(b.pin ?? '') !== config.adminPin) {
      rateLimitFail(`gate:${ip}`, 5, 60_000, 300_000);
      await audit(null, 'GATE_FAIL', ip, 'PIN incorrecto');
      return fail(res, 401, 'PIN incorrecto.');
    }
    rateLimitClear(`gate:${ip}`);
    const gateToken = signToken({ kind: 'gate' }, config.gateTtlMs);
    setCookie(res, 'pv_gate', gateToken, { maxAge: config.gateTtlMs });
    ok(res, { ok: true });
  });

  r.get('/api/gate/status', (req, res) => ok(res, { gate: gateOk(req) }));

  /* ===== Setup inicial: primer administrador (plataforma vacía) ===== */
  r.get('/api/setup/status', async (req, res) => {
    if (!gateOk(req)) return fail(res, 403, 'Acceso denegado.');
    ok(res, { needed: (await adminsCount()) === 0 });
  });

  r.post('/api/setup', async (req, res) => {
    if (!gateOk(req)) return fail(res, 403, 'Acceso denegado.');
    const ip = ipOf(req);
    const rl = rateLimit(`setup:${ip}`, 5, 120_000, 300_000);
    if (!rl.ok) return fail(res, 429, `Demasiados intentos. Esperá ${rl.retryAfter}s.`);
    if ((await adminsCount()) !== 0) return fail(res, 409, 'La plataforma ya fue configurada.');
    const b = await readJson(req);
    const { user, errors } = validateNewAdmin(b);
    if (Object.keys(errors).length) { rateLimitFail(`setup:${ip}`, 5, 120_000, 300_000); return fail(res, 422, 'Revisá los campos.', { fields: errors }); }
    const info = await db.run(
      "INSERT INTO users (username, email, name, pass_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
      user.username, user.email, user.name, hashPassword(user.password), nowSql());
    const created = { id: Number(info.lastInsertRowid), email: user.email, name: user.name, username: user.username };
    const signed = await issueSession(created, res);
    rateLimitClear(`setup:${ip}`);
    await audit(created, 'SETUP', '', 'Primer administrador creado');
    ok(res, { token: signed, user: created });
  });

  /* ===== Login de administradores (requiere PIN ya validado) ===== */
  r.post('/api/auth/login', async (req, res) => {
    if (!gateOk(req)) return fail(res, 403, 'Acceso denegado.');
    const ip = ipOf(req);
    const rl = rateLimit(`login:${ip}`, 5, 120_000, 300_000);
    if (!rl.ok) return fail(res, 429, `Demasiados intentos. Esperá ${rl.retryAfter}s.`);
    const b = await readJson(req);
    const loginId = cleanText(b.username ?? b.email, 120).toLowerCase();
    const password = String(b.password ?? '');
    const user = await db.get(
      'SELECT * FROM users WHERE (lower(email) = ? OR lower(username) = ?) AND active = 1',
      loginId, loginId);
    if (!user || !verifyPassword(password, user.pass_hash)) {
      rateLimitFail(`login:${ip}`, 5, 120_000, 300_000);
      return fail(res, 401, 'Credenciales inválidas.');
    }
    rateLimitClear(`login:${ip}`);
    const signed = await issueSession(user, res);
    await audit(user, 'LOGIN', '', 'Inicio de sesión');
    ok(res, { token: signed, user: { id: Number(user.id), email: user.email, name: user.name, username: user.username } });
  });

  r.post('/api/auth/logout', async (req, res) => {
    const auth = req.headers.authorization || '';
    const token = (auth.startsWith('Bearer ') ? auth.slice(7) : '') || parseCookies(req).pv_admin || '';
    if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    setCookie(res, 'pv_admin', '', { maxAge: 0 });
    ok(res, { ok: true });
  });

  r.get('/api/auth/me', async (req, res) => {
    const u = await requireAdmin(req);
    if (!u) return fail(res, 401, 'Sesión no válida.');
    ok(res, { user: { id: Number(u.id), email: u.email, name: u.name, username: u.username } });
  });

  /* ===== RF-016: recuperación de contraseña (token de 15 minutos) ===== */
  r.post('/api/auth/forgot', async (req, res) => {
    if (!gateOk(req)) return fail(res, 403, 'Acceso denegado.');
    const ip = ipOf(req);
    const rl = rateLimit(`forgot:${ip}`, 3, 120_000, 300_000);
    if (!rl.ok) return fail(res, 429, `Esperá ${rl.retryAfter}s antes de reintentar.`);
    const b = await readJson(req);
    const email = cleanText(b.email, 120).toLowerCase();
    const user = await db.get("SELECT * FROM users WHERE lower(email) = ? AND active = 1 AND role = 'admin'", email);
    // Respuesta uniforme para no revelar qué correos existen
    if (user) {
      const token = randomToken();
      await db.run('INSERT INTO reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        user.id, sha256(token), Date.now() + config.resetTokenTtlMs);
      const link = `${config.adminUrl.replace(/\/$/, '')}/reset.html#${token}`;
      // Sin SMTP configurado, el enlace se emite por consola del servidor (simulación de correo).
      console.log(`[reset] Enlace de recuperación para ${email}: ${link} (válido 15 min)`);
      await audit(user, 'PASSWORD_RESET_REQUEST', '', 'Se generó un token de recuperación');
    }
    ok(res, { ok: true, message: 'Si el correo existe, se envió un enlace de recuperación (válido 15 minutos).' });
  });

  r.post('/api/auth/reset', async (req, res) => {
    if (!gateOk(req)) return fail(res, 403, 'Acceso denegado.');
    const b = await readJson(req);
    const token = String(b.token ?? '');
    const password = String(b.password ?? '');
    if (password.length < 8) return fail(res, 422, 'La contraseña debe tener al menos 8 caracteres.');
    const rt = await db.get('SELECT * FROM reset_tokens WHERE token_hash = ? AND used = 0', sha256(token));
    if (!rt || Number(rt.expires_at) < Date.now()) {
      return fail(res, 400, 'El enlace ha expirado. Solicita uno nuevo.');
    }
    await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(password), rt.user_id);
    await db.run('UPDATE reset_tokens SET used = 1 WHERE id = ?', rt.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', rt.user_id);
    const u = await db.get('SELECT * FROM users WHERE id = ?', rt.user_id);
    await audit(u, 'PASSWORD_RESET', '', 'Contraseña restablecida');
    ok(res, { ok: true, message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
  });

  /* ===== Middleware: PIN + admin (o bootstrap mientras no haya admins) ===== */
  const guard = async (req, res) => {
    if (!gateOk(req)) { fail(res, 403, 'Acceso denegado.'); return null; }
    const u = await requireAccess(req);
    if (!u) { fail(res, 401, 'Sesión no válida o expirada.'); return null; }
    return u;
  };

  /* ===== RF-011: CRUD de contenidos ===== */
  r.get('/api/contents', async (req, res, p, query) => {
    if (!await guard(req, res)) return;
    const conds = ['1=1']; const args = [];
    if (query.type && ALL_TYPES.includes(query.type)) { conds.push('type = ?'); args.push(query.type); }
    if (query.status && ['draft', 'published'].includes(query.status)) { conds.push('status = ?'); args.push(query.status); }
    if (query.q) {
      conds.push('(title LIKE ? OR body LIKE ?)');
      args.push(`%${String(query.q).slice(0, 80)}%`, `%${String(query.q).slice(0, 80)}%`);
    }
    const rows = await db.all(`SELECT * FROM contents WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT 300`, ...args);
    ok(res, { items: rows.map(contentRow) });
  });

  r.get('/api/contents/:id', async (req, res, { id }) => {
    if (!await guard(req, res)) return;
    const c = await db.get('SELECT * FROM contents WHERE id = ?', Number(id));
    if (!c) return fail(res, 404, 'Contenido no encontrado.');
    ok(res, { item: contentRow(c) });
  });

  r.post('/api/contents', async (req, res) => {
    const u = await guard(req, res); if (!u) return;
    const { data, errors } = validateContent(await readJson(req));
    if (Object.keys(errors).length) return fail(res, 422, 'Revisá los campos.', { fields: errors });
    const status = data.status === 'published' ? 'published' : 'draft';
    const info = await db.run(`INSERT INTO contents (type, area, age, title, body, tags, image, link, status, author_id, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.type, data.area, data.age, data.title, data.body, JSON.stringify(data.tags),
      data.image, data.link, status, u.id, status === 'published' ? nowSql() : null, nowSql(), nowSql());
    await audit(u, 'CREATE_CONTENT', `content:${info.lastInsertRowid}`, data.title);
    if (status === 'published') await broadcast('content', { action: 'published', id: Number(info.lastInsertRowid), title: data.title });
    ok(res, { id: Number(info.lastInsertRowid) });
  });

  const updateContent = async (req, res, id) => {
    const u = await guard(req, res); if (!u) return;
    const cur = await db.get('SELECT * FROM contents WHERE id = ?', Number(id));
    if (!cur) return fail(res, 404, 'Contenido no encontrado.');
    const merged = { ...contentRow(cur), ...pick(await readJson(req), ['type', 'area', 'age', 'title', 'body', 'tags', 'image', 'link', 'status']) };
    const { data, errors } = validateContent(merged);
    if (Object.keys(errors).length) return fail(res, 422, 'Revisá los campos.', { fields: errors });
    const becamePublished = data.status === 'published' && cur.status !== 'published';
    await db.run(`UPDATE contents SET type=?, area=?, age=?, title=?, body=?, tags=?, image=?, link=?, status=?,
      published_at = COALESCE(?, published_at),
      updated_at = ? WHERE id = ?`,
      data.type, data.area, data.age, data.title, data.body, JSON.stringify(data.tags),
      data.image, data.link, data.status || 'draft', becamePublished ? nowSql() : null, nowSql(), Number(id));
    await audit(u, 'UPDATE_CONTENT', `content:${id}`, data.title);
    if (data.status === 'published') await broadcast('content', { action: becamePublished ? 'published' : 'updated', id: Number(id), title: data.title });
    if (data.status === 'draft' && cur.status === 'published') await broadcast('content', { action: 'unpublished', id: Number(id) });
    ok(res, { ok: true });
  };
  r.put('/api/contents/:id', (req, res, { id }) => updateContent(req, res, id));
  r.patch('/api/contents/:id', (req, res, { id }) => updateContent(req, res, id)); // autoguardado

  r.delete('/api/contents/:id', async (req, res, { id }) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    if (!pinOk(b)) return fail(res, 403, PIN_ERROR);
    const cur = await db.get('SELECT * FROM contents WHERE id = ?', Number(id));
    if (!cur) return fail(res, 404, 'Contenido no encontrado.');
    await db.run('DELETE FROM contents WHERE id = ?', Number(id));
    await audit(u, 'DELETE_CONTENT', `content:${id}`, cur.title);
    if (cur.status === 'published') await broadcast('content', { action: 'deleted', id: Number(id) });
    ok(res, { ok: true });
  });

  /* ===== RF-017: subida de imágenes y video ===== */
  r.post('/api/upload', async (req, res) => {
    const u = await guard(req, res); if (!u) return;
    const { file } = await readMultipart(req);
    const saved = await saveUpload(file);
    await audit(u, 'UPLOAD_FILE', saved.name, file?.filename || '');
    ok(res, saved);
  });

  /* ===== Centros de ayuda (RF-007) ===== */
  r.get('/api/centers', async (req, res) => {
    if (!await guard(req, res)) return;
    const rows = await db.all('SELECT * FROM centers ORDER BY dept, name');
    ok(res, { items: rows.map((c) => ({ ...c, id: Number(c.id), created_at: fmtDate(c.created_at) })) });
  });
  r.post('/api/centers', async (req, res) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    const name = cleanText(b.name, 120), address = cleanText(b.address, 200),
      phone = cleanText(b.phone, 40), dept = cleanText(b.dept, 60);
    if (name.length < 3 || !address || !phone) {
      return fail(res, 422, 'Información incompleta del centro de ayuda.');
    }
    const info = await db.run('INSERT INTO centers (name, address, phone, dept, created_at) VALUES (?, ?, ?, ?, ?)',
      name, address, phone, dept, nowSql());
    await audit(u, 'CREATE_CENTER', `center:${info.lastInsertRowid}`, name);
    await broadcast('centers', { action: 'changed' });
    ok(res, { id: Number(info.lastInsertRowid) });
  });
  r.put('/api/centers/:id', async (req, res, { id }) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    const name = cleanText(b.name, 120), address = cleanText(b.address, 200),
      phone = cleanText(b.phone, 40), dept = cleanText(b.dept, 60);
    if (name.length < 3 || !address || !phone) return fail(res, 422, 'Información incompleta del centro de ayuda.');
    const info = await db.run('UPDATE centers SET name=?, address=?, phone=?, dept=? WHERE id=?',
      name, address, phone, dept, Number(id));
    if (!info.changes) return fail(res, 404, 'Centro no encontrado.');
    await audit(u, 'UPDATE_CENTER', `center:${id}`, name);
    await broadcast('centers', { action: 'changed' });
    ok(res, { ok: true });
  });
  r.delete('/api/centers/:id', async (req, res, { id }) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    if (!pinOk(b)) return fail(res, 403, PIN_ERROR);
    const info = await db.run('DELETE FROM centers WHERE id = ?', Number(id));
    if (!info.changes) return fail(res, 404, 'Centro no encontrado.');
    await audit(u, 'DELETE_CENTER', `center:${id}`);
    await broadcast('centers', { action: 'changed' });
    ok(res, { ok: true });
  });

  /* ===== Mensajes de contacto ===== */
  r.get('/api/messages', async (req, res) => {
    if (!await guard(req, res)) return;
    const rows = await db.all('SELECT * FROM messages ORDER BY created_at DESC LIMIT 300');
    ok(res, { items: rows.map((m) => ({ ...m, id: Number(m.id), created_at: fmtDate(m.created_at) })) });
  });
  r.patch('/api/messages/:id/read', async (req, res, { id }) => {
    if (!await guard(req, res)) return;
    await db.run('UPDATE messages SET read = 1 WHERE id = ?', Number(id));
    ok(res, { ok: true });
  });

  /* ===== RF-010: gestión de administradores (mínimo 2 — RNF-001) ===== */
  r.get('/api/admins', async (req, res) => {
    if (!await guard(req, res)) return;
    const rows = await db.all("SELECT id, username, email, name, role, active, created_at FROM users WHERE role = 'admin' ORDER BY id");
    ok(res, { items: rows.map((x) => ({ ...x, id: Number(x.id), created_at: fmtDate(x.created_at) })) });
  });
  r.post('/api/admins', async (req, res) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    if (!pinOk(b)) return fail(res, 403, PIN_ERROR);
    const { user, errors } = validateNewAdmin(b);
    if (Object.keys(errors).length) return fail(res, 422, 'Revisá los campos.', { fields: errors });
    if (await db.get('SELECT id FROM users WHERE lower(email) = ? OR lower(username) = ?', user.email, user.username)) {
      return fail(res, 409, 'Ya existe un usuario con ese correo o nombre de usuario.');
    }
    const info = await db.run(
      "INSERT INTO users (username, email, name, pass_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
      user.username, user.email, user.name, hashPassword(user.password), nowSql());
    await audit(u, 'CREATE_ADMIN', `user:${info.lastInsertRowid}`, user.email);
    ok(res, { id: Number(info.lastInsertRowid) });
  });
  r.delete('/api/admins/:id', async (req, res, { id }) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    if (!pinOk(b)) return fail(res, 403, PIN_ERROR);
    const target = await db.get("SELECT * FROM users WHERE id = ? AND role = 'admin'", Number(id));
    if (!target) return fail(res, 404, 'Administrador no encontrado.');
    const total = await adminsCount();
    if (total <= config.minAdmins) {
      return fail(res, 400, 'El sistema requiere al menos 2 administradores globales.');
    }
    await db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
    await db.run('DELETE FROM users WHERE id = ?', target.id);
    await audit(u, 'DELETE_ADMIN', `user:${id}`, target.email);
    ok(res, { ok: true });
  });
  r.patch('/api/admins/:id', async (req, res, { id }) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    if (!pinOk(b)) return fail(res, 403, PIN_ERROR);
    const target = await db.get("SELECT * FROM users WHERE id = ? AND role = 'admin'", Number(id));
    if (!target) return fail(res, 404, 'Administrador no encontrado.');
    if (b.active === false || b.active === 0) {
      const total = await adminsCount();
      if (target.active && total <= config.minAdmins) {
        return fail(res, 400, 'El sistema requiere al menos 2 administradores globales.');
      }
      await db.run('UPDATE users SET active = 0 WHERE id = ?', target.id);
      await db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
      await audit(u, 'DEACTIVATE_ADMIN', `user:${id}`, target.email);
    } else if (b.active === true || b.active === 1) {
      await db.run('UPDATE users SET active = 1 WHERE id = ?', target.id);
      await audit(u, 'ACTIVATE_ADMIN', `user:${id}`, target.email);
    }
    if (typeof b.password === 'string' && b.password.length >= 8) {
      await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(b.password), target.id);
      await db.run('DELETE FROM sessions WHERE user_id = ?', target.id);
      await audit(u, 'RESET_ADMIN_PASSWORD', `user:${id}`, target.email);
    }
    ok(res, { ok: true });
  });

  /* ===== Textos del sitio (editor visual en vivo) ===== */
  r.get('/api/site-texts', async (req, res) => {
    if (!await guard(req, res)) return;
    ok(res, {
      items: Object.fromEntries(
        (await db.all('SELECT key, value FROM site_texts')).map((x) => [x.key, x.value])
      ),
    });
  });

  r.put('/api/site-texts', async (req, res) => {
    const u = await guard(req, res); if (!u) return;
    const b = await readJson(req);
    const items = b.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      return fail(res, 400, 'Formato inválido.');
    }
    const changed = [];
    for (const [k, v] of Object.entries(items).slice(0, 200)) {
      if (!/^[a-z0-9_.-]{1,80}$/i.test(k)) continue;
      let value = String(v ?? '');
      if (/\.(img|src|media)$/.test(k)) {
        // Solo rutas de archivos subidos por el panel (o Vercel Blob)
        if (value && !isMediaUrl(value)) continue;
      } else {
        value = cleanText(value, 20000);
      }
      if (value === '') {
        await db.run('DELETE FROM site_texts WHERE key = ?', k);
      } else {
        await db.run('INSERT INTO site_texts (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, value);
      }
      changed.push(k);
    }
    await audit(u, 'UPDATE_SITE_TEXTS', '', `${changed.length} clave(s): ${changed.join(', ')}`);
    await broadcast('site', { keys: changed });
    ok(res, { ok: true, updated: changed.length });
  });

  /* ===== RF-019: auditoría (solo lectura — inmutable) ===== */
  r.get('/api/audit', async (req, res) => {
    if (!await guard(req, res)) return;
    const rows = await db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500');
    ok(res, { items: rows.map((a) => ({ ...a, id: Number(a.id), created_at: fmtDate(a.created_at) })) });
  });
  // Intentar modificar el registro está prohibido por diseño:
  r.delete('/api/audit/:id', (req, res) => fail(res, 405, 'El registro de auditoría es inmutable.'));
  r.put('/api/audit/:id', (req, res) => fail(res, 405, 'El registro de auditoría es inmutable.'));

  /* ===== RF-013/014: estadísticas y exportación ===== */
  r.get('/api/stats', async (req, res, p, query) => {
    if (!await guard(req, res)) return;
    const start = cleanText(query.start || '1970-01-01', 10);
    const end = cleanText(query.end || '2999-12-31', 10);
    const range = [start + ' 00:00:00', end + ' 23:59:59'];
    const byEvent = await db.all(
      "SELECT event, COUNT(*) AS n FROM analytics WHERE created_at BETWEEN ? AND ? GROUP BY event",
      ...range);
    const byDay = await db.all(
      "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM analytics WHERE created_at BETWEEN ? AND ? GROUP BY day ORDER BY day",
      ...range);
    const n = async (sql, ...a) => Number((await db.get(sql, ...a))?.n || 0);
    const counts = {
      contents_published: await n("SELECT COUNT(*) AS n FROM contents WHERE status='published'"),
      contents_draft: await n("SELECT COUNT(*) AS n FROM contents WHERE status='draft'"),
      centers: await n('SELECT COUNT(*) AS n FROM centers'),
      messages_unread: await n('SELECT COUNT(*) AS n FROM messages WHERE read = 0'),
      messages_total: await n('SELECT COUNT(*) AS n FROM messages'),
      admins: await n("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1"),
    };
    ok(res, {
      byEvent: byEvent.map((x) => ({ ...x, n: Number(x.n) })),
      byDay: byDay.map((x) => ({ ...x, n: Number(x.n) })),
      counts, range: { start, end },
    });
  });

  const exportRows = async (start, end) => (await db.all(
    'SELECT event, substr(created_at,1,10) AS day, COUNT(*) AS n FROM analytics WHERE created_at BETWEEN ? AND ? GROUP BY event, day ORDER BY day',
    start + ' 00:00:00', end + ' 23:59:59')).map((x) => ({ ...x, n: Number(x.n) }));

  r.get('/api/export.csv', async (req, res, p, query) => {
    if (!await guard(req, res)) return;
    const rows = await exportRows(cleanText(query.start || '1970-01-01', 10), cleanText(query.end || '2999-12-31', 10));
    const csv = 'fecha,evento,cantidad\n' + rows.map((x) => `${x.day},${x.event},${x.n}`).join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="prevesuy-metricas-${Date.now()}.csv"`,
    });
    res.end('﻿' + csv);
  });

  r.get('/api/export.pdf', async (req, res, p, query) => {
    if (!await guard(req, res)) return;
    const start = cleanText(query.start || '1970-01-01', 10), end = cleanText(query.end || '2999-12-31', 10);
    const rows = await exportRows(start, end);
    const lines = [
      'PREVESUY - Reporte de metricas anonimizadas',
      `Periodo: ${start} a ${end}`,
      `Generado: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
      '',
      'FECHA        EVENTO                    CANTIDAD',
      ...rows.map((x) => `${x.day}   ${x.event.padEnd(24)}  ${x.n}`),
      '',
      `Total de eventos: ${rows.reduce((a, x) => a + x.n, 0)}`,
    ];
    const pdf = buildPdf(lines);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="prevesuy-metricas-${Date.now()}.pdf"`,
    });
    res.end(pdf);
  });

  r.get('/api/events', async (req, res) => {
    if (!await guard(req, res)) return;
    sseSubscribe(req, res);
  });

  return r;
}

/* ---------- Validación de alta de administradores ---------- */
function validateNewAdmin(b) {
  const username = cleanText(b.username, 60).toLowerCase();
  const email = cleanText(b.email, 120).toLowerCase();
  const name = cleanText(b.name, 80);
  const password = String(b.password ?? '');
  const errors = {};
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) errors.username = 'Usuario: 3-60 caracteres (letras, números, . _ -).';
  if (!isEmail(email)) errors.email = 'Correo inválido.';
  if (name.length < 2) errors.name = 'Nombre obligatorio.';
  if (password.length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.';
  return { user: { username, email, name, password }, errors };
}

export const adminRouterInstance = adminRouter();
export { gateOk, requireAdmin };
