# -*- coding: utf-8 -*-
"""API integration tests over a temporary database."""
import os
import tempfile

import pytest

_tmpdb = os.path.join(tempfile.mkdtemp(), "test_pbk.db")
os.environ["PBK_DB"] = _tmpdb

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(app)


def _purchase(client, qty=24000, price=9.0, item="نموذج 2", date="2026-01-04"):
    r = client.post("/api/lines", json={
        "kind": "purchase", "invoice_date": date, "invoice_no": "14426",
        "party": "سيفتى باك", "item": item, "qty": qty, "unit_price": price,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _sale(client, qty=24000, price=10.5, item="نموذج 2", date="2026-01-18", vat=0.0):
    r = client.post("/api/lines", json={
        "kind": "sale", "invoice_date": date, "invoice_no": "19-2026",
        "party": "الفشاوي", "item": item, "qty": qty, "unit_price": price, "vat": vat,
    })
    assert r.status_code == 200, r.text
    return r.json()


class TestLinesAndDashboard:
    def test_create_line_defaults_vat_to_14_percent(self, client):
        p = _purchase(client)
        assert p["vat"] == pytest.approx(24000 * 9 * 0.14)

    def test_explicit_vat_respected(self, client):
        s = _sale(client, vat=0.0)
        assert s["vat"] == 0.0

    def test_dashboard_reflects_lines(self, client):
        r = client.get("/api/dashboard")
        assert r.status_code == 200
        d = r.json()
        assert d["purchases"]["count"] >= 1
        assert d["sales"]["count"] >= 1
        assert d["vat_position"] == pytest.approx(
            d["sales"]["vat"] - d["purchases"]["vat"])

    def test_update_and_delete_line(self, client):
        p = _purchase(client, qty=100, price=10)
        pid = p["id"]
        r = client.put(f"/api/lines/purchase/{pid}", json={"qty": 150})
        assert r.status_code == 200
        assert r.json()["qty"] == 150
        r = client.delete(f"/api/lines/purchase/{pid}")
        assert r.status_code == 200
        r = client.get("/api/lines", params={"kind": "purchase"})
        assert all(l["id"] != pid for l in r.json())


class TestMatching:
    def test_manual_match_and_unlink(self, client):
        p, s = _purchase(client), _sale(client)
        r = client.post("/api/matches", json={"purchase_id": p["id"], "sale_id": s["id"]})
        assert r.status_code == 200
        mid = r.json()["id"]
        matches = client.get("/api/matches").json()
        assert any(m["id"] == mid for m in matches)
        assert client.delete(f"/api/matches/{mid}").status_code == 200

    def test_line_cannot_match_twice(self, client):
        p, s1, s2 = _purchase(client), _sale(client), _sale(client)
        assert client.post("/api/matches", json={
            "purchase_id": p["id"], "sale_id": s1["id"]}).status_code == 200
        r = client.post("/api/matches", json={
            "purchase_id": p["id"], "sale_id": s2["id"]})
        assert r.status_code == 409

    def test_auto_match_suggests_and_accepts(self, client):
        p = _purchase(client, qty=7777, price=9, item="صنف فريد للاختبار")
        s = _sale(client, qty=7777, price=11, item="صنف فريد للاختبار")
        sugg = client.post("/api/matches/auto").json()
        pair = [m for m in sugg if m["purchase_id"] == p["id"]]
        assert pair and pair[0]["sale_id"] == s["id"]
        r = client.post("/api/matches/accept",
                        json={"pairs": [{"purchase_id": p["id"], "sale_id": s["id"]}]})
        assert r.status_code == 200
        assert r.json()["created"] == 1


class TestSettingsAndExport:
    def test_settings_roundtrip_masks_secret(self, client):
        r = client.put("/api/settings", json={
            "eta_env": "preprod", "eta_client_id": "cid", "eta_client_secret": "s3cret",
            "vat_rate": 0.14})
        assert r.status_code == 200
        got = client.get("/api/settings").json()
        assert got["eta_client_id"] == "cid"
        assert "s3cret" not in str(got)
        assert got["has_secret"] is True

    def test_export_returns_workbook(self, client):
        r = client.get("/api/export/excel")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml")
        assert len(r.content) > 1000
