/**
 * Chart builders using Chart.js 4.
 * Each function takes a canvas element + data and returns the Chart instance.
 * Destroy any existing chart on the canvas before creating a new one.
 *
 * Colours were checked with a colour-vision-deficiency validator rather than
 * picked by eye:
 *   - money in / out: emerald #059669 vs red #ef4444 (both ≥ 3:1 on white,
 *     still distinct under protan/deutan simulation);
 *   - income sources, stacked in this order, use four categorical hues whose
 *     neighbours stay distinct under the same simulation.
 * Part-to-whole breakdowns are ranked bars in one colour (shareBars) rather
 * than donuts: four similar greens could not be told apart, and bars with
 * printed amounts compare close values far better.
 */
import { gbp } from "./app.js";

const INCOME_SOURCES  = ["YouTube AdSense", "Patreon", "Sponsorships", "Other Income"];

export const MARK = {
  income:  "#059669",
  expense: "#ef4444",
};

// Fixed per source — a source keeps its colour however many are showing.
export const SOURCE_COLORS = {
  "YouTube AdSense": "#2a78d6",
  "Patreon":         "#eb6834",
  "Sponsorships":    "#1baf7a",
  "Other Income":    "#eda100",
};

const INK      = "#0f172a";
const INK_2    = "#475569";
const MUTED    = "#64748b";
const GRID     = "#eef2f6";
const BASELINE = "#cbd5e1";
const SURFACE  = "#ffffff";

// ── Shared look ────────────────────────────────────────────────────────────
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.font.size   = 11;
Chart.defaults.color       = MUTED;
Chart.defaults.animation   = { duration: 350 };

Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: SURFACE,
  titleColor:      INK,
  bodyColor:       INK_2,
  footerColor:     INK,
  borderColor:     "#e2e8f0",
  borderWidth:     1,
  padding:         10,
  cornerRadius:    8,
  boxPadding:      4,
  usePointStyle:   true,
  caretPadding:    6,
});
Chart.defaults.plugins.tooltip.titleFont  = { weight: "600" };
Chart.defaults.plugins.tooltip.footerFont = { weight: "600" };

const LEGEND = {
  position: "top",
  align:    "start",
  labels: {
    color: INK_2, usePointStyle: true, pointStyle: "circle",
    boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 12 },
  },
};

// Axis money: whole pounds, with a true minus on negatives.
const axisMoney = v => {
  const s = "£" + Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return v < 0 ? "−" + s : s;
};

function destroyExisting(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

function baseScales() {
  return {
    x: {
      grid:   { display: false },
      border: { color: BASELINE },
      ticks: {
        // Drop labels rather than let them collide when a long run of months
        // is squeezed into a narrow card.
        autoSkip: true,
        autoSkipPadding: 10,
        maxRotation: 0,
      },
    },
    y: {
      border: { display: false },
      // Hairline grid, with the zero line one step darker so gains and losses
      // read against a clear baseline.
      grid: { color: ctx => (ctx.tick.value === 0 ? BASELINE : GRID) },
      ticks: { maxTicksLimit: 6, callback: axisMoney, padding: 6 },
    },
  };
}

// Hovering anywhere in a period's column shows that period — no pixel-hunting.
const INDEX_HOVER = { mode: "index", intersect: false };

// ── Income vs Expenses grouped bar ────────────────────────────────────────
export function buildIncomeExpenseBar(canvas, rows) {
  destroyExisting(canvas);
  const bar = {
    borderRadius:  4,
    borderSkipped: "start",      // rounded data end, square on the baseline
    maxBarThickness: 24,
    categoryPercentage: 0.72,
    barPercentage: 0.86,         // leaves a small gap between the pair
  };

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map(r => r.period),
      datasets: [
        { ...bar, label: "Income",   data: rows.map(r => r["Total Income"]),   backgroundColor: MARK.income  },
        { ...bar, label: "Expenses", data: rows.map(r => r["Total Expenses"]), backgroundColor: MARK.expense },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: INDEX_HOVER,
      plugins: {
        legend: LEGEND,
        tooltip: {
          callbacks: {
            label:  ctx => ` ${ctx.dataset.label}: ${gbp(ctx.raw)}`,
            footer: items => {
              const [inc, exp] = [items[0]?.raw ?? 0, items[1]?.raw ?? 0];
              return items.length === 2 ? `Net: ${gbp(inc - exp)}` : "";
            },
          },
        },
      },
      scales: baseScales(),
    },
  });
}

// ── Net profit / loss — one bar per period, coloured by sign ───────────────
// Bars rather than a smoothed line: each period is a separate result, and a
// curve through them invents values between periods that never happened.
export function buildNetBars(canvas, rows) {
  destroyExisting(canvas);
  const nets = rows.map(r => r["Net"]);

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map(r => r.period),
      datasets: [{
        label: "Net",
        data:  nets,
        backgroundColor: nets.map(n => (n >= 0 ? MARK.income : MARK.expense)),
        borderRadius:  4,
        borderSkipped: "start",
        maxBarThickness: 24,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: INDEX_HOVER,
      plugins: {
        legend: { display: false },     // one series: the card title names it
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.raw >= 0 ? "Profit" : "Loss"}: ${gbp(ctx.raw)}`,
          },
        },
      },
      scales: baseScales(),
    },
  });
}

// ── Income by source, stacked per period ───────────────────────────────────
// Only the top visible segment of each column gets rounded corners, so the
// column reads as one shape whichever sources are present that month.
function isTopOfStack(ctx) {
  const { chart, dataIndex, datasetIndex } = ctx;
  const sets = chart.data.datasets;
  for (let i = datasetIndex + 1; i < sets.length; i++) {
    if (chart.isDatasetVisible(i) && (sets[i].data[dataIndex] || 0) > 0) return false;
  }
  return true;
}

export function buildIncomeStacked(canvas, rows) {
  destroyExisting(canvas);
  const datasets = INCOME_SOURCES.map(src => ({
    label:           src,
    data:            rows.map(r => r[src] || 0),
    backgroundColor: SOURCE_COLORS[src],
    stack:           "income",
    maxBarThickness: 28,
    borderSkipped:   "start",
    // A 2px surface-coloured top edge is the gap between stacked segments.
    borderColor:     SURFACE,
    borderWidth:     { top: 2 },
    borderRadius:    ctx => (isTopOfStack(ctx) ? { topLeft: 4, topRight: 4 } : 0),
  }));

  return new Chart(canvas, {
    type: "bar",
    data: { labels: rows.map(r => r.period), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: INDEX_HOVER,
      plugins: {
        legend: LEGEND,
        tooltip: {
          filter: item => item.raw > 0,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,   // same order as the stack
          callbacks: {
            label:  ctx => ` ${ctx.dataset.label}: ${gbp(ctx.raw)}`,
            footer: items => `Total: ${gbp(items.reduce((s, i) => s + i.raw, 0))}`,
          },
        },
      },
      scales: {
        ...baseScales(),
        x: { ...baseScales().x, stacked: true },
        y: { ...baseScales().y, stacked: true },
      },
    },
  });
}

// ── Part-to-whole as ranked bars (plain HTML) ──────────────────────────────
// entries: [{ label, value }]. Bars scale to the largest entry; the share of
// the total is printed beside each amount. tone: "income" | "expense".
export function shareBars(entries, tone) {
  const items = entries.filter(e => e.value > 0).sort((a, b) => b.value - a.value);
  if (!items.length) return `<div class="share-empty">Nothing recorded yet.</div>`;
  const total = items.reduce((s, e) => s + e.value, 0);
  const max   = items[0].value;
  return `
    <div class="share-bars">
      ${items.map(e => {
        const pct = (e.value / total) * 100;
        return `
          <div class="share-row">
            <div class="share-head">
              <span class="share-label">${e.label}</span>
              <span class="share-value">${gbp(e.value)}</span>
              <span class="share-pct">${pct < 1 ? "<1" : Math.round(pct)}%</span>
            </div>
            <div class="share-track"><div class="share-fill ${tone}" style="width:${Math.max(1, (e.value / max) * 100)}%"></div></div>
          </div>`;
      }).join("")}
    </div>`;
}
