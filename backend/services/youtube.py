import re
from urllib.parse import urlparse, parse_qs
from datetime import datetime

import httpx
from fastapi import HTTPException

_VIDEO_ID_RE = re.compile(r'^[\w-]{11}$')


def extract_video_id(url: str) -> str | None:
    url = url.strip()

    # Bare video ID
    if _VIDEO_ID_RE.match(url):
        return url

    try:
        parsed = urlparse(url)
    except Exception:
        return None

    host = parsed.netloc.lower().replace("www.", "")

    # youtu.be/VIDEO_ID
    if host == "youtu.be":
        vid = parsed.path.lstrip("/").split("?")[0].split("/")[0]
        return vid if _VIDEO_ID_RE.match(vid) else None

    if host in ("youtube.com", "m.youtube.com"):
        # /watch?v=VIDEO_ID
        qs = parse_qs(parsed.query)
        if "v" in qs:
            vid = qs["v"][0]
            return vid if _VIDEO_ID_RE.match(vid) else None

        # /shorts/VIDEO_ID or /embed/VIDEO_ID or /v/VIDEO_ID
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in ("shorts", "embed", "v"):
            vid = parts[1]
            return vid if _VIDEO_ID_RE.match(vid) else None

    return None


async def fetch_video_data(video_id: str, api_key: str) -> dict:
    url = (
        "https://www.googleapis.com/youtube/v3/videos"
        f"?part=snippet,statistics&id={video_id}&key={api_key}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"YouTube API error: {e.response.status_code}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"YouTube API unreachable: {e}")

    items = data.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="Video not found or API key invalid")

    item = items[0]
    snippet = item.get("snippet", {})
    stats = item.get("statistics", {})

    published_raw = snippet.get("publishedAt", "")
    try:
        dt = datetime.fromisoformat(published_raw.replace("Z", "+00:00"))
        published = dt.strftime("%d/%m/%Y")
    except Exception:
        published = published_raw

    thumbnails = snippet.get("thumbnails", {})
    thumb = (
        thumbnails.get("maxres", {}).get("url")
        or thumbnails.get("high", {}).get("url")
        or thumbnails.get("medium", {}).get("url")
        or ""
    )

    return {
        "title": snippet.get("title", ""),
        "published_at": published,
        "view_count": int(stats.get("viewCount", 0)),
        "thumbnail_url": thumb,
    }
