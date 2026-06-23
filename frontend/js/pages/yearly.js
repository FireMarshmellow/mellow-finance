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
import {
  buildIncomeExpenseBar,
  buildNetTrend,
  buildSourcePie,
  buildExpensePie,
} from "../charts.js";

const INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"];
const EXPENSE_SOURCES = ["Amazon", "eBay", "AliExpress", "Other Expenses"];
const ALL_COLS = [
  ...INCOME_SOURCES, "Total Income",
  ...EXPENSE_SOURCES, "Total Expenses", "Net",
];

const MON      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MON_FULL = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

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

// ── helpers ─────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDay(d) {
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtIso(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${+d} ${MON[+m - 1] || ""} ${y}`;
}

// UK financial year runs 6 Apr → 5 Apr. Label "2023/24" = 6 Apr 2023 – 5 Apr 2024.
function fyStart(label) { return new Date(+label.split("/")[0], 3, 6); }
function fyEnd(label)   { return new Date(+label.split("/")[0] + 1, 3, 5); }

function fyLabelForDate(d) {
  let y = d.getFullYear();
  if (d.getMonth() < 3 || (d.getMonth() === 3 && d.getDate() < 6)) y -= 1;
  return `${y}/${String(y + 1).slice(2)}`;
}

function currentFY() { return fyLabelForDate(new Date()); }

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

function statCards(rows) {
  if (!rows.length) return "";

  const latest = rows[rows.length - 1];
  const prev   = rows.length > 1 ? rows[rows.length - 2] : null;

  function delta(key) {
    if (!prev) return "";
    const d = latest[key] - prev[key];
    const sign = d >= 0 ? "+" : "";
    return `<div class="stat-meta">${sign}${gbp(d)} vs ${prev.period}</div>`;
  }

  const netClass = latest["Net"] >= 0 ? "positive" : "negative";
  const totalIncome  = rows.reduce((s, r) => s + r["Total Income"],  0);
  const totalExpense = rows.reduce((s, r) => s + r["Total Expenses"], 0);
  const totalNet     = totalIncome - totalExpense;

  return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Income ${latest.period}</div>
        <div class="stat-value income">${gbp(latest["Total Income"])}</div>
        ${delta("Total Income")}
      </div>
      <div class="stat-card">
        <div class="stat-label">Expenses ${latest.period}</div>
        <div class="stat-value expense">${gbp(latest["Total Expenses"])}</div>
        ${delta("Total Expenses")}
      </div>
      <div class="stat-card">
        <div class="stat-label">Net ${latest.period}</div>
        <div class="stat-value ${netClass}">${gbp(latest["Net"])}</div>
        ${delta("Net")}
      </div>
      <div class="stat-card">
        <div class="stat-label">All-Time Income</div>
        <div class="stat-value income">${gbp(totalIncome)}</div>
        <div class="stat-meta">${rows.length} financial years</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">All-Time Expenses</div>
        <div class="stat-value expense">${gbp(totalExpense)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">All-Time Net</div>
        <div class="stat-value ${totalNet >= 0 ? "positive" : "negative"}">${gbp(totalNet)}</div>
      </div>
    </div>`;
}

function summaryTable(rows) {
  const headerCols = ALL_COLS.map(c => `<th>${c}</th>`).join("");
  const bodyRows = rows.map(row => {
    const cells = ALL_COLS.map(col => {
      const v = row[col] ?? 0;
      let cls = "";
      if (col === "Total Income")   cls = "total-col";
      else if (col === "Total Expenses") cls = "total-expense-col";
      else if (col === "Net")       cls = v >= 0 ? "net-pos" : "net-neg";
      else if (INCOME_SOURCES.includes(col))  cls = v > 0 ? "income-val" : "";
      else if (EXPENSE_SOURCES.includes(col)) cls = v > 0 ? "expense-val" : "";
      return `<td class="${cls}">${v !== 0 ? gbp(v) : "—"}</td>`;
    }).join("");
    return `<tr><td>${row.period}</td>${cells}</tr>`;
  }).join("");

  return `
    <div class="table-card section-gap">
      <div class="table-card-header">
        <span class="table-card-title">Financial Year Summary</span>
        <span style="font-size:11px;color:var(--text-faint)">UK FY: 6 Apr – 5 Apr</span>
      </div>
      <div class="table-scroll">
        <table class="summary">
          <thead><tr><th>Period</th>${headerCols}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderOverview() {
  if (!_rows.length) {
    return `<div class="empty-state" style="padding:40px 0">No transaction data found. Check your CSV files.</div>`;
  }
  return `
    ${statCards(_rows)}
    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-card-title">Income vs Expenses by Year</div>
        <div class="chart-canvas-wrap"><canvas id="chart-bar"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Net Profit / Loss by Year</div>
        <div class="chart-canvas-wrap"><canvas id="chart-net"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Income by Source (all-time)</div>
        <div class="chart-canvas-wrap"><canvas id="chart-income-pie"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Expenses by Category (all-time)</div>
        <div class="chart-canvas-wrap"><canvas id="chart-expense-pie"></canvas></div>
      </div>
    </div>
    ${summaryTable(_rows)}`;
}

function buildOverviewCharts() {
  const bar = document.getElementById("chart-bar");
  if (!bar) return;
  buildIncomeExpenseBar(bar,                                    _rows);
  buildNetTrend        (document.getElementById("chart-net"),        _rows);
  buildSourcePie       (document.getElementById("chart-income-pie"), _rows);
  buildExpensePie      (document.getElementById("chart-expense-pie"), _rows);
}

// ── per-financial-year pack ──────────────────────────────────────────────────────

function fyStatCards(row, inkindTotal) {
  const net = row["Net"];
  return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Total Income</div>
        <div class="stat-value income">${gbp(row["Total Income"])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Expenses</div>
        <div class="stat-value expense">${gbp(row["Total Expenses"])}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Net Profit / Loss</div>
        <div class="stat-value ${net >= 0 ? "positive" : "negative"}">${gbp(net)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">In-Kind Value</div>
        <div class="stat-value">${gbp(inkindTotal)}</div>
        <div class="stat-meta">non-cash · excluded from net</div>
      </div>
    </div>`;
}

function fyBreakdownTable(row) {
  const line = (label, v) =>
    `<tr><td class="fy-indent">${label}</td><td class="fy-num">${v ? gbp(v) : "—"}</td></tr>`;
  return `
    <div class="table-card section-gap">
      <div class="table-card-header"><span class="table-card-title">Income &amp; Expenses</span></div>
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

function fyInKindSection(items, total) {
  const body = items.length
    ? items.map(it => `
        <tr>
          <td style="white-space:nowrap">${esc(fmtIso(it.date_iso)) || esc(it.date) || "—"}</td>
          <td>${esc(it.provider) || "—"}</td>
          <td>${it.category ? `<span class="fs-badge">${esc(it.category)}</span>` : "—"}</td>
          <td>${esc(it.item) || "—"}</td>
          <td class="fs-specs" title="${esc(it.specs)}">${esc(it.specs) || "—"}</td>
          <td class="fy-num">${gbp(it.value)}</td>
        </tr>`).join("")
    : `<tr><td colspan="6"><div class="empty-state" style="padding:22px 0">No in-kind contributions recorded for this year.</div></td></tr>`;
  return `
    <div class="table-card section-gap">
      <div class="table-card-header">
        <span class="table-card-title">In-Kind Contributions</span>
        <span style="font-size:12px;color:var(--text-muted)">${items.length} item${items.length !== 1 ? "s" : ""} · ${gbp(total)}</span>
      </div>
      <div class="table-scroll">
        <table class="sheet-table">
          <thead><tr>
            <th>Date</th><th>Provider</th><th>Category</th>
            <th>Item or Benefit</th><th>Quantity / Specs</th>
            <th style="text-align:right">Value</th>
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
      <a class="stmt-row-name" href="${viewUrl}" target="_blank" rel="noopener" title="${esc(f.filename)}">📄 ${esc(fmtPeriod(f))}</a>
      <span class="stmt-row-actions">
        <a class="btn-icon" href="${viewUrl}" target="_blank" rel="noopener" title="View">👁</a>
        <a class="btn-icon" href="${dlUrl}" title="Download">↓</a>
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
        <span class="table-card-title">Bank Statements</span>
        <span style="font-size:11px;color:var(--text-faint)">Covering ${fyRangeLabel(label)}</span>
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
      <button class="btn btn-secondary no-print" id="fy-print">🖨 Print / Save PDF</button>
    </div>
    ${fyStatCards(row, inkindTotal)}
    ${fyBreakdownTable(row)}
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
        <div class="page-subtitle">Income, expenses, in-kind contributions &amp; statements — ready for your accountant</div>
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

  if (_activeTab === "overview") buildOverviewCharts();
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

  const entries = await Promise.all(_accounts.map(async a => {
    try { return [a.id, await api.stmtFiles(a.id)]; }
    catch (_) { return [a.id, []]; }
  }));
  _filesByAccount = Object.fromEntries(entries);

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
