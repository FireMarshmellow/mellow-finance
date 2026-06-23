from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from config import SHEET_MAP, SHEET_META
from routers import data, summary
from routers import sponsors, freebies, statements, settings as settings_router
from services.loader import load_sheet


class NoCacheStaticFiles(StaticFiles):
    """Serve static assets with `Cache-Control: no-cache` so browsers always
    revalidate against the ETag. Prevents a stale cached JS module from being
    linked against freshly-updated ones (which silently breaks the SPA)."""

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        response.headers.setdefault("Cache-Control", "no-cache")
        return response

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
app.include_router(statements.router)
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
app.mount("/", NoCacheStaticFiles(directory=str(FRONTEND), html=True), name="static")
