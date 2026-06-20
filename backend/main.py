from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import SHEET_MAP, SHEET_META
from routers import data, summary
from routers import sponsors, freebies, settings as settings_router
from services.loader import load_sheet

app = FastAPI(title="Mellow Labs Finance", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(summary.router)
app.include_router(data.router)
app.include_router(sponsors.router)
app.include_router(freebies.router)
app.include_router(settings_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/meta")
def meta():
    result = {}
    for sheet_id, info in SHEET_META.items():
        try:
            df = load_sheet(sheet_id)
            cols = list(df.columns)
        except Exception:
            cols = []
        result[sheet_id] = {
            "label":    info["label"],
            "category": info["category"],
            "columns":  cols,
        }
    return result


# Serve the frontend — must be last so it doesn't shadow /api routes
FRONTEND = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
