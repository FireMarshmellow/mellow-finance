import { api }  from "../api.js";
import { gbp, showLoading } from "../app.js";
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
          <thead>
            <tr>
              <th>Period</th>${headerCols}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
}

export async function renderYearly(container) {
  showLoading();

  const { rows } = await api.yearlySummary();

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">No data found. Check your CSV files.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Financial Year Summary</div>
        <div class="page-subtitle">All income and expenses grouped by UK financial year</div>
      </div>
    </div>

    ${statCards(rows)}

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

    ${summaryTable(rows)}
  `;

  buildIncomeExpenseBar(document.getElementById("chart-bar"),        rows);
  buildNetTrend        (document.getElementById("chart-net"),        rows);
  buildSourcePie       (document.getElementById("chart-income-pie"), rows);
  buildExpensePie      (document.getElementById("chart-expense-pie"), rows);
}
