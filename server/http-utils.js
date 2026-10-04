import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import helmet from 'helmet';
import { config, ROOT } from './config.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- Respuestas ---------- */
export function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(body);
}

export const ok = (res, data) => sendJson(res, 200, data);
export const fail = (res, status, msg, extra) =>
  sendJson(res, status, { error: msg, ...(extra || {}) });

/* ---------- Cookies ---------- */
export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

/* ---------- Body JSON con límite ---------- */
export function readJson(req, maxBytes = config.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'Cuerpo de la petición demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

/* ---------- Multipart (subida de imágenes, RF-017) ---------- */
export function readMultipart(req, maxBytes = config.maxVideoBytes + 64 * 1024) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const m = ct.match(/multipart\/form-data;\s*boundary=(.+)$/i);
    if (!m) return reject(new HttpError(400, 'Se esperaba multipart/form-data.'));
    const boundary = Buffer.from('--' + m[1]);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new HttpError(413, 'El archivo supera el tamaño máximo permitido.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const fields = {};
        let file = null;
        let start = buf.indexOf(boundary);
        while (start !== -1) {
          const end = buf.indexOf(boundary, start + boundary.length);
          if (end === -1) break;
          const part = buf.subarray(start + boundary.length, end);
          const sep = part.indexOf('\r\n\r\n');
          if (sep !== -1) {
            const head = part.subarray(0, sep).toString('utf8');
            let body = part.subarray(sep + 4);
            if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
              body = body.subarray(0, body.length - 2);
            }
            const name = (head.match(/name="([^"]*)"/) || [])[1];
            const filename = (head.match(/filename="([^"]*)"/) || [])[1];
            const partType = (head.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1]?.trim();
            if (filename) file = { field: name, filename, mime: partType, data: body };
            else if (name) fields[name] = body.toString('utf8');
          }
          start = end;
        }
        resolve({ fields, file });
      } catch (e) { reject(new HttpError(400, 'No se pudo procesar el archivo.')); }
    });
    req.on('error', reject);
  });
}

const ALLOWED_UPLOAD_MIMES = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm',
};
export async function saveUpload(file) {
  if (!file || !file.data || !file.data.length) throw new HttpError(400, 'No se recibió ningún archivo.');
  const ext = ALLOWED_UPLOAD_MIMES[file.mime];
  if (!ext) throw new HttpError(400, 'Formato no permitido. Usá PNG, JPG, WEBP, GIF, MP4 o WEBM.');
  const isVideo = file.mime.startsWith('video/');
  const max = isVideo ? config.maxVideoBytes : config.maxUploadBytes;
  if (file.data.length > max) {
    throw new HttpError(413, `El archivo supera el máximo de ${isVideo ? '30' : '3'} MB.`);
  }
  // Firma mágica mínima para evitar archivos renombrados maliciosos
  const sig4 = file.data.subarray(0, 4).toString('hex');
  const sig12 = file.data.subarray(4, 12).toString('utf8');
  const validSig = sig4.startsWith('89504e47') || sig4.startsWith('ffd8ff') ||
    sig4.startsWith('47494638') || sig4.startsWith('52494646') ||
    sig4.startsWith('1a45dfa3') || sig12 === 'ftypisom' || sig12 === 'ftypmp42' ||
    sig12 === 'ftypMSNV' || sig12.startsWith('ftyp');
  if (!validSig) throw new HttpError(400, 'El archivo no es una imagen o video válido.');
  const name = crypto.randomBytes(16).toString('hex') + ext;
  // Almacenamiento en la nube (el FS de Vercel es efímero).
  // Prioridad: Supabase Storage → Vercel Blob → disco local.
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPA_BUCKET = process.env.SUPABASE_STORAGE_BUCKET;
  const hasSupa = SUPA_URL && SUPA_KEY && SUPA_BUCKET;
  if (process.env.VERCEL && !hasSupa && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new HttpError(503, 'Uploads no disponibles: configurá Supabase Storage (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET) o BLOB_READ_WRITE_TOKEN.');
  }
  if (hasSupa) {
    const resp = await fetch(`${SUPA_URL}/storage/v1/object/${SUPA_BUCKET}/uploads/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPA_KEY}`,
        apikey: SUPA_KEY,
        'Content-Type': file.mime,
        'x-upsert': 'false',
      },
      body: file.data,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new HttpError(502, `Error al subir a Supabase Storage (${resp.status}). Verificá el bucket "${SUPA_BUCKET}" y sus políticas. ${detail.slice(0, 120)}`);
    }
    return { url: `${SUPA_URL}/storage/v1/object/public/${SUPA_BUCKET}/uploads/${name}`, name };
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(name, file.data, { access: 'public', contentType: file.mime });
    return { url: blob.url, name: blob.pathname };
  }
  fs.writeFileSync(path.join(config.uploadDir, name), file.data);
  return { url: `/uploads/${name}`, name };
}

/* ---------- Archivos estáticos con cabeceras de seguridad ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

/* helmet aplica la batería estándar de cabeceras duras (HSTS, nosniff,
   DNS-prefetch, Download-Options, etc.). El CSP propio y X-Frame-Options
   se fijan en securityHeaders() y sobrescriben los de helmet. */
const helmetMw = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
});
export function applyHelmet(req, res) {
  return new Promise((resolve, reject) =>
    helmetMw(req, res, (err) => (err ? reject(err) : resolve())));
}

export function securityHeaders(isAdmin = false) {
  return {
    'X-Content-Type-Options': 'nosniff',
    // El panel embebe la vista previa del sitio en un iframe del mismo origen (:4000)
    'X-Frame-Options': isAdmin ? 'SAMEORIGIN' : 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Robots-Tag': isAdmin ? 'noindex, nofollow' : 'index, follow',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://*.public.blob.vercel-storage.com https://*.supabase.co",
      "media-src 'self' https://*.public.blob.vercel-storage.com https://*.supabase.co",
      "connect-src 'self'",
      `frame-ancestors ${isAdmin ? "'self'" : "'none'"}`,
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  };
}

// Sirve un archivo estático. baseDir limita path traversal.
export function serveStatic(res, baseDir, urlPath, extraHeaders = {}) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const filePath = path.normalize(path.join(baseDir, clean));
  if (!filePath.startsWith(path.normalize(baseDir))) throw new HttpError(403, 'Acceso denegado.');
  let file = filePath;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(filePath, 'index.html');
    if (fs.existsSync(idx)) file = idx; else return false;
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extraHeaders });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------- Hub SSE (actualización en tiempo real) ---------- */
const clients = new Set();
export function sseSubscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
  // En serverless (Vercel) las conexiones largas se cortan: cerramos prolijo a los ~25 s
  // y el cliente reconecta o pasa al modo polling de /api/version.
  if (process.env.VERCEL) setTimeout(() => { try { res.end(); } catch { /* noop */ } }, 25_000).unref?.();
}
export function sseBroadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { clients.delete(res); } }
}
setInterval(() => sseBroadcast('ping', { t: Date.now() }), 25_000).unref();

/* ---------- Mini router ---------- */
export function makeRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, rx, keys, handler });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    async dispatch(req, res, pathname) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.rx);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        await r.handler(req, res, params, Object.fromEntries(new URL(req.url, 'http://x').searchParams));
        return true;
      }
      return false;
    },
  };
}
