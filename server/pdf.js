export function buildPdf(
  lines,
  {
    title = 'PREVESUY - Reporte de Métricas',
    subtitle = 'Informe institucional',
    author = 'PREVESUY',
    date = new Date().toLocaleDateString('es-UY'),
  } = {}
) {
  const PAGE_W = 595;
  const PAGE_H = 842;

  const MARGIN = 72;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const COLORS = {
    brown: [0.25, 0.15, 0.10],
    terracotta: [0.62, 0.32, 0.22],
    cream: [0.97, 0.94, 0.87],
    beige: [0.90, 0.83, 0.72],
    light: [0.985, 0.975, 0.95],
    text: [0.15, 0.13, 0.11],
    gray: [0.40, 0.37, 0.34],
    white: [1, 1, 1],
  };

  const eventNames = {
    page_view: 'Visitas a la página',
    emergency_click: 'Clics a emergencia',
    favorite: 'Favorito',
    survey_useful_yes: 'Encuesta útil (sí)',
    exercise_view: 'Ejercicio visto',
    survey_useful_no: 'Encuesta útil (no)',
  };

  const objects = [];

  const addObject = (value) => {
    objects.push(value);
    return objects.length;
  };

  const fontRegular = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>'
  );

  const fontBold = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>'
  );

  const fontItalic = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>'
  );

  const winAnsi = {
    'á': 225,
    'é': 233,
    'í': 237,
    'ó': 243,
    'ú': 250,
    'Á': 193,
    'É': 201,
    'Í': 205,
    'Ó': 211,
    'Ú': 218,
    'ñ': 241,
    'Ñ': 209,
    'ü': 252,
    'Ü': 220,
    '¿': 191,
    '¡': 161,
    '°': 176,
    '–': 150,
    '—': 151,
    '“': 147,
    '”': 148,
    '‘': 145,
    '’': 146,
  };

  const encodeText = (value) => {
    let result = '';

    for (const char of String(value)) {
      if (winAnsi[char]) {
        result += String.fromCharCode(winAnsi[char]);
      } else {
        const code = char.charCodeAt(0);

        if (code >= 32 && code <= 126) {
          result += char;
        } else {
          result += '?';
        }
      }
    }

    return result
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  };

  const color = (value) =>
    value.map((item) => Number(item).toFixed(3)).join(' ');

  const textWidth = (value, size) =>
    String(value).length * size * 0.45;

  const wrap = (value, width, size) => {
    const words = String(value).split(/\s+/);
    const result = [];

    let current = '';

    for (const word of words) {
      const candidate = current
        ? `${current} ${word}`
        : word;

      if (textWidth(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) {
          result.push(current);
        }

        current = word;
      }
    }

    if (current) {
      result.push(current);
    }

    return result.length ? result : [''];
  };

  const drawText = (
    commands,
    value,
    x,
    y,
    width,
    {
      size = 11,
      font = 'regular',
      fill = COLORS.text,
      align = 'left',
      lineHeight = 14,
    } = {}
  ) => {
    const fontName =
      font === 'bold'
        ? 'F2'
        : font === 'italic'
          ? 'F3'
          : 'F1';

    const linesWrapped = wrap(value, width, size);

    let currentY = y;

    for (const lineText of linesWrapped) {
      let currentX = x;

      if (align === 'center') {
        currentX =
          x +
          (width - textWidth(lineText, size)) / 2;
      }

      if (align === 'right') {
        currentX =
          x +
          width -
          textWidth(lineText, size);
      }

      commands.push(
        `BT /${fontName} ${size} Tf ` +
        `${color(fill)} rg ` +
        `1 0 0 1 ${currentX.toFixed(2)} ${currentY.toFixed(2)} Tm ` +
        `(${encodeText(lineText)}) Tj ET`
      );

      currentY -= lineHeight;
    }

    return linesWrapped.length * lineHeight;
  };

  const drawRect = (
    commands,
    x,
    y,
    width,
    height,
    fill,
    stroke = null,
    strokeWidth = 0.5
  ) => {
    let command = '';

    if (fill) {
      command += `${color(fill)} rg `;
    }

    if (stroke) {
      command +=
        `${color(stroke)} RG ` +
        `${strokeWidth} w `;
    }

    command +=
      `${x} ${y} ${width} ${height} re `;

    if (fill && stroke) {
      command += 'B';
    } else if (fill) {
      command += 'f';
    } else {
      command += 'S';
    }

    commands.push(command);
  };

  const drawLine = (
    commands,
    x1,
    y1,
    x2,
    y2,
    stroke = COLORS.beige,
    width = 0.6
  ) => {
    commands.push(
      `${color(stroke)} RG ${width} w ` +
      `${x1} ${y1} m ${x2} ${y2} l S`
    );
  };

  // ============================================================
  // INTERPRETACIÓN DE LOS DATOS
  // ============================================================

  const data = {
    period: '',
    generated: '',
    events: [],
    total: null,
  };

  for (const item of lines) {
    const value = String(item).trim();

    if (!value) {
      continue;
    }

    if (/^Periodo\s*:/i.test(value)) {
      data.period = value
        .replace(/^Periodo\s*:/i, '')
        .trim();

      continue;
    }

    if (/^Generado\s*:/i.test(value)) {
      data.generated = value
        .replace(/^Generado\s*:/i, '')
        .trim();

      continue;
    }

    if (/^Total de eventos\s*:/i.test(value)) {
      data.total = value
        .replace(/^Total de eventos\s*:/i, '')
        .trim();

      continue;
    }

    const eventMatch = value.match(
      /^(\d{4}-\d{2}-\d{2})\s+([^\s]+)\s+(\d+)$/
    );

    if (eventMatch) {
      data.events.push({
        date: eventMatch[1],
        event: eventMatch[2],
        amount: eventMatch[3],
      });

      continue;
    }
  }

  if (data.total === null) {
    data.total = data.events.reduce(
      (sum, item) =>
        sum + Number(item.amount || 0),
      0
    );
  }

  // ============================================================
  // PÁGINAS
  // ============================================================

  const pages = [];
  let commands = [];

  const startPage = () => {
    commands = [];

    // Banda superior
    drawRect(
      commands,
      0,
      PAGE_H - 16,
      PAGE_W,
      16,
      COLORS.terracotta
    );
  };

  const finishPage = () => {
    pages.push(commands);
  };

  startPage();

  // ============================================================
  // PORTADA
  // ============================================================

  let y = PAGE_H - 88;

  drawText(
    commands,
    title,
    MARGIN,
    y,
    CONTENT_W,
    {
      size: 21,
      font: 'bold',
      fill: COLORS.brown,
      align: 'center',
      lineHeight: 25,
    }
  );

  y -= 38;

  drawText(
    commands,
    subtitle,
    MARGIN,
    y,
    CONTENT_W,
    {
      size: 12,
      font: 'italic',
      fill: COLORS.gray,
      align: 'center',
      lineHeight: 16,
    }
  );

  y -= 58;

  // ============================================================
  // INFORMACIÓN DEL INFORME
  // ============================================================

  const infoHeight = 112;

  drawRect(
    commands,
    MARGIN,
    y - infoHeight,
    CONTENT_W,
    infoHeight,
    COLORS.light,
    COLORS.beige,
    0.8
  );

  drawText(
    commands,
    'Información del informe',
    MARGIN + 18,
    y - 25,
    CONTENT_W - 36,
    {
      size: 13,
      font: 'bold',
      fill: COLORS.brown,
      lineHeight: 16,
    }
  );

  drawLine(
    commands,
    MARGIN + 18,
    y - 34,
    PAGE_W - MARGIN - 18,
    y - 34,
    COLORS.beige,
    0.7
  );

  drawText(
    commands,
    'Institución',
    MARGIN + 18,
    y - 56,
    130,
    {
      size: 10,
      font: 'bold',
      fill: COLORS.gray,
    }
  );

  drawText(
    commands,
    author,
    MARGIN + 150,
    y - 56,
    CONTENT_W - 168,
    {
      size: 10.5,
      fill: COLORS.text,
    }
  );

  drawText(
    commands,
    'Fecha del informe',
    MARGIN + 18,
    y - 76,
    130,
    {
      size: 10,
      font: 'bold',
      fill: COLORS.gray,
    }
  );

  drawText(
    commands,
    date,
    MARGIN + 150,
    y - 76,
    CONTENT_W - 168,
    {
      size: 10.5,
      fill: COLORS.text,
    }
  );

  drawText(
    commands,
    'Período analizado',
    MARGIN + 18,
    y - 96,
    130,
    {
      size: 10,
      font: 'bold',
      fill: COLORS.gray,
    }
  );

  drawText(
    commands,
    data.period || 'No especificado',
    MARGIN + 150,
    y - 96,
    CONTENT_W - 168,
    {
      size: 10.5,
      fill: COLORS.text,
    }
  );

  y -= infoHeight + 42;

  // ============================================================
  // TABLA DE RESUMEN
  // ============================================================

  drawText(
    commands,
    'Tabla 1',
    MARGIN,
    y,
    CONTENT_W,
    {
      size: 10,
      font: 'italic',
      fill: COLORS.gray,
      lineHeight: 13,
    }
  );

  y -= 18;

  drawText(
    commands,
    'Resumen general de métricas',
    MARGIN,
    y,
    CONTENT_W,
    {
      size: 14,
      font: 'bold',
      fill: COLORS.brown,
      lineHeight: 18,
    }
  );

  y -= 27;

  const summaryRows = [
    ['Total de eventos registrados', String(data.total)],
    ['Cantidad de registros', String(data.events.length)],
    ['Período analizado', data.period || 'No especificado'],
    ['Fecha de generación', data.generated || date],
  ];

  const summaryHeader = 31;
  const summaryRow = 32;
  const summaryLabelWidth = CONTENT_W * 0.68;
  const summaryValueWidth =
    CONTENT_W - summaryLabelWidth;

  drawRect(
    commands,
    MARGIN,
    y - summaryHeader,
    CONTENT_W,
    summaryHeader,
    COLORS.brown
  );

  drawText(
    commands,
    'Indicador',
    MARGIN + 10,
    y - 20,
    summaryLabelWidth - 20,
    {
      size: 10.5,
      font: 'bold',
      fill: COLORS.white,
    }
  );

  drawText(
    commands,
    'Resultado',
    MARGIN + summaryLabelWidth + 10,
    y - 20,
    summaryValueWidth - 20,
    {
      size: 10.5,
      font: 'bold',
      fill: COLORS.white,
      align: 'center',
    }
  );

  y -= summaryHeader;

  for (let index = 0; index < summaryRows.length; index++) {
    const row = summaryRows[index];

    const rowFill =
      index % 2 === 0
        ? COLORS.cream
        : COLORS.white;

    drawRect(
      commands,
      MARGIN,
      y - summaryRow,
      CONTENT_W,
      summaryRow,
      rowFill,
      COLORS.beige,
      0.5
    );

    drawLine(
      commands,
      MARGIN + summaryLabelWidth,
      y,
      MARGIN + summaryLabelWidth,
      y - summaryRow,
      COLORS.beige,
      0.5
    );

    drawText(
      commands,
      row[0],
      MARGIN + 10,
      y - 20,
      summaryLabelWidth - 20,
      {
        size: 10,
        fill: COLORS.text,
      }
    );

    drawText(
      commands,
      row[1],
      MARGIN + summaryLabelWidth + 10,
      y - 20,
      summaryValueWidth - 20,
      {
        size: 10,
        font: 'bold',
        fill: COLORS.terracotta,
        align: 'center',
      }
    );

    y -= summaryRow;
  }

  finishPage();

  // ============================================================
  // TABLA DE EVENTOS
  // ============================================================

  let eventIndex = 0;
  let pageNumber = 2;

  while (eventIndex < data.events.length) {
    startPage();

    y = PAGE_H - 70;

    drawText(
      commands,
      'Tabla 2',
      MARGIN,
      y,
      CONTENT_W,
      {
        size: 10,
        font: 'italic',
        fill: COLORS.gray,
      }
    );

    y -= 18;

    drawText(
      commands,
      'Registro de eventos',
      MARGIN,
      y,
      CONTENT_W,
      {
        size: 15,
        font: 'bold',
        fill: COLORS.brown,
        lineHeight: 18,
      }
    );

    y -= 28;

    const headerHeight = 32;
    const rowHeight = 30;

    const dateWidth = CONTENT_W * 0.27;
    const eventWidth = CONTENT_W * 0.50;
    const amountWidth =
      CONTENT_W - dateWidth - eventWidth;

    // Encabezado
    drawRect(
      commands,
      MARGIN,
      y - headerHeight,
      CONTENT_W,
      headerHeight,
      COLORS.brown
    );

    drawText(
      commands,
      'Fecha',
      MARGIN + 8,
      y - 20,
      dateWidth - 16,
      {
        size: 10,
        font: 'bold',
        fill: COLORS.white,
      }
    );

    drawText(
      commands,
      'Evento',
      MARGIN + dateWidth + 8,
      y - 20,
      eventWidth - 16,
      {
        size: 10,
        font: 'bold',
        fill: COLORS.white,
      }
    );

    drawText(
      commands,
      'Cantidad',
      MARGIN + dateWidth + eventWidth,
      y - 20,
      amountWidth,
      {
        size: 10,
        font: 'bold',
        fill: COLORS.white,
        align: 'center',
      }
    );

    y -= headerHeight;

    // Filas
    while (
      eventIndex < data.events.length &&
      y - rowHeight > 65
    ) {
      const item = data.events[eventIndex];

      const rowFill =
        eventIndex % 2 === 0
          ? COLORS.cream
          : COLORS.white;

      drawRect(
        commands,
        MARGIN,
        y - rowHeight,
        CONTENT_W,
        rowHeight,
        rowFill,
        COLORS.beige,
        0.5
      );

      drawLine(
        commands,
        MARGIN + dateWidth,
        y,
        MARGIN + dateWidth,
        y - rowHeight,
        COLORS.beige,
        0.5
      );

      drawLine(
        commands,
        MARGIN + dateWidth + eventWidth,
        y,
        MARGIN + dateWidth + eventWidth,
        y - rowHeight,
        COLORS.beige,
        0.5
      );

      drawText(
        commands,
        item.date,
        MARGIN + 8,
        y - 19,
        dateWidth - 16,
        {
          size: 9.5,
          fill: COLORS.text,
        }
      );

      drawText(
        commands,
        eventNames[item.event] || item.event,
        MARGIN + dateWidth + 8,
        y - 19,
        eventWidth - 16,
        {
          size: 9.5,
          fill: COLORS.text,
        }
      );

      drawText(
        commands,
        item.amount,
        MARGIN + dateWidth + eventWidth,
        y - 19,
        amountWidth,
        {
          size: 9.5,
          font: 'bold',
          fill: COLORS.terracotta,
          align: 'center',
        }
      );

      y -= rowHeight;
      eventIndex++;
    }

    // Total al final del último bloque
    if (eventIndex === data.events.length) {
      const totalHeight = 34;

      drawRect(
        commands,
        MARGIN,
        y - totalHeight,
        CONTENT_W,
        totalHeight,
        COLORS.brown
      );

      drawText(
        commands,
        'Total de eventos',
        MARGIN + 10,
        y - 22,
        CONTENT_W * 0.70,
        {
          size: 10.5,
          font: 'bold',
          fill: COLORS.white,
        }
      );

      drawText(
        commands,
        String(data.total),
        MARGIN + CONTENT_W * 0.70,
        y - 22,
        CONTENT_W * 0.30 - 10,
        {
          size: 11,
          font: 'bold',
          fill: COLORS.white,
          align: 'center',
        }
      );

      y -= totalHeight + 25;

      // Nota dentro de una caja
      const noteHeight = 54;

      drawRect(
        commands,
        MARGIN,
        y - noteHeight,
        CONTENT_W,
        noteHeight,
        COLORS.light,
        COLORS.beige,
        0.6
      );

      drawText(
        commands,
        'Nota.',
        MARGIN + 12,
        y - 18,
        35,
        {
          size: 9.5,
          font: 'italic',
          fill: COLORS.text,
        }
      );

      drawText(
        commands,
        'Las métricas presentadas corresponden a los datos disponibles al momento de generar el presente informe.',
        MARGIN + 48,
        y - 18,
        CONTENT_W - 60,
        {
          size: 9.5,
          fill: COLORS.gray,
          lineHeight: 13,
        }
      );
    }

    finishPage();
    pageNumber++;
  }

  // ============================================================
  // PIE DE PÁGINA
  // ============================================================

  for (let index = 0; index < pages.length; index++) {
    pages[index].push(
      `${color(COLORS.beige)} RG 0.6 w ` +
      `${MARGIN} 52 m ${PAGE_W - MARGIN} 52 l S`
    );

    pages[index].push(
      `BT /F1 8.5 Tf ${color(COLORS.gray)} rg ` +
      `1 0 0 1 ${MARGIN} 34 Tm ` +
      `(${encodeText('PREVESUY - Reporte institucional de métricas')}) Tj ET`
    );

    pages[index].push(
      `BT /F1 8.5 Tf ${color(COLORS.gray)} rg ` +
      `1 0 0 1 ${PAGE_W - MARGIN - 55} 34 Tm ` +
      `(${encodeText(`Página ${index + 1} de ${pages.length}`)}) Tj ET`
    );
  }

  // ============================================================
  // CREACIÓN DE OBJETOS PDF
  // ============================================================

  const pageIds = [];
  const contentIds = [];

  for (const pageCommands of pages) {
    const stream = pageCommands.join('\n');

    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\n` +
      `stream\n` +
      `${stream}\n` +
      `endstream`
    );

    contentIds.push(contentId);

    pageIds.push(objects.length + 1);

    addObject('');
  }

  const pagesId = objects.length + 1;

  for (let index = 0; index < pages.length; index++) {
    objects[pageIds[index] - 1] =
      `<< ` +
      `/Type /Page ` +
      `/Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << ` +
      `/F1 ${fontRegular} 0 R ` +
      `/F2 ${fontBold} 0 R ` +
      `/F3 ${fontItalic} 0 R ` +
      `>> >> ` +
      `/Contents ${contentIds[index]} 0 R ` +
      `>>`;
  }

  addObject(
    `<< /Type /Pages ` +
    `/Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`
  );

  const catalogId = addObject(
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  );

  // ============================================================
  // SERIALIZACIÓN
  // ============================================================

  let output = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((body, index) => {
    offsets.push(
      Buffer.byteLength(output, 'latin1')
    );

    output +=
      `${index + 1} 0 obj\n` +
      `${body}\n` +
      `endobj\n`;
  });

  const xrefPosition =
    Buffer.byteLength(output, 'latin1');

  output +=
    `xref\n` +
    `0 ${objects.length + 1}\n` +
    `0000000000 65535 f \n`;

  for (let index = 1; index <= objects.length; index++) {
    output +=
      String(offsets[index]).padStart(10, '0') +
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
