/**
 * Editable raw-data sheet view.
 *
 * Clicking any cell converts it to an inline input.
 * Changes are saved on blur or Enter key → PUT /api/data/{id}/{idx}.
 * "Add Row" appends a blank row → POST /api/data/{id}.
 * Delete button on each row → DELETE /api/data/{id}/{idx}.
 * After any mutation the summary cache is stale; a page navigation will
 * re-fetch automatically since we always call the API on render.
 */
import { api }  from "../api.js";
import { showLoading, toast, gbp, confirmModal } from "../app.js";
import { makeSortable } from "../tableSort.js";
import { fyLabelForDate, fmtIso, parseIso } from "../dates.js";
import { ICON_TRASH, ICON_PLUS, ICON_DOWNLOAD, ICON_SEARCH } from "../icons.js";

const SHEET_LABELS = {
  youtube_adsense: "YouTube AdSense",
  patreon:         "Patreon",
  sponsorships:    "Sponsorships",
  other_income:    "Other Income",
  amazon:          "Amazon",
  ebay:            "eBay",
  aliexpress:      "AliExpress",
  other_expenses:  "Other Expenses",
};

const SHEET_CATEGORY = {
  youtube_adsense: "income",
  patreon:         "income",
  sponsorships:    "income",
  other_income:    "income",
  amazon:          "expense",
  ebay:            "expense",
  aliexpress:      "expense",
  other_expenses:  "expense",
};

// ── State ──────────────────────────────────────────────────────────────────
let _sheetId   = null;
let _container = null;
let _columns   = [];
let _rows      = [];

// ── Helpers ────────────────────────────────────────────────────────────────
// A column holds dates if its name says so, or if every filled value in it
// parses as d/m/y — Patreon's "Received_in_account" and "Withdrow from patrion"
// carry dates without saying "date" anywhere in the name. Amount columns are
// excluded by their currency prefix.
const DMY = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

let _dateCols = new Set();

function computeDateCols(columns, rows) {
  _dateCols = new Set(columns.filter(col => {
    if (/date/i.test(col)) return true;
    let seen = 0;
    for (const row of rows) {
      const v = String(row[col] ?? "").trim();
      if (!v) continue;
      seen++;
      if (!DMY.test(v)) return false;
    }
    return seen > 0;
  }));
}

function isDateCol(col) {
  return _dateCols.has(col) || /date/i.test(col);
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Header text only — the raw name stays the key for every read and write.
// "Received_amount_in_account" → "Received amount in account"
function humanize(col) {
  const s = String(col).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Table rendering ────────────────────────────────────────────────────────

// Column sort mode: dates by name, otherwise numeric only when every filled
// value in the column is a number (so "Amount" sorts 2 < 10, not "10" < "2").
function colSortType(col, rows) {
  if (isDateCol(col)) return "date";
  let seen = 0;
  for (const row of rows) {
    const v = String(row[col] ?? "").trim();
    if (!v) continue;
    seen++;
    if (!/^-?[£$€]?-?[\d,]*\.?\d+%?$/.test(v)) return "text";
  }
  return seen ? "num" : "text";
}

function renderTable(columns, rows, category) {
  computeDateCols(columns, rows);

  const thead = `
    <thead>
      <tr>
        <th class="col-row-no" data-type="num" title="Source row number">#</th>
        ${columns.map(c => {
          const type = colSortType(c, rows);
          const label = humanize(c);
          const title = label === c ? "" : ` title="${escHtml(c)}"`;
          return `<th data-type="${type}" class="${type === "num" ? "num" : ""}"${title}>${escHtml(label)}<div class="col-resize-handle"></div></th>`;
        }).join("")}
        <th class="col-actions" data-nosort><span class="sr-only">Actions</span></th>
      </tr>
    </thead>`;

  const types = Object.fromEntries(columns.map(c => [c, colSortType(c, rows)]));

  // Newest entries first: rows are appended to the CSV as they happen, so the
  // latest ones would otherwise sit at the very bottom. data-row keeps the
  // true source index for edits and deletes.
  const tbody = rows.map((row, idx) => {
    const cells = columns.map(col => {
      const val = row[col] ?? "";
      return `
        <td data-col="${escHtml(col)}" data-row="${idx}" class="${types[col] === "num" ? "num" : ""}">
          <span class="cell-inner">${escHtml(val)}</span>
          <input class="cell-input" type="text" value="${escHtml(val)}" data-original="${escHtml(val)}" />
        </td>`;
    }).join("");

    return `
      <tr data-row="${idx}">
        <td class="col-row-no">${idx + 1}</td>
        ${cells}
        <td class="col-actions">
          <button class="btn-icon danger btn-del" data-row="${idx}" title="Delete row" aria-label="Delete row ${idx + 1}">${ICON_TRASH}</button>
        </td>
      </tr>`;
  }).reverse().join("");

  return `<table class="sheet-table" data-sortable data-sort-id="sheet:${escHtml(_sheetId)}">${thead}<tbody>${tbody}</tbody></table>`;
}

// ── Full re-render ─────────────────────────────────────────────────────────
async function reload() {
  const wrapper = document.getElementById("sheet-table-wrap");
  if (!wrapper) return;
  wrapper.innerHTML = `<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>`;

  let data;
  try {
    data = await api.getSheet(_sheetId);
  } catch (err) {
    wrapper.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }

  const { columns, rows } = data;
  const cat = SHEET_CATEGORY[_sheetId] || "income";
  _columns = columns;
  _rows    = rows;

  wrapper.innerHTML = renderTable(columns, rows, cat);
  wireTable(wrapper, columns, rows);
  applySearch();
  refreshStats();
}

// ── Stats strip ────────────────────────────────────────────────────────────
// Totals come from the same normalised transactions the summaries use, so they
// always agree with the Financial Year and Monthly pages — including which rows
// count (a row with no parseable date or amount is left out there too).
async function refreshStats() {
  const el = document.getElementById("sheet-stats");
  if (!el) return;
  const label = SHEET_LABELS[_sheetId];
  let txns = [];
  try { txns = (await api.getTransactions()).transactions.filter(t => t.source === label); }
  catch (_) { el.innerHTML = ""; return; }

  const cat    = SHEET_CATEGORY[_sheetId] || "income";
  const thisFY = fyLabelForDate(new Date());
  const total  = txns.reduce((s, t) => s + t.amount_gbp, 0);
  const fyTot  = txns.filter(t => fyLabelForDate(parseIso(t.date)) === thisFY)
                     .reduce((s, t) => s + t.amount_gbp, 0);
  const latest = txns.reduce((m, t) => (t.date > m ? t.date : m), "");
  const skipped = _rows.length - txns.length;

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">This financial year</div>
      <div class="stat-value ${cat}">${gbp(fyTot)}</div>
      <div class="stat-meta">FY ${thisFY}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">All time</div>
      <div class="stat-value">${gbp(total)}</div>
      <div class="stat-meta">${txns.length} ${txns.length === 1 ? "entry" : "entries"}${skipped > 0
        ? ` · <span title="Rows without a readable date or amount are left out of every total">${skipped} row${skipped !== 1 ? "s" : ""} not counted</span>` : ""}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Latest entry</div>
      <div class="stat-value stat-value-sm">${latest ? fmtIso(latest) : "—"}</div>
    </div>`;
}

// ── Search ─────────────────────────────────────────────────────────────────
// Hides rows that don't contain the query anywhere; the add-row form stays put.
function applySearch() {
  const q     = (document.getElementById("sheet-search")?.value || "").trim().toLowerCase();
  const tbody = document.querySelector("#sheet-table-wrap .sheet-table tbody");
  const count = document.getElementById("row-count");
  if (!tbody) return;
  let shown = 0, total = 0;
  for (const tr of tbody.rows) {
    if (tr.id === "add-row-form") continue;
    total++;
    const hit = !q || tr.textContent.toLowerCase().includes(q);
    tr.hidden = !hit;
    if (hit) shown++;
  }
  if (count) {
    count.textContent = q
      ? `${shown} of ${total} row${total !== 1 ? "s" : ""}`
      : `${total} row${total !== 1 ? "s" : ""}`;
  }
}

// ── CSV export ─────────────────────────────────────────────────────────────
function exportCsv(sheetId, columns, rows) {
  const escape = val => {
    const s = String(val ?? "");
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.join(","),
    ...rows.map(row => columns.map(col => escape(row[col])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: `${sheetId}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Column resizing ────────────────────────────────────────────────────────
function wireResizeHandles(wrapper) {
  wrapper.querySelectorAll(".col-resize-handle").forEach(handle => {
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      const th = handle.closest("th");
      const startX = e.clientX;
      const startWidth = th.offsetWidth;

      handle.classList.add("resizing");

      function onMouseMove(ev) {
        const newWidth = Math.max(60, startWidth + (ev.clientX - startX));
        th.style.width    = newWidth + "px";
        th.style.minWidth = newWidth + "px";
      }

      function onMouseUp() {
        handle.classList.remove("resizing");
        // The click that follows this drag must not also re-sort the column.
        const table = th.closest("table");
        if (table) {
          table.dataset.resizing = "1";
          setTimeout(() => delete table.dataset.resizing, 0);
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  });
}

// ── Event wiring ───────────────────────────────────────────────────────────
function wireTable(wrapper, columns, rows) {
  wireResizeHandles(wrapper);
  makeSortable(wrapper);

  // Attach flatpickr to date-column cell inputs
  wrapper.querySelectorAll("td[data-col]").forEach(td => {
    if (!isDateCol(td.dataset.col)) return;
    const input = td.querySelector(".cell-input");
    flatpickr(input, {
      dateFormat: "d/m/Y",
      allowInput: false,
      onClose() {
        setTimeout(() => input.blur(), 0);
      },
    });
  });

  // Cell click → activate editing
  wrapper.querySelectorAll("td[data-col]").forEach(td => {
    td.addEventListener("click", () => {
      if (td.classList.contains("editing")) return;
      td.classList.add("editing");
      const input = td.querySelector(".cell-input");
      input.focus();
      input.select();
    });
  });

  // Input blur → save if changed
  wrapper.querySelectorAll("input.cell-input").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { input.value = input.dataset.original; input.blur(); }
      if (e.key === "Tab") {
        e.preventDefault();
        // Move to next cell in row or first cell of next row
        const td      = input.closest("td");
        const allTds  = [...wrapper.querySelectorAll("td[data-col]")]
          .filter(c => !c.closest("tr").hidden);   // skip rows hidden by search
        const cur     = allTds.indexOf(td);
        const next    = allTds[cur + 1];
        input.blur();
        if (next) { next.click(); }
      }
    });

    input.addEventListener("blur", async () => {
      const td     = input.closest("td");
      const col    = td.dataset.col;
      const rowIdx = parseInt(td.dataset.row, 10);
      const newVal = input.value;
      const oldVal = input.dataset.original;

      td.classList.remove("editing");

      if (newVal === oldVal) return;   // no change

      td.classList.add("dirty");
      input.dataset.original = newVal;
      td.querySelector(".cell-inner").textContent = newVal;

      try {
        await api.updateRow(_sheetId, rowIdx, { [col]: newVal });
        td.classList.remove("dirty");
        toast("Saved");
      } catch (err) {
        td.classList.remove("dirty");
        input.value = oldVal;
        input.dataset.original = oldVal;
        td.querySelector(".cell-inner").textContent = oldVal;
        toast(`Save failed: ${err.message}`, "error");
      }
    });
  });

  // Delete buttons
  wrapper.querySelectorAll(".btn-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rowIdx = parseInt(btn.dataset.row, 10);
      if (!(await confirmModal(`Delete row ${rowIdx + 1}? This cannot be undone.`,
            { title: "Delete row", okText: "Delete row" }))) return;
      try {
        await api.deleteRow(_sheetId, rowIdx);
        toast("Row deleted");
        reload();
      } catch (err) {
        toast(`Delete failed: ${err.message}`, "error");
      }
    });
  });
}

// ── Add row modal ──────────────────────────────────────────────────────────
async function addRow(columns) {
  // Build a simple inline form at the top of the table scroll area
  const formId = "add-row-form";
  if (document.getElementById(formId)) return;  // already open

  const fields = columns.map(col => `
    <td class="new-row-cell">
      <input type="text" class="new-row-input" name="${escHtml(col)}"
             placeholder="${isDateCol(col) ? "DD/MM/YYYY" : escHtml(humanize(col))}"
             ${isDateCol(col) ? 'data-datepicker="true"' : ""} />
    </td>`).join("");

  const formRow = document.createElement("tr");
  formRow.id = formId;
  formRow.className = "new-row";
  formRow.setAttribute("data-no-sort", "");   // stays pinned to the top when sorting
  formRow.innerHTML = `
    <td class="col-row-no new-row-tag">New</td>
    ${fields}
    <td class="col-actions new-row-cell">
      <button id="btn-save-new" class="btn btn-primary btn-sm">Save</button>
    </td>`;

  const tbody = document.querySelector(".sheet-table tbody");
  if (!tbody) return;
  tbody.prepend(formRow);

  // Attach flatpickr to date fields in the new row
  formRow.querySelectorAll('input[data-datepicker="true"]').forEach(input => {
    flatpickr(input, { dateFormat: "d/m/Y", allowInput: false });
  });

  // Focus first input
  formRow.querySelector("input")?.focus();

  document.getElementById("btn-save-new").addEventListener("click", async () => {
    const row = {};
    formRow.querySelectorAll("input").forEach(inp => {
      if (inp.name) row[inp.name] = inp.value;
    });

    try {
      await api.addRow(_sheetId, row);
      toast("Row added");
      formRow.remove();
      reload();
    } catch (err) {
      toast(`Could not add row: ${err.message}`, "error");
    }
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function renderSheet(container, sheetId) {
  _sheetId   = sheetId;
  _container = container;

  showLoading();

  let data;
  try {
    data = await api.getSheet(sheetId);
  } catch (err) {
    container.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }

  const { columns, rows } = data;
  const label = SHEET_LABELS[sheetId] || sheetId;
  const cat   = SHEET_CATEGORY[sheetId] || "income";
  _columns = columns;
  _rows    = rows;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">
        ${escHtml(label)}
        <span class="badge ${cat}">${cat === "income" ? "Income" : "Expense"}</span>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="btn-export-csv">${ICON_DOWNLOAD} Export CSV</button>
        <button class="btn btn-primary" id="btn-add-row">${ICON_PLUS} Add row</button>
      </div>
    </div>

    <div class="stat-grid stat-grid-3" id="sheet-stats"></div>

    <div class="table-card">
      <div class="sheet-toolbar">
        <label class="search-box">
          ${ICON_SEARCH}
          <input type="search" id="sheet-search" placeholder="Search ${escHtml(label)}…" autocomplete="off" />
        </label>
        <span id="row-count" class="toolbar-count">${rows.length} rows</span>
        <span class="toolbar-hint">Click a cell to edit · saves on Enter, Tab or click away</span>
      </div>
      <div class="table-scroll" id="sheet-table-wrap">
        ${renderTable(columns, rows, cat)}
      </div>
    </div>`;

  wireTable(
    document.getElementById("sheet-table-wrap"),
    columns,
    rows,
  );
  applySearch();     // sets the row-count label
  refreshStats();

  document.getElementById("sheet-search").addEventListener("input", applySearch);

  document.getElementById("btn-add-row").addEventListener("click", () => {
    addRow(_columns);
  });

  // Reads the module state, not the first render's rows, so an export after
  // edits, adds or deletes includes them.
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    exportCsv(sheetId, _columns, _rows);
  });
}
