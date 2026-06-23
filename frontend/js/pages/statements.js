/**
 * Bank Statements — store & view statement PDFs, organised per account.
 *
 * A collapsible tree: Account → Year → statement PDFs. Each account can have
 * PDFs uploaded, viewed (inline), downloaded, or deleted. No parsing.
 */
import { api }                              from "../api.js";
import { showLoading, toast,
         confirmModal, promptModal }        from "../app.js";

let _root          = null;
let _accounts      = [];
let _filesByAccount = {};      // accountId → files[]
let _expanded      = new Set(); // open keys: "a:<id>", "y:<id>:<year>"

// ── entry point ───────────────────────────────────────────────────────────────

export async function renderStatements(container) {
  _root = container;
  showLoading();
  try {
    _accounts = await api.stmtAccounts();
  } catch (err) {
    container.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }

  // Load every account's statements up front so the tree renders synchronously.
  const entries = await Promise.all(_accounts.map(async a => {
    try { return [a.id, await api.stmtFiles(a.id)]; }
    catch (_) { return [a.id, []]; }
  }));
  _filesByAccount = Object.fromEntries(entries);

  ensureDefaultExpansion();
  container.innerHTML = buildPage();
  wireEvents();
}

// ── helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024)        return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${d.getDate()} ${mon} ${d.getFullYear()}`;
}

const MON_FULL = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

// Pull the statement period out of the filename. Handles DD-MM-YYYY (NatWest et al.)
// and YYYY-MM-DD, with -, _, / or . separators. A date range like
// "11-02-2023-10-03-2023" yields {start, end}; a single date sets both the same.
function stmtPeriod(filename) {
  const name = String(filename || "");
  let dates = [...name.matchAll(/\b(\d{1,2})[-_/.](\d{1,2})[-_/.](\d{4})\b/g)]
    .map(m => new Date(+m[3], +m[2] - 1, +m[1]));
  if (!dates.length) {
    dates = [...name.matchAll(/\b(\d{4})[-_/.](\d{1,2})[-_/.](\d{1,2})\b/g)]
      .map(m => new Date(+m[1], +m[2] - 1, +m[3]));
  }
  dates = dates.filter(d => !isNaN(d)).sort((a, b) => a - b);
  if (!dates.length) return { start: null, end: null };
  return { start: dates[0], end: dates[dates.length - 1] };
}

// The date a statement is filed under (period end), falling back to upload time.
function stmtEnd(f) {
  return stmtPeriod(f.filename).end || new Date(f.uploaded);
}

// "June – July 2023", "December 2024 – January 2025", or "June 2021" for a
// single date.
function fmtPeriod(f) {
  const { start, end } = stmtPeriod(f.filename);
  if (!start && !end) return fmtDate(f.uploaded);
  if (start && end && start.getTime() !== end.getTime()) {
    if (start.getFullYear() === end.getFullYear())
      return `${MON_FULL[start.getMonth()]} – ${MON_FULL[end.getMonth()]} ${end.getFullYear()}`;
    return `${MON_FULL[start.getMonth()]} ${start.getFullYear()} – ${MON_FULL[end.getMonth()]} ${end.getFullYear()}`;
  }
  const d = end || start;
  return `${MON_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

// Group an account's statements by year, newest year and statement first.
function groupByYear(files) {
  const years = new Map();
  for (const f of files) {
    const d = stmtEnd(f);
    const y = isNaN(d) ? 0 : d.getFullYear();
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(f);
  }
  return [...years.keys()].sort((a, b) => b - a).map(y => ({
    year: y,
    files: years.get(y).sort((a, b) => stmtEnd(b) - stmtEnd(a)),
  }));
}

function filesFor(accountId) {
  return _filesByAccount[accountId] || [];
}

function sortAccounts() {
  _accounts.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// On first load, open the first account and its most recent year.
function ensureDefaultExpansion() {
  if (!_accounts.length || _accounts.some(a => _expanded.has(`a:${a.id}`))) return;
  const first = _accounts[0];
  _expanded.add(`a:${first.id}`);
  const groups = groupByYear(filesFor(first.id));
  if (groups.length) _expanded.add(`y:${first.id}:${groups[0].year}`);
}

function _extractError(err) {
  const match = err.message.match(/→ \d+: ([\s\S]+)$/);
  if (match) {
    try { return JSON.parse(match[1])?.detail || match[1]; }
    catch (_) { return match[1]; }
  }
  return err.message;
}

// ── page skeleton ─────────────────────────────────────────────────────────────

function buildPage() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Bank Statements</div>
        <div class="page-subtitle">Upload &amp; organise statement PDFs by account</div>
      </div>
      <button class="btn btn-primary" id="stmt-add-account">＋ Add Account</button>
    </div>

    <div class="table-card">
      <div class="sheet-toolbar">
        <span style="font-size:12px;color:var(--text-muted)">
          ${_accounts.length} account${_accounts.length !== 1 ? "s" : ""}
        </span>
        ${_accounts.length ? `
        <button class="btn btn-secondary btn-sm" id="stmt-expand-all" style="margin-left:auto">Expand all</button>
        <button class="btn btn-secondary btn-sm" id="stmt-collapse-all">Collapse all</button>` : ""}
      </div>
      <div id="stmt-tree-wrap">
        ${renderTree()}
      </div>
    </div>
  `;
}

function renderTree() {
  if (!_accounts.length) {
    return `<div class="empty-state" style="padding:40px 0">
      No accounts yet. Click <strong>＋ Add Account</strong> to create one (e.g. “Business Current”, “Personal Savings”).
    </div>`;
  }
  return `<div class="stmt-tree">${_accounts.map(renderAccountGroup).join("")}</div>`;
}

function renderAccountGroup(acc) {
  const key  = `a:${acc.id}`;
  const open = _expanded.has(key);
  return `
    <div class="stmt-group stmt-account ${open ? "open" : ""}">
      <div class="stmt-group-head" data-key="${key}" role="button" aria-expanded="${open}">
        <span class="stmt-caret">▸</span>
        <span class="stmt-group-label">${esc(acc.name)}</span>
        <span class="stmt-group-count">${acc.file_count}</span>
        <span class="stmt-group-actions">
          <button class="btn-icon stmt-rename" data-id="${acc.id}" title="Rename account">✎</button>
          <button class="btn-icon danger stmt-del-account" data-id="${acc.id}" title="Delete account">✕</button>
        </span>
      </div>
      <div class="stmt-group-body">
        ${open ? renderAccountBody(acc) : ""}
      </div>
    </div>`;
}

function renderAccountBody(acc) {
  const groups = groupByYear(filesFor(acc.id));
  return `
    <label class="stmt-dropzone stmt-dropzone-sm" data-id="${acc.id}">
      <input type="file" class="stmt-file-input" data-id="${acc.id}" accept="application/pdf,.pdf" multiple hidden />
      <div class="stmt-dropzone-text"><strong>Click to upload</strong> or drop PDFs here</div>
      <div class="stmt-dropzone-hint">PDF only · up to 25 MB each</div>
    </label>
    ${groups.length
      ? groups.map(g => renderYearGroup(acc, g)).join("")
      : `<div class="empty-state" style="padding:18px 0">No statements yet.</div>`}
  `;
}

function renderYearGroup(acc, g) {
  const key  = `y:${acc.id}:${g.year}`;
  const open = _expanded.has(key);
  return `
    <div class="stmt-group stmt-year ${open ? "open" : ""}">
      <div class="stmt-group-head" data-key="${key}" role="button" aria-expanded="${open}">
        <span class="stmt-caret">▸</span>
        <span class="stmt-group-label">${g.year}</span>
        <span class="stmt-group-count">${g.files.length}</span>
      </div>
      <div class="stmt-group-body">
        ${open ? g.files.map(f => renderStmtRow(acc, f)).join("") : ""}
      </div>
    </div>`;
}

function renderStmtRow(acc, f) {
  const viewUrl = api.stmtFileUrl(acc.id, f.filename, false);
  const dlUrl   = api.stmtFileUrl(acc.id, f.filename, true);
  return `
    <div class="stmt-row">
      <a class="stmt-row-name" href="${viewUrl}" target="_blank" rel="noopener" title="${esc(f.filename)}">📄 ${esc(fmtPeriod(f))}</a>
      <span class="stmt-row-size">${fmtSize(f.size)}</span>
      <span class="stmt-row-actions">
        <a class="btn-icon" href="${viewUrl}" target="_blank" rel="noopener" title="View">👁</a>
        <a class="btn-icon" href="${dlUrl}" title="Download">↓</a>
        <button class="btn-icon stmt-delete danger" data-id="${acc.id}" data-name="${esc(f.filename)}" title="Delete">✕</button>
      </span>
    </div>`;
}

// ── rerender ────────────────────────────────────────────────────────────────────

// Full rebuild (account list changed): refresh the toolbar count too.
function rerenderAll() {
  if (!_root) return;
  _root.innerHTML = buildPage();
  wireEvents();
}

// Tree-only rebuild (toggles, uploads, file/rename changes).
function rerenderTree() {
  const wrap = document.getElementById("stmt-tree-wrap");
  if (wrap) { wrap.innerHTML = renderTree(); wireTree(); }
}

function toggleKey(key) {
  if (_expanded.has(key)) _expanded.delete(key);
  else _expanded.add(key);
  rerenderTree();
}

function expandAll() {
  for (const acc of _accounts) {
    _expanded.add(`a:${acc.id}`);
    for (const g of groupByYear(filesFor(acc.id))) _expanded.add(`y:${acc.id}:${g.year}`);
  }
}

// ── event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  document.getElementById("stmt-add-account")?.addEventListener("click", handleAddAccount);
  document.getElementById("stmt-expand-all")?.addEventListener("click", () => { expandAll(); rerenderTree(); });
  document.getElementById("stmt-collapse-all")?.addEventListener("click", () => { _expanded.clear(); rerenderTree(); });
  wireTree();
}

function wireTree() {
  const wrap = document.getElementById("stmt-tree-wrap");
  if (!wrap) return;

  wrap.querySelectorAll(".stmt-group-head").forEach(head =>
    head.addEventListener("click", () => toggleKey(head.dataset.key))
  );

  wrap.querySelectorAll(".stmt-rename").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); handleRenameAccount(btn.dataset.id); })
  );
  wrap.querySelectorAll(".stmt-del-account").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); handleDeleteAccount(btn.dataset.id); })
  );
  wrap.querySelectorAll(".stmt-delete").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); handleDeleteFile(btn.dataset.id, btn.dataset.name); })
  );

  wrap.querySelectorAll(".stmt-dropzone").forEach(dz => {
    const id    = dz.dataset.id;
    const input = dz.querySelector(".stmt-file-input");
    if (input) {
      input.addEventListener("change", () => {
        if (input.files.length) handleUpload(id, input.files);
        input.value = "";
      });
    }
    ["dragenter", "dragover"].forEach(ev =>
      dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach(ev =>
      dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); })
    );
    dz.addEventListener("drop", e => {
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.name.toLowerCase().endsWith(".pdf"));
      if (files.length) handleUpload(id, files);
      else toast("Only PDF files are accepted", "error");
    });
  });
}

// ── account actions ─────────────────────────────────────────────────────────────

async function handleAddAccount() {
  const name = ((await promptModal(
    "New account name (e.g. “Business Current”):", "",
    { title: "Add account", okText: "Add" })) || "").trim();
  if (!name) return;
  try {
    const acc = await api.stmtAccountAdd(name);
    if (acc.file_count == null) acc.file_count = 0;
    _accounts.push(acc);
    sortAccounts();
    _filesByAccount[acc.id] = [];
    _expanded.add(`a:${acc.id}`);
    rerenderAll();
    toast(`Account “${acc.name}” added`);
  } catch (err) {
    toast(_extractError(err), "error");
  }
}

async function handleRenameAccount(id) {
  const acc = _accounts.find(a => a.id === id);
  if (!acc) return;
  const name = ((await promptModal(
    "Rename account:", acc.name,
    { title: "Rename account", okText: "Rename" })) || "").trim();
  if (!name || name === acc.name) return;
  try {
    const updated = await api.stmtAccountRename(id, name);
    Object.assign(acc, updated);
    sortAccounts();
    rerenderTree();
    toast("Account renamed");
  } catch (err) {
    toast(_extractError(err), "error");
  }
}

async function handleDeleteAccount(id) {
  const acc = _accounts.find(a => a.id === id);
  if (!acc) return;
  const msg = acc.file_count
    ? `Delete “${acc.name}” and its ${acc.file_count} statement${acc.file_count !== 1 ? "s" : ""}? This cannot be undone.`
    : `Delete account “${acc.name}”?`;
  if (!(await confirmModal(msg, { title: "Delete account", okText: "Delete account" }))) return;
  try {
    await api.stmtAccountDelete(id);
    _accounts = _accounts.filter(a => a.id !== id);
    delete _filesByAccount[id];
    rerenderAll();
    toast("Account deleted");
  } catch (err) {
    toast(_extractError(err), "error");
  }
}

// ── file actions ────────────────────────────────────────────────────────────────

async function handleUpload(id, fileList) {
  const acc = _accounts.find(a => a.id === id);
  toast(`Uploading ${fileList.length} file${fileList.length !== 1 ? "s" : ""}…`);
  try {
    const res = await api.stmtUpload(id, fileList);
    if (acc) acc.file_count += res.saved.length;
    try { _filesByAccount[id] = await api.stmtFiles(id); } catch (_) {}
    _expanded.add(`a:${id}`);
    rerenderTree();
    if (res.saved.length) toast(`Uploaded ${res.saved.length} statement${res.saved.length !== 1 ? "s" : ""}`);
    res.errors.forEach(e => toast(`${e.filename}: ${e.error}`, "error"));
  } catch (err) {
    toast(_extractError(err), "error");
  }
}

async function handleDeleteFile(id, filename) {
  if (!(await confirmModal(`Delete “${filename}”? This cannot be undone.`,
        { title: "Delete statement", okText: "Delete" }))) return;
  try {
    await api.stmtFileDelete(id, filename);
    const acc = _accounts.find(a => a.id === id);
    if (acc && acc.file_count > 0) acc.file_count -= 1;
    try { _filesByAccount[id] = await api.stmtFiles(id); } catch (_) {}
    rerenderTree();
    toast("Statement deleted");
  } catch (err) {
    toast(_extractError(err), "error");
  }
}
