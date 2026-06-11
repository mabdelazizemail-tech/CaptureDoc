# -*- coding: utf-8 -*-
"""Tests for ETA document → line-row mapping and date chunking (pure logic)."""
from datetime import date

from app.eta_client import map_document, chunk_date_range

SUMMARY = {
    "uuid": "UUID123",
    "internalId": "14426",
    "typeName": "I",
    "issuerName": "سيفتى باك",
    "receiverName": "شركة بي بي كيه",
    "dateTimeIssued": "2026-01-04T09:30:00Z",
    "status": "Valid",
}

RAW_DOC = {
    "internalID": "14426",
    "dateTimeIssued": "2026-01-04T09:30:00Z",
    "invoiceLines": [
        {
            "description": "نموذج 2",
            "quantity": 24000,
            "unitValue": {"currencySold": "EGP", "amountEGP": 9.0},
            "salesTotal": 216000.0,
            "netTotal": 216000.0,
            "total": 246240.0,
            "taxableItems": [
                {"taxType": "T1", "amount": 30240.0, "subType": "V009", "rate": 14},
                {"taxType": "T4", "amount": 2160.0, "subType": "W001", "rate": 1},
            ],
        },
        {
            "description": "نموذج 3",
            "quantity": 9900,
            "unitValue": {"currencySold": "EGP", "amountEGP": 19.5},
            "salesTotal": 193050.0,
            "netTotal": 193050.0,
            "total": 220077.0,
            "taxableItems": [],
        },
    ],
}


class TestMapDocument:
    def test_received_invoice_maps_to_purchase_lines(self):
        lines = map_document(SUMMARY, RAW_DOC, "Received")
        assert len(lines) == 2
        first = lines[0]
        assert first["eta_uuid"] == "UUID123"
        assert first["eta_line_index"] == 0
        assert first["invoice_no"] == "14426"
        assert first["invoice_date"] == "2026-01-04"
        assert first["party"] == "سيفتى باك"  # issuer is the supplier
        assert first["item"] == "نموذج 2"
        assert first["qty"] == 24000
        assert first["unit_price"] == 9.0
        assert first["vat"] == 30240.0  # only T1, not T4
        assert first["doc_type"] == "i"

    def test_sent_invoice_party_is_receiver(self):
        lines = map_document(SUMMARY, RAW_DOC, "Sent")
        assert lines[0]["party"] == "شركة بي بي كيه"

    def test_line_without_taxable_items_has_zero_vat(self):
        lines = map_document(SUMMARY, RAW_DOC, "Received")
        assert lines[1]["vat"] == 0.0

    def test_credit_note_negates_qty_and_vat(self):
        summary = dict(SUMMARY, typeName="C")
        lines = map_document(summary, RAW_DOC, "Sent")
        assert lines[0]["qty"] == -24000
        assert lines[0]["vat"] == -30240.0
        assert lines[0]["unit_price"] == 9.0  # price stays positive
        assert lines[0]["doc_type"] == "c"

    def test_missing_lines_returns_empty(self):
        assert map_document(SUMMARY, {}, "Received") == []

    def test_falls_back_to_summary_fields(self):
        raw = {"invoiceLines": [{"description": "x", "quantity": 1,
                                 "unitValue": {"amountEGP": 5}}]}
        lines = map_document(SUMMARY, raw, "Received")
        assert lines[0]["invoice_no"] == "14426"
        assert lines[0]["invoice_date"] == "2026-01-04"


class TestChunkDateRange:
    def test_short_range_single_chunk(self):
        chunks = chunk_date_range(date(2026, 1, 1), date(2026, 1, 20), max_days=30)
        assert chunks == [(date(2026, 1, 1), date(2026, 1, 20))]

    def test_long_range_is_split_and_contiguous(self):
        chunks = chunk_date_range(date(2026, 1, 1), date(2026, 3, 15), max_days=30)
        assert chunks[0][0] == date(2026, 1, 1)
        assert chunks[-1][1] == date(2026, 3, 15)
        for (a, b), (c, d) in zip(chunks, chunks[1:]):
            assert (b - a).days <= 30
            assert c == b  # contiguous, no gaps
        assert all((b - a).days <= 30 for a, b in chunks)

    def test_inverted_range_returns_empty(self):
        assert chunk_date_range(date(2026, 2, 1), date(2026, 1, 1)) == []
