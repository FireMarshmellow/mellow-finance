import os
import time
import uuid
from pathlib import Path
from datetime import date

import pandas as pd
from dateutil import parser as dateutil_parser

from config import SPONSOR_CSV

_REQUIRED_COLS = [
    "Video ID", "Video title", "Sponserd by", "video release date",
    "Milestones End date", "views", "Milestones payout", "Bonus Paid",
    "Flat rate (Paid confirmation)", "thumbnail_url", "last_updated",
    "milestones_enabled", "flat_rate_enabled",
]

_DEFAULTS = {
    "thumbnail_url": "",
    "last_updated": "",
    "milestones_enabled": "yes",
    "flat_rate_enabled": "yes",
}


def load_sponsors() -> pd.DataFrame:
    path = Path(SPONSOR_CSV)
    if not path.exists():
        df = pd.DataFrame(columns=_REQUIRED_COLS)
        write_sponsors(df)
        return df

    df = pd.read_csv(path, dtype=str, encoding="utf-8-sig", keep_default_na=False)
    df.columns = df.columns.str.strip()

    migrated = False
    for col, default in _DEFAULTS.items():
        if col not in df.columns:
            df[col] = default
            migrated = True

    if migrated:
        write_sponsors(df)

    return df


def write_sponsors(df: pd.DataFrame) -> None:
    path = Path(SPONSOR_CSV)
    # Use a unique name so concurrent requests don't collide on the same .tmp file
    tmp = path.parent / f"{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        df.to_csv(tmp, index=False, encoding="utf-8-sig")
        # Retry up to 3 times in case Windows has a brief lock on the target
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


def auto_disable_lapsed_milestones(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    """Disable milestones on videos that are past 30 days and never hit 5k views."""
    today = date.today()
    changed = False
    for i, row in df.iterrows():
        if row.get("milestones_enabled", "yes").lower() == "no":
            continue
        release = parse_date_safe(row.get("video release date", ""))
        if not release or (today - release).days <= 30:
            continue
        try:
            views = int(str(row.get("views", "0")).replace(",", "") or 0)
        except (ValueError, TypeError):
            views = 0
        if views < 5000:
            df.at[i, "milestones_enabled"] = "no"
            changed = True
    return df, changed


def milestone_for(views: int) -> int:
    if views >= 20000:
        return 300
    if views >= 10000:
        return 200
    if views >= 5000:
        return 100
    return 0


def unique_sponsors(df: pd.DataFrame) -> list[str]:
    col = "Sponserd by"
    if col not in df.columns:
        return []
    vals = df[col].dropna().unique()
    return sorted(v for v in vals if v.strip())


def parse_date_safe(s: str) -> date | None:
    if not s or not s.strip():
        return None
    try:
        return dateutil_parser.parse(s, dayfirst=True).date()
    except Exception:
        return None
