import type { VercelRequest, VercelResponse } from '@vercel/node';

const ETA_TOKEN_URL = 'https://id.eta.gov.eg/connect/token';
const ETA_API_BASE  = 'https://api.invoicing.eta.gov.eg';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Tokens live ~1h; cache per credential pair so bursts of calls (e.g. bulk PDF
// export) don't re-authenticate every request and trip ETA throttling.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const key = `${clientId}:${clientSecret}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(ETA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(key).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=InvoicingAPI',
  });
  if (!res.ok) throw new Error(`ETA auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('No access_token in ETA response');
  const ttlMs = Math.max(60, (data.expires_in ?? 3600) - 120) * 1000;
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttlMs });
  return data.access_token;
}

// ETA throttles aggressively (429) and occasionally returns transient 5xx;
// retry those with backoff, honouring Retry-After when present.
async function etaFetch(url: string, token: string, attempts = 4): Promise<Response> {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || i >= attempts) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 1500 * i;
    await sleep(waitMs);
  }
}

// GET /api/v1.0/documents/search — sent or received invoices
const CHUNK_DAYS = 30; // ETA max per call

const fmt = (d: Date, eod = false) =>
  d.toISOString().slice(0, 10) + (eod ? 'T23:59:59' : 'T00:00:00');

// Single 30-day-or-less window — used for continuationToken pagination too
type DocType = 'i' | 'c' | 'd';

async function searchWindow(token: string, direction: 'Sent' | 'Received', params: {
  issueDateFrom: string;
  issueDateTo:   string;
  continuationToken?: string;
  pageSize?: number;
  documentType?: DocType;
}) {
  const qp = new URLSearchParams({
    direction,
    status:       'Valid',
    documentType: params.documentType ?? 'i',
    pageSize:     String(params.pageSize ?? 50),
    issueDateFrom: params.issueDateFrom,
    issueDateTo:   params.issueDateTo,
    ...(params.continuationToken && { continuationToken: params.continuationToken }),
  });
  const res = await etaFetch(`${ETA_API_BASE}/api/v1.0/documents/search?${qp}`, token);
  if (!res.ok) throw new Error(`ETA search failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Split any date range into ≤30-day chunks, collect all pages, merge results
async function searchDocuments(token: string, direction: 'Sent' | 'Received', params: {
  issueDateFrom?: string;
  issueDateTo?: string;
  continuationToken?: string;
  pageSize?: number;
  documentType?: DocType;
}) {
  const toDate   = params.issueDateTo   ? new Date(params.issueDateTo)   : new Date();
  const fromDate = params.issueDateFrom ? new Date(params.issueDateFrom) : (() => { const d = new Date(); d.setDate(d.getDate() - CHUNK_DAYS); return d; })();

  // If a continuationToken is given, the caller is paginating within a single chunk
  if (params.continuationToken) {
    return searchWindow(token, direction, {
      issueDateFrom: fmt(fromDate),
      issueDateTo:   fmt(toDate, true),
      continuationToken: params.continuationToken,
      pageSize: params.pageSize,
      documentType: params.documentType,
    });
  }

  const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);

  // Single chunk — normal path
  if (diffDays <= CHUNK_DAYS) {
    return searchWindow(token, direction, {
      issueDateFrom: fmt(fromDate),
      issueDateTo:   fmt(toDate, true),
      pageSize: params.pageSize,
      documentType: params.documentType,
    });
  }

  // Multi-chunk: split into 30-day windows, newest-first, collect up to 200 docs
  const allDocs: any[] = [];
  let chunkEnd = new Date(toDate);

  while (chunkEnd > fromDate && allDocs.length < 200) {
    const chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() - CHUNK_DAYS);
    if (chunkStart < fromDate) chunkStart.setTime(fromDate.getTime());

    let token_ = undefined as string | undefined;
    do {
      const data = await searchWindow(token, direction, {
        issueDateFrom: fmt(chunkStart),
        issueDateTo:   fmt(chunkEnd, true),
        continuationToken: token_,
        pageSize: 50,
        documentType: params.documentType,
      });
      const rows: any[] = data.result ?? [];
      allDocs.push(...rows);
      const next = data.metadata?.continuationToken ?? '';
      token_ = next === 'EndofResultSet' ? undefined : next || undefined;
      if (token_) await sleep(1100); // ETA rate limit: 1 req / 2s
    } while (token_ && allDocs.length < 200);

    chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    if (allDocs.length < 200) await sleep(1100);
  }

  return {
    result: allDocs,
    metadata: { totalCount: allDocs.length, continuationToken: 'EndofResultSet' },
  };
}

// GET /api/v1.0/documents/{uuid}/raw — single document
async function getDocument(token: string, uuid: string) {
  const res = await etaFetch(`${ETA_API_BASE}/api/v1.0/documents/${uuid}/raw`, token);
  if (!res.ok) throw new Error(`ETA document fetch failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// GET /api/v1.0/documents/{uuid}/pdf — PDF representation
async function getDocumentPdf(token: string, uuid: string): Promise<string> {
  const res = await etaFetch(`${ETA_API_BASE}/api/v1.0/documents/${uuid}/pdf`, token);
  if (!res.ok) throw new Error(`ETA PDF fetch failed (${res.status}): ${await res.text()}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

function parseSearchRow(doc: any) {
  return {
    uuid:             doc.uuid             ?? '',
    internalId:       doc.internalId       ?? '',
    issuerName:       doc.issuerName       ?? '',
    issuerId:         doc.issuerId         ?? '',
    receiverName:     doc.receiverName     ?? '',
    receiverId:       doc.receiverId       ?? '',
    dateTimeIssued:   (doc.dateTimeIssued   ?? '').slice(0, 10),
    dateTimeReceived: (doc.dateTimeReceived ?? '').slice(0, 10),
    netAmount:        Number(doc.netAmount  ?? 0),
    total:            Number(doc.total      ?? 0),
    status:           doc.status           ?? '',
  };
}

// /raw returns the submitted document as a JSON string under "document"
function rawInner(doc: any): any {
  const d = doc.document;
  if (typeof d === 'string') {
    try { return JSON.parse(d); } catch { return doc; }
  }
  return d ?? doc;
}

function parseFullDoc(doc: any) {
  const inner = rawInner(doc);
  const taxTotals: any[] = inner.taxTotals ?? [];
  const tax = taxTotals.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
  return {
    uuid:        doc.uuid          ?? '',
    invoiceNo:   doc.internalId    ?? inner.internalId ?? '',
    supplier:    doc.issuerName    ?? inner.issuer?.name ?? '',
    receiver:    doc.receiverName  ?? inner.receiver?.name ?? '',
    invoiceDate: (doc.dateTimeIssued ?? inner.dateTimeIssued ?? '').slice(0, 10),
    amount:      Number(inner.netAmount ?? inner.totalSalesAmount ?? doc.netAmount ?? 0),
    tax,
    total:       Number(inner.totalAmount ?? doc.total ?? 0),
    documentType: inner.documentType ?? '',
    references:  (inner.references ?? []) as string[],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, uuid, uuids, documentType, issueDateFrom, issueDateTo, continuationToken, clientId: bodyId, clientSecret: bodySec } = req.body as any;

  const clientId     = bodyId     || process.env.ETA_CLIENT_ID;
  const clientSecret = bodySec    || process.env.ETA_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return res.status(400).json({ error: 'ETA credentials missing — enter Client ID and Client Secret' });

  try {
    const token = await getAccessToken(clientId, clientSecret);

    if (action === 'list' || action === 'list-sent') {
      const direction = action === 'list-sent' ? 'Sent' : 'Received';
      const docType: DocType = ['i', 'c', 'd'].includes(documentType) ? documentType : 'i';
      const data = await searchDocuments(token, direction, { issueDateFrom, issueDateTo, continuationToken, documentType: docType });
      const rows: any[] = data.result ?? [];
      const nextToken: string = data.metadata?.continuationToken ?? '';
      return res.status(200).json({
        ok: true,
        invoices: rows.map(parseSearchRow),
        continuationToken: nextToken === 'EndofResultSet' ? '' : nextToken,
        totalCount: data.metadata?.totalCount ?? rows.length,
      });
    }

    if (action === 'get' && uuid) {
      const doc = await getDocument(token, uuid);
      return res.status(200).json({ ok: true, invoice: parseFullDoc(doc) });
    }

    // Which documents each credit/debit note references (the invoices it adjusts)
    if (action === 'references' && Array.isArray(uuids)) {
      const references: Record<string, string[]> = {};
      const errors: Record<string, string> = {};
      for (const [i, id] of (uuids as string[]).slice(0, 25).entries()) {
        try {
          references[id] = (rawInner(await getDocument(token, id)).references ?? []) as string[];
        } catch (e: any) {
          errors[id] = e.message ?? 'Unknown error';
        }
        if (i < uuids.length - 1) await sleep(500);
      }
      return res.status(200).json({ ok: true, references, errors });
    }

    if (action === 'pdf' && uuid) {
      const base64 = await getDocumentPdf(token, uuid);
      return res.status(200).json({ ok: true, pdf: base64 });
    }

    return res.status(400).json({ error: 'action must be "list", "list-sent", "get", "references", or "pdf"' });
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err.message ?? 'Unknown error' });
  }
}
