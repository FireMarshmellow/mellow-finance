import { api }  from "../api.js";
import { gbp, showLoading, toast } from "../app.js";

import {
  buildIncomeExpenseBar,
  buildNetTrend,
  buildMonthlyStacked,
  buildSourcePie,
} from "../charts.js";

const INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"];
const EXPENSE_SOURCES = ["Amazon", "eBay", "AliExpress", "Other Expenses"];
const ALL_COLS = [
  ...INCOME_SOURCES, "Total Income",
  ...EXPENSE_SOURCES, "Total Expenses", "Net",
];

let _startPicker, _endPicker;   // flatpickr instances

function statCards(rows) {
  if (!rows.length) return "";
  const totalIncome  = rows.reduce((s, r) => s + r["Total Income"],  0);
  const totalExpense = rows.reduce((s, r) => s + r["Total Expenses"], 0);
  const net = totalIncome - totalExpense;
  const best  = rows.reduce((a, b) => b["Net"] > a["Net"] ? b : a);
  const worst = rows.reduce((a, b) => b["Net"] < a["Net"] ? b : a);

  return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Total Income</div>
        <div class="stat-value income">${gbp(totalIncome)}</div>
        <div class="stat-meta">across ${rows.length} month${rows.length !== 1 ? "s" : ""}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Expenses</div>
        <div class="stat-value expense">${gbp(totalExpense)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Net</div>
        <div class="stat-value ${net >= 0 ? "positive" : "negative"}">${gbp(net)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Best Month (Net)</div>
        <div class="stat-value positive">${gbp(best["Net"])}</div>
        <div class="stat-meta">${best.period}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Worst Month (Net)</div>
        <div class="stat-value negative">${gbp(worst["Net"])}</div>
        <div class="stat-meta">${worst.period}</div>
      </div>
    </div>`;
}

function summaryTable(rows) {
  const headerCols = ALL_COLS.map(c => `<th>${c}</th>`).join("");

  const bodyRows = rows.map(row => {
    const cells = ALL_COLS.map(col => {
      const v = row[col] ?? 0;
      let cls = "";
      if (col === "Total Income")        cls = "total-col";
      else if (col === "Total Expenses") cls = "total-expense-col";
      else if (col === "Net")            cls = v >= 0 ? "net-pos" : "net-neg";
      else if (INCOME_SOURCES.includes(col))  cls = v > 0 ? "income-val" : "";
      else if (EXPENSE_SOURCES.includes(col)) cls = v > 0 ? "expense-val" : "";
      return `<td class="${cls}">${v !== 0 ? gbp(v) : "—"}</td>`;
    }).join("");
    return `<tr><td>${row.period}</td>${cells}</tr>`;
  }).join("");

  return `
    <div class="table-card">
      <div class="table-card-header">
        <span class="table-card-title">Monthly Breakdown</span>
      </div>
      <div class="table-scroll">
        <table class="summary">
          <thead>
            <tr><th>Month</th>${headerCols}</tr>
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

  const rows = items => items.map(t => `
    <tr>
      <td class="txn-date">${fmtDate(t.date)}</td>
      <td class="txn-source">${t.source}</td>
      <td class="txn-amount">${gbp(t.amount_gbp)}</td>
    </tr>`).join("");

  const panel = (title, items, total, cls) => `
    <div class="txn-panel">
      <div class="txn-panel-header ${cls}">
        <span class="txn-panel-title">${title}</span>
        <span class="txn-panel-total">${gbp(total)}</span>
      </div>
      ${items.length ? `
        <div class="table-scroll" style="max-height:420px">
          <table class="txn-table">
            <thead><tr><th>Date</th><th>Source</th><th>Amount</th></tr></thead>
            <tbody>${rows(items)}</tbody>
          </table>
        </div>` : `<div class="empty-state" style="padding:24px">No transactions</div>`}
    </div>`;

  return `
    <div class="txn-grid">
      ${panel("Income",   income,   totalIncome,  "income")}
      ${panel("Expenses", expenses, totalExpense, "expense")}
    </div>`;
}

async function fetchAndRender(start, end) {
  const chartsEl = document.getElementById("charts-area");
  const statsEl  = document.getElementById("stats-area");
  const tableEl  = document.getElementById("table-area");
  const txnEl    = document.getElementById("txn-area");
  if (!chartsEl) return;

  chartsEl.innerHTML = `<div class="loading-state" style="padding:40px"><div class="spinner"></div></div>`;
  statsEl.innerHTML  = "";
  tableEl.innerHTML  = "";
  txnEl.innerHTML    = "";

  let data, txnData;
  try {
    [data, txnData] = await Promise.all([
      start && end ? api.rangeSummary(start, end) : api.monthlySummary(),
      api.getTransactions(start, end),
    ]);
  } catch (err) {
    chartsEl.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }

  const { rows } = data;

  if (!rows.length) {
    chartsEl.innerHTML = `<div class="empty-state">No data for this period.</div>`;
    return;
  }

  statsEl.innerHTML = statCards(rows);

  chartsEl.innerHTML = `
    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-card-title">Income vs Expenses by Month</div>
        <div class="chart-canvas-wrap"><canvas id="chart-bar"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Net by Month</div>
        <div class="chart-canvas-wrap"><canvas id="chart-net"></canvas></div>
      </div>
      <div class="chart-card" style="grid-column: 1 / -1;">
        <div class="chart-card-title">Income Sources Stacked by Month</div>
        <div class="chart-canvas-wrap" style="height:280px;"><canvas id="chart-stacked"></canvas></div>
      </div>
    </div>`;

  tableEl.innerHTML = summaryTable(rows);
  txnEl.innerHTML   = transactionPanels(txnData.transactions);

  buildIncomeExpenseBar(document.getElementById("chart-bar"),     rows);
  buildNetTrend        (document.getElementById("chart-net"),     rows);
  buildMonthlyStacked  (document.getElementById("chart-stacked"), rows);
}

function rangeBar() {
  return `
    <div class="range-bar" id="range-bar">
      <label>From</label>
      <input type="text" id="range-start" placeholder="DD/MM/YYYY" readonly />
      <span class="range-separator">→</span>
      <label>To</label>
      <input type="text" id="range-end" placeholder="DD/MM/YYYY" readonly />
      <button class="btn btn-primary" id="btn-apply">Apply</button>
      <button class="btn btn-ghost"   id="btn-reset">Reset</button>
    </div>`;
}

export async function renderMonthly(container) {
  showLoading();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Monthly Summary</div>
        <div class="page-subtitle">Income and expenses by month — filter to any date range</div>
      </div>
    </div>

    ${rangeBar()}

    <div id="stats-area"></div>
    <div id="charts-area"></div>
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

  document.getElementById("btn-apply").addEventListener("click", () => {
    const s = _startPicker.selectedDates[0];
    const e = _endPicker.selectedDates[0];
    if (!s || !e) { toast("Please select both start and end dates.", "error"); return; }
    if (s > e)    { toast("Start date must be before end date.", "error"); return; }
    const fmt = d => d.toISOString().split("T")[0];
    fetchAndRender(fmt(s), fmt(e));
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    _startPicker.clear();
    _endPicker.clear();
    fetchAndRender(null, null);
  });

  // Initial load — all months
  await fetchAndRender(null, null);
}
