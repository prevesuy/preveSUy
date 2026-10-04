// Generador PDF minimalista (texto, Helvetica) sin dependencias externas.
// Suficiente para el reporte institucional de metricas (RF-014).
export function buildPdf(lines, { title = 'PREVESUY - Reporte' } = {}) {
  const esc = (s) => String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes para Helvetica basica
    .replace(/[\\()]/g, (m) => '\\' + m);

  const perPage = 44;
  const pages = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }

  const objects = [];
  const add = (s) => { objects.push(s); return objects.length; };

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const pageIds = [];
  const contentIds = [];

  for (const pageLines of pages) {
    let y = 780;
    let stream = 'BT /F1 10 Tf 14 TL 40 800 Td\n';
    let first = true;
    for (const line of pageLines) {
      stream += first ? `(${esc(line)}) Tj\n` : `T* (${esc(line)}) Tj\n`;
      first = false;
    }
    stream += 'ET';
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    pageIds.push(objects.length + 1);
    add(''); // placeholder de la pagina
  }

  const pagesId = objects.length + 1;
  for (let i = 0; i < pages.length; i++) {
    objects[pageIds[i] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => id + ' 0 R').join(' ')}] /Count ${pages.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let out = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
