/** Date helpers shared by the pages. Everything works in local time. */

export const MON      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const MON_FULL = ["January","February","March","April","May","June",
                         "July","August","September","October","November","December"];

/** Date → "2026-04-13", in local time. (toISOString() is UTC, so during BST
 *  it turns local midnight into the previous day.) */
export function isoLocal(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-04-13" → a local-midnight Date, or undefined. Hand this to flatpickr's
 *  defaultDate: given a bare ISO string, flatpickr parses it with the picker's
 *  own "d/m/Y" format and lands on the wrong day. */
export function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined;
}

/** "2026-04-13" → "13 Apr 2026" */
export function fmtIso(iso) {
  const d = parseIso(iso);
  return d ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : "";
}

// UK financial year runs 6 Apr → 5 Apr. Label "2023/24" = 6 Apr 2023 – 5 Apr 2024.
export function fyStartYear(d) {
  const y = d.getFullYear();
  return (d.getMonth() < 3 || (d.getMonth() === 3 && d.getDate() < 6)) ? y - 1 : y;
}

export function fyLabelForDate(d) {
  const y = fyStartYear(d);
  return `${y}/${String(y + 1).slice(2)}`;
}

export function fyStart(label) { return new Date(+label.split("/")[0], 3, 6); }
export function fyEnd(label)   { return new Date(+label.split("/")[0] + 1, 3, 5); }
