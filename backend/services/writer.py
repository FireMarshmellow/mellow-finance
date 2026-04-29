"""Atomic CSV write: write to .tmp then os.replace to avoid corruption."""
import os
from pathlib import Path

import pandas as pd

from config import SHEET_MAP


def write_sheet(sheet_id: str, df: pd.DataFrame) -> None:
    path = Path(SHEET_MAP[sheet_id])
    tmp  = path.with_suffix(".csv.tmp")
    df.to_csv(tmp, index=False, encoding="utf-8-sig")
    os.replace(tmp, path)
