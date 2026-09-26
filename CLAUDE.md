# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user financial dashboard for Mellow Labs (a YouTube channel business). A FastAPI backend reads and writes CSV files (exported from the old Google Sheets workbook) and serves a no-build vanilla-JS SPA from the same origin. There is no database, no test suite, no linter, and no frontend build step.

## Running

- **Local dev (Windows):** `start.bat`, which runs `py -m uvicorn main:app --reload --host 127.0.0.1 --port 8000` from `backend/`. Open http://localhost:8000.
- **Manual:** `cd backend && pip install -r requirements.txt && uvicorn main:app --reload`. You must run it from `backend/` because imports are top-level (`from config import ...`, `from services.loader import ...`).
- **Docker:** `docker compose up --build`, which mounts `./data` as `/data`.
- **CI:** every push to `main` builds the image and pushes it to `ghcr.io/<repo>` with the tags `latest` and `sha-*` (`.github/workflows/docker-publish.yml`).

## Data location

- All data lives in `DATA_DIR`, which comes from the env var. Without the env var, `backend/config.py` falls back to a hard-coded local Windows path outside the repo.
- CSVs, `data/` and `piinfo.txt` are gitignored. Never commit financial data, and don't bake it into the image.
- `config.py` is the single source of truth for file names (`SHEET_MAP`), sheet labels and income/expense category (`SHEET_META`), and summary column order (`INCOME_SOURCES`, `EXPENSE_SOURCES`, `SUMMARY_COLUMNS`).

Files in `DATA_DIR`:
- The 8 `Mellow_labs_Financials_V5 - *.csv` sheets: 4 income, 4 expense.
- `Sponsor Tracker - Sponserd videos.csv`
- `Free stuff.csv`: seeded from a repo-root `Free stuff.csv` if that file exists.
- `settings.json`: holds `youtube_api_key`, hidden years, and so on.
- `bank_statements/`: `index.json` for accounts, plus one folder of uploaded PDFs per account.

## Backend architecture (`backend/`)

**Raw sheets vs. summaries:**
- Raw sheets are always read with `dtype=str`, `keep_default_na=False` and `utf-8-sig` (`services/loader.py`). This keeps edits lossless: cells round-trip as strings, and the column names are whatever the CSV header says.
- Generic CRUD goes through `routers/data.py`. It addresses rows by **positional index** (`/api/data/{sheet_id}/{row_index}`) and rewrites the whole CSV on each change.
- Summaries follow this pipeline: `load_all()` → `services/normaliser.py` → `services/aggregator.py`.
  - The normaliser maps each sheet's inconsistent column names (for example `Received_amount_in_account`, `Order_Total`, the misspelled `Withdrow_from_patrion`) into canonical rows: `{source, category, transaction_date, amount_gbp, description}`.
  - It uses `_col()` for case-insensitive fallback lookups, and silently skips rows whose date or amount doesn't parse (`↓`, `TBC`, blanks). If a sheet's column is renamed, update the candidate lists here.
  - The aggregator pivots the canonical rows by period. **Yearly means UK financial year, starting 6 April** (label `2023/24`). Monthly uses `"Jan 2024"` labels.
- Nothing is cached; every summary request re-reads every CSV.

**Writes are atomic:** write to a temp file, then `os.replace`. This pattern is in `services/writer.py`, `settings_store.py` and the sponsor/freebie loaders. Keep it when adding new persisted files.

**Feature modules with their own storage:** sponsors, freebies and statements each have a loader/store service with its own schema. For example, `sponsor_loader._REQUIRED_COLS` / `_DEFAULTS` migrate missing columns in on load. Sponsors also call the YouTube Data API v3 (`services/youtube.py`, via httpx), using the API key from settings.

**Route order in `main.py`:** the static frontend is mounted at `/` **last**, so it doesn't shadow `/api/*`. It uses `NoCacheStaticFiles` (`Cache-Control: no-cache`) so ES modules never go stale against each other. Register new routers before that mount.

## Frontend architecture (`frontend/`)

- Plain ES modules with no bundler. Edit a file and reload the page. Chart.js and flatpickr are loaded from the jsDelivr CDN in `index.html`.
- `js/app.js` contains:
  - the hash router (`#/yearly`, `#/monthly`, `#/sheet/<sheet_id>`, `#/sponsor-tracker`, `#/freebies`, `#/statements`, `#/settings`)
  - shared UI helpers: `toast`, `showLoading`, and the `confirmModal`/prompt modals, which are used instead of native `confirm()`/`prompt()` on purpose
  - the collapsible-sidebar logic
- Each page is `js/pages/<name>.js` and exports `render<Name>(container)`. To add a page, add a router branch in `app.js` and a nav item in `index.html`.
- All HTTP goes through `js/api.js`. Add endpoints there rather than calling `fetch` directly.
- `js/columns.js` holds short display labels for summary headers. API column names double as row keys, so change labels only here. Sheet pages humanise raw CSV headers for display only (`humanize()` in `sheet.js`).
- `tableSort.js` and `tableFit.js` are shared table behaviours (sorting, and scroll-edge shadows on wide tables).
- `js/dates.js` holds the shared date helpers, including the UK financial year ones. Two date traps have caused real bugs here:
  - flatpickr's `defaultDate` must be given `parseIso(iso)` (a `Date`), never a bare `"2026-09-23"` string. flatpickr parses strings with the picker's own `d/m/Y` format, so it lands on the wrong day, and saving the dialog writes that wrong date to the CSV.
  - Use `isoLocal(date)`, not `toISOString()`. The latter is UTC, so during BST it shifts local midnight to the previous day.
- `js/icons.js` has the inline SVG icons used in buttons. Don't use emoji or text glyphs as icons.
- Sheet tables render the newest rows first by reversing the CSV order. `data-row` always carries the true source index used for edits and deletes.
- Money colours have two roles, and both are set as tokens in `:root` of `css/style.css`:
  - Marks such as bars and dots use `--income` / `--expense`.
  - Text uses `--income-text` / `--expense-text`, because the bright mark greens fail contrast as text.
- The chart colours in `charts.js` were chosen by checking them with a colour-blindness validator. Keep one fixed colour per income source (`SOURCE_COLORS`). Part-to-whole breakdowns use the plain-HTML `shareBars()` rather than donuts.
