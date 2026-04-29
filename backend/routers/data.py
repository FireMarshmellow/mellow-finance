from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException

from config import SHEET_MAP, SHEET_META
from services.loader import load_sheet
from services.writer import write_sheet

router = APIRouter(prefix="/api/data", tags=["data"])


def _check(sheet_id: str) -> None:
    if sheet_id not in SHEET_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown sheet: {sheet_id}")


def _to_response(df: pd.DataFrame) -> dict:
    return {
        "columns": list(df.columns),
        "rows": df.fillna("").to_dict(orient="records"),
    }


@router.get("/{sheet_id}")
def get_sheet(sheet_id: str):
    _check(sheet_id)
    return _to_response(load_sheet(sheet_id))


@router.post("/{sheet_id}")
def add_row(sheet_id: str, row: dict[str, Any]):
    _check(sheet_id)
    df = load_sheet(sheet_id)
    new_row = {col: row.get(col, "") for col in df.columns}
    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    write_sheet(sheet_id, df)
    return _to_response(df)


@router.put("/{sheet_id}/{row_index}")
def update_row(sheet_id: str, row_index: int, row: dict[str, Any]):
    _check(sheet_id)
    df = load_sheet(sheet_id)
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(status_code=404, detail="Row index out of range")
    for col, val in row.items():
        if col in df.columns:
            df.at[row_index, col] = val
    write_sheet(sheet_id, df)
    return _to_response(df)


@router.delete("/{sheet_id}/{row_index}")
def delete_row(sheet_id: str, row_index: int):
    _check(sheet_id)
    df = load_sheet(sheet_id)
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(status_code=404, detail="Row index out of range")
    df = df.drop(index=row_index).reset_index(drop=True)
    write_sheet(sheet_id, df)
    return _to_response(df)
