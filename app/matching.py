# -*- coding: utf-8 -*-
"""Arabic text normalization and purchase↔sale auto-matching engine."""
from __future__ import annotations

import re
from datetime import date, datetime
from difflib import SequenceMatcher

MATCH_THRESHOLD = 55
_DIACRITICS = re.compile(r"[ً-ْٰـ]")  # tashkeel + dagger alef + tatweel
_ALEF = re.compile(r"[أإآٱ]")  # أ إ آ ٱ
_PUNCT = re.compile(r"[^\w\s؀-ۿ]", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize_ar(text) -> str:
    if not text:
        return ""
    s = str(text)
    s = _DIACRITICS.sub("", s)
    s = _ALEF.sub("ا", s)          # → ا
    s = s.replace("ى", "ي")   # ى → ي
    s = s.replace("ة", "ه")   # ة → ه
    s = s.replace("ئ", "ي")   # ئ → ي
    s = s.replace("ؤ", "و")   # ؤ → و
    s = _PUNCT.sub(" ", s)
    s = _WS.sub(" ", s).strip().lower()
    return s


def similarity(a, b) -> float:
    na, nb = normalize_ar(a), normalize_ar(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def _parse_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def score_pair(purchase: dict, sale: dict) -> float:
    pq, sq = purchase.get("qty") or 0, sale.get("qty") or 0
    score = 0.0
    if pq and sq:
        rel = abs(abs(pq) - abs(sq)) / max(abs(pq), abs(sq))
        if rel < 1e-9:
            score += 50
        elif rel <= 0.02:
            score += 35
        elif rel <= 0.10:
            score += 15
        elif rel <= 0.25:
            score += 5
        else:
            return 0.0  # quantities too far apart — not the same goods
    score += 30 * similarity(purchase.get("item"), sale.get("item"))
    pd, sd = _parse_date(purchase.get("invoice_date")), _parse_date(sale.get("invoice_date"))
    if pd and sd:
        delta = abs((sd - pd).days)
        if delta <= 60:
            score += 15 * (1 - delta / 60)
    if (pq >= 0) == (sq >= 0):  # same polarity (regular vs credit note)
        score += 5
    return min(score, 100.0)


def auto_match(purchases: list[dict], sales: list[dict]) -> list[dict]:
    """Greedy 1:1 matching of unmatched lines; returns suggestions sorted by score."""
    candidates = []
    for p in purchases:
        for s in sales:
            sc = score_pair(p, s)
            if sc >= MATCH_THRESHOLD:
                candidates.append((sc, p, s))
    candidates.sort(key=lambda t: -t[0])
    used_p, used_s, result = set(), set(), []
    for sc, p, s in candidates:
        if p["id"] in used_p or s["id"] in used_s:
            continue
        used_p.add(p["id"])
        used_s.add(s["id"])
        result.append({
            "purchase_id": p["id"],
            "sale_id": s["id"],
            "score": round(sc, 1),
            "qty_diff": (p.get("qty") or 0) - (s.get("qty") or 0),
        })
    return result
