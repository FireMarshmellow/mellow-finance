"""
Maps each raw CSV into a canonical list of transactions:
  { source, category, transaction_date (date), amount_gbp (float) }

Rows with unparseable dates or amounts are skipped but do NOT corrupt the CSV.
"""
import re
from datetime import date
from typing import Optional

import pandas as pd

from config import INCOME_SOURCES, EXPENSE_SOURCES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean_amount(val) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("↓", "-", "N/A", "n/a", "TBC", "tbc"):
        return None
    s = re.sub(r"[£$,\s]", "", s)
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(val) -> Optional[date]:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("↓", "-"):
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return pd.to_datetime(s, format=fmt).date()
        except Exception:
            pass
    try:
        return pd.to_datetime(s, dayfirst=True).date()
    except Exception:
        return None


def _col(df: pd.DataFrame, *candidates: str) -> Optional[str]:
    """Return the first column name from candidates that exists (case-insensitive)."""
    lower_map = {c.lower().strip(): c for c in df.columns}
    for cand in candidates:
        found = lower_map.get(cand.lower().strip())
        if found is not None:
            return found
    return None


# ---------------------------------------------------------------------------
# Per-source normalisers
# ---------------------------------------------------------------------------

def _normalise_youtube(df: pd.DataFrame) -> list:
    date_col   = _col(df, "Date")
    amount_col = _col(df, "Amount_Received_in_account")
    records = []
    for _, row in df.iterrows():
        d   = _parse_date(row.get(date_col))
        amt = _clean_amount(row.get(amount_col))
        if d is None or amt is None:
            continue
        records.append({"source": "YouTube AdSense", "category": "income",
                         "transaction_date": d, "amount_gbp": amt, "description": ""})
    return records


def _normalise_patreon(df: pd.DataFrame) -> list:
    # Use "Received_in_account" as date, "Received_amount_in_account" as amount.
    # Some rows only have a withdrawal date with no received date — fall back to
    # Date_Withdrawal.  Rows with ↓ in the amount are batched sub-rows; skip them.
    date_col   = _col(df, "Received_in_account", "Date_Withdrawal", "Withdrow_from_patrion")
    amount_col = _col(df, "Received_amount_in_account", "Amount")
    records = []
    for _, row in df.iterrows():
        d   = _parse_date(row.get(date_col))
        amt = _clean_amount(row.get(amount_col))
        if d is None or amt is None:
            continue
        records.append({"source": "Patreon", "category": "income",
                         "transaction_date": d, "amount_gbp": amt, "description": ""})
    return records


def _normalise_sponsorships(df: pd.DataFrame) -> list:
    # withdrawal_date → date; Received_amount_in_account → GBP amount
    date_col   = _col(df, "withdrawal_date", "Date")
    amount_col = _col(df, "Received_amount_in_account", "received_amount")
    records = []
    for _, row in df.iterrows():
        d   = _parse_date(row.get(date_col))
        amt_raw = row.get(amount_col, "")
        # If the amount column contains USD ($) and there's no GBP column, skip
        # (the Received_amount_in_account column should always be GBP)
        amt = _clean_amount(amt_raw)
        if d is None or amt is None:
            continue
        records.append({"source": "Sponsorships", "category": "income",
                         "transaction_date": d, "amount_gbp": amt, "description": ""})
    return records


def _normalise_other_income(df: pd.DataFrame) -> list:
    date_col   = _col(df, "Date_Received_in_account", "Date")
    amount_col = _col(df, "Amount_Received_in_account", "amount")
    records = []
    for _, row in df.iterrows():
        d   = _parse_date(row.get(date_col))
        amt = _clean_amount(row.get(amount_col))
        if d is None or amt is None:
            continue
        records.append({"source": "Other Income", "category": "income",
                         "transaction_date": d, "amount_gbp": amt, "description": ""})
    return records


def _normalise_expense(df: pd.DataFrame, source: str) -> list:
    date_col   = _col(df, "Order_Date", "order_date", "order date", "Date")
    amount_col = _col(df, "Order_Total", "order_total", "total_owed", "Total_Owed", "total owed")
    desc_col   = _col(df, "product name", "Product_Name", "Item_Title", "item_title", "Description")
    if date_col is None or amount_col is None:
        return []
    records = []
    for _, row in df.iterrows():
        d   = _parse_date(row.get(date_col))
        amt = _clean_amount(row.get(amount_col))
        if d is None or amt is None:
            continue
        desc = str(row.get(desc_col, "")).strip() if desc_col else ""
        records.append({"source": source, "category": "expense",
                         "transaction_date": d, "amount_gbp": amt,
                         "description": desc})
    return records


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

_NORMALISERS = {
    "youtube_adsense": _normalise_youtube,
    "patreon":         _normalise_patreon,
    "sponsorships":    _normalise_sponsorships,
    "other_income":    _normalise_other_income,
}

_EXPENSE_SOURCES = {
    "amazon":          "Amazon",
    "ebay":            "eBay",
    "aliexpress":      "AliExpress",
    "other_expenses":  "Other Expenses",
}


def normalise_all(sheets: dict) -> pd.DataFrame:
    records = []

    for sheet_id, fn in _NORMALISERS.items():
        df = sheets.get(sheet_id, pd.DataFrame())
        if not df.empty:
            records.extend(fn(df))

    for sheet_id, source_name in _EXPENSE_SOURCES.items():
        df = sheets.get(sheet_id, pd.DataFrame())
        if not df.empty:
            records.extend(_normalise_expense(df, source_name))

    if not records:
        return pd.DataFrame(columns=["source", "category", "transaction_date", "amount_gbp"])

    return pd.DataFrame(records)
