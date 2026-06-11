# -*- coding: utf-8 -*-
"""UI smoke test against a running instance on :8077 (not collected by pytest)."""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8077"
SHOTS = Path(r"C:\Software\PBK\data\shots")
SHOTS.mkdir(parents=True, exist_ok=True)

failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


# -- API-level checks on the real data --------------------------------------
d = requests.get(f"{BASE}/api/dashboard").json()
check("dashboard vat_position == sheet J2", abs(d["vat_position"] - (-480538.513)) < 0.01,
      str(d["vat_position"]))
check("dashboard gross_diff == sheet R2", abs(d["gross_diff"] - 788906.537) < 0.01,
      str(d["gross_diff"]))
check("counts 54/56/52", (d["purchases"]["count"], d["sales"]["count"], d["matches_count"])
      == (54, 56, 52), str((d["purchases"]["count"], d["sales"]["count"], d["matches_count"])))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 950})
    page.goto(BASE)
    page.wait_for_load_state("networkidle")

    # dashboard populated
    vat_text = page.locator("#kpi-vat-position").inner_text()
    check("UI shows VAT position", "480,538" in vat_text, vat_text)
    check("RTL document", page.evaluate("document.documentElement.dir") == "rtl")
    page.screenshot(path=str(SHOTS / "1-dashboard.png"), full_page=True)

    # matching tab
    page.click('[data-tab="matching"]')
    page.wait_for_timeout(700)
    unmatched_p = page.locator("#tbl-unmatched-p tbody tr").count()
    unmatched_s = page.locator("#tbl-unmatched-s tbody tr").count()
    check("unmatched purchases listed (2)", unmatched_p == 2, str(unmatched_p))
    check("unmatched sales listed (4)", unmatched_s == 4, str(unmatched_s))
    matches_rows = page.locator("#tbl-matches tbody tr").count()
    check("matches table has 52 rows", matches_rows == 52, str(matches_rows))
    page.click("#btn-auto-match")
    page.wait_for_timeout(1200)
    page.screenshot(path=str(SHOTS / "2-matching.png"), full_page=True)

    # purchases tab + search
    page.click('[data-tab="purchases"]')
    page.wait_for_timeout(600)
    rows_all = page.locator("#tbl-purchases tbody tr").count()
    check("purchases table 54 rows", rows_all == 54, str(rows_all))
    page.fill("#q-purchases", "عسل")
    page.wait_for_timeout(700)
    rows_filtered = page.locator("#tbl-purchases tbody tr").count()
    check("search filters honey rows (2)", rows_filtered == 2, str(rows_filtered))
    page.fill("#q-purchases", "")
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "3-purchases.png"), full_page=True)

    # sales tab shows credit-note pill
    page.click('[data-tab="sales"]')
    page.wait_for_timeout(600)
    credit_pills = page.locator("#tbl-sales .pill.credit").count()
    check("credit-note badges visible", credit_pills >= 1, str(credit_pills))

    # ETA + settings tabs render
    page.click('[data-tab="eta"]')
    page.wait_for_timeout(400)
    check("ETA warning visible (no creds yet)",
          page.locator("#eta-cred-warning").is_visible())
    page.screenshot(path=str(SHOTS / "4-eta.png"), full_page=True)
    page.click('[data-tab="settings"]')
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / "5-settings.png"), full_page=True)

    # add + delete a manual line through the UI
    page.click('[data-tab="purchases"]')
    page.wait_for_timeout(400)
    page.click('[data-add="purchase"]')
    page.fill("#ln-date", "2026-06-01")
    page.fill("#ln-no", "TEST-1")
    page.fill("#ln-party", "مورد تجريبي")
    page.fill("#ln-item", "صنف تجريبي")
    page.fill("#ln-qty", "10")
    page.fill("#ln-price", "100")
    page.click("#btn-line-save")
    page.wait_for_timeout(700)
    check("manual line added (55 rows)",
          page.locator("#tbl-purchases tbody tr").count() == 55)
    test_row = page.locator("tr", has_text="TEST-1")
    vat_cell = test_row.locator("td").nth(7).inner_text()
    check("manual line VAT auto = 140.00", "140.00" in vat_cell, vat_cell)
    page.once("dialog", lambda dlg: dlg.accept())
    test_row.locator("[data-del]").click()
    page.wait_for_timeout(700)
    check("manual line deleted (54 rows)",
          page.locator("#tbl-purchases tbody tr").count() == 54)

    browser.close()

# -- export endpoint --------------------------------------------------------
r = requests.get(f"{BASE}/api/export/excel")
check("export returns xlsx", r.status_code == 200 and r.content[:2] == b"PK", str(r.status_code))
out = SHOTS / "exported.xlsx"
out.write_bytes(r.content)
print(f"\nexported file: {out} ({len(r.content)} bytes)")
print("FAILURES:", failures if failures else "none")
sys.exit(1 if failures else 0)
