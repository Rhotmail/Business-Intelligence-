import { jsPDF } from 'jspdf';
import { ReportDefinition } from '../types.ts';
import { getEpistemicLabel, getVerificationMeta, ROLE_TITLES } from './formatters.ts';

export interface ComparisonMetricRow {
  label: string;
  reportA: number | null;
  reportB: number | null;
  unit: string;
}

function csvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '').replace(/"/g, '""');
  return `"${str}"`;
}

export function exportComparisonToCsv(params: {
  leftReport: ReportDefinition;
  rightReport: ReportDefinition;
  chartMetrics: ComparisonMetricRow[];
  chartUnit: string;
  period: string;
  branch: string;
}): void {
  const { leftReport, rightReport, chartMetrics, chartUnit, period, branch } = params;

  const lines: string[] = [];
  const pushRow = (cols: Array<string | number | null | undefined>) => {
    lines.push(cols.map(csvCell).join(','));
  };

  pushRow(['OWNER AI Enterprise — مقارنة التقارير والمؤشرات الاقتصادية']);
  pushRow(['الفترة', period, 'النطاق', branch === 'all' ? 'الشركة كاملة' : branch]);
  pushRow(['تاريخ التصدير', new Date().toLocaleString('ar-IQ')]);
  pushRow([]);

  pushRow(['البند / المؤشر', `أ · ${leftReport.title}`, `ب · ${rightReport.title}`]);
  pushRow(['التصنيف', leftReport.category, rightReport.category]);
  pushRow(['الفترة والنطاق', `${leftReport.period} · ${leftReport.dataScope}`, `${rightReport.period} · ${rightReport.dataScope}`]);
  pushRow(['حالة التحقق والثقة', leftReport.confidenceLabel, rightReport.confidenceLabel]);
  pushRow(['النتيجة المعتمدة', `${leftReport.resultHeadline}: ${leftReport.resultValue}`, `${rightReport.resultHeadline}: ${rightReport.resultValue}`]);
  pushRow([]);

  if (chartMetrics.length > 0) {
    pushRow([`مؤشرات المقارنة البصرية (${chartUnit})`, leftReport.title, rightReport.title]);
    for (const m of chartMetrics) {
      pushRow([
        `${m.label} (${m.unit})`,
        m.reportA !== null ? `${m.reportA} ${m.unit}` : '—',
        m.reportB !== null ? `${m.reportB} ${m.unit}` : '—',
      ]);
    }
    pushRow([]);
  }

  const maxEv = Math.max(leftReport.evidence.length, rightReport.evidence.length);
  pushRow([
    'مؤشر الأدلة',
    `المؤشر (أ)`,
    `القيمة (أ)`,
    `المصدر والحالة (أ)`,
    `المؤشر (ب)`,
    `القيمة (ب)`,
    `المصدر والحالة (ب)`,
  ]);
  for (let i = 0; i < maxEv; i++) {
    const evA = leftReport.evidence[i];
    const evB = rightReport.evidence[i];
    pushRow([
      `مؤشر #${i + 1}`,
      evA?.metric ?? '—',
      evA?.value ?? '—',
      evA ? `${evA.source} (${getVerificationMeta(evA.status).label})` : '—',
      evB?.metric ?? '—',
      evB?.value ?? '—',
      evB ? `${evB.source} (${getVerificationMeta(evB.status).label})` : '—',
    ]);
  }
  pushRow([]);

  pushRow(['التشخيص والأسباب — التقرير الأول', leftReport.causes.map((c) => `[${getEpistemicLabel(c.level).label}] ${c.text}`).join(' | ')]);
  pushRow(['التشخيص والأسباب — التقرير الثاني', rightReport.causes.map((c) => `[${getEpistemicLabel(c.level).label}] ${c.text}`).join(' | ')]);
  pushRow([
    'الإجراءات المقترحة — التقرير الأول',
    leftReport.suggestedActions.map((a) => `${a.action} (${a.expectedImpact} - ${ROLE_TITLES[a.ownerRole]})`).join(' | '),
  ]);
  pushRow([
    'الإجراءات المقترحة — التقرير الثاني',
    rightReport.suggestedActions.map((a) => `${a.action} (${a.expectedImpact} - ${ROLE_TITLES[a.ownerRole]})`).join(' | '),
  ]);

  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `owner-ai-comparison-${period}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function wrapArabicText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ['—'];
}

async function svgElementToImage(svgEl: SVGSVGElement): Promise<HTMLImageElement | null> {
  try {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    const width = Math.max(600, Math.round(rect.width || 760));
    const height = Math.max(240, Math.round(rect.height || 280));
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const serialized = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch {
    return null;
  }
}

export async function exportComparisonToPdf(params: {
  leftReport: ReportDefinition;
  rightReport: ReportDefinition;
  chartMetrics: ComparisonMetricRow[];
  chartUnit: string;
  period: string;
  branch: string;
  chartContainer: HTMLElement | null;
}): Promise<void> {
  const { leftReport, rightReport, chartMetrics, chartUnit, period, branch, chartContainer } = params;

  // A4 logical canvas dimensions at 2x resolution (1190 x 1684 px per page)
  const PAGE_W = 1190;
  const PAGE_H = 1684;
  const MARGIN = 64;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const FONT_FAMILY = '"IBM Plex Sans Arabic", system-ui, -apple-system, sans-serif';

  const pages: HTMLCanvasElement[] = [];

  const createPage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    pages.push(canvas);
    return { canvas, ctx };
  };

  let { ctx } = createPage();
  let y = MARGIN;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > PAGE_H - MARGIN) {
      const next = createPage();
      ctx = next.ctx;
      y = MARGIN;
    }
  };

  // Header
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 28px ${FONT_FAMILY}`;
  ctx.fillText('OWNER AI Enterprise — مقارنة التقارير والمؤشرات الاقتصادية', PAGE_W - MARGIN, y);
  y += 40;

  ctx.fillStyle = '#475569';
  ctx.font = `400 17px ${FONT_FAMILY}`;
  ctx.fillText(
    `الفترة: ${period}  ·  النطاق: ${branch === 'all' ? 'الشركة كاملة' : branch}  ·  التاريخ: ${new Date().toLocaleDateString('ar-IQ')}`,
    PAGE_W - MARGIN,
    y
  );
  y += 32;

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_W - MARGIN, y);
  ctx.stroke();
  y += 28;

  // Report A & B Summary Cards
  const cardGap = 24;
  const cardW = (CONTENT_W - cardGap) / 2;
  const drawSummaryCard = (rep: ReportDefinition, label: string, xRight: number) => {
    const xLeft = xRight - cardW;
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.fillRect(xLeft, y, cardW, 148);
    ctx.strokeRect(xLeft, y, cardW, 148);

    ctx.fillStyle = '#64748B';
    ctx.font = `600 14px ${FONT_FAMILY}`;
    ctx.fillText(`${label} · ${rep.category} · ${rep.confidenceLabel}`, xRight - 18, y + 16);

    ctx.fillStyle = '#0F172A';
    ctx.font = `700 18px ${FONT_FAMILY}`;
    const titleLines = wrapArabicText(ctx, rep.title, cardW - 36);
    ctx.fillText(titleLines[0] ?? rep.title, xRight - 18, y + 44);

    ctx.fillStyle = '#334155';
    ctx.font = `400 14px ${FONT_FAMILY}`;
    const headLines = wrapArabicText(ctx, rep.resultHeadline, cardW - 36);
    ctx.fillText(headLines[0] ?? rep.resultHeadline, xRight - 18, y + 76);

    ctx.fillStyle = '#1D4ED8';
    ctx.font = `700 18px ${FONT_FAMILY}`;
    const valLines = wrapArabicText(ctx, rep.resultValue, cardW - 36);
    ctx.fillText(valLines[0] ?? rep.resultValue, xRight - 18, y + 108);
  };

  drawSummaryCard(leftReport, 'التقرير الأول (أ)', PAGE_W - MARGIN);
  drawSummaryCard(rightReport, 'التقرير الثاني (ب)', PAGE_W - MARGIN - cardW - cardGap);
  y += 176;

  // Draw Recharts SVG Chart onto PDF
  const svgEl = chartContainer?.querySelector('svg') ?? null;
  if (svgEl) {
    const chartImg = await svgElementToImage(svgEl);
    if (chartImg) {
      ensureSpace(390);
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 19px ${FONT_FAMILY}`;
      ctx.fillText(`المقارنة البصرية للمؤشرات المختارة (${chartUnit})`, PAGE_W - MARGIN, y);
      y += 32;

      const drawW = CONTENT_W;
      const drawH = Math.min(330, Math.round((chartImg.height / Math.max(1, chartImg.width)) * drawW));
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(MARGIN, y, drawW, drawH + 24);
      ctx.drawImage(chartImg, MARGIN + 12, y + 12, drawW - 24, drawH);
      y += drawH + 52;
    }
  }

  // Table Section
  ensureSpace(120);
  ctx.fillStyle = '#0F172A';
  ctx.font = `700 19px ${FONT_FAMILY}`;
  ctx.fillText('جدول المقارنة التفصيلي للمؤشرات الاقتصادية', PAGE_W - MARGIN, y);
  y += 34;

  const colLabelW = 240;
  const colValW = (CONTENT_W - colLabelW) / 2;

  const drawTableHeader = () => {
    ctx.fillStyle = '#F1F5F9';
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.2;
    ctx.fillRect(MARGIN, y, CONTENT_W, 46);
    ctx.strokeRect(MARGIN, y, CONTENT_W, 46);

    ctx.fillStyle = '#0F172A';
    ctx.font = `700 15px ${FONT_FAMILY}`;
    ctx.fillText('البند / المؤشر', PAGE_W - MARGIN - 14, y + 14);
    ctx.fillText(`أ · ${leftReport.title}`, PAGE_W - MARGIN - colLabelW - 14, y + 14);
    ctx.fillText(`ب · ${rightReport.title}`, PAGE_W - MARGIN - colLabelW - colValW - 14, y + 14);
    y += 46;
  };

  drawTableHeader();

  const tableRows: Array<{ label: string; colA: string; colB: string }> = [
    {
      label: 'حالة التحقق والثقة',
      colA: leftReport.confidenceLabel,
      colB: rightReport.confidenceLabel,
    },
    {
      label: 'النتيجة المعتمدة',
      colA: `${leftReport.resultHeadline} — ${leftReport.resultValue}`,
      colB: `${rightReport.resultHeadline} — ${rightReport.resultValue}`,
    },
    ...chartMetrics.map((m) => ({
      label: `${m.label} (${m.unit})`,
      colA: m.reportA !== null ? `${m.reportA} ${m.unit}` : '—',
      colB: m.reportB !== null ? `${m.reportB} ${m.unit}` : '—',
    })),
  ];

  const maxEv = Math.max(leftReport.evidence.length, rightReport.evidence.length);
  for (let i = 0; i < maxEv; i++) {
    const evA = leftReport.evidence[i];
    const evB = rightReport.evidence[i];
    tableRows.push({
      label: `مؤشر دليل #${i + 1}`,
      colA: evA ? `${evA.metric}: ${evA.value} (${evA.source})` : '—',
      colB: evB ? `${evB.metric}: ${evB.value} (${evB.source})` : '—',
    });
  }

  tableRows.push({
    label: 'التشخيص والأسباب',
    colA: leftReport.causes.map((c) => `[${getEpistemicLabel(c.level).label}] ${c.text}`).join(' · '),
    colB: rightReport.causes.map((c) => `[${getEpistemicLabel(c.level).label}] ${c.text}`).join(' · '),
  });

  tableRows.push({
    label: 'الإجراءات المقترحة',
    colA: leftReport.suggestedActions.map((a) => `${a.action} (${a.expectedImpact})`).join(' · '),
    colB: rightReport.suggestedActions.map((a) => `${a.action} (${a.expectedImpact})`).join(' · '),
  });

  for (const row of tableRows) {
    ctx.font = `600 14px ${FONT_FAMILY}`;
    const labelLines = wrapArabicText(ctx, row.label, colLabelW - 24);
    ctx.font = `400 14px ${FONT_FAMILY}`;
    const aLines = wrapArabicText(ctx, row.colA, colValW - 24);
    const bLines = wrapArabicText(ctx, row.colB, colValW - 24);

    const maxLines = Math.max(labelLines.length, aLines.length, bLines.length);
    const rowH = Math.max(44, maxLines * 22 + 20);

    if (y + rowH > PAGE_H - MARGIN) {
      const next = createPage();
      ctx = next.ctx;
      y = MARGIN;
      drawTableHeader();
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.fillRect(MARGIN, y, CONTENT_W, rowH);
    ctx.strokeRect(MARGIN, y, CONTENT_W, rowH);

    // Column dividers
    ctx.beginPath();
    ctx.moveTo(PAGE_W - MARGIN - colLabelW, y);
    ctx.lineTo(PAGE_W - MARGIN - colLabelW, y + rowH);
    ctx.moveTo(PAGE_W - MARGIN - colLabelW - colValW, y);
    ctx.lineTo(PAGE_W - MARGIN - colLabelW - colValW, y + rowH);
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.font = `600 14px ${FONT_FAMILY}`;
    labelLines.forEach((line, idx) => {
      ctx.fillText(line, PAGE_W - MARGIN - 12, y + 12 + idx * 22);
    });

    ctx.fillStyle = '#0F172A';
    ctx.font = `400 14px ${FONT_FAMILY}`;
    aLines.forEach((line, idx) => {
      ctx.fillText(line, PAGE_W - MARGIN - colLabelW - 12, y + 12 + idx * 22);
    });
    bLines.forEach((line, idx) => {
      ctx.fillText(line, PAGE_W - MARGIN - colLabelW - colValW - 12, y + 12 + idx * 22);
    });

    y += rowH;
  }

  // Assemble PDF pages via jsPDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  pages.forEach((canvas, idx) => {
    if (idx > 0) pdf.addPage();
    const imgData = canvas.toDataURL('image/png', 0.95);
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
  });

  pdf.save(`owner-ai-comparison-${period}.pdf`);
}
