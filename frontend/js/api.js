/** Thin fetch wrapper — all API calls go through here. */

const BASE = "";   // same origin; FastAPI serves both

async function _req(method, path, body) {
  const opts = {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body:    body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // Summaries
  yearlySummary:  ()              => _req("GET",    "/api/summary/yearly"),
  monthlySummary: ()              => _req("GET",    "/api/summary/monthly"),
  rangeSummary:   (start, end)    => _req("GET",    `/api/summary/range?start=${start}&end=${end}`),

  // Individual transactions
  getTransactions: (start, end) => {
    const q = start && end ? `?start=${start}&end=${end}` : "";
    return _req("GET", `/api/summary/transactions${q}`);
  },

  // Raw sheet data
  getSheet:   (id)           => _req("GET",    `/api/data/${id}`),
  addRow:     (id, row)      => _req("POST",   `/api/data/${id}`, row),
  updateRow:  (id, idx, row) => _req("PUT",    `/api/data/${id}/${idx}`, row),
  deleteRow:  (id, idx)      => _req("DELETE", `/api/data/${id}/${idx}`),

  // Metadata
  meta: () => _req("GET", "/api/meta"),
};
