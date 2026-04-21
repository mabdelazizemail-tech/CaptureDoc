import * as pdfjs from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
// @ts-ignore - Vite asset import
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export interface ParsedInvoice {
  invoiceNo: string;
  customer: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string;     // YYYY-MM-DD (defaulted to invoiceDate + 30 days)
  amount: number;      // pre-tax sales
  tax: number;
  total: number;
  rawText: string;
  matched: Partial<Record<keyof Omit<ParsedInvoice, 'rawText' | 'matched'>, boolean>>;
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

async function extractTextFromPdfDoc(pdf: any): Promise<string> {

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Collect items grouped by visual line (Y-coordinate).
    // Keep per-item width/height so we can detect real word boundaries via
    // horizontal gaps — otherwise pdfjs-per-glyph runs produce "ش ر ك ه".
    interface Item { x: number; w: number; h: number; s: string }
    const rows = new Map<number, Item[]>();
    for (const item of content.items as any[]) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4] as number;
      const w = (item.width as number) || 0;
      const h = (item.height as number) || Math.abs(item.transform[3] as number) || 10;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x, w, h, s: item.str });
    }

    // Pre-sort rows and compute ALL positive gaps across the whole page so
    // the word-break threshold is stable even on short lines with noisy data.
    const sortedRows = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => [y, items.sort((a, b) => a.x - b.x)] as const);

    const allGaps: number[] = [];
    let totalH = 0, hCount = 0;
    for (const [, items] of sortedRows) {
      for (let i = 1; i < items.length; i++) {
        const g = items[i].x - (items[i - 1].x + items[i - 1].w);
        if (g > 0.1) allGaps.push(g);
      }
      for (const it of items) { totalH += it.h; hCount++; }
    }
    const pageAvgH = hCount ? totalH / hCount : 10;

    // Use the 75th-percentile gap as the boundary — top 25% of gaps are word
    // breaks, the rest is same-word jitter. Also require the threshold to be
    // at least 40% of the average glyph height to filter sub-pixel noise.
    let threshold = pageAvgH * 0.4;
    if (allGaps.length >= 4) {
      const sortedGaps = [...allGaps].sort((a, b) => a - b);
      const p75 = sortedGaps[Math.floor(sortedGaps.length * 0.75)];
      threshold = Math.max(threshold, p75 * 0.9);
    }

    const lines = sortedRows.map(([, items]) => {
      let visual = '';
      let prevEndX: number | null = null;
      for (const it of items) {
        if (prevEndX !== null) {
          const gap = it.x - prevEndX;
          if (gap > threshold) visual += ' ';
        }
        visual += it.s;
        prevEndX = it.x + it.w;
      }
      return normalizeArabic(visual);
    });
    pages.push(lines.join('\n'));
  }
  return pages.join('\n');
}

// Public wrapper: load file → extract text layer
export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  return extractTextFromPdfDoc(pdf);
}

// ─── OCR (Arabic) ─────────────────────────────────────────────────────────────

async function renderPageToCanvas(pdf: any, pageNum: number, scale = 2.5): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

// Extract the Arabic customer name from OCR output. Tesseract's Arabic model
// produces properly-spaced, correctly-shaped text, avoiding the per-glyph
// positioning issues that plague text-layer extraction of ETA invoices.
function extractCustomerFromOcrText(ocr: string): string {
  // Locate the "Recipients (To)" block; stop at the next labelled section.
  const block = ocr.match(/Recipients\s*\(\s*To\s*\)([\s\S]{0,800}?)(?:Registration\s*Number|Taxpayer\s*Activity|Code\s*Name|Item\s*Code|$)/i);
  if (!block) return '';
  const body = block[1];

  // Strongest signal: "Taxpayer Name: <arabic>"
  const labelled = body.match(/Taxpayer\s*Name\s*[:\-]?\s*([\u0600-\u06FF][\u0600-\u06FF\s0-9.،\-&]+)/);
  if (labelled) return cleanArabic(labelled[1]);

  // Fallback: longest Arabic run in the block
  const runs = body.match(/[\u0600-\u06FF][\u0600-\u06FF\s0-9.،\-&]{2,}/g) || [];
  if (runs.length) {
    runs.sort((a, b) => b.trim().length - a.trim().length);
    return cleanArabic(runs[0]);
  }
  return '';
}

function cleanArabic(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\u0640/g, '')        // strip tatweel
    .replace(/[|:\-،,.]+$/g, '')   // trailing punctuation from OCR noise
    .replace(/\s+/g, ' ')
    .trim();
}

export async function ocrPdfFirstPage(pdf: any): Promise<string> {
  const canvas = await renderPageToCanvas(pdf, 1, 2.5);
  const { data } = await Tesseract.recognize(canvas, 'ara+eng');
  return data.text || '';
}

// ─── Arabic Text Normalization ────────────────────────────────────────────────
//
// PDF extractors frequently return Arabic text using the Presentation Forms
// blocks (U+FB50–FDFF, U+FE70–FEFF) in *visual* (LTR) order. When rendered in
// the browser, each glyph is treated as an isolated form, so the letters stop
// connecting into proper cursive Arabic. The fix is two steps:
//   1. NFKC-normalize so presentation forms collapse to base Arabic letters
//      (which the browser's shaper will then connect).
//   2. Reverse each Arabic character run so logical order matches reading
//      order (RTL) instead of visual extraction order (LTR).
//
// Only Arabic runs are reversed — Latin/digits/punctuation keep their order.

const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PRESENTATION_FORM_RE = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

function reverseArabicRuns(s: string): string {
  const chars = Array.from(s);
  const isWs = (c: string) => /\s/.test(c);
  const isArabic = (c: string) => ARABIC_CHAR_RE.test(c);

  // Classify each char: whitespace is "Arabic" if it sits between Arabic chars,
  // so multi-word Arabic names reverse as a single run.
  const arabicMask = chars.map((c, i) => {
    if (isArabic(c)) return true;
    if (!isWs(c)) return false;
    // Whitespace: look past any adjacent whitespace on each side
    let L = i - 1;
    while (L >= 0 && isWs(chars[L])) L--;
    let R = i + 1;
    while (R < chars.length && isWs(chars[R])) R++;
    return L >= 0 && R < chars.length && isArabic(chars[L]) && isArabic(chars[R]);
  });

  const out: string[] = [];
  let buf: string[] = [];
  let currentIsArabic: boolean | null = null;
  for (let i = 0; i < chars.length; i++) {
    const flag = arabicMask[i];
    if (currentIsArabic === null) currentIsArabic = flag;
    if (flag !== currentIsArabic) {
      out.push(currentIsArabic ? buf.reverse().join('') : buf.join(''));
      buf = [];
      currentIsArabic = flag;
    }
    buf.push(chars[i]);
  }
  if (currentIsArabic !== null) {
    out.push(currentIsArabic ? buf.reverse().join('') : buf.join(''));
  }
  return out.join('');
}

export function normalizeArabic(s: string): string {
  if (!s) return s;
  // Detect visual-order extraction by looking for Presentation Form codepoints
  // BEFORE normalization collapses them to base letters.
  const visualOrder = PRESENTATION_FORM_RE.test(s);
  // 1. Compose presentation forms → base Arabic letters
  let r = s.normalize('NFKC');
  // 2. Strip tatweel / kashida (cosmetic elongation)
  r = r.replace(/\u0640/g, '');
  // 3. Reverse Arabic runs only when the PDF used Presentation Forms
  //    (logical-order PDFs come out correct without reversal).
  if (visualOrder && ARABIC_CHAR_RE.test(r)) {
    r = reverseArabicRuns(r);
  }
  // 4. Collapse whitespace
  r = r.replace(/\s+/g, ' ').trim();
  return r;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toNumber = (s: string | undefined): number => {
  if (!s) return 0;
  const clean = s.replace(/,/g, '').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

// Convert "27/01/2026" or "01-27-2026" to YYYY-MM-DD.
// Auto-detects DD/MM vs MM/DD:
//   - If the first part > 12, it must be DD/MM (European / Egyptian)
//   - If the second part > 12, it must be MM/DD (US)
//   - If both ≤ 12 (ambiguous), default to DD/MM (Egypt / ETA convention)
const normalizeDate = (s: string | undefined): string => {
  if (!s) return '';
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  let [, p1, p2, y] = m;
  if (y.length === 2) y = '20' + y;
  const a = parseInt(p1, 10);
  const b = parseInt(p2, 10);
  let mm: string, dd: string;
  if (a > 12) { dd = p1; mm = p2; }
  else if (b > 12) { mm = p1; dd = p2; }
  else { dd = p1; mm = p2; } // ambiguous → default DD/MM
  mm = mm.padStart(2, '0');
  dd = dd.padStart(2, '0');
  return `${y}-${mm}-${dd}`;
};

const addDays = (iso: string, days: number): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// ─── Regex Parser ─────────────────────────────────────────────────────────────

export function parseInvoiceText(text: string): ParsedInvoice {
  const matched: ParsedInvoice['matched'] = {};

  // Invoice No — prefer "Internal ID" (e.g. "02/26"), fall back to ETA "ID"
  let invoiceNo = '';
  const internalId = text.match(/Internal\s*ID\s*[:\-]?\s*([^\n\r]+?)(?:\n|$|\s{2,})/i);
  if (internalId) {
    invoiceNo = internalId[1].trim();
    matched.invoiceNo = true;
  } else {
    const etaId = text.match(/\bID\s*[:\-]\s*([A-Z0-9]{10,})/);
    if (etaId) {
      invoiceNo = etaId[1].trim();
      matched.invoiceNo = true;
    }
  }

  // Invoice Date — prefer "Issuance Date", fall back to "Service Delivery Date"
  let invoiceDate = '';
  const issuance = text.match(/Issuance\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  const delivery = text.match(/Service\s*Delivery\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (issuance) {
    invoiceDate = normalizeDate(issuance[1]);
    matched.invoiceDate = true;
  } else if (delivery) {
    invoiceDate = normalizeDate(delivery[1]);
    matched.invoiceDate = true;
  }

  // Due Date — most ETA invoices don't include one; default +30 days from invoice date
  const dueDate = invoiceDate ? addDays(invoiceDate, 30) : '';

  // Customer — Arabic name inside the "Recipients (To)" block
  // Handles both orderings produced by different PDF text extractors:
  //   (a) "Taxpayer Name: شركه زيروكس مصر"   (label before name)
  //   (b) "شركه زيروكس مصر :Name Taxpayer"  (RTL-reversed)
  let customer = '';
  const recipientsBlock = text.match(/Recipients\s*\(\s*To\s*\)([\s\S]{0,500}?)Registration\s*Number/i);
  if (recipientsBlock) {
    const block = recipientsBlock[1];
    const arabicChars = '\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF';
    const arabicRun = `[${arabicChars}][${arabicChars}\\s0-9.،\\-&]*`;

    // (a) label → name
    const afterLabel = block.match(new RegExp(`Taxpayer\\s*Name\\s*:?\\s*(${arabicRun})`, 'i'));
    // (b) name → label (RTL reversal)
    const beforeLabel = block.match(new RegExp(`(${arabicRun})\\s*:?\\s*Name\\s*Taxpayer`, 'i'));

    if (afterLabel) {
      customer = afterLabel[1].trim();
    } else if (beforeLabel) {
      customer = beforeLabel[1].trim();
    } else {
      // Fallback: first substantial Arabic chunk (≥3 chars)
      const arabicAny = block.match(new RegExp(`([${arabicChars}][${arabicChars}\\s0-9.،\\-&]{2,})`));
      if (arabicAny) customer = arabicAny[1].trim();
    }
    if (customer) matched.customer = true;
  }

  // Amounts
  const amountMatch = text.match(/Total\s*Sales\s*\(EGP\)\s*([\d,]+\.?\d*)/i);
  const taxMatch = text.match(/Value\s*added\s*tax\s*\(EGP\)\s*([\d,]+\.?\d*)/i);
  const totalMatch = text.match(/Total\s*Amount\s*\(EGP\)\s*([\d,]+\.?\d*)/i);

  const amount = toNumber(amountMatch?.[1]);
  const tax = toNumber(taxMatch?.[1]);
  const total = toNumber(totalMatch?.[1]) || amount + tax;

  if (amountMatch) matched.amount = true;
  if (taxMatch) matched.tax = true;
  if (totalMatch) matched.total = true;

  return {
    invoiceNo,
    customer,
    invoiceDate,
    dueDate,
    amount,
    tax,
    total,
    rawText: text,
    matched,
  };
}

// ─── Combined ─────────────────────────────────────────────────────────────────

export async function parseInvoicePdf(file: File): Promise<ParsedInvoice> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  // Fast path: text layer for numbers, dates, and IDs (reliable)
  const text = await extractTextFromPdfDoc(pdf);
  const parsed = parseInvoiceText(text);

  // OCR pass for the Arabic customer name — text layers of ETA invoices use
  // per-glyph positioning that corrupts word boundaries, so OCR is the only
  // reliable route for the "Recipients (To)" Arabic name.
  try {
    const ocrText = await ocrPdfFirstPage(pdf);
    const ocrCustomer = extractCustomerFromOcrText(ocrText);
    if (ocrCustomer) {
      parsed.customer = ocrCustomer;
      parsed.matched.customer = true;
    }
  } catch (err) {
    console.warn('OCR fallback failed:', err);
    // Keep whatever customer value text-layer produced, if any.
  }

  return parsed;
}
