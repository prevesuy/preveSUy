/*
 * Middleware (Vercel Edge): la zona /admin/* solo se sirve si el PIN fue validado
 * (cookie pv_gate firmada con HMAC-SHA256). La API /admin/api/* se permite porque
 * cada endpoint re-verifica la cookie y la sesión admin en la función.
 */
const PUBLIC_ADMIN_FILES = new Set([
  '/admin/gate.html', '/admin/gate.js', '/admin/admin.css',
  '/admin/reset.html', '/admin/reset.js', '/admin/favicon.ico',
]);

const b64urlToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function verifyGateToken(token) {
  try {
    const dot = token.indexOf('.');
    if (dot < 0) return false;
    const data = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const secret = process.env.PREVESUY_SECRET || '';
    if (!secret) return true; // sin secreto configurado la función API igual valida
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(data));
    if (!ok) return false;
    const body = JSON.parse(new TextDecoder().decode(b64urlToBytes(data)));
    return body.kind === 'gate' && Number(body.exp) > Date.now();
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (PUBLIC_ADMIN_FILES.has(p) || p.startsWith('/admin/api/')) return;

  const cookie = request.headers.get('cookie') || '';
  const raw = cookie.split(';').map((s) => s.trim())
    .find((s) => s.startsWith('pv_gate='));
  const token = raw ? decodeURIComponent(raw.slice(8)) : '';
  if (await verifyGateToken(token)) return; // continuar a la página/estático

  return Response.redirect(new URL('/admin/gate.html', url));
}

export const config = { matcher: '/admin/:path*' };
