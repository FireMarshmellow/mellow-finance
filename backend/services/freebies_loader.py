import os
import time
import uuid
from pathlib import Path
from datetime import date

import pandas as pd
from dateutil import parser as dateutil_parser

from config import FREEBIES_CSV, FREEBIES_SEED

COLUMNS = [
    "Date",
    "Provider",
    "Category",
    "Item or Benefit Received",
    "Quantity / Specifications",
    "Value (£)",
]


def load_freebies() -> pd.DataFrame:
    path = Path(FREEBIES_CSV)

    if not path.exists():
        seed = Path(FREEBIES_SEED)
        if seed.exists() and seed.resolve() != path.resolve():
            df = pd.read_csv(seed, dtype=str, encoding="utf-8-sig", keep_default_na=False)
            df.columns = df.columns.str.strip()
        else:
            df = pd.DataFrame(columns=COLUMNS)
        for col in COLUMNS:
            if col not in df.columns:
                df[col] = ""
        write_freebies(df)
        return df

    df = pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    df.columns = df.columns.str.strip()
    for col in COLUMNS:
        if col not in df.columns:
            df[col] = ""
    return df


def write_freebies(df: pd.DataFrame) -> None:
    path = Path(FREEBIES_CSV)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Unique temp name so concurrent requests don't collide on the same .tmp file
    tmp = path.parent / f"{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        df.to_csv(tmp, index=False, encoding="utf-8-sig")
        # Retry in case Windows has a brief lock on the target
        for attempt in range(3):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt < 2:
                    time.sleep(0.3)
                else:
                    raise
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def parse_date_safe(s: str) -> date | None:
    if not s or not s.strip():
        return None
    try:
        return dateutil_parser.parse(s, dayfirst=True).date()
    except Exception:
        return None


def parse_value(s) -> float:
    if s is None:
        return 0.0
    try:
        return float(str(s).replace(",", "").replace("£", "").strip() or 0)
    except ValueError:
        return 0.0


def unique_values(df: pd.DataFrame, col: str) -> list[str]:
    if col not in df.columns:
        return []
    vals = df[col].dropna().unique()
    return sorted(v for v in vals if str(v).strip())
