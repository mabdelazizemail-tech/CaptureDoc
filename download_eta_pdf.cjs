const fs = require('fs');
const path = require('path');

const ETA_TOKEN_URL = 'https://id.eta.gov.eg/connect/token';
const ETA_API_BASE  = 'https://api.invoicing.eta.gov.eg';

const clientId = '90fcdb0a-bbd7-4d19-a169-02b5720e7647';
const clientSecret = '8608cfbd-af63-4111-beed-8b784b7b9f2f';

const invoiceNoToFind = process.argv[2] || '47/26';
const sanitizedFileName = invoiceNoToFind.replace(/[\/\\]/g, '_') + '.pdf';
const outputPath = path.join(__dirname, sanitizedFileName);

async function getAccessToken() {
  const res = await fetch(ETA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=InvoicingAPI',
  });
  if (!res.ok) throw new Error(`ETA auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function searchSentInvoices(token) {
  // Search window around the invoice dates
  const issueDateFrom = '2026-05-10T00:00:00';
  const issueDateTo = '2026-05-24T23:59:59';
  const qp = new URLSearchParams({
    direction: 'Sent',
    status: 'Valid',
    documentType: 'i',
    pageSize: '100',
    issueDateFrom,
    issueDateTo,
  });
  
  const res = await fetch(`${ETA_API_BASE}/api/v1.0/documents/search?${qp}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ETA search failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function getDocumentPdf(token, uuid) {
  const res = await fetch(`${ETA_API_BASE}/api/v1.0/documents/${uuid}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ETA PDF fetch failed (${res.status}): ${await res.text()}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

async function run() {
  try {
    console.log(`Authenticating with ETA Portal...`);
    const token = await getAccessToken();
    console.log('Authentication successful!');
    
    console.log(`Searching for invoice "${invoiceNoToFind}" on ETA...`);
    const searchData = await searchSentInvoices(token);
    const invoices = searchData.result || [];
    
    const targetInvoice = invoices.find(inv => inv.internalId === invoiceNoToFind);
    if (!targetInvoice) {
      console.log(`Invoice "${invoiceNoToFind}" not found in recent sent invoices.`);
      console.log('Available sent invoices:', invoices.map(i => i.internalId));
      return;
    }
    
    console.log(`Found Invoice! UUID: ${targetInvoice.uuid}`);
    console.log('Downloading PDF file from ETA Portal...');
    const pdfBuffer = await getDocumentPdf(token, targetInvoice.uuid);
    
    fs.writeFileSync(outputPath, pdfBuffer);
    console.log(`======================================================`);
    console.log(`SUCCESS! Saved PDF to:`);
    console.log(`${outputPath}`);
    console.log(`======================================================`);
  } catch (err) {
    console.error('An error occurred:', err.message);
  }
}

run();
