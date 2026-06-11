# -*- coding: utf-8 -*-
"""Client for Egypt's ETA e-invoicing API (id service + Documents API).

Verified against https://sdk.invoicing.eta.gov.eg :
- POST {id}/connect/token            (Basic auth, client_credentials, scope=InvoicingAPI)
- GET  {api}/api/v1.0/documents/search   (continuationToken paging, <=30-day window, 1 req / 2 s)
- GET  {api}/api/v1.0/documents/{uuid}/raw  (falls back to /details)
"""
from __future__ import annotations

import json
import time
from datetime import date, timedelta

import requests

ENVIRONMENTS = {
    "preprod": {
        "id": "https://id.preprod.eta.gov.eg",
        "api": "https://api.preprod.invoicing.eta.gov.eg",
    },
    "prod": {
        "id": "https://id.eta.gov.eg",
        "api": "https://api.invoicing.eta.gov.eg",
    },
}

# ETA throttles document search to 1 request per 2 seconds per taxpayer
_THROTTLE_SECONDS = 2.1


class ETAError(Exception):
    def __init__(self, message, status_code=None, detail=None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


def chunk_date_range(date_from: date, date_to: date, max_days: int = 30):
    """Split [date_from, date_to] into contiguous chunks of at most max_days."""
    if date_to < date_from:
        return []
    chunks = []
    start = date_from
    while start < date_to:
        end = min(start + timedelta(days=max_days), date_to)
        chunks.append((start, end))
        start = end
    if not chunks:  # zero-length range
        chunks.append((date_from, date_to))
    return chunks


def _normalize_doc_type(type_name: str) -> str:
    t = (type_name or "i").strip().lower()
    if t in ("c", "ec"):
        return "c"
    if t in ("d", "ed"):
        return "d"
    return "i"


def map_document(summary: dict, raw_document: dict, direction: str) -> list[dict]:
    """Flatten an ETA document into app line rows (one per invoiceLine)."""
    lines = raw_document.get("invoiceLines") or []
    if not lines:
        return []
    doc_type = _normalize_doc_type(summary.get("typeName"))
    sign = -1 if doc_type == "c" else 1
    party = summary.get("issuerName") if direction == "Received" else summary.get("receiverName")
    invoice_no = raw_document.get("internalID") or summary.get("internalId") or ""
    issued = raw_document.get("dateTimeIssued") or summary.get("dateTimeIssued") or ""
    invoice_date = str(issued)[:10]  # ETA returns UTC ISO; day precision is enough here
    result = []
    for idx, ln in enumerate(lines):
        vat = sum(
            float(t.get("amount") or 0)
            for t in (ln.get("taxableItems") or [])
            if (t.get("taxType") or "").upper() == "T1"
        )
        result.append({
            "eta_uuid": summary.get("uuid"),
            "eta_line_index": idx,
            "invoice_date": invoice_date,
            "invoice_no": str(invoice_no),
            "party": party or "",
            "item": ln.get("description") or "",
            "qty": sign * float(ln.get("quantity") or 0),
            "unit_price": float((ln.get("unitValue") or {}).get("amountEGP") or 0),
            "vat": sign * vat,
            "doc_type": doc_type,
        })
    return result


class ETAClient:
    def __init__(self, env: str, client_id: str, client_secret: str, session=None):
        if env not in ENVIRONMENTS:
            raise ETAError(f"بيئة غير معروفة: {env}")
        self.bases = ENVIRONMENTS[env]
        self.client_id = client_id
        self.client_secret = client_secret
        self.session = session or requests.Session()
        self._token = None
        self._token_expiry = 0.0
        self._last_request_at = 0.0

    # -- auth ---------------------------------------------------------------
    def get_token(self) -> str:
        if self._token and time.time() < self._token_expiry:
            return self._token
        try:
            resp = self.session.post(
                f"{self.bases['id']}/connect/token",
                auth=(self.client_id, self.client_secret),
                data={"grant_type": "client_credentials", "scope": "InvoicingAPI"},
                timeout=30,
            )
        except requests.RequestException as e:
            raise ETAError(f"تعذر الاتصال بخدمة الهوية: {e}") from e
        if resp.status_code != 200:
            raise ETAError(
                "فشل تسجيل الدخول إلى ETA — تحقق من Client ID / Secret والبيئة",
                status_code=resp.status_code, detail=resp.text[:500],
            )
        data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = time.time() + int(data.get("expires_in", 3600)) - 120
        return self._token

    # -- low-level GET with retry-on-401 and throttling ----------------------
    def _get(self, path: str, params=None, throttle=False):
        if throttle:
            wait = _THROTTLE_SECONDS - (time.time() - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
        token = self.get_token()
        url = f"{self.bases['api']}{path}"
        try:
            resp = self.session.get(
                url, params=params, timeout=60,
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 401:  # token may have been revoked early
                self._token = None
                resp = self.session.get(
                    url, params=params, timeout=60,
                    headers={"Authorization": f"Bearer {self.get_token()}"},
                )
        except requests.RequestException as e:
            raise ETAError(f"تعذر الاتصال بخادم ETA: {e}") from e
        finally:
            self._last_request_at = time.time()
        if resp.status_code == 429:
            raise ETAError("تم تجاوز حد الطلبات لدى ETA — أعد المحاولة بعد قليل",
                           status_code=429, detail=resp.text[:300])
        if resp.status_code != 200:
            raise ETAError(f"خطأ من خادم ETA (HTTP {resp.status_code})",
                           status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()

    # -- documents ------------------------------------------------------------
    def search_documents(self, date_from: date, date_to: date,
                         direction: str | None = None, status: str = "Valid",
                         on_progress=None):
        """Yield document summaries across chunked date windows."""
        for win_from, win_to in chunk_date_range(date_from, date_to, max_days=30):
            token_param = None
            while True:
                params = {
                    "issueDateFrom": f"{win_from.isoformat()}T00:00:00Z",
                    "issueDateTo": f"{win_to.isoformat()}T23:59:59Z",
                    "pageSize": 100,
                    "status": status,
                }
                if direction:
                    params["direction"] = direction
                if token_param:
                    params["continuationToken"] = token_param
                data = self._get("/api/v1.0/documents/search", params, throttle=True)
                docs = data.get("result") or []
                if on_progress:
                    on_progress(win_from, win_to, len(docs))
                yield from docs
                token_param = (data.get("metadata") or {}).get("continuationToken")
                if not token_param or token_param == "EndofResultSet":
                    break

    def get_document_lines(self, summary: dict, direction: str) -> list[dict]:
        uuid = summary["uuid"]
        raw = None
        for path in (f"/api/v1.0/documents/{uuid}/raw",
                     f"/api/v1.0/documents/{uuid}/details"):
            try:
                payload = self._get(path, throttle=True)
            except ETAError as e:
                if e.status_code in (404, 405):
                    continue
                raise
            doc = payload.get("document") if isinstance(payload, dict) else None
            if isinstance(doc, str):
                try:
                    doc = json.loads(doc)
                except json.JSONDecodeError:
                    doc = None
            raw = doc if isinstance(doc, dict) else (payload if isinstance(payload, dict) else None)
            if raw and raw.get("invoiceLines"):
                break
        return map_document(summary, raw or {}, direction)
