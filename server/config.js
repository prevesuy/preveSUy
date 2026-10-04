import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(__dirname, 'data');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');

// En Vercel el filesystem del código es de solo lectura: no se puede fallar aquí.
for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* serverless read-only */ }
}

// Secreto de firma de tokens: PREVESUY_SECRET en producción; local se genera y persiste.
const SECRET_FILE = path.join(DATA_DIR, '.secret');
function loadSecret() {
  if (process.env.PREVESUY_SECRET) return process.env.PREVESUY_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    try { fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 }); } catch { /* read-only */ }
    if (process.env.VERCEL) {
      console.warn('[prevesuy] PREVESUY_SECRET no está definida: las sesiones no sobreviven entre instancias.');
    }
    return secret;
  }
}

export const config = {
  publicPort: Number(process.env.PORT_PUBLIC || 3000),
  adminPort: Number(process.env.PORT_ADMIN || 4000),
  host: process.env.HOST || '127.0.0.1',
  adminPin: process.env.ADMIN_PIN || '1111',
  adminUrl: process.env.ADMIN_URL || `http://127.0.0.1:${Number(process.env.PORT_ADMIN || 4000)}`,
  secret: loadSecret(),
  dbFile: path.join(DATA_DIR, 'prevesuy.db'),
  uploadDir: UPLOAD_DIR,
  tokenTtlMs: 8 * 60 * 60 * 1000,        // sesión admin: 8 h
  gateTtlMs: 8 * 60 * 60 * 1000,         // cookie de PIN: 8 h
  resetTokenTtlMs: 15 * 60 * 1000,       // RF-016: 15 minutos
  maxBodyBytes: 256 * 1024,              // límite JSON bodies
  maxUploadBytes: 3 * 1024 * 1024,       // imágenes: 3 MB
  maxVideoBytes: 30 * 1024 * 1024,       // videos: 30 MB
  minAdmins: 2,                          // RNF-001 / RF-010
};
