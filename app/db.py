# -*- coding: utf-8 -*-
"""SQLite storage for the matching tool."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = os.environ.get("PBK_DB") or str(
    Path(__file__).resolve().parent.parent / "data" / "pbk.db")

_LINE_COLUMNS = """
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_date TEXT,
    invoice_no TEXT DEFAULT '',
    party TEXT DEFAULT '',
    item TEXT DEFAULT '',
    qty REAL NOT NULL DEFAULT 0,
    unit_price REAL NOT NULL DEFAULT 0,
    vat REAL NOT NULL DEFAULT 0,
    doc_type TEXT NOT NULL DEFAULT 'i',
    source TEXT NOT NULL DEFAULT 'manual',
    eta_uuid TEXT,
    eta_line_index INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
"""

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS purchase_lines (
    {_LINE_COLUMNS},
    UNIQUE(eta_uuid, eta_line_index)
);
CREATE TABLE IF NOT EXISTS sale_lines (
    {_LINE_COLUMNS},
    internal_ref TEXT DEFAULT '',
    note TEXT DEFAULT '',
    UNIQUE(eta_uuid, eta_line_index)
);
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_line_id INTEGER NOT NULL UNIQUE
        REFERENCES purchase_lines(id) ON DELETE CASCADE,
    sale_line_id INTEGER NOT NULL UNIQUE
        REFERENCES sale_lines(id) ON DELETE CASCADE,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
"""


def get_conn() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript(SCHEMA)


def get_setting(key: str, default: str = "") -> str:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row and row["value"] is not None else default


def set_setting(key: str, value: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def vat_rate() -> float:
    try:
        return float(get_setting("vat_rate", "0.14"))
    except ValueError:
        return 0.14
