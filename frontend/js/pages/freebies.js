/**
 * Free Stuff tracker — items / benefits received for free.
 *
 * Lists rows from /api/freebies, with an add/edit modal and per-row delete.
 * CSV columns: Date, Provider, Category, Item or Benefit Received,
 *              Quantity / Specifications, Value (£).
 */
import { api }                    from "../api.js";
import { showLoading, toast, gbp } from "../app.js";

let _items     = [];
let _providers = [];
let _categories = [];

// ── entry point ───────────────────────────────────────────────────────────────

export async function renderFreebies(container) {
  showLoading();

  try {
    const [items, opts] = await Promise.all([
      api.freebieList(),
      api.freebieOptions(),
    ]);
    _items      = items;
    _providers  = opts.providers  || [];
    _categories = opts.categories || [];
  } catch (err) {
    container.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }

  container.innerHTML = buildPage();
  wireEvents(container);
}

// ── sorting ─────────────────────────────────────────────────────────────────────

// Column definitions: key = data field, label = header text, type = compare mode.
const COLS = [
  { key: "date",     label: "Date",            type: "date" },
  { key: "provider", label: "Provider",        type: "text" },
  { key: "category", label: "Category",        type: "text" },
  { key: "item",     label: "Item or Benefit", type: "text" },
  { key: "specs",    label: "Quantity / Specs", type: "text" },
  { key: "value",    label: "Value",           type: "num", align: "right" },
];

// Current sort: newest date first by default.
let _sort = { key: "date", dir: "desc" };

function colType(key) {
  return COLS.find(c => c.key === key)?.type || "text";
}

function displayItems() {
  const { key, dir } = _sort;
  const type = colType(key);
  const mul  = dir === "asc" ? 1 : -1;

  return [..._items].sort((a, b) => {
    let cmp;
    if (type === "num") {
      cmp = (a.value || 0) - (b.value || 0);
    } else if (type === "date") {
      cmp = (a.date_iso || "0000-00-00").localeCompare(b.date_iso || "0000-00-00");
    } else {
      cmp = String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { sensitivity: "base" });
    }
    return cmp * mul;
  });
}

function setSort(key) {
  if (_sort.key === key) {
    _sort.dir = _sort.dir === "asc" ? "desc" : "asc";
  } else {
    // Dates and values feel natural starting high→low; text starts A→Z.
    _sort = { key, dir: colType(key) === "text" ? "asc" : "desc" };
  }
  rerenderTable();
}

function sortArrow(key) {
  if (_sort.key !== key) return `<span class="fs-sort-arrow">↕</span>`;
  return `<span class="fs-sort-arrow active">${_sort.dir === "asc" ? "↑" : "↓"}</span>`;
}

// Format "2026-04-13" → "13 Apr 2026"
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1] || "";
  return `${+d} ${mon} ${y}`;
}

// ── page skeleton ─────────────────────────────────────────────────────────────

function buildPage() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">In-Kind Contributions</div>
        <div class="page-subtitle">Products &amp; benefits received free of charge</div>
      </div>
    </div>

    <div class="stat-grid stat-grid-3" style="margin-bottom:24px;">
      <div class="stat-card">
        <div class="stat-label">Total Items</div>
        <div class="stat-value" id="fs-stat-count">${_items.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Value</div>
        <div class="stat-value" id="fs-stat-total">${gbp(totalValue())}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Value This Year</div>
        <div class="stat-value" id="fs-stat-year">${gbp(yearValue())}</div>
      </div>
    </div>

    <div class="table-card">
      <div class="sheet-toolbar">
        <span id="fs-row-count" style="font-size:12px;color:var(--text-muted)">${_items.length} item${_items.length !== 1 ? "s" : ""}</span>
        <button class="btn btn-primary" id="fs-btn-add">＋ Add Item</button>
      </div>
      <div class="table-scroll" id="fs-table-wrap">
        ${renderTable()}
      </div>
    </div>

    ${renderModal()}
    ${renderDatalists()}
  `;
}

function totalValue() {
  return _items.reduce((s, it) => s + (it.value || 0), 0);
}

function yearValue() {
  const yr = String(new Date().getFullYear());
  return _items
    .filter(it => (it.date_iso || "").startsWith(yr))
    .reduce((s, it) => s + (it.value || 0), 0);
}

// ── table rendering ────────────────────────────────────────────────────────────

function renderTable() {
  if (!_items.length) {
    return `<div class="empty-state" style="padding:40px 0">No items yet. Click “＋ Add Item” to log something you received for free.</div>`;
  }

  const rows = displayItems().map(it => `
    <tr data-row="${it.row_index}">
      <td style="white-space:nowrap">${esc(fmtDate(it.date_iso)) || esc(it.date) || "—"}</td>
      <td>${esc(it.provider) || "—"}</td>
      <td>${it.category ? `<span class="fs-badge">${esc(it.category)}</span>` : "—"}</td>
      <td>${esc(it.item) || "—"}</td>
      <td class="fs-specs" title="${esc(it.specs)}">${esc(it.specs) || "—"}</td>
      <td style="white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums">${gbp(it.value)}</td>
      <td class="col-actions" style="white-space:nowrap">
        <button class="btn-icon fs-edit" data-row="${it.row_index}" title="Edit">✎</button>
        <button class="btn-icon fs-delete danger" data-row="${it.row_index}" title="Remove">✕</button>
      </td>
    </tr>`).join("");

  return `
    <table class="sheet-table">
      <thead>
        <tr>
          ${COLS.map(c => `
            <th class="fs-sortable${_sort.key === c.key ? " sorted" : ""}" data-sort="${c.key}"
                style="cursor:pointer;${c.align === "right" ? "text-align:right" : ""}">
              ${esc(c.label)} ${sortArrow(c.key)}
            </th>`).join("")}
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── datalists for provider / category autocomplete ──────────────────────────────

function renderDatalists() {
  const opts = arr => arr.map(v => `<option value="${esc(v)}"></option>`).join("");
  return `
    <datalist id="fs-provider-list">${opts(_providers)}</datalist>
    <datalist id="fs-category-list">${opts(_categories)}</datalist>
  `;
}

// ── modal ───────────────────────────────────────────────────────────────────────

function renderModal() {
  return `
    <div id="fs-modal-overlay" class="modal-overlay" style="display:none">
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title" id="fs-modal-title">Add Item</div>
          <button class="modal-close" id="fs-modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label>Date <span style="font-weight:400;color:var(--text-faint)">(DD/MM/YYYY)</span></label>
            <input type="text" id="fs-date" placeholder="e.g. 13/04/2026" maxlength="10" />
          </div>
          <div class="modal-field">
            <label>Provider</label>
            <input type="text" id="fs-provider" list="fs-provider-list" placeholder="e.g. DFRobot" />
          </div>
          <div class="modal-field">
            <label>Category</label>
            <input type="text" id="fs-category" list="fs-category-list" placeholder="e.g. Product sponsorship" />
          </div>
          <div class="modal-field">
            <label>Item or Benefit Received</label>
            <input type="text" id="fs-item" placeholder="What did you receive?" />
          </div>
          <div class="modal-field">
            <label>Quantity / Specifications</label>
            <textarea id="fs-specs" rows="2" placeholder="Models, SKUs, quantities…"></textarea>
          </div>
          <div class="modal-field">
            <label>Value (£)</label>
            <input type="number" id="fs-value" step="0.01" min="0" placeholder="0.00" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="fs-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="fs-modal-save">Save</button>
        </div>
      </div>
    </div>`;
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function itemByRow(idx) {
  return _items.find(it => it.row_index === idx);
}

function _extractError(err) {
  const match = err.message.match(/→ \d+: ([\s\S]+)$/);
  if (match) {
    try { return JSON.parse(match[1])?.detail || match[1]; }
    catch (_) { return match[1]; }
  }
  return err.message;
}

function refreshStats() {
  const c = document.getElementById("fs-stat-count");
  const t = document.getElementById("fs-stat-total");
  const y = document.getElementById("fs-stat-year");
  const rc = document.getElementById("fs-row-count");
  if (c) c.textContent = _items.length;
  if (t) t.textContent = gbp(totalValue());
  if (y) y.textContent = gbp(yearValue());
  if (rc) rc.textContent = `${_items.length} item${_items.length !== 1 ? "s" : ""}`;
}

function rerenderTable() {
  const wrap = document.getElementById("fs-table-wrap");
  if (wrap) {
    wrap.innerHTML = renderTable();
    wireTableEvents(wrap);
  }
  refreshStats();
}

function refreshDatalists() {
  const pl = document.getElementById("fs-provider-list");
  const cl = document.getElementById("fs-category-list");
  const opts = arr => arr.map(v => `<option value="${esc(v)}"></option>`).join("");
  if (pl) pl.innerHTML = opts(_providers);
  if (cl) cl.innerHTML = opts(_categories);
}

// ── event wiring ──────────────────────────────────────────────────────────────────

function wireEvents(container) {
  container.querySelector("#fs-btn-add").addEventListener("click", () => openModal(null));
  wireTableEvents(container.querySelector("#fs-table-wrap"));
  wireModal(container);
}

function wireTableEvents(wrap) {
  if (!wrap) return;
  wrap.querySelectorAll("th.fs-sortable").forEach(th =>
    th.addEventListener("click", () => setSort(th.dataset.sort))
  );
  wrap.querySelectorAll(".fs-edit").forEach(btn =>
    btn.addEventListener("click", e => openModal(parseInt(e.currentTarget.dataset.row, 10)))
  );
  wrap.querySelectorAll(".fs-delete").forEach(btn =>
    btn.addEventListener("click", e => handleDelete(e))
  );
}

function wireModal(container) {
  container.querySelector("#fs-modal-close").addEventListener("click", closeModal);
  container.querySelector("#fs-modal-cancel").addEventListener("click", closeModal);
  container.querySelector("#fs-modal-overlay").addEventListener("click", e => {
    if (e.target.id === "fs-modal-overlay") closeModal();
  });
  container.querySelector("#fs-modal-save").addEventListener("click", handleSave);
}

// ── modal open / close ──────────────────────────────────────────────────────────

let _editingRow = null;
let _datepicker = null;

function openModal(rowIndex) {
  _editingRow = rowIndex;
  const it = rowIndex == null ? null : itemByRow(rowIndex);

  document.getElementById("fs-modal-title").textContent = it ? "Edit Item" : "Add Item";
  document.getElementById("fs-provider").value = it?.provider ?? "";
  document.getElementById("fs-category").value = it?.category ?? "";
  document.getElementById("fs-item").value     = it?.item ?? "";
  document.getElementById("fs-specs").value    = it?.specs ?? "";
  document.getElementById("fs-value").value    = it && it.value ? it.value : "";

  if (_datepicker) { _datepicker.destroy(); _datepicker = null; }
  const dInput = document.getElementById("fs-date");
  _datepicker = flatpickr(dInput, {
    dateFormat: "d/m/Y",
    defaultDate: it?.date_iso || undefined,
    allowInput: true,
  });
  if (!it) dInput.value = "";

  const overlay = document.getElementById("fs-modal-overlay");
  overlay.style.display = "flex";
  const saveBtn = document.getElementById("fs-modal-save");
  saveBtn.disabled = false;
  saveBtn.textContent = "Save";
}

function closeModal() {
  const overlay = document.getElementById("fs-modal-overlay");
  if (overlay) overlay.style.display = "none";
  if (_datepicker) { _datepicker.destroy(); _datepicker = null; }
  _editingRow = null;
}

// ── save / delete ─────────────────────────────────────────────────────────────────

async function handleSave() {
  const saveBtn = document.getElementById("fs-modal-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  const body = {
    date:     document.getElementById("fs-date").value.trim(),
    provider: document.getElementById("fs-provider").value.trim(),
    category: document.getElementById("fs-category").value.trim(),
    item:     document.getElementById("fs-item").value.trim(),
    specs:    document.getElementById("fs-specs").value.trim(),
    value:    document.getElementById("fs-value").value.trim(),
  };

  if (!body.item && !body.provider) {
    toast("Add at least a provider or item", "error");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
    return;
  }

  try {
    let saved;
    if (_editingRow == null) {
      saved = await api.freebieAdd(body);
      _items.push(saved);
    } else {
      saved = await api.freebieUpdate(_editingRow, body);
      const i = _items.findIndex(it => it.row_index === _editingRow);
      if (i !== -1) _items[i] = saved;
    }
    learnOption(_providers, saved.provider);
    learnOption(_categories, saved.category);
    refreshDatalists();

    closeModal();
    rerenderTable();
    toast("Saved");
  } catch (err) {
    toast(_extractError(err), "error");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}

function learnOption(arr, val) {
  if (val && !arr.includes(val)) {
    arr.push(val);
    arr.sort();
  }
}

async function handleDelete(e) {
  const btn = e.currentTarget;
  const row = parseInt(btn.dataset.row, 10);
  const it  = itemByRow(row);
  if (!confirm(`Remove "${it?.item || it?.provider || "this item"}"?`)) return;

  btn.disabled = true;
  try {
    await api.freebieDelete(row);
    // Row indices shift after a delete — reload from server to stay in sync.
    _items = await api.freebieList();
    rerenderTable();
    toast("Item removed");
  } catch (err) {
    toast(_extractError(err), "error");
    btn.disabled = false;
  }
}
