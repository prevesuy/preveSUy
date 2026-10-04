import crypto from 'node:crypto';
import { config } from './config.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/* ---------- Hashing de contrasenas (scrypt, KDF nativa de Node) ---------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, saltHex, hashHex] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

/* ---------- Tokens firmados HMAC (estilo JWT, sin dependencias) ---------- */
export function signToken(payload, ttlMs) {
  const body = { ...payload, exp: Date.now() + ttlMs };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', config.secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', config.secret).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ---------- Rate limiting en memoria (PIN, login, recuperacion) ---------- */
const buckets = new Map();
export function rateLimit(key, maxAttempts, windowMs, blockMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.reset) b = { fails: 0, reset: now + windowMs, blockedUntil: 0 };
  if (b.blockedUntil && now < b.blockedUntil) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil((b.blockedUntil - now) / 1000) };
  }
  buckets.set(key, b);
  return { ok: true };
}
export function rateLimitFail(key, maxAttempts, windowMs, blockMs) {
  const b = buckets.get(key);
  if (!b) return;
  b.fails += 1;
  if (b.fails >= maxAttempts) {
    b.blockedUntil = Date.now() + blockMs;
    b.fails = 0;
    b.reset = Date.now() + windowMs;
  }
}
export function rateLimitClear(key) { buckets.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset && now > (b.blockedUntil || 0)) buckets.delete(k);
}, 60_000).unref();

/* ---------- Sanitizacion y validacion de entradas ---------- */
// El contenido se almacena como texto plano y se renderiza siempre escapado.
export const escapeHtml = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
export const cleanText = (s, max = 5000) =>
  String(s ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max);

export const isEmail = (s) =>
  typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120;

// Campos permitidos (anti mass-assignment): descarta claves no declaradas.
export const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && Object.hasOwn(obj, k)) out[k] = obj[k];
  return out;
};
