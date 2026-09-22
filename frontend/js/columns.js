/**
 * Display labels for the summary tables.
 *
 * The API's column names double as row keys, so those stay as they are —
 * these are only what the header shows. They are short enough to keep every
 * heading on one line at any width; the full name is on the th's title for
 * hover, since "Other" appears twice and is otherwise told apart only by
 * position and the income / expense colouring.
 */

const SHORT = {
  "YouTube AdSense": "AdSense",
  "Sponsorships":    "Sponsors",
  "Other Income":    "Other",
  "Total Income":    "Income",
  "Other Expenses":  "Other",
  "Total Expenses":  "Expenses",
};

export const colLabel = col => SHORT[col] ?? col;

/** A summary-table <th>: short label visible, full column name on hover. */
export function colHeader(col) {
  const short = colLabel(col);
  const title = short === col ? "" : ` title="${col}"`;
  return `<th data-type="num"${title}>${short}</th>`;
}
