import { api }  from "../api.js";
import { gbp, showLoading, toast } from "../app.js";
import { makeSortable } from "../tableSort.js";
import { colHeader }       from "../columns.js";
import { isoLocal, parseIso, fmtIso, fyStartYear } from "../dates.js";

import {
  buildIncomeExpenseBar,
  buildNetBars,
  buildIncomeStacked,
} from "../charts.js";

const INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"];
const EXPENSE_SOURCES = ["Amazon", "eBay", "AliExpress", "Other Expenses"];
const ALL_COLS = [
  ...INCOME_SOURCES, "Total Income",
  ...EXPENSE_SOURCES, "Total Expenses", "Net",
];

let _startPicker, _endPicker;   // flatpickr instances

// ── Date range presets ─────────────────────────────────────────────────────
// Sixty-odd months in one chart is unreadable, so the page opens on the last
// 12 months; "All time" is one click away and the choice is remembered.
const PRESETS = [
  { id: "12m",    label: "Last 12 months" },
  { id: "fy",     label: "This FY" },
  { id: "lastfy", label: "Last FY" },
  { id: "all",    label: "All time" },
];
const PRESET_KEY = "monthly-range";

function presetRange(id) {
  const today = new Date();
  const fy    = fyStartYear(today);
  switch (id) {
    case "12m":    return [isoLocal(new Date(today.getFullYear(), today.getMonth() - 11, 1)), isoLocal(today)];
    case "fy":     return [isoLocal(new Date(fy, 3, 6)),     isoLocal(today)];
    case "lastfy": return [isoLocal(new Date(fy - 1, 3, 6)), isoLocal(new Date(fy, 3, 5))];
    default:       return [null, null];
  }
}

function savedPreset() {
  try {
    const v = localStorage.getItem(PRESET_KEY);
    if (PRESETS.some(p => p.id === v)) return v;
  } catch (_) {}
  return "12m";
}

function rememberPreset(id) {
  try { localStorage.setItem(PRESET_KEY, id); } catch (_) {}
}

function rangeCaption(start, end) {
  return start && end ? `${fmtIso(start)} – ${fmtIso(end)}` : "Every month on record";
}

function statCards(rows) {
  if (!rows.length) return "";
  const totalIncome  = rows.reduce((s, r) => s + r["Total Income"],  0);
  const totalExpense = rows.reduce((s, r) => s + r["Total Expenses"], 0);
  const net = totalIncome - totalExpense;
  const best  = rows.reduce((a, b) => b["Net"] > a["Net"] ? b : a);
  const worst = rows.reduce((a, b) => b["Net"] < a["Net"] ? b : a);

  return `
    <div class="stat-grid stat-grid-5">
      <div class="stat-card">
        <div class="stat-label">Income</div>
        <div class="stat-value income">${gbp(totalIncome)}</div>
        <div class="stat-meta">across ${rows.length} month${rows.length !== 1 ? "s" : ""}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Expenses</div>
        <div class="stat-value expense">${gbp(totalExpense)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Net</div>
        <div class="stat-value ${net >= 0 ? "positive" : "negative"}">${gbp(net)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Best month</div>
        <div class="stat-value ${best["Net"] >= 0 ? "positive" : "negative"}">${gbp(best["Net"])}</div>
        <div class="stat-meta">${best.period}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Worst month</div>
        <div class="stat-value ${worst["Net"] >= 0 ? "positive" : "negative"}">${gbp(worst["Net"])}</div>
        <div class="stat-meta">${worst.period}</div>
      </div>
    </div>`;
}

function summaryTable(rows) {
  const headerCols = ALL_COLS.map(colHeader).join("");

  const bodyRows = rows.map(row => {
    const cells = ALL_COLS.map(col => {
      const v = row[col] ?? 0;
      let cls = "";
      if (col === "Total Income")        cls = "total-col";
      else if (col === "Total Expenses") cls = "total-expense-col";
      else if (col === "Net")            cls = v >= 0 ? "net-pos" : "net-neg";
      else if (INCOME_SOURCES.includes(col))  cls = v > 0 ? "income-val" : "";
      else if (EXPENSE_SOURCES.includes(col)) cls = v > 0 ? "expense-val" : "";
      // Sort on the raw number: the cell shows "—" for zero and "£1,234.56" otherwise.
      return `<td class="${cls}" data-sort-value="${v}">${v !== 0 ? gbp(v) : "—"}</td>`;
    }).join("");
    return `<tr><td>${row.period}</td>${cells}</tr>`;
  }).join("");

  return `
    <div class="table-card">
      <div class="table-card-header">
        <span class="table-card-title">Monthly breakdown</span>
        <span class="table-card-note">Click a column header to sort</span>
      </div>
      <div class="table-scroll">
        <table class="summary" data-sortable data-sort-id="monthly-summary">
          <thead>
            <tr><th data-type="date">Month</th>${headerCols}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function transactionPanels(transactions) {
  const income   = transactions.filter(t => t.category === "income");
  const expenses = transactions.filter(t => t.category === "expense");

  const totalIncome  = income.reduce((s, t) => s + t.amount_gbp, 0);
  const totalExpense = expenses.reduce((s, t) => s + t.amount_gbp, 0);

  const txnRow = label => items => items.map(t => `
    <tr>
      <td class="txn-date col-date" data-sort-value="${t.date}">${fmtDate(t.date)}</td>
      <td class="txn-source">${label(t)}</td>
      <td class="txn-amount num" data-sort-value="${t.amount_gbp}">${gbp(t.amount_gbp)}</td>
    </tr>`).join("");

  const incomeRows  = txnRow(t => t.source);
  const expenseRows = txnRow(t => t.description || t.source);

  const panel = (title, items, total, cls, rowFn, col2, sortId) => `
    <div class="txn-panel">
      <div class="txn-panel-header ${cls}">
        <span class="txn-panel-title">${title} <span class="txn-panel-count">${items.length}</span></span>
        <span class="txn-panel-total">${gbp(total)}</span>
      </div>
      ${items.length ? `
        <div class="table-scroll" style="max-height:min(56vh,560px)">
          <table class="txn-table" data-sortable data-sort-id="txn-${sortId}">
            <thead><tr>
              <th data-type="date" class="col-date">Date</th>
              <th data-type="text">${col2}</th>
              <th data-type="num" class="num">Amount</th>
            </tr></thead>
            <tbody>${rowFn(items)}</tbody>
          </table>
        </div>` : `<div class="empty-state" style="padding:24px">No transactions</div>`}
    </div>`;

  return `
    <div class="txn-grid">
      ${panel("Income",   income,   totalIncome,  "income",  incomeRows,  "Source", "income")}
      ${panel("Expenses", expenses, totalExpense, "expense", expenseRows, "Item",   "expense")}
    </div>`;
}

async function fetchAndRender(start, end) {
  const chartsEl = document.getElementById("charts-area");
  const statsEl  = document.getElementById("stats-area");
  const tableEl  = document.getElementById("table-area");
  const txnEl    = document.getElementById("txn-area");
  if (!chartsEl) return;

  const caption = document.getElementById("range-caption");
  if (caption) caption.textContent = rangeCaption(start, end);

  // Keep the previous render on screen, dimmed, until the new one is ready —
  // no flash of empty page when switching ranges.
  const areas = [statsEl, chartsEl, tableEl, txnEl];
  areas.forEach(el => el.classList.add("is-refreshing"));

  let data, txnData;
  try {
    [data, txnData] = await Promise.all([
      start && end ? api.rangeSummary(start, end) : api.monthlySummary(),
      api.getTransactions(start, end),
    ]);
  } catch (err) {
    areas.forEach(el => el.classList.remove("is-refreshing"));
    chartsEl.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }
  areas.forEach(el => el.classList.remove("is-refreshing"));

  const { rows } = data;

  if (!rows.length) {
    statsEl.innerHTML = tableEl.innerHTML = txnEl.innerHTML = "";
    chartsEl.innerHTML = `<div class="empty-state">No data for this period.</div>`;
    return;
  }

  statsEl.innerHTML = statCards(rows);

  chartsEl.innerHTML = `
    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-card-title">Income vs expenses</div>
        <div class="chart-canvas-wrap"><canvas id="chart-bar"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Net profit / loss</div>
        <div class="chart-canvas-wrap"><canvas id="chart-net"></canvas></div>
      </div>
      <div class="chart-card chart-card-wide">
        <div class="chart-card-title">Income by source</div>
        <div class="chart-canvas-wrap chart-canvas-tall"><canvas id="chart-stacked"></canvas></div>
      </div>
    </div>`;

  tableEl.innerHTML = summaryTable(rows);
  txnEl.innerHTML   = transactionPanels(txnData.transactions);

  makeSortable(tableEl);
  makeSortable(txnEl);

  buildIncomeExpenseBar(document.getElementById("chart-bar"),     rows);
  buildNetBars         (document.getElementById("chart-net"),     rows);
  buildIncomeStacked   (document.getElementById("chart-stacked"), rows);
}

function rangeBar(active) {
  return `
    <div class="range-bar" id="range-bar">
      <div class="seg" role="group" aria-label="Date range">
        ${PRESETS.map(p => `
          <button class="seg-btn${p.id === active ? " active" : ""}" data-preset="${p.id}"
                  aria-pressed="${p.id === active}">${p.label}</button>`).join("")}
      </div>
      <div class="range-custom">
        <input type="text" id="range-start" placeholder="From" aria-label="From date" readonly />
        <span class="range-separator">→</span>
        <input type="text" id="range-end" placeholder="To" aria-label="To date" readonly />
        <button class="btn btn-secondary btn-sm" id="btn-apply">Apply</button>
      </div>
      <span class="range-caption" id="range-caption"></span>
    </div>`;
}

function setActivePreset(id) {
  document.querySelectorAll("#range-bar .seg-btn").forEach(b => {
    const on = b.dataset.preset === id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function applyPreset(id) {
  rememberPreset(id);
  setActivePreset(id);
  const [s, e] = presetRange(id);
  // Mirror the preset in the custom pickers so tweaking it starts from here.
  _startPicker?.setDate(s ? parseIso(s) : null, false);
  _endPicker?.setDate(e ? parseIso(e) : null, false);
  fetchAndRender(s, e);
}

export async function renderMonthly(container) {
  showLoading();
  const preset = savedPreset();

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Monthly Summary</div>
    </div>

    ${rangeBar(preset)}

    <div id="stats-area"></div>
    <div id="charts-area"><div class="loading-state"><div class="spinner"></div></div></div>
    <div id="table-area"></div>
    <div id="txn-area"></div>
  `;

  // Wire up flatpickr
  _startPicker = flatpickr("#range-start", {
    dateFormat: "d/m/Y",
    allowInput: false,
  });
  _endPicker = flatpickr("#range-end", {
    dateFormat: "d/m/Y",
    allowInput: false,
  });

  document.querySelectorAll("#range-bar .seg-btn").forEach(btn =>
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset))
  );

  document.getElementById("btn-apply").addEventListener("click", () => {
    const s = _startPicker.selectedDates[0];
    const e = _endPicker.selectedDates[0];
    if (!s || !e) { toast("Please select both start and end dates.", "error"); return; }
    if (s > e)    { toast("Start date must be before end date.", "error"); return; }
    setActivePreset(null);   // a custom range matches no preset
    fetchAndRender(isoLocal(s), isoLocal(e));
  });

  applyPreset(preset);
}
