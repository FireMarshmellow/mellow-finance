/**
 * Financial Years — an accountant-ready view.
 *
 * Top tabs: an "Overview" (all-time charts + multi-year table) plus one tab per
 * UK financial year (6 Apr – 5 Apr); the current year is flagged "Ongoing".
 * Each financial-year tab is a self-contained pack: income/expense breakdown,
 * in-kind contributions, and the bank statements that fall in that year
 * (grouped by account → calendar year). Use the Print button to hand it over.
 */
import { api }                 from "../api.js";
import { gbp, showLoading, toast } from "../app.js";
import { makeSortable }         from "../tableSort.js";
import { colHeader }       from "../columns.js";
import {
  buildIncomeExpenseBar,
  buildNetBars,
  shareBars,
} from "../charts.js";
import {
  MON, MON_FULL, isoLocal, fmtIso, fyStart, fyEnd, fyLabelForDate,
} from "../dates.js";
import { ICON_EYE, ICON_DOWNLOAD, ICON_FILE, ICON_PRINT } from "../icons.js";

const INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"];
const EXPENSE_SOURCES = ["Amazon", "eBay", "AliExpress", "Other Expenses"];
const ALL_COLS = [
  ...INCOME_SOURCES, "Total Income",
  ...EXPENSE_SOURCES, "Total Expenses", "Net",
];

// ── module state ────────────────────────────────────────────────────────────────
let _container       = null;
let _rows            = [];     // yearly summary rows (one per FY with transactions)
let _freebies        = [];     // in-kind contributions
let _accounts        = [];     // statement accounts
let _filesByAccount  = {};     // accountId → files[]
let _fyList          = [];     // FY labels, newest first
let _hidden          = new Set(); // FY labels hidden from the report
let _showHidden      = false;  // reveal hidden tabs for restoring
let _activeTab       = null;   // "overview" or an FY label
let _ytdPrev         = null;   // last FY's totals up to today's date a year ago

// ── helpers ─────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDay(d) {
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

function currentFY() { return fyLabelForDate(new Date()); }

function prevFYLabel(label) {
  const y = +label.split("/")[0] - 1;
  return `${y}/${String(y + 1).slice(2)}`;
}

function fyRangeLabel(label) {
  return `${fmtDay(fyStart(label))} – ${fmtDay(fyEnd(label))}`;
}

function filesFor(accountId) { return _filesByAccount[accountId] || []; }

// Pull the statement period out of the filename (DD-MM-YYYY or YYYY-MM-DD, with
// -, _, / or . separators). A date range yields {start, end}; a single date sets both.
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

function stmtEnd(f) { return stmtPeriod(f.filename).end || new Date(f.uploaded); }

function fmtPeriod(f) {
  const { start, end } = stmtPeriod(f.filename);
  if (!start && !end) return fmtIso((f.uploaded || "").slice(0, 10));
  if (start && end && start.getTime() !== end.getTime()) {
    if (start.getFullYear() === end.getFullYear())
      return `${MON_FULL[start.getMonth()]} – ${MON_FULL[end.getMonth()]} ${end.getFullYear()}`;
    return `${MON_FULL[start.getMonth()]} ${start.getFullYear()} – ${MON_FULL[end.getMonth()]} ${end.getFullYear()}`;
  }
  const d = end || start;
  return `${MON_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

// Every FY that has data anywhere, plus the current one — newest first.
function buildFYList() {
  const set = new Set();
  for (const r of _rows) set.add(r.period);
  for (const it of _freebies) if (it.date_iso) set.add(fyLabelForDate(new Date(it.date_iso)));
  for (const acc of _accounts) {
    for (const f of filesFor(acc.id)) {
      const p = stmtPeriod(f.filename);
      if (p.start) set.add(fyLabelForDate(p.start));
      if (p.end)   set.add(fyLabelForDate(p.end));
    }
  }
  set.add(currentFY());
  return [...set].sort((a, b) => +b.split("/")[0] - +a.split("/")[0]);
}

function fyHasData(label) {
  const r = _rows.find(x => x.period === label);
  if (r && (r["Total Income"] || r["Total Expenses"])) return true;
  if (freebiesForFY(label).length) return true;
  return _accounts.some(acc => stmtsForFY(label, filesFor(acc.id)).length);
}

function rowForFY(label) {
  return _rows.find(r => r.period === label) || {
    period: label, "Total Income": 0, "Total Expenses": 0, "Net": 0,
    ...Object.fromEntries([...INCOME_SOURCES, ...EXPENSE_SOURCES].map(s => [s, 0])),
  };
}

function freebiesForFY(label) {
  const s = fyStart(label).getTime(), e = fyEnd(label).getTime();
  return _freebies
    .filter(it => it.date_iso && (() => { const t = new Date(it.date_iso).getTime(); return t >= s && t <= e; })())
    .sort((a, b) => (a.date_iso || "").localeCompare(b.date_iso || ""));
}

// Statements whose period overlaps the financial year (so a Mar–Apr statement
// shows up in both years it touches — the accountant wants full coverage).
function stmtsForFY(label, files) {
  const s = fyStart(label).getTime(), e = fyEnd(label).getTime();
  return files.filter(f => {
    const p  = stmtPeriod(f.filename);
    const ps = (p.start || stmtEnd(f)).getTime();
    const pe = (p.end   || stmtEnd(f)).getTime();
    return ps <= e && pe >= s;
  });
}

function groupByYear(files) {
  const years = new Map();
  for (const f of files) {
    const y = stmtEnd(f).getFullYear();
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(f);
  }
  return [...years.keys()].sort((a, b) => b - a).map(y => ({
    year: y,
    files: years.get(y).sort((a, b) => stmtEnd(b) - stmtEnd(a)),
  }));
}

// ── overview (all-time) ──────────────────────────────────────────────────────────

// ▲/▼ change against a comparison figure. `upIsGood` flips the colour for
// expenses, where going up is the bad direction. Percentages only when both
// figures share a sign — "−£500 → £800" as a percentage means nothing.
function deltaTag(cur, prev, upIsGood = true) {
  if (prev == null) return "";
  const diff = cur - prev;
  if (Math.abs(diff) < 0.005) return `<span class="delta flat">No change</span>`;
  const up   = diff > 0;
  const pct  = prev !== 0 && Math.sign(prev) === Math.sign(cur) ? Math.abs(diff / prev) * 100 : null;
  const size = pct != null ? `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%` : gbp(Math.abs(diff));
  return `<span class="delta ${up === upIsGood ? "good" : "bad"}">${up ? "▲" : "▼"} ${size}</span>`;
}

function statCard(label, value, cls, meta = "") {
  return `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${cls}">${gbp(value)}</div>
      ${meta ? `<div class="stat-meta">${meta}</div>` : ""}
    </div>`;
}

function statCards(rows) {
  if (!rows.length) return "";

  const latest  = rows[rows.length - 1];
  const ongoing = latest.period === currentFY();

  // An unfinished year is compared with last year *at the same point*, not with
  // last year's full total — otherwise every ongoing year looks like a slump.
  let cmp = null, cmpNote = "";
  if (ongoing) {
    if (_ytdPrev) { cmp = _ytdPrev; cmpNote = `vs this point in ${prevFYLabel(latest.period)}`; }
  } else if (rows.length > 1) {
    cmp = rows[rows.length - 2];
    cmpNote = `vs ${cmp.period}`;
  }
  const d = (key, upIsGood) => (cmp ? deltaTag(latest[key], cmp[key], upIsGood) : "");

  const totalIncome  = rows.reduce((s, r) => s + r["Total Income"],  0);
  const totalExpense = rows.reduce((s, r) => s + r["Total Expenses"], 0);
  const totalNet     = totalIncome - totalExpense;
  const sign = v => (v >= 0 ? "positive" : "negative");

  return `
    <div class="stat-groups">
      <section class="stat-group">
        <div class="stat-group-title">
          FY ${latest.period}${ongoing ? " so far" : ""}
          ${cmpNote ? `<span class="stat-group-note">${cmpNote}</span>` : ""}
        </div>
        <div class="stat-grid stat-grid-3">
          ${statCard("Income",   latest["Total Income"],   "income",  d("Total Income", true))}
          ${statCard("Expenses", latest["Total Expenses"], "expense", d("Total Expenses", false))}
          ${statCard("Net",      latest["Net"], sign(latest["Net"]),  d("Net", true))}
        </div>
      </section>
      <section class="stat-group">
        <div class="stat-group-title">
          All time
          <span class="stat-group-note">${rows.length} financial year${rows.length !== 1 ? "s" : ""}</span>
        </div>
        <div class="stat-grid stat-grid-3">
          ${statCard("Income",   totalIncome,  "income")}
          ${statCard("Expenses", totalExpense, "expense")}
          ${statCard("Net",      totalNet, sign(totalNet))}
        </div>
      </section>
    </div>`;
}

// Totals for a set of rows, as { "Total Income", "Total Expenses", Net, …sources }.
function sumRows(rows) {
  const out = {};
  for (const col of ALL_COLS) out[col] = rows.reduce((s, r) => s + (r[col] || 0), 0);
  return out;
}

const sourceEntries = (row, sources) => sources.map(s => ({ label: s, value: row[s] || 0 }));

function summaryTable(rows) {
  const headerCols = ALL_COLS.map(colHeader).join("");
  const bodyRows = rows.map(row => {
    const cells = ALL_COLS.map(col => {
      const v = row[col] ?? 0;
      let cls = "";
      if (col === "Total Income")   cls = "total-col";
      else if (col === "Total Expenses") cls = "total-expense-col";
      else if (col === "Net")       cls = v >= 0 ? "net-pos" : "net-neg";
      else if (INCOME_SOURCES.includes(col))  cls = v > 0 ? "income-val" : "";
      else if (EXPENSE_SOURCES.includes(col)) cls = v > 0 ? "expense-val" : "";
      // Sort on the raw number: the cell shows "—" for zero and "£1,234.56" otherwise.
      return `<td class="${cls}" data-sort-value="${v}">${v !== 0 ? gbp(v) : "—"}</td>`;
    }).join("");
    // "2023/24" sorts by its start year.
    return `<tr><td data-sort-value="${row.period.split("/")[0]}">${row.period}</td>${cells}</tr>`;
  }).join("");

  return `
    <div class="table-card section-gap">
      <div class="table-card-header">
        <span class="table-card-title">Financial year summary</span>
        <span class="table-card-note">UK FY: 6 Apr – 5 Apr · click a header to sort</span>
      </div>
      <div class="table-scroll">
        <table class="summary" data-sortable data-sort-id="yearly-summary">
          <thead><tr><th data-type="num">Period</th>${headerCols}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderOverview() {
  if (!_rows.length) {
    return `<div class="empty-state" style="padding:40px 0">No transaction data found. Check your CSV files.</div>`;
  }
  const all = sumRows(_rows);
  return `
    ${statCards(_rows)}
    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-card-title">Income vs expenses by year</div>
        <div class="chart-canvas-wrap"><canvas id="chart-bar"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Net profit / loss by year</div>
        <div class="chart-canvas-wrap"><canvas id="chart-net"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Income by source <span class="chart-card-note">All time</span></div>
        ${shareBars(sourceEntries(all, INCOME_SOURCES), "income")}
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Spending by category <span class="chart-card-note">All time</span></div>
        ${shareBars(sourceEntries(all, EXPENSE_SOURCES), "expense")}
      </div>
    </div>
    ${summaryTable(_rows)}`;
}

function buildOverviewCharts() {
  const bar = document.getElementById("chart-bar");
  if (!bar) return;
  buildIncomeExpenseBar(bar,                             _rows);
  buildNetBars         (document.getElementById("chart-net"), _rows);
}

// ── per-financial-year pack ──────────────────────────────────────────────────────

function fyStatCards(row, inkindTotal) {
  const net = row["Net"];
  return `
    <div class="stat-grid stat-grid-4">
      ${statCard("Total income",      row["Total Income"],   "income")}
      ${statCard("Total expenses",    row["Total Expenses"], "expense")}
      ${statCard("Net profit / loss", net, net >= 0 ? "positive" : "negative")}
      ${statCard("In-kind value",     inkindTotal, "", "Non-cash · not included in net")}
    </div>`;
}

function fyBreakdownTable(row) {
  const line = (label, v) =>
    `<tr><td class="fy-indent">${label}</td><td class="fy-num">${v ? gbp(v) : "—"}</td></tr>`;
  return `
    <div class="table-card">
      <div class="table-card-header"><span class="table-card-title">Income &amp; expenses</span></div>
      <div class="table-scroll">
        <table class="summary fy-breakdown">
          <tbody>
            <tr class="fy-section"><td>Income</td><td></td></tr>
            ${INCOME_SOURCES.map(s => line(s, row[s])).join("")}
            <tr class="fy-subtotal"><td>Total Income</td><td class="fy-num total-col">${gbp(row["Total Income"])}</td></tr>
            <tr class="fy-section"><td>Expenses</td><td></td></tr>
            ${EXPENSE_SOURCES.map(s => line(s, row[s])).join("")}
            <tr class="fy-subtotal"><td>Total Expenses</td><td class="fy-num total-expense-col">${gbp(row["Total Expenses"])}</td></tr>
            <tr class="fy-net"><td>Net Profit / Loss</td><td class="fy-num ${row["Net"] >= 0 ? "net-pos" : "net-neg"}">${gbp(row["Net"])}</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

// The statement's companion: where the year's money came from and went.
function fyShareCard(row) {
  return `
    <div class="chart-card fy-share">
      <div class="chart-card-title">Income by source</div>
      ${shareBars(sourceEntries(row, INCOME_SOURCES), "income")}
      <div class="chart-card-title fy-share-second">Spending by category</div>
      ${shareBars(sourceEntries(row, EXPENSE_SOURCES), "expense")}
    </div>`;
}

function fyInKindSection(items, total) {
  const body = items.length
    ? items.map(it => `
        <tr>
          <td class="col-date" data-sort-value="${esc(it.date_iso)}">${esc(fmtIso(it.date_iso)) || esc(it.date) || "—"}</td>
          <td>${esc(it.provider) || "—"}</td>
          <td>${it.category ? `<span class="fs-badge">${esc(it.category)}</span>` : "—"}</td>
          <td>${esc(it.item) || "—"}</td>
          <td class="fs-specs" title="${esc(it.specs)}">${esc(it.specs) || "—"}</td>
          <td class="num" data-sort-value="${it.value ?? ""}">${gbp(it.value)}</td>
        </tr>`).join("")
    : `<tr data-no-sort><td colspan="6"><div class="empty-state" style="padding:22px 0">No in-kind contributions recorded for this year.</div></td></tr>`;
  return `
    <div class="table-card section-gap">
      <div class="table-card-header">
        <span class="table-card-title">In-kind contributions</span>
        <span class="table-card-note">${items.length} item${items.length !== 1 ? "s" : ""} · ${gbp(total)}</span>
      </div>
      <div class="table-scroll">
        <table class="sheet-table" data-sortable data-sort-id="fy-inkind">
          <thead><tr>
            <th data-type="date" class="col-date">Date</th>
            <th data-type="text">Provider</th>
            <th data-type="text">Category</th>
            <th data-type="text">Item or Benefit</th>
            <th data-type="text">Quantity / Specs</th>
            <th data-type="num" class="num">Value</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

function renderFyStmtRow(acc, f) {
  const viewUrl = api.stmtFileUrl(acc.id, f.filename, false);
  const dlUrl   = api.stmtFileUrl(acc.id, f.filename, true);
  return `
    <div class="stmt-row fy-stmt-row">
      <a class="stmt-row-name" href="${viewUrl}" target="_blank" rel="noopener" title="${esc(f.filename)}"><span class="stmt-file-icon">${ICON_FILE}</span>${esc(fmtPeriod(f))}</a>
      <span class="stmt-row-actions">
        <a class="btn-icon" href="${viewUrl}" target="_blank" rel="noopener" title="View" aria-label="View">${ICON_EYE}</a>
        <a class="btn-icon" href="${dlUrl}" title="Download" aria-label="Download">${ICON_DOWNLOAD}</a>
      </span>
    </div>`;
}

function fyStatementsSection(label) {
  const blocks = _accounts.map(acc => {
    const files = stmtsForFY(label, filesFor(acc.id));
    if (!files.length) return "";
    return `
      <div class="fy-stmt-account">
        <div class="fy-stmt-account-head">
          <span class="fy-stmt-account-name">${esc(acc.name)}</span>
          <span class="stmt-group-count">${files.length}</span>
        </div>
        ${groupByYear(files).map(g => `
          <div class="fy-stmt-year">
            <div class="fy-stmt-year-label">${g.year}</div>
            ${g.files.map(f => renderFyStmtRow(acc, f)).join("")}
          </div>`).join("")}
      </div>`;
  }).filter(Boolean).join("");

  const inner = blocks ||
    `<div class="empty-state" style="padding:22px 0">No bank statements cover this financial year.</div>`;

  return `
    <div class="table-card section-gap">
      <div class="table-card-header">
        <span class="table-card-title">Bank statements</span>
        <span class="table-card-note">Covering ${fyRangeLabel(label)}</span>
      </div>
      <div class="fy-stmt-wrap">${inner}</div>
    </div>`;
}

function renderFYView(label) {
  const row     = rowForFY(label);
  const ongoing = label === currentFY();
  const inkind  = freebiesForFY(label);
  const inkindTotal = inkind.reduce((s, it) => s + (it.value || 0), 0);

  return `
    <div class="fy-head">
      <div>
        <div class="fy-head-title">
          Financial Year ${label}
          ${ongoing ? `<span class="fy-badge ongoing">Ongoing</span>`
                    : `<span class="fy-badge complete">Complete</span>`}
        </div>
        <div class="fy-head-range">${fyRangeLabel(label)} · UK financial year</div>
      </div>
      <button class="btn btn-secondary no-print" id="fy-print">${ICON_PRINT} Print / Save PDF</button>
    </div>
    ${fyStatCards(row, inkindTotal)}
    <div class="fy-split section-gap">
      ${fyBreakdownTable(row)}
      ${fyShareCard(row)}
    </div>
    ${fyInKindSection(inkind, inkindTotal)}
    ${fyStatementsSection(label)}
  `;
}

// ── tabs + paint ─────────────────────────────────────────────────────────────────

function visibleFYs() {
  return _fyList.filter(fy => !_hidden.has(fy));
}

function renderTabs() {
  const cur = currentFY();
  const tabs = [
    `<div class="fy-tab ${_activeTab === "overview" ? "active" : ""}" data-tab="overview" role="button" tabindex="0">Overview</div>`,
  ];
  for (const fy of visibleFYs()) {
    const ongoing = fy === cur;
    tabs.push(`
      <div class="fy-tab ${_activeTab === fy ? "active" : ""}" data-tab="${fy}" role="button" tabindex="0">
        <span>FY ${fy}</span>
        ${ongoing ? `<span class="fy-tab-ongoing">Ongoing</span>` : ""}
        <button class="fy-tab-icon fy-tab-hide" data-fy="${fy}" title="Hide this year from the report">✕</button>
      </div>`);
  }

  if (_hidden.size) {
    tabs.push(`<button class="fy-hidden-toggle" id="fy-toggle-hidden">${_showHidden ? "Done" : `${_hidden.size} hidden`}</button>`);
    if (_showHidden) {
      const hiddenSorted = [..._hidden].sort((a, b) => +b.split("/")[0] - +a.split("/")[0]);
      for (const fy of hiddenSorted) {
        tabs.push(`
          <div class="fy-tab fy-tab-muted ${_activeTab === fy ? "active" : ""}" data-tab="${fy}" role="button" tabindex="0">
            <span>FY ${fy}</span>
            <button class="fy-tab-icon fy-tab-restore" data-fy="${fy}" title="Restore this year">↩</button>
          </div>`);
      }
    }
  }
  return `<div class="fy-tabs no-print">${tabs.join("")}</div>`;
}

async function persistHidden() {
  try { await api.saveHiddenYears([..._hidden]); }
  catch (err) { toast(`Couldn't save: ${err.message}`, "error"); }
}

function hideYear(fy) {
  _hidden.add(fy);
  if (_activeTab === fy) {
    const vis = visibleFYs();
    _activeTab = vis.find(fyHasData) || vis[0] || "overview";
  }
  persistHidden();
  paint();
  toast(`FY ${fy} hidden`);
}

function restoreYear(fy) {
  _hidden.delete(fy);
  if (!_hidden.size) _showHidden = false;
  persistHidden();
  paint();
}

function renderActive() {
  return _activeTab === "overview" ? renderOverview() : renderFYView(_activeTab);
}

function paint() {
  _container.innerHTML = `
    <div class="page-header no-print">
      <div>
        <div class="page-title">Financial Years</div>
      </div>
    </div>
    ${renderTabs()}
    <div id="fy-content">${renderActive()}</div>`;

  _container.querySelectorAll(".fy-tab").forEach(t =>
    t.addEventListener("click", () => { _activeTab = t.dataset.tab; paint(); })
  );
  _container.querySelectorAll(".fy-tab-hide").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); hideYear(b.dataset.fy); })
  );
  _container.querySelectorAll(".fy-tab-restore").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); restoreYear(b.dataset.fy); })
  );
  document.getElementById("fy-toggle-hidden")?.addEventListener("click", () => { _showHidden = !_showHidden; paint(); });
  document.getElementById("fy-print")?.addEventListener("click", () => window.print());

  makeSortable(_container);

  if (_activeTab === "overview") buildOverviewCharts();
}

// Last FY's totals from its 6 April up to today's date a year ago — what the
// ongoing year is compared against. null when there's nothing to compare.
async function loadYtdComparison() {
  const cur = currentFY();
  if (!_rows.length || _rows[_rows.length - 1].period !== cur) return null;
  const today = new Date();
  const start = fyStart(prevFYLabel(cur));
  const end   = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  try {
    const res = await api.rangeSummary(isoLocal(start), isoLocal(end));
    return res.rows?.length ? sumRows(res.rows) : null;
  } catch (_) {
    return null;
  }
}

// ── entry point ──────────────────────────────────────────────────────────────────

export async function renderYearly(container) {
  _container = container;
  showLoading();

  let summary, hiddenRes;
  try {
    [summary, _freebies, _accounts, hiddenRes] = await Promise.all([
      api.yearlySummary(),
      api.freebieList().catch(() => []),
      api.stmtAccounts().catch(() => []),
      api.hiddenYears().catch(() => ({ hidden: [] })),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }
  _rows     = summary.rows || [];
  _freebies = _freebies || [];
  _accounts = _accounts || [];
  _hidden   = new Set(hiddenRes.hidden || []);

  const [entries, ytdPrev] = await Promise.all([
    Promise.all(_accounts.map(async a => {
      try { return [a.id, await api.stmtFiles(a.id)]; }
      catch (_) { return [a.id, []]; }
    })),
    loadYtdComparison(),
  ]);
  _filesByAccount = Object.fromEntries(entries);
  _ytdPrev = ytdPrev;

  _fyList = buildFYList();
  if (!_activeTab || (_activeTab !== "overview" && !_fyList.includes(_activeTab))) {
    // Prefer the ongoing year, but if it's hidden or has nothing yet, land on
    // the most recent visible year with data so the page opens on something useful.
    const vis = visibleFYs();
    _activeTab = (!_hidden.has(currentFY()) && fyHasData(currentFY()))
      ? currentFY()
      : (vis.find(fyHasData) || vis[0] || "overview");
  }

  paint();
}
