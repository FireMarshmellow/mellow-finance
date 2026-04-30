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
import { showLoading, toast } from "../app.js";

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

// ── Helpers ────────────────────────────────────────────────────────────────
function isDateCol(col) {
  return /date/i.test(col);
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Table rendering ────────────────────────────────────────────────────────
function renderTable(columns, rows, category) {
  const thead = `
    <thead>
      <tr>
        <th style="width:44px;text-align:center">#</th>
        ${columns.map(c => `<th>${escHtml(c)}<div class="col-resize-handle"></div></th>`).join("")}
        <th class="col-actions">✕</th>
      </tr>
    </thead>`;

  const tbody = rows.map((row, idx) => {
    const cells = columns.map(col => {
      const val = row[col] ?? "";
      return `
        <td data-col="${escHtml(col)}" data-row="${idx}">
          <span class="cell-inner">${escHtml(val)}</span>
          <input class="cell-input" type="text" value="${escHtml(val)}" data-original="${escHtml(val)}" />
        </td>`;
    }).join("");

    return `
      <tr data-row="${idx}">
        <td style="text-align:center;color:var(--text-faint);font-size:11px;padding:8px 6px">${idx + 1}</td>
        ${cells}
        <td class="col-actions">
          <button class="btn-del" data-row="${idx}" title="Delete row">✕</button>
        </td>
      </tr>`;
  }).join("");

  return `<table class="sheet-table">${thead}<tbody>${tbody}</tbody></table>`;
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

  // Update row count badge
  const badge = document.getElementById("row-count");
  if (badge) badge.textContent = `${rows.length} row${rows.length !== 1 ? "s" : ""}`;

  wrapper.innerHTML = renderTable(columns, rows, cat);
  wireTable(wrapper, columns, rows);
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
        const allTds  = [...wrapper.querySelectorAll("td[data-col]")];
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
      if (!confirm(`Delete row ${rowIdx + 1}? This cannot be undone.`)) return;
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
    <td>
      <input type="text" name="${escHtml(col)}"
             placeholder="${isDateCol(col) ? "DD/MM/YYYY" : escHtml(col)}"
             ${isDateCol(col) ? 'data-datepicker="true"' : ""}
             style="width:100%;padding:6px 10px;border:1px solid var(--accent);border-radius:4px;
                    font-size:12px;font-family:inherit;background:#f0f9ff;outline:none;" />
    </td>`).join("");

  const formRow = document.createElement("tr");
  formRow.id = formId;
  formRow.style.background = "#f0fdf4";
  formRow.innerHTML = `
    <td style="text-align:center;font-size:11px;color:var(--income);padding:8px 6px">NEW</td>
    ${fields}
    <td style="text-align:center;padding:4px 6px;">
      <button id="btn-save-new" class="btn btn-primary" style="padding:5px 10px;font-size:12px">Save</button>
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

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${escHtml(label)}</div>
        <div class="page-subtitle">Raw data — click any cell to edit, use Tab to move between cells</div>
      </div>
    </div>

    <div class="table-card">
      <div class="sheet-toolbar">
        <span class="badge ${cat}">${cat}</span>
        <span id="row-count" style="font-size:12px;color:var(--text-muted)">${rows.length} rows</span>
        <button class="btn btn-primary" id="btn-add-row">＋ Add Row</button>
        <button class="btn btn-secondary" id="btn-export-csv">↓ Export CSV</button>
        <span style="margin-left:auto;font-size:11px;color:var(--text-faint)">
          Changes auto-save on Tab / Enter / click away
        </span>
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

  document.getElementById("btn-add-row").addEventListener("click", () => {
    addRow(columns);
  });

  document.getElementById("btn-export-csv").addEventListener("click", () => {
    exportCsv(sheetId, columns, rows);
  });
}
