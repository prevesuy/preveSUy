// ============================================================
// PREVESUY - Generador de PDF de Métricas
// Diseño institucional - estilo APA
// Sin dependencias externas
// ============================================================

export function buildPdf(
  lines,
  {
    title = 'PREVESUY - Reporte de Métricas',
    subtitle = 'Informe institucional',
    author = 'PREVESUY',
    date = new Date().toLocaleDateString('es-UY'),
  } = {}
) {

  // ------------------------------------------------------------
  // CONFIGURACIÓN GENERAL
  // ------------------------------------------------------------

  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;

  // Aproximadamente 2,54 cm = 72 pt
  const MARGIN_X = 72;
  const MARGIN_TOP = 70;
  const MARGIN_BOTTOM = 65;

  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  // Paleta cálida
  const COLORS = {
    brown: [0.32, 0.20, 0.14],
    terracotta: [0.62, 0.32, 0.22],
    beige: [0.94, 0.90, 0.82],
    cream: [0.98, 0.96, 0.91],
    sand: [0.84, 0.73, 0.59],
    text: [0.16, 0.14, 0.12],
    gray: [0.42, 0.39, 0.36],
    white: [1, 1, 1],
  };

  // ------------------------------------------------------------
  // UTILIDADES
  // ------------------------------------------------------------

  const objects = [];

  const add = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fmt = (n) => Number(n).toFixed(3);

  const rgb = (c) => c.map(fmt).join(' ');

  /*
   * Convierte Unicode común del español a WinAnsi.
   * Esto permite conservar á, é, í, ó, ú, ñ, ¿, ¡, etc.
   */
  const winAnsiMap = {
    '€': 128,
    '‚': 130,
    'ƒ': 131,
    '„': 132,
    '…': 133,
    '†': 134,
    '‡': 135,
    'ˆ': 136,
    '‰': 137,
    'Š': 138,
    '‹': 139,
    'Œ': 140,
    'Ž': 142,
    '‘': 145,
    '’': 146,
    '“': 147,
    '”': 148,
    '•': 149,
    '–': 150,
    '—': 151,
    '˜': 152,
    '™': 153,
    'š': 154,
    '›': 155,
    'œ': 156,
    'ž': 158,
    'Ÿ': 159,

    '¡': 161,
    '¢': 162,
    '£': 163,
    '¤': 164,
    '¥': 165,
    '¦': 166,
    '§': 167,
    '¨': 168,
    '©': 169,
    'ª': 170,
    '«': 171,
    '¬': 172,
    '®': 174,
    '¯': 175,
    '°': 176,
    '±': 177,
    '²': 178,
    '³': 179,
    '´': 180,
    'µ': 181,
    '¶': 182,
    '·': 183,
    '¸': 184,
    '¹': 185,
    'º': 186,
    '»': 187,
    '¼': 188,
    '½': 189,
    '¾': 190,
    '¿': 191,

    'À': 192,
    'Á': 193,
    'Â': 194,
    'Ã': 195,
    'Ä': 196,
    'Å': 197,
    'Æ': 198,
    'Ç': 199,
    'È': 200,
    'É': 201,
    'Ê': 202,
    'Ë': 203,
    'Ì': 204,
    'Í': 205,
    'Î': 206,
    'Ï': 207,
    'Ð': 208,
    'Ñ': 209,
    'Ò': 210,
    'Ó': 211,
    'Ô': 212,
    'Õ': 213,
    'Ö': 214,
    '×': 215,
    'Ø': 216,
    'Ù': 217,
    'Ú': 218,
    'Û': 219,
    'Ü': 220,
    'Ý': 221,
    'Þ': 222,
    'ß': 223,

    'à': 224,
    'á': 225,
    'â': 226,
    'ã': 227,
    'ä': 228,
    'å': 229,
    'æ': 230,
    'ç': 231,
    'è': 232,
    'é': 233,
    'ê': 234,
    'ë': 235,
    'ì': 236,
    'í': 237,
    'î': 238,
    'ï': 239,
    'ð': 240,
    'ñ': 241,
    'ò': 242,
    'ó': 243,
    'ô': 244,
    'õ': 245,
    'ö': 246,
    '÷': 247,
    'ø': 248,
    'ù': 249,
    'ú': 250,
    'û': 251,
    'ü': 252,
    'ý': 253,
    'þ': 254,
    'ÿ': 255,
  };

  const encodeWinAnsi = (text) => {
    let result = '';

    for (const char of String(text)) {
      const code = winAnsiMap[char];

      if (code !== undefined) {
        result += String.fromCharCode(code);
      } else {
        const cp = char.codePointAt(0);

        if (cp >= 32 && cp <= 126) {
          result += char;
        } else {
          // Caracteres no soportados por Helvetica/Times
          result += '?';
        }
      }
    }

    return result;
  };

  const esc = (text) =>
    encodeWinAnsi(text)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  // ------------------------------------------------------------
  // FUENTES
  // ------------------------------------------------------------

  // Times se aproxima al estilo académico APA.
  const fontRegular = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>'
  );

  const fontBold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>'
  );

  const fontItalic = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>'
  );

  // ------------------------------------------------------------
  // MEDICIÓN APROXIMADA DEL TEXTO
  // ------------------------------------------------------------

  const textWidth = (text, size) => {
    // Aproximación suficientemente buena para Times.
    return String(text).length * size * 0.45;
  };

  const wrapText = (text, maxWidth, fontSize = 12) => {
    const words = String(text).split(/\s+/);
    const result = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;

      if (textWidth(test, fontSize) <= maxWidth) {
        current = test;
      } else {
        if (current) result.push(current);
        current = word;
      }
    }

    if (current) result.push(current);

    return result.length ? result : [''];
  };

  // ------------------------------------------------------------
  // CONSTRUCCIÓN DE PÁGINAS
  // ------------------------------------------------------------

  const pages = [];
  let currentPage = [];
  let cursorY = PAGE_H - MARGIN_TOP;

  const newPage = () => {
    if (currentPage.length) {
      pages.push(currentPage);
    }

    currentPage = [];
    cursorY = PAGE_H - MARGIN_TOP;
  };

  const ensureSpace = (height) => {
    if (cursorY - height < MARGIN_BOTTOM) {
      newPage();
    }
  };

  const addCommand = (command) => {
    currentPage.push(command);
  };

  // ------------------------------------------------------------
  // TEXTO
  // ------------------------------------------------------------

  const drawText = (
    text,
    {
      x = MARGIN_X,
      size = 12,
      font = 'regular',
      color = COLORS.text,
      align = 'left',
      maxWidth = CONTENT_W,
      lineHeight = size * 1.5,
    } = {}
  ) => {

    const fontName =
      font === 'bold'
        ? 'F2'
        : font === 'italic'
          ? 'F3'
          : 'F1';

    const linesWrapped = wrapText(text, maxWidth, size);

    ensureSpace(linesWrapped.length * lineHeight);

    for (const line of linesWrapped) {
      let drawX = x;

      if (align === 'center') {
        drawX = x + (maxWidth - textWidth(line, size)) / 2;
      }

      if (align === 'right') {
        drawX = x + maxWidth - textWidth(line, size);
      }

      addCommand(
        `BT /${fontName} ${size} Tf ${rgb(color)} rg ` +
        `1 0 0 1 ${drawX.toFixed(2)} ${cursorY.toFixed(2)} Tm ` +
        `(${esc(line)}) Tj ET`
      );

      cursorY -= lineHeight;
    }

    return linesWrapped.length * lineHeight;
  };

  // ------------------------------------------------------------
  // RECTÁNGULOS
  // ------------------------------------------------------------

  const rect = (
    x,
    y,
    width,
    height,
    {
      fill = null,
      stroke = null,
      lineWidth = 1,
    } = {}
  ) => {

    let command = '';

    if (fill) {
      command += `${rgb(fill)} rg `;
    }

    if (stroke) {
      command += `${rgb(stroke)} RG ${lineWidth} w `;
    }

    command += `${x} ${y} ${width} ${height} re `;

    if (fill && stroke) {
      command += 'B';
    } else if (fill) {
      command += 'f';
    } else {
      command += 'S';
    }

    addCommand(command);
  };

  // ------------------------------------------------------------
  // LÍNEAS
  // ------------------------------------------------------------

  const line = (
    x1,
    y1,
    x2,
    y2,
    color = COLORS.sand,
    width = 1
  ) => {
    addCommand(
      `${rgb(color)} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`
    );
  };

  // ------------------------------------------------------------
  // PORTADA
  // ------------------------------------------------------------

  // Banda superior
  rect(
    0,
    PAGE_H - 18,
    PAGE_W,
    18,
    { fill: COLORS.terracotta }
  );

  cursorY = PAGE_H - 120;

  drawText(title, {
    size: 22,
    font: 'bold',
    color: COLORS.brown,
    align: 'center',
    x: MARGIN_X,
    maxWidth: CONTENT_W,
    lineHeight: 28,
  });

  cursorY -= 8;

  drawText(subtitle, {
    size: 13,
    font: 'italic',
    color: COLORS.gray,
    align: 'center',
    x: MARGIN_X,
    maxWidth: CONTENT_W,
    lineHeight: 20,
  });

  cursorY -= 55;

  // Caja institucional
  const boxHeight = 110;

  rect(
    MARGIN_X,
    cursorY - boxHeight,
    CONTENT_W,
    boxHeight,
    {
      fill: COLORS.cream,
      stroke: COLORS.sand,
      lineWidth: 1,
    }
  );

  const boxY = cursorY - 30;

  drawText(author, {
    x: MARGIN_X + 20,
    size: 13,
    font: 'bold',
    color: COLORS.brown,
    maxWidth: CONTENT_W - 40,
    lineHeight: 20,
  });

  drawText(`Fecha del informe: ${date}`, {
    x: MARGIN_X + 20,
    size: 11,
    color: COLORS.gray,
    maxWidth: CONTENT_W - 40,
    lineHeight: 18,
  });

  drawText('Reporte de métricas institucionales', {
    x: MARGIN_X + 20,
    size: 11,
    color: COLORS.gray,
    maxWidth: CONTENT_W - 40,
    lineHeight: 18,
  });

  cursorY -= boxHeight + 55;

  // ------------------------------------------------------------
  // SECCIÓN PRINCIPAL
  // ------------------------------------------------------------

  drawText('Resumen de métricas', {
    size: 16,
    font: 'bold',
    color: COLORS.brown,
    lineHeight: 24,
  });

  cursorY -= 6;

  line(
    MARGIN_X,
    cursorY,
    PAGE_W - MARGIN_X,
    cursorY,
    COLORS.sand,
    1.2
  );

  cursorY -= 20;

  // ------------------------------------------------------------
  // NORMALIZACIÓN DE DATOS
  // ------------------------------------------------------------

  /*
   * Se mantiene compatible con el formato anterior:
   *
   * [
   *   "Usuarios registrados: 120",
   *   "Casos atendidos: 85",
   *   "Tiempo promedio: 14 minutos"
   * ]
   *
   * También admite:
   *
   * [
   *   { label: "Usuarios registrados", value: "120" },
   *   { label: "Casos atendidos", value: "85" }
   * ]
   *
   * Y líneas con "|":
   *
   * "Usuarios registrados|120"
   */

  const normalizeLine = (item) => {

    if (typeof item === 'object' && item !== null) {
      return {
        label:
          item.label ??
          item.name ??
          item.metric ??
          item.nombre ??
          'Métrica',

        value:
          item.value ??
          item.valor ??
          item.data ??
          '',
      };
    }

    const text = String(item);

    if (text.includes('|')) {
      const parts = text.split('|');

      return {
        label: parts.shift().trim(),
        value: parts.join('|').trim(),
      };
    }

    if (text.includes(':')) {
      const index = text.indexOf(':');

      return {
        label: text.slice(0, index).trim(),
        value: text.slice(index + 1).trim(),
      };
    }

    return {
      label: text,
      value: '',
    };
  };

  const metrics = lines.map(normalizeLine);

  // ------------------------------------------------------------
  // TABLA
  // ------------------------------------------------------------

  const drawTable = (data) => {

    const col1 = CONTENT_W * 0.65;
    const col2 = CONTENT_W * 0.35;

    const rowHeight = 32;
    const headerHeight = 34;

    ensureSpace(headerHeight + rowHeight);

    const tableX = MARGIN_X;

    // Encabezado
    rect(
      tableX,
      cursorY - headerHeight,
      CONTENT_W,
      headerHeight,
      { fill: COLORS.brown }
    );

    drawText('Métrica', {
      x: tableX + 10,
      size: 11,
      font: 'bold',
      color: COLORS.white,
      maxWidth: col1 - 20,
      lineHeight: 14,
    });

    const headerValueX = tableX + col1;

    drawText('Resultado', {
      x: headerValueX + 10,
      size: 11,
      font: 'bold',
      color: COLORS.white,
      maxWidth: col2 - 20,
      lineHeight: 14,
    });

    cursorY -= headerHeight;

    // Filas
    data.forEach((metric, index) => {

      const bg =
        index % 2 === 0
          ? COLORS.cream
          : COLORS.white;

      ensureSpace(rowHeight);

      rect(
        tableX,
        cursorY - rowHeight,
        CONTENT_W,
        rowHeight,
        {
          fill: bg,
          stroke: COLORS.sand,
          lineWidth: 0.5,
        }
      );

      // División vertical
      line(
        tableX + col1,
        cursorY,
        tableX + col1,
        cursorY - rowHeight,
        COLORS.sand,
        0.5
      );

      drawText(metric.label, {
        x: tableX + 10,
        size: 10.5,
        color: COLORS.text,
        maxWidth: col1 - 20,
        lineHeight: 13,
      });

      drawText(metric.value, {
        x: headerValueX + 10,
        size: 10.5,
        font: 'bold',
        color: COLORS.terracotta,
        maxWidth: col2 - 20,
        lineHeight: 13,
      });

      cursorY -= rowHeight;
    });

    cursorY -= 25;
  };

  drawTable(metrics);

  // ------------------------------------------------------------
  // NOTA APA
  // ------------------------------------------------------------

  ensureSpace(70);

  drawText('Nota.', {
    size: 10,
    font: 'italic',
    color: COLORS.text,
    lineHeight: 14,
  });

  drawText(
    'Las métricas presentadas corresponden a los datos disponibles al momento de generar el presente informe.',
    {
      x: MARGIN_X + 28,
      size: 10,
      color: COLORS.gray,
      maxWidth: CONTENT_W - 28,
      lineHeight: 14,
    }
  );

  // ------------------------------------------------------------
  // PIE DE PÁGINA Y ENCABEZADO
  // ------------------------------------------------------------

  pages.push(currentPage);

  // ------------------------------------------------------------
  // CREACIÓN DE CONTENT STREAMS
  // ------------------------------------------------------------

  const pageIds = [];
  const contentIds = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {

    const page = pages[pageIndex];

    // Encabezado
    page.unshift(
      `${rgb(COLORS.terracotta)} rg 0 ${PAGE_H - 18} ${PAGE_W} 18 re f`
    );

    // Pie
    page.push(
      `${rgb(COLORS.gray)} rg ` +
      `BT /F1 9 Tf ` +
      `1 0 0 1 ${MARGIN_X} 35 Tm ` +
      `(${esc('PREVESUY - Reporte institucional de métricas')}) Tj ET`
    );

    page.push(
      `${rgb(COLORS.gray)} rg ` +
      `BT /F1 9 Tf ` +
      `1 0 0 1 ${PAGE_W - 105} 35 Tm ` +
      `(${esc(`Página ${pageIndex + 1} de ${pages.length}`)}) Tj ET`
    );

    const stream = page.join('\n');

    const contentId = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\n` +
      `stream\n${stream}\nendstream`
    );

    contentIds.push(contentId);

    pageIds.push(objects.length + 1);

    // Placeholder
    add('');
  }

  // ------------------------------------------------------------
  // OBJETO PAGES
  // ------------------------------------------------------------

  const pagesId = objects.length + 1;

  for (let i = 0; i < pages.length; i++) {

    objects[pageIds[i] - 1] =
      `<< ` +
      `/Type /Page ` +
      `/Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << ` +
      `/Font << ` +
      `/F1 ${fontRegular} 0 R ` +
      `/F2 ${fontBold} 0 R ` +
      `/F3 ${fontItalic} 0 R ` +
      `>> ` +
      `>> ` +
      `/Contents ${contentIds[i]} 0 R ` +
      `>>`;
  }

  add(
    `<< /Type /Pages ` +
    `/Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`
  );

  // ------------------------------------------------------------
  // CATÁLOGO
  // ------------------------------------------------------------

  const catalogId = add(
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  );

  // ------------------------------------------------------------
  // PDF FINAL
  // ------------------------------------------------------------

  let output = '%PDF-1.4\n';

  const offsets = [0];

  objects.forEach((body, index) => {

    offsets.push(Buffer.byteLength(output, 'latin1'));

    output +=
      `${index + 1} 0 obj\n` +
      `${body}\n` +
      `endobj\n`;
  });

  const xrefPosition = Buffer.byteLength(output, 'latin1');

  output +=
    `xref\n` +
    `0 ${objects.length + 1}\n` +
    `0000000000 65535 f \n`;

  for (let i = 1; i <= objects.length; i++) {

    output +=
      String(offsets[i]).padStart(10, '0') +
      ' 00000 n \n';
  }

  output +=
    `trailer\n` +
    `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
    `startxref\n` +
    `${xrefPosition}\n` +
    `%%EOF`;

  return Buffer.from(output, 'latin1');
}
