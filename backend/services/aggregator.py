"""
Aggregates the canonical DataFrame into period-based summary rows.
"""
from datetime import date

import pandas as pd

from config import INCOME_SOURCES, EXPENSE_SOURCES, SUMMARY_COLUMNS


# ---------------------------------------------------------------------------
# Period labelling
# ---------------------------------------------------------------------------

def _fy_label(d: date) -> str:
    """UK financial year label, e.g. '2023/24'.  FY starts 6 April."""
    if d.month > 4 or (d.month == 4 and d.day >= 6):
        y = d.year
    else:
        y = d.year - 1
    return f"{y}/{str(y + 1)[2:]}"


def _month_label(d: date) -> str:
    return d.strftime("%b %Y")   # e.g. "Jan 2024"


def _month_sort_key(d: date) -> str:
    return d.strftime("%Y-%m")


# ---------------------------------------------------------------------------
# Core pivot builder
# ---------------------------------------------------------------------------

def _build_rows(df: pd.DataFrame) -> list:
    if df.empty or "period" not in df.columns:
        return []

    pivot = (
        df.groupby(["period", "source"])["amount_gbp"]
        .sum()
        .unstack(fill_value=0.0)
        .reset_index()
    )

    # Ensure all expected source columns exist
    for src in INCOME_SOURCES + EXPENSE_SOURCES:
        if src not in pivot.columns:
            pivot[src] = 0.0

    rows = []
    for _, r in pivot.iterrows():
        row: dict = {"period": r["period"]}
        for src in INCOME_SOURCES:
            row[src] = round(float(r.get(src, 0)), 2)
        row["Total Income"] = round(sum(row[s] for s in INCOME_SOURCES), 2)
        for src in EXPENSE_SOURCES:
            row[src] = round(float(r.get(src, 0)), 2)
        row["Total Expenses"] = round(sum(row[s] for s in EXPENSE_SOURCES), 2)
        row["Net"] = round(row["Total Income"] - row["Total Expenses"], 2)
        rows.append(row)

    return rows


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_yearly_summary(canonical: pd.DataFrame) -> dict:
    if canonical.empty:
        return {"columns": SUMMARY_COLUMNS, "rows": []}

    df = canonical.copy()
    df["period"] = df["transaction_date"].apply(_fy_label)
    # sort key: extract start year from label "2023/24" → 2023
    rows = _build_rows(df)
    rows.sort(key=lambda r: int(r["period"].split("/")[0]))
    return {"columns": SUMMARY_COLUMNS, "rows": rows}


def get_monthly_summary(canonical: pd.DataFrame) -> dict:
    if canonical.empty:
        return {"columns": SUMMARY_COLUMNS, "rows": []}

    df = canonical.copy()
    df["period"]   = df["transaction_date"].apply(_month_label)
    df["sort_key"] = df["transaction_date"].apply(_month_sort_key)
    sort_map = df.groupby("period")["sort_key"].first().to_dict()

    rows = _build_rows(df)
    rows.sort(key=lambda r: sort_map.get(r["period"], ""))
    return {"columns": SUMMARY_COLUMNS, "rows": rows}


def get_range_summary(canonical: pd.DataFrame, start: date, end: date) -> dict:
    if canonical.empty:
        return {"columns": SUMMARY_COLUMNS, "rows": []}

    df = canonical.copy()
    df = df[(df["transaction_date"] >= start) & (df["transaction_date"] <= end)]

    if df.empty:
        return {"columns": SUMMARY_COLUMNS, "rows": []}

    df["period"]   = df["transaction_date"].apply(_month_label)
    df["sort_key"] = df["transaction_date"].apply(_month_sort_key)
    sort_map = df.groupby("period")["sort_key"].first().to_dict()

    rows = _build_rows(df)
    rows.sort(key=lambda r: sort_map.get(r["period"], ""))
    return {"columns": SUMMARY_COLUMNS, "rows": rows}
