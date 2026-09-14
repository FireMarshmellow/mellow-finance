/**
 * Shared column sorting for every data table in the app.
 *
 * Call `makeSortable(scopeElement)` after rendering; it finds every
 * `<table data-sortable>` inside and wires each header cell for click-to-sort.
 * Clicking a header cycles: default direction → opposite → back to the order
 * the page rendered in.
 *
 * Markup contract (all optional — the module falls back to inspecting the data):
 *   <table data-sortable data-sort-id="unique-key">
 *     <th data-type="date|num|text">   force a column's compare mode
 *     <th data-nosort>                 header that is not clickable (actions, …)
 *     <td data-sort-value="2026-04-13">exact value to sort on, when the visible
 *                                      text is formatted ("13 Apr 2026", "£1,200.00")
 *     <tr data-no-sort>                row pinned to the top (e.g. an add-row form)
 *
 * `data-sort-id` keeps the chosen sort across re-renders of the same table.
 */

const _state = new Map();   // sortId → { col, dir } | null

// ── value parsing ───────────────────────────────────────────────────────────

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function isBlank(s) {
  return s == null || s === "" || s === "—" || s === "-" || s === "–";
}

// "£1,234.56" → 1234.56 · "(50)" → -50 · anything else → null
function parseNum(s) {
  const t = String(s).replace(/[£$€,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d*\.?\d+%?$/.test(t)) return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

// Handles the date shapes this app renders. Returns ms, or null.
function parseDate(s) {
  const t = String(s).trim();
  let m;

  // 2026-04-13
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)))
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);

  // 13/04/2026 · 13-04-2026 · 13.04.2026
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)))
    return Date.UTC(+m[3], +m[2] - 1, +m[1]);

  // 13 Apr 2026
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(t))) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon != null) return Date.UTC(+m[3], mon, +m[1]);
  }

  // Jan 2026 · January 2026
  if ((m = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(t))) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon != null) return Date.UTC(+m[2], mon, 1);
  }

  return null;
}

function rawValue(td) {
  return (td.dataset.sortValue ?? td.textContent ?? "").trim();
}

// ── column types ────────────────────────────────────────────────────────────

function headerRow(table) {
  const thead = table.tHead;
  return thead && thead.rows.length ? thead.rows[thead.rows.length - 1] : null;
}

// A column is numeric/date only if *every* filled cell parses that way, so one
// stray text value keeps the column sorting alphabetically rather than randomly.
function inferType(table, col) {
  const rows = [...(table.tBodies[0]?.rows || [])].slice(0, 60);
  let seen = 0, nums = 0, dates = 0;

  for (const r of rows) {
    const td = r.cells[col];
    if (!td) continue;
    const raw = rawValue(td);
    if (isBlank(raw)) continue;
    seen++;
    if (parseDate(raw) !== null) dates++;
    if (parseNum(raw)  !== null) nums++;
  }

  if (!seen) return "text";
  if (dates === seen) return "date";
  if (nums  === seen) return "num";
  return "text";
}

function colType(table, col) {
  if (!table._colTypes) table._colTypes = {};
  if (table._colTypes[col]) return table._colTypes[col];
  const th = headerRow(table)?.cells[col];
  const t  = th?.dataset.type || inferType(table, col);
  table._colTypes[col] = t;
  return t;
}

function cellValue(row, col, type) {
  const td = row.cells[col];
  if (!td) return null;
  const raw = rawValue(td);
  if (isBlank(raw)) return null;
  if (type === "num")  return parseNum(raw);
  if (type === "date") return parseDate(raw);
  return raw.toLowerCase();
}

// Dates and amounts read most-useful newest/largest first; text reads A→Z.
function defaultDir(type) {
  return type === "text" ? "asc" : "desc";
}

// ── state ───────────────────────────────────────────────────────────────────

function stateFor(table) {
  const id = table.dataset.sortId;
  return id ? (_state.get(id) ?? null) : (table._sortState ?? null);
}

function setState(table, s) {
  const id = table.dataset.sortId;
  if (!id) { table._sortState = s; return; }
  if (s) _state.set(id, s);
  else   _state.delete(id);
}

// ── apply ───────────────────────────────────────────────────────────────────

function paintHeaders(table, state) {
  const head = headerRow(table);
  if (!head) return;
  [...head.cells].forEach((th, i) => {
    const arrow = th.querySelector(".sort-arrow");
    if (!arrow) return;
    const on = !!state && state.col === i;
    th.classList.toggle("sorted", on);
    th.setAttribute("aria-sort", on ? (state.dir === "asc" ? "ascending" : "descending") : "none");
    arrow.classList.toggle("active", on);
    arrow.textContent = on ? (state.dir === "asc" ? "↑" : "↓") : "↕";
  });
}

function apply(table, state) {
  paintHeaders(table, state);

  const tbody = table.tBodies[0];
  if (!tbody) return;

  const all      = [...tbody.rows];
  const pinned   = all.filter(r => r.hasAttribute("data-no-sort"));
  const sortable = all.filter(r => !r.hasAttribute("data-no-sort"));

  let ordered;
  if (!state) {
    ordered = sortable.slice().sort((a, b) => (+a.dataset.origIndex) - (+b.dataset.origIndex));
  } else {
    const type = colType(table, state.col);
    const mul  = state.dir === "asc" ? 1 : -1;

    ordered = sortable
      .map((r, i) => ({ r, i, v: cellValue(r, state.col, type) }))
      .sort((a, b) => {
        // Empty cells always sink to the bottom, whichever way we're sorting.
        if (a.v === null && b.v === null) return a.i - b.i;
        if (a.v === null) return 1;
        if (b.v === null) return -1;
        const c = type === "text"
          ? a.v.localeCompare(b.v, undefined, { sensitivity: "base", numeric: true })
          : a.v - b.v;
        return (c * mul) || (a.i - b.i);   // stable: ties keep render order
      })
      .map(x => x.r);
  }

  const frag = document.createDocumentFragment();
  pinned.forEach(r => frag.appendChild(r));
  ordered.forEach(r => frag.appendChild(r));
  tbody.appendChild(frag);
}

function cycle(table, col) {
  const cur  = stateFor(table);
  const def  = defaultDir(colType(table, col));
  let next;
  if (!cur || cur.col !== col)   next = { col, dir: def };
  else if (cur.dir === def)      next = { col, dir: def === "asc" ? "desc" : "asc" };
  else                           next = null;   // third click → back to render order
  setState(table, next);
  apply(table, next);
}

// ── init ────────────────────────────────────────────────────────────────────

function initTable(table) {
  if (!headerRow(table) || !table.tBodies[0]) return;

  // Wiring the same table element twice would stack duplicate click handlers,
  // making every click cycle the sort two steps at once.
  if (table.dataset.sortReady) { apply(table, stateFor(table)); return; }
  table.dataset.sortReady = "1";

  // Remember the order the page rendered in — that's the state we cycle back to.
  [...table.tBodies[0].rows].forEach((r, i) => { r.dataset.origIndex = i; });

  [...headerRow(table).cells].forEach((th, i) => {
    if (th.hasAttribute("data-nosort")) return;

    th.classList.add("th-sort");
    th.setAttribute("role", "button");
    th.setAttribute("tabindex", "0");
    if (!th.querySelector(".sort-arrow")) {
      th.insertAdjacentHTML("beforeend", ` <span class="sort-arrow">↕</span>`);
    }

    th.addEventListener("click", e => {
      // Dragging a column-resize handle must not also re-sort the table.
      if (e.target.closest(".col-resize-handle") || table.dataset.resizing) return;
      cycle(table, i);
    });
    th.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycle(table, i); }
    });
  });

  apply(table, stateFor(table));
}

/** Wire every `table[data-sortable]` inside `scope` (or `scope` itself). */
export function makeSortable(scope) {
  if (!scope) return;
  const tables = scope.tagName === "TABLE"
    ? (scope.hasAttribute("data-sortable") ? [scope] : [])
    : [...scope.querySelectorAll("table[data-sortable]")];
  tables.forEach(initTable);
}
