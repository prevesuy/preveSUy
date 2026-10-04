import path from 'node:path';
import { config } from './config.js';

/*
 * Capa de datos dual:
 *  - Producción (Vercel): PostgreSQL si POSTGRES_URL o DATABASE_URL está definida.
 *  - Desarrollo local: SQLite embebido (node:sqlite), sin dependencias externas.
 * Todas las operaciones son async para que ambos drivers compartan la misma API.
 * Los placeholders se escriben como '?' y se traducen a '$n' en Postgres.
 */

const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
export const isPostgres = !!PG_URL;

export const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const fmtDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v ?? ''));

/* ---------- Esquema (dialecto por motor) ---------- */
const SCHEMA_SQLITE = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'general',
  age TEXT NOT NULL DEFAULT 'todos',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  image TEXT,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  sid TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_texts (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contents (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'general',
  age TEXT NOT NULL DEFAULT 'todos',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  image TEXT,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS centers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  sid TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_texts (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
`;

/* ---------- Driver ---------- */
let db;
let initPromise;

const qPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export function initDb() {
  return (initPromise ??= (async () => {
    if (process.env.VERCEL && !isPostgres) {
      throw new Error('POSTGRES_URL es obligatoria en Vercel (el filesystem es efímero). Configurá la variable de entorno.');
    }
    if (isPostgres) {
      const { default: postgres } = await import('postgres');
      const client = postgres(PG_URL, {
        max: 2,
        // Supabase (y cualquier pooler pgbouncer en modo transaction) exige
        // prepared statements desactivados; es seguro también en conexión directa.
        prepare: false,
        ssl: PG_URL.includes('localhost') || PG_URL.includes('127.0.0.1') ? false : 'require',
      });
      db = {
        engine: 'pg',
        run: async (sql, ...args) => {
          const t = qPg(sql);
          const isInsert = /^\s*insert\s/i.test(t) && !/returning/i.test(t);
          // RETURNING * porque no todas las tablas tienen columna id (settings, site_texts)
          const rows = await client.unsafe(isInsert ? `${t} RETURNING *` : t, args);
          return { changes: rows.count ?? rows.length, lastInsertRowid: isInsert ? rows[0]?.id : undefined };
        },
        get: async (sql, ...args) => (await client.unsafe(qPg(sql), args))[0],
        all: async (sql, ...args) => client.unsafe(qPg(sql), args),
      };
      for (const stmt of SCHEMA_PG.split(';').map((s) => s.trim()).filter(Boolean)) {
        await client.unsafe(stmt);
      }
      try { await client.unsafe("ALTER TABLE analytics ADD COLUMN sid TEXT NOT NULL DEFAULT ''"); } catch { /* ya existe */ }
      try { await client.unsafe('ALTER TABLE users ADD COLUMN username TEXT'); } catch { /* ya existe */ }
      try { await client.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)'); } catch { /* n/a */ }
    } else {
      const { DatabaseSync } = await import('node:sqlite');
      const sdb = new DatabaseSync(config.dbFile);
      sdb.exec(SCHEMA_SQLITE);
      try { sdb.exec('ALTER TABLE users ADD COLUMN username TEXT'); } catch { /* ya existe */ }
      try { sdb.exec("ALTER TABLE analytics ADD COLUMN sid TEXT NOT NULL DEFAULT ''"); } catch { /* ya existe */ }
      try { sdb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)'); } catch { /* n/a */ }
      db = {
        engine: 'sqlite',
        run: async (sql, ...args) => sdb.prepare(sql).run(...args),
        get: async (sql, ...args) => sdb.prepare(sql).get(...args),
        all: async (sql, ...args) => sdb.prepare(sql).all(...args),
      };
    }
    await seed();
    return db;
  })());
}

export const SLOGAN = 'Pedir ayuda no está mal'; // RF-003 / RNF-001: cadena exacta por defecto

async function seed() {
  // Datos protegidos obligatorios del documento del proyecto.
  // El resto de la plataforma arranca vacía: todo se crea desde el panel.
  const set = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING";
  await db.run(set, 'slogan', SLOGAN);
  await db.run(set, 'phone_primary', '0800 0777');
  await db.run(set, 'phone_primary_desc', 'Línea de apoyo en salud mental');
  await db.run(set, 'version', String(Date.now()));
}

export async function bumpVersion() {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    'version', String(Date.now())
  );
}

export async function audit(user, action, target = '', meta = '') {
  await db.run(
    'INSERT INTO audit_logs (user_id, user_email, action, target, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    user?.id ?? null, user?.email ?? 'sistema', action, String(target), String(meta), nowSql()
  );
}

export { db };
