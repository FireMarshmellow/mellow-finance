from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services import statements_store as store

router = APIRouter(prefix="/api/statements", tags=["statements"])

MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB per statement


# ── accounts ─────────────────────────────────────────────────────────────────

@router.get("/accounts")
def list_accounts():
    return store.list_accounts()


class AccountBody(BaseModel):
    name: str


@router.post("/accounts")
def add_account(body: AccountBody):
    try:
        return store.add_account(body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/accounts/{account_id}")
def rename_account(account_id: str, body: AccountBody):
    try:
        return store.rename_account(account_id, body.name)
    except KeyError:
        raise HTTPException(status_code=404, detail="Account not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str):
    try:
        store.delete_account(account_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"ok": True}


# ── statements (files) ────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/files")
def list_files(account_id: str):
    try:
        return store.list_files(account_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Account not found")


@router.post("/accounts/{account_id}/files")
async def upload_files(account_id: str, files: list[UploadFile] = File(...)):
    if not store.get_account(account_id):
        raise HTTPException(status_code=404, detail="Account not found")

    saved, errors = [], []
    for f in files:
        name = f.filename or "statement.pdf"
        if not name.lower().endswith(".pdf"):
            errors.append({"filename": name, "error": "Only PDF files are allowed"})
            continue
        content = await f.read()
        if len(content) > MAX_FILE_BYTES:
            errors.append({"filename": name, "error": "File exceeds 25 MB limit"})
            continue
        try:
            saved.append(store.save_file(account_id, name, content))
        except ValueError as e:
            errors.append({"filename": name, "error": str(e)})

    if not saved and errors:
        raise HTTPException(status_code=400, detail=errors[0]["error"])
    return {"saved": saved, "errors": errors}


@router.get("/accounts/{account_id}/files/{filename}")
def get_file(account_id: str, filename: str, download: bool = False):
    try:
        path = store.resolve_file(account_id, filename)
    except KeyError:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=path.name,
        content_disposition_type="attachment" if download else "inline",
    )


@router.delete("/accounts/{account_id}/files/{filename}")
def delete_file(account_id: str, filename: str):
    try:
        store.delete_file(account_id, filename)
    except KeyError:
        raise HTTPException(status_code=404, detail="File not found")
    return {"ok": True}
