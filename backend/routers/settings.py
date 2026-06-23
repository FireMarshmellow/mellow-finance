from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.settings_store import load_settings, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/")
def get_settings():
    s = load_settings()
    return {"youtube_api_key_set": bool(s.get("youtube_api_key", "").strip())}


class SettingsBody(BaseModel):
    youtube_api_key: str


@router.put("/")
def put_settings(body: SettingsBody):
    key = body.youtube_api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")
    s = load_settings()
    s["youtube_api_key"] = key
    save_settings(s)
    return {"ok": True}


# ── hidden financial years (e.g. personal-only years before the business) ──────

class HiddenYearsBody(BaseModel):
    hidden: list[str]


@router.get("/hidden-years")
def get_hidden_years():
    val = load_settings().get("hidden_financial_years", [])
    return {"hidden": val if isinstance(val, list) else []}


@router.put("/hidden-years")
def put_hidden_years(body: HiddenYearsBody):
    s = load_settings()
    s["hidden_financial_years"] = sorted({y.strip() for y in body.hidden if y.strip()})
    save_settings(s)
    return {"hidden": s["hidden_financial_years"]}
