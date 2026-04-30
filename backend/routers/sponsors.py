from datetime import date, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.sponsor_loader import (
    load_sponsors, write_sponsors, milestone_for, unique_sponsors, parse_date_safe,
    auto_disable_lapsed_milestones,
)
from services.settings_store import load_settings
from services.youtube import extract_video_id, fetch_video_data

router = APIRouter(prefix="/api/sponsors", tags=["sponsors"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _row_to_out(row: dict, idx: int) -> dict:
    views = 0
    try:
        views = int(str(row.get("views", "0")).replace(",", "") or 0)
    except (ValueError, TypeError):
        pass

    release = parse_date_safe(row.get("video release date", ""))
    tracking_active = False
    if release:
        tracking_active = (date.today() - release).days <= 30

    milestones_on = row.get("milestones_enabled", "yes").lower() != "no"
    flat_rate_on  = row.get("flat_rate_enabled", "yes").lower() != "no"

    return {
        "row_index":           idx,
        "video_id":            row.get("Video ID", ""),
        "title":               row.get("Video title", ""),
        "sponsor":             row.get("Sponserd by", ""),
        "release_date":        row.get("video release date", ""),
        "release_date_iso":    release.isoformat() if release else "",
        "milestones_end_date": row.get("Milestones End date", ""),
        "views":               views,
        "thumbnail_url":       row.get("thumbnail_url", ""),
        "last_updated":        row.get("last_updated", ""),
        "milestone_payout":    milestone_for(views) if milestones_on else 0,
        "milestone_payout_csv": row.get("Milestones payout", ""),
        "bonus_paid":          row.get("Bonus Paid", ""),
        "flat_rate_paid":      row.get("Flat rate (Paid confirmation)", ""),
        "milestones_enabled":  milestones_on,
        "flat_rate_enabled":   flat_rate_on,
        "tracking_active":     tracking_active,
    }


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_sponsors():
    df = load_sponsors()
    df, changed = auto_disable_lapsed_milestones(df)
    if changed:
        write_sponsors(df)
    return [_row_to_out(row, i) for i, row in enumerate(df.to_dict(orient="records"))]


@router.get("/sponsors-list")
def sponsors_list():
    df = load_sponsors()
    return unique_sponsors(df)


class AddBody(BaseModel):
    url: str
    sponsor: str = ""
    milestones_enabled: bool = True
    flat_rate_enabled: bool = True


@router.post("/add")
async def add_sponsor(body: AddBody):
    video_id = extract_video_id(body.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Could not extract video ID from URL")

    settings = load_settings()
    api_key = settings.get("youtube_api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="No YouTube API key configured. Go to Settings first.")

    df = load_sponsors()
    if video_id in df["Video ID"].values:
        raise HTTPException(status_code=409, detail="Video is already being tracked")

    data = await fetch_video_data(video_id, api_key)

    release = parse_date_safe(data["published_at"])
    milestones_end = ""
    if release:
        milestones_end = (release + timedelta(days=30)).strftime("%d/%m/%Y")

    new_row = {
        "Video ID":                     video_id,
        "Video title":                  data["title"],
        "Sponserd by":                  body.sponsor,
        "video release date":           data["published_at"],
        "Milestones End date":          milestones_end,
        "views":                        str(data["view_count"]),
        "Milestones payout":            str(milestone_for(data["view_count"])),
        "Bonus Paid":                   "Pending",
        "Flat rate (Paid confirmation)": "Pending",
        "thumbnail_url":                data["thumbnail_url"],
        "last_updated":                 date.today().isoformat(),
        "milestones_enabled":           "yes" if body.milestones_enabled else "no",
        "flat_rate_enabled":            "yes" if body.flat_rate_enabled else "no",
    }

    import pandas as pd
    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    write_sponsors(df)

    idx = len(df) - 1
    return _row_to_out(new_row, idx)


class PatchBody(BaseModel):
    sponsor: str | None = None
    bonus_paid: str | None = None
    flat_rate_paid: str | None = None
    milestones_enabled: bool | None = None
    flat_rate_enabled: bool | None = None
    release_date: str | None = None


@router.patch("/{row_index}")
def update_sponsor(row_index: int, body: PatchBody):
    df = load_sponsors()
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(status_code=404, detail="Row not found")

    if body.sponsor is not None:
        df.at[row_index, "Sponserd by"] = body.sponsor
    if body.bonus_paid is not None:
        df.at[row_index, "Bonus Paid"] = body.bonus_paid
    if body.flat_rate_paid is not None:
        df.at[row_index, "Flat rate (Paid confirmation)"] = body.flat_rate_paid
    if body.milestones_enabled is not None:
        df.at[row_index, "milestones_enabled"] = "yes" if body.milestones_enabled else "no"
    if body.flat_rate_enabled is not None:
        df.at[row_index, "flat_rate_enabled"] = "yes" if body.flat_rate_enabled else "no"
    if body.release_date is not None:
        parsed = parse_date_safe(body.release_date)
        if not parsed:
            raise HTTPException(status_code=400, detail="Invalid date — use DD/MM/YYYY")
        formatted = parsed.strftime("%d/%m/%Y")
        df.at[row_index, "video release date"] = formatted
        df.at[row_index, "Milestones End date"] = (parsed + timedelta(days=30)).strftime("%d/%m/%Y")

    write_sponsors(df)
    return _row_to_out(df.iloc[row_index].to_dict(), row_index)


@router.delete("/{row_index}")
def delete_sponsor(row_index: int):
    df = load_sponsors()
    if row_index < 0 or row_index >= len(df):
        raise HTTPException(status_code=404, detail="Row not found")
    df = df.drop(index=row_index).reset_index(drop=True)
    write_sponsors(df)
    return {"ok": True}


class RefreshBody(BaseModel):
    row_index: int


@router.post("/refresh")
async def refresh_sponsor(body: RefreshBody):
    df = load_sponsors()
    idx = body.row_index
    if idx < 0 or idx >= len(df):
        raise HTTPException(status_code=404, detail="Row not found")

    settings = load_settings()
    api_key = settings.get("youtube_api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="No YouTube API key configured")

    video_id = df.at[idx, "Video ID"]
    data = await fetch_video_data(video_id, api_key)

    df.at[idx, "views"] = str(data["view_count"])
    df.at[idx, "thumbnail_url"] = data["thumbnail_url"]
    df.at[idx, "last_updated"] = date.today().isoformat()
    write_sponsors(df)

    return _row_to_out(df.iloc[idx].to_dict(), idx)


@router.post("/auto-refresh")
async def auto_refresh():
    settings = load_settings()
    api_key = settings.get("youtube_api_key", "")
    if not api_key:
        return {"refreshed": [], "errors": ["no_api_key"]}

    df = load_sponsors()
    today = date.today()
    refreshed = []
    errors = []

    for i, row in df.iterrows():
        release = parse_date_safe(row.get("video release date", ""))
        if not release:
            continue
        if (today - release).days > 30:
            continue

        last = parse_date_safe(row.get("last_updated", ""))
        if last and (today - last).days < 1:
            continue

        video_id = row.get("Video ID", "")
        try:
            data = await fetch_video_data(video_id, api_key)
            df.at[i, "views"] = str(data["view_count"])
            df.at[i, "thumbnail_url"] = data["thumbnail_url"]
            df.at[i, "last_updated"] = today.isoformat()
            refreshed.append(video_id)
        except Exception as e:
            errors.append({"video_id": video_id, "error": str(e)})

    if refreshed:
        write_sponsors(df)

    return {"refreshed": refreshed, "errors": errors}
