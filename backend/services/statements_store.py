"""Per-account storage of bank-statement PDFs.

Layout on disk (inside DATA_DIR):

    bank_statements/
        index.json                 ← list of accounts: [{id, name, created}]
        <account_id>/              ← one folder per account
            <statement>.pdf        ← uploaded files (original, sanitised names)

Statement metadata (size, upload date) is read straight from the filesystem,
so the only thing we persist is the account list.
"""
import json
import os
import re
import uuid
from datetime import datetime, date
from pathlib import Path

from config import STATEMENTS_DIR

_INDEX_NAME = "index.json"


# ── paths ──────────────────────────────────────────────────────────────────────

def _root() -> Path:
    root = Path(STATEMENTS_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _index_path() -> Path:
    return _root() / _INDEX_NAME


def _account_dir(account_id: str) -> Path:
    return _root() / account_id


# ── index (accounts) ────────────────────────────────────────────────────────────

def _load_index() -> dict:
    try:
        return json.loads(_index_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"accounts": []}


def _save_index(data: dict) -> None:
    path = _index_path()
    tmp = path.parent / f"{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def list_accounts() -> list[dict]:
    data = _load_index()
    out = []
    for acc in data.get("accounts", []):
        files = _list_dir(_account_dir(acc["id"]))
        out.append({
            **acc,
            "file_count": len(files),
            "total_size": sum(f["size"] for f in files),
        })
    out.sort(key=lambda a: a["name"].lower())
    return out


def get_account(account_id: str) -> dict | None:
    for acc in _load_index().get("accounts", []):
        if acc["id"] == account_id:
            return acc
    return None


def add_account(name: str) -> dict:
    name = name.strip()
    if not name:
        raise ValueError("Account name is required")
    data = _load_index()
    if any(a["name"].lower() == name.lower() for a in data["accounts"]):
        raise ValueError("An account with that name already exists")
    acc = {"id": uuid.uuid4().hex, "name": name, "created": date.today().isoformat()}
    data["accounts"].append(acc)
    _save_index(data)
    _account_dir(acc["id"]).mkdir(parents=True, exist_ok=True)
    return acc


def rename_account(account_id: str, name: str) -> dict:
    name = name.strip()
    if not name:
        raise ValueError("Account name is required")
    data = _load_index()
    target = next((a for a in data["accounts"] if a["id"] == account_id), None)
    if not target:
        raise KeyError("Account not found")
    if any(a["id"] != account_id and a["name"].lower() == name.lower() for a in data["accounts"]):
        raise ValueError("An account with that name already exists")
    target["name"] = name
    _save_index(data)
    return target


def delete_account(account_id: str) -> None:
    data = _load_index()
    if not any(a["id"] == account_id for a in data["accounts"]):
        raise KeyError("Account not found")
    data["accounts"] = [a for a in data["accounts"] if a["id"] != account_id]
    _save_index(data)
    # Remove the folder and any statements inside it
    folder = _account_dir(account_id)
    if folder.is_dir():
        for f in folder.iterdir():
            try:
                f.unlink()
            except OSError:
                pass
        try:
            folder.rmdir()
        except OSError:
            pass


# ── statements (files) ──────────────────────────────────────────────────────────

def _list_dir(folder: Path) -> list[dict]:
    if not folder.is_dir():
        return []
    out = []
    for f in folder.iterdir():
        if f.is_file() and f.suffix.lower() == ".pdf":
            st = f.stat()
            out.append({
                "filename":  f.name,
                "size":      st.st_size,
                "uploaded":  datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            })
    out.sort(key=lambda x: x["uploaded"], reverse=True)
    return out


def list_files(account_id: str) -> list[dict]:
    if not get_account(account_id):
        raise KeyError("Account not found")
    return _list_dir(_account_dir(account_id))


def _sanitise_filename(name: str) -> str:
    # Keep just the base name — no directory components (path-traversal guard)
    base = os.path.basename(name.replace("\\", "/"))
    # Allow letters, numbers, space, dot, dash, underscore, parentheses
    base = re.sub(r"[^A-Za-z0-9 ._()\-]", "_", base).strip(" .")
    return base or "statement.pdf"


def _unique_path(folder: Path, filename: str) -> Path:
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".pdf"
    candidate = folder / f"{stem}{suffix}"
    i = 1
    while candidate.exists():
        candidate = folder / f"{stem} ({i}){suffix}"
        i += 1
    return candidate


def save_file(account_id: str, original_name: str, content: bytes) -> dict:
    if not get_account(account_id):
        raise KeyError("Account not found")

    clean = _sanitise_filename(original_name)
    if not clean.lower().endswith(".pdf"):
        raise ValueError("Only PDF files are allowed")

    folder = _account_dir(account_id)
    folder.mkdir(parents=True, exist_ok=True)
    dest = _unique_path(folder, clean)

    tmp = folder / f".{uuid.uuid4().hex}.tmp"
    try:
        tmp.write_bytes(content)
        os.replace(tmp, dest)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise

    st = dest.stat()
    return {
        "filename": dest.name,
        "size":     st.st_size,
        "uploaded": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
    }


def resolve_file(account_id: str, filename: str) -> Path:
    """Return the on-disk path for a statement, guarding against path traversal."""
    if not get_account(account_id):
        raise KeyError("Account not found")
    folder = _account_dir(account_id).resolve()
    target = (folder / os.path.basename(filename.replace("\\", "/"))).resolve()
    # Ensure the resolved path is inside the account folder
    if folder not in target.parents or target.suffix.lower() != ".pdf":
        raise KeyError("File not found")
    if not target.is_file():
        raise KeyError("File not found")
    return target


def delete_file(account_id: str, filename: str) -> None:
    target = resolve_file(account_id, filename)
    target.unlink()
