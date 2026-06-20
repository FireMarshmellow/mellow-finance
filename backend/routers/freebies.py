import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.freebies_loader import (
    load_freebies, write_freebies, parse_date_safe, parse_value, unique_values, COLUMNS,
)

router = APIRouter(prefix="/api/freebies", tags=["freebies"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _row_to_out(row: dict, idx: int) -> dict:
    d = parse_date_safe(row.get("Date", ""))
    return {
        "row_index": idx,
        "date":      row.get("Date", ""),
        "date_iso":  d.isoformat() if d else "",
        "provider":  row.get("Provider", ""),
        "category":  row.get("Category", ""),
        "item":      row.get("Item or Benefit Received", ""),
        "specs":     row.get("Quantity / Specifications", ""),
        "value":     parse_value(row.get("Value (£)", "")),
    }


def _fmt_date(s: str) -> str:
    d = parse_date_safe(s)
    return d.strftime("%d/%m/%Y") if d else (s or "")


def _fmt_value(s: str) -> str:
    if s is None or str(s).strip() == "":
        return ""
    v = parse_value(s)
    # Keep it tidy: drop trailing .0 for whole numbers
    return str(int(v)) if v == int(v) else f"{v:.2f}"


# ── schema ───────────────────────────────────────────────────────────────────

class FreebieBody(BaseModel):
    date:     str | None = None
    provider: str | None = None
    category: str | None = None
    item:     str | None = None
    specs:    str | None = None
    value:    str | None = None


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/")
def list_freebies():
    df = load_freebies()
    return [_row_to_out(row, i) for i, row in enumerate(df.to_dict(orient="records"))]


@router.get("/options")
def options():
    df = load_freebies()
    return {
        "providers":  unique_values(df, "Provider"),
        "categories": unique_values(df, "Category"),
    }


@router.post("/")
def add_freebie(body: FreebieBody):
    df = load_freebies()
    new_row = {
        "Date":                      _fmt_date(body.date or ""),
        "Provider":                  (body.provider or "").strip(),
        "Category":                  (body.category or "").strip(),
        "Item or Benefit Received":  (body.item or "").strip(),
        "Quantity / Specifications": (body.specs or "").strip(),
        "Value (£)":                 _fmt_value(body.value or ""),
    }
    df = pd.concat([df, pd.DataFrame([new_row], columns=COLUMNS)], ignore_index=True)
    write_freebies(df)
    idx = len(df) - 1
    return _row_to_out(new_row, idx)


@router.patch("/{row_index}")
def update_freebie(row_index: int, body: FreebieBody):
    df = load_freebies()
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(status_code=404, detail="Row not found")

    if body.date is not None:
        df.at[row_index, "Date"] = _fmt_date(body.date)
    if body.provider is not None:
        df.at[row_index, "Provider"] = body.provider.strip()
    if body.category is not None:
        df.at[row_index, "Category"] = body.category.strip()
    if body.item is not None:
        df.at[row_index, "Item or Benefit Received"] = body.item.strip()
    if body.specs is not None:
        df.at[row_index, "Quantity / Specifications"] = body.specs.strip()
    if body.value is not None:
        df.at[row_index, "Value (£)"] = _fmt_value(body.value)

    write_freebies(df)
    return _row_to_out(df.iloc[row_index].to_dict(), row_index)


@router.delete("/{row_index}")
def delete_freebie(row_index: int):
    df = load_freebies()
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(status_code=404, detail="Row not found")
    df = df.drop(index=row_index).reset_index(drop=True)
    write_freebies(df)
    return {"ok": True}
