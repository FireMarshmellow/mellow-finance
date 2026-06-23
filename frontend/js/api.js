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

  // Sponsor Tracker
  sponsorList:        ()           => _req("GET",    "/api/sponsors/"),
  sponsorsList:       ()           => _req("GET",    "/api/sponsors/sponsors-list"),
  sponsorAdd:         (body)       => _req("POST",   "/api/sponsors/add", body),
  sponsorUpdate:      (idx, patch) => _req("PATCH",  `/api/sponsors/${idx}`, patch),
  sponsorDelete:      (idx)        => _req("DELETE", `/api/sponsors/${idx}`),
  sponsorRefresh:     (idx)        => _req("POST",   "/api/sponsors/refresh", { row_index: idx }),
  sponsorAutoRefresh: ()           => _req("POST",   "/api/sponsors/auto-refresh"),

  // Freebies (free items received)
  freebieList:    ()           => _req("GET",    "/api/freebies/"),
  freebieOptions: ()           => _req("GET",    "/api/freebies/options"),
  freebieAdd:     (body)       => _req("POST",   "/api/freebies/", body),
  freebieUpdate:  (idx, patch) => _req("PATCH",  `/api/freebies/${idx}`, patch),
  freebieDelete:  (idx)        => _req("DELETE", `/api/freebies/${idx}`),

  // Bank statements
  stmtAccounts:       ()           => _req("GET",    "/api/statements/accounts"),
  stmtAccountAdd:     (name)       => _req("POST",   "/api/statements/accounts", { name }),
  stmtAccountRename:  (id, name)   => _req("PATCH",  `/api/statements/accounts/${id}`, { name }),
  stmtAccountDelete:  (id)         => _req("DELETE", `/api/statements/accounts/${id}`),
  stmtFiles:          (id)         => _req("GET",    `/api/statements/accounts/${id}/files`),
  stmtFileDelete:     (id, name)   => _req("DELETE", `/api/statements/accounts/${id}/files/${encodeURIComponent(name)}`),
  stmtFileUrl:        (id, name, download = false) =>
    `/api/statements/accounts/${id}/files/${encodeURIComponent(name)}${download ? "?download=true" : ""}`,
  stmtUpload: async (id, fileList) => {
    const fd = new FormData();
    for (const f of fileList) fd.append("files", f);
    const res = await fetch(`/api/statements/accounts/${id}/files`, { method: "POST", body: fd });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST upload → ${res.status}: ${text}`);
    }
    return res.json();
  },

  // Settings
  getSettings:  ()      => _req("GET", "/api/settings/"),
  saveSettings: (body)  => _req("PUT", "/api/settings/", body),
};
