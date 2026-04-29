/**
 * Chart builders using Chart.js 4.
 * Each function takes a canvas element + data and returns the Chart instance.
 * Destroy any existing chart on the canvas before creating a new one.
 */

const INCOME_COLORS = [
  "#10b981", "#34d399", "#6ee7b7", "#a7f3d0",
];
const EXPENSE_COLORS = [
  "#ef4444", "#f87171", "#fca5a5", "#fecaca",
];
const INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"];
const EXPENSE_SOURCES = ["Amazon", "eBay", "AliExpress", "Other Expenses"];

function destroyExisting(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

const AXIS_COLOR = "#94a3b8";
const GRID_COLOR = "rgba(148,163,184,.15)";

function baseScales() {
  return {
    x: {
      ticks: { color: AXIS_COLOR, font: { size: 11 } },
      grid:  { color: GRID_COLOR },
    },
    y: {
      ticks: {
        color: AXIS_COLOR, font: { size: 11 },
        callback: v => "£" + Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 }),
      },
      grid: { color: GRID_COLOR },
    },
  };
}

// ── Income vs Expenses grouped bar ────────────────────────────────────────
export function buildIncomeExpenseBar(canvas, rows) {
  destroyExisting(canvas);
  const labels   = rows.map(r => r.period);
  const incomes  = rows.map(r => r["Total Income"]);
  const expenses = rows.map(r => r["Total Expenses"]);

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label:           "Total Income",
          data:            incomes,
          backgroundColor: "#10b981",
          borderRadius:    4,
          borderSkipped:   false,
        },
        {
          label:           "Total Expenses",
          data:            expenses,
          backgroundColor: "#ef4444",
          borderRadius:    4,
          borderSkipped:   false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { color: AXIS_COLOR, font: { size: 12 }, boxWidth: 14, padding: 16 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: £${Number(ctx.raw).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: baseScales(),
    },
  });
}

// ── Net trend line ─────────────────────────────────────────────────────────
export function buildNetTrend(canvas, rows) {
  destroyExisting(canvas);
  const labels = rows.map(r => r.period);
  const nets   = rows.map(r => r["Net"]);

  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Net",
        data:  nets,
        borderColor:     "#38bdf8",
        backgroundColor: "rgba(56,189,248,.1)",
        tension:         0.35,
        fill:            true,
        pointRadius:     4,
        pointBackgroundColor: nets.map(n => n >= 0 ? "#10b981" : "#ef4444"),
        pointBorderColor:     "transparent",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Net: £${Number(ctx.raw).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: baseScales(),
    },
  });
}

// ── Income source breakdown donut ──────────────────────────────────────────
export function buildSourcePie(canvas, rows) {
  destroyExisting(canvas);
  const totals = {};
  for (const src of INCOME_SOURCES) {
    totals[src] = rows.reduce((s, r) => s + (r[src] || 0), 0);
  }
  const filtered = INCOME_SOURCES.filter(s => totals[s] > 0);

  return new Chart(canvas, {
    type: "doughnut",
    data: {
      labels:   filtered,
      datasets: [{
        data:            filtered.map(s => totals[s]),
        backgroundColor: INCOME_COLORS.slice(0, filtered.length),
        borderWidth:     2,
        borderColor:     "#ffffff",
        hoverOffset:     8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: AXIS_COLOR, font: { size: 12 }, boxWidth: 14, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: £${Number(ctx.raw).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
          },
        },
      },
    },
  });
}

// ── Expense breakdown donut ────────────────────────────────────────────────
export function buildExpensePie(canvas, rows) {
  destroyExisting(canvas);
  const totals = {};
  for (const src of EXPENSE_SOURCES) {
    totals[src] = rows.reduce((s, r) => s + (r[src] || 0), 0);
  }
  const filtered = EXPENSE_SOURCES.filter(s => totals[s] > 0);

  return new Chart(canvas, {
    type: "doughnut",
    data: {
      labels:   filtered,
      datasets: [{
        data:            filtered.map(s => totals[s]),
        backgroundColor: EXPENSE_COLORS.slice(0, filtered.length),
        borderWidth:     2,
        borderColor:     "#ffffff",
        hoverOffset:     8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: AXIS_COLOR, font: { size: 12 }, boxWidth: 14, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: £${Number(ctx.raw).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
          },
        },
      },
    },
  });
}

// ── Monthly stacked bar ────────────────────────────────────────────────────
export function buildMonthlyStacked(canvas, rows) {
  destroyExisting(canvas);
  const labels = rows.map(r => r.period);

  const incomeDatasets = INCOME_SOURCES.map((src, i) => ({
    label:           src,
    data:            rows.map(r => r[src] || 0),
    backgroundColor: INCOME_COLORS[i],
    stack:           "income",
    borderRadius:    i === INCOME_SOURCES.length - 1 ? { topLeft: 4, topRight: 4 } : 0,
    borderSkipped:   false,
  }));

  const expenseDatasets = EXPENSE_SOURCES.map((src, i) => ({
    label:           src,
    data:            rows.map(r => -(r[src] || 0)),   // negative so bars go down
    backgroundColor: EXPENSE_COLORS[i],
    stack:           "expense",
    borderRadius:    i === 0 ? { bottomLeft: 4, bottomRight: 4 } : 0,
    borderSkipped:   false,
  }));

  const scales = baseScales();
  scales.y.ticks.callback = v =>
    "£" + Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 });

  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [...incomeDatasets, ...expenseDatasets] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { color: AXIS_COLOR, font: { size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: £${Math.abs(ctx.raw).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales,
    },
  });
}
