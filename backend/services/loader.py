import pandas as pd
from config import SHEET_MAP


def load_sheet(sheet_id: str) -> pd.DataFrame:
    path = SHEET_MAP[sheet_id]
    df = pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    df.columns = df.columns.str.strip()
    return df


def load_all() -> dict:
    result = {}
    for sid in SHEET_MAP:
        try:
            result[sid] = load_sheet(sid)
        except Exception as e:
            print(f"Warning: could not load {sid}: {e}")
            result[sid] = pd.DataFrame()
    return result
