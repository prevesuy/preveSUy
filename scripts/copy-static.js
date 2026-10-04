/* Ensambla la salida estática para Vercel en out/.
   Solo se copia lo que debe ser público (sitio + panel + assets).
   El backend vive en /api (función serverless) y no se expone.
   JS y CSS se minifican con terser/clean-css (JS puro: sin binarios
   ni postinstall, compatible con pnpm estricto en CI). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';
import CleanCSS from 'clean-css';

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

const cssMin = new CleanCSS({ level: 2 });
let done = 0;
for (const file of walk(OUT)) {
  const ext = path.extname(file).toLowerCase();
  const code = fs.readFileSync(file, 'utf8');
  if (ext === '.js') {
    const { code: min } = await minify(code, {
      compress: { passes: 2, drop_console: false },
      mangle: true,
      format: { comments: false },
    });
    fs.writeFileSync(file, min);
    done++;
  } else if (ext === '.css') {
    const { styles } = cssMin.minify(code);
    fs.writeFileSync(file, styles);
    done++;
  }
}

console.log(`[build] out/ listo: ${fs.readdirSync(OUT).join(', ')} · ${done} archivos minificados`);
