/* Ensambla la salida estática para Vercel en out/.
   Solo se copia lo que debe ser público (sitio + panel + assets).
   El backend vive en /api (función serverless) y no se expone.
   JS y CSS se minifican con esbuild (ofuscación: sin comentarios,
   código compactado) — el código fuente legible queda en el repo. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const item of ['index.html', 'mantenimiento.html', 'assets', 'public', 'admin']) {
  fs.cpSync(path.join(ROOT, item), path.join(OUT, item), { recursive: true });
}

/* Minificación in-place de JS y CSS */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

let minified = 0;
for (const file of walk(OUT)) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.js' && ext !== '.css') continue;
  const code = fs.readFileSync(file, 'utf8');
  const { code: min } = transformSync(code, {
    loader: ext === '.js' ? 'js' : 'css',
    minify: true,
    target: 'es2020',
    legalComments: 'none',
  });
  fs.writeFileSync(file, min);
  minified++;
}

console.log(`[build] out/ listo: ${fs.readdirSync(OUT).join(', ')} · ${minified} archivos minificados`);
