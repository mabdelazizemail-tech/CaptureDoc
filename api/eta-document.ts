import type { VercelRequest, VercelResponse } from '@vercel/node';

const ETA_TOKEN_URL = 'https://id.eta.gov.eg/connect/token';
const ETA_API_BASE  = 'https://api.invoicing.eta.gov.eg';

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(ETA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=InvoicingAPI',
  });
  if (!res.ok) throw new Error(`ETA auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token in ETA response');
  return data.access_token;
}

// GET /api/v1.0/documents/search — sent or received invoices
const CHUNK_DAYS = 30; // ETA max per call
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const fmt = (d: Date, eod = false) =>
  d.toISOString().slice(0, 10) + (eod ? 'T23:59:59' : 'T00:00:00');

// Single 30-day-or-less window — used for continuationToken pagination too
async function searchWindow(token: string, direction: 'Sent' | 'Received', params: {
  issueDateFrom: string;
  issueDateTo:   string;
  continuationToken?: string;
  pageSize?: number;
}) {
  const qp = new URLSearchParams({
    direction,
    status:       'Valid',
    documentType: 'i',
    pageSize:     String(params.pageSize ?? 50),
    issueDateFrom: params.issueDateFrom,
    issueDateTo:   params.issueDateTo,
    ...(params.continuationToken && { continuationToken: params.continuationToken }),
  });
  const res = await fetch(`${ETA_API_BASE}/api/v1.0/documents/search?${qp}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ETA search failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Split any date range into ≤30-day chunks, collect all pages, merge results
async function searchDocuments(token: string, direction: 'Sent' | 'Received', params: {
  issueDateFrom?: string;
  issueDateTo?: string;
  continuationToken?: string;
  pageSize?: number;
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
    });
  }

  const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);

  // Single chunk — normal path
  if (diffDays <= CHUNK_DAYS) {
    return searchWindow(token, direction, {
      issueDateFrom: fmt(fromDate),
      issueDateTo:   fmt(toDate, true),
      pageSize: params.pageSize,
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
  const res = await fetch(`${ETA_API_BASE}/api/v1.0/documents/${uuid}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ETA document fetch failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// GET /api/v1.0/documents/{uuid}/pdf — PDF representation
async function getDocumentPdf(token: string, uuid: string): Promise<string> {
  const res = await fetch(`${ETA_API_BASE}/api/v1.0/documents/${uuid}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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

function parseFullDoc(doc: any) {
  const inner = doc.document ?? doc; // raw document has a nested "document" object
  const taxTotals: any[] = inner.taxTotals ?? [];
  const tax = taxTotals.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);
  return {
    uuid:        doc.uuid          ?? '',
    invoiceNo:   doc.internalId    ?? inner.internalId ?? '',
    supplier:    doc.issuerName    ?? inner.issuer?.name ?? '',
    receiver:    doc.receiverName  ?? inner.receiver?.name ?? '',
    invoiceDate: (doc.dateTimeIssued ?? inner.dateTimeIssued ?? '').slice(0, 10),
    amount:      Number(inner.totalSalesAmount ?? inner.netAmount ?? doc.netAmount ?? 0),
    tax,
    total:       Number(inner.totalAmount ?? doc.total ?? 0),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, uuid, issueDateFrom, issueDateTo, continuationToken, clientId: bodyId, clientSecret: bodySec } = req.body as any;

  const clientId     = bodyId     || process.env.ETA_CLIENT_ID;
  const clientSecret = bodySec    || process.env.ETA_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return res.status(400).json({ error: 'ETA credentials missing — enter Client ID and Client Secret' });

  try {
    const token = await getAccessToken(clientId, clientSecret);

    if (action === 'list' || action === 'list-sent') {
      const direction = action === 'list-sent' ? 'Sent' : 'Received';
      const data = await searchDocuments(token, direction, { issueDateFrom, issueDateTo, continuationToken });
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

    if (action === 'pdf' && uuid) {
      const base64 = await getDocumentPdf(token, uuid);
      return res.status(200).json({ ok: true, pdf: base64 });
    }

    return res.status(400).json({ error: 'action must be "list", "get", or "pdf"' });
  } catch (err: any) {
    return res.status(502).json({ ok: false, error: err.message ?? 'Unknown error' });
  }
}
