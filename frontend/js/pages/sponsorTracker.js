import { api }                    from "../api.js";
import { showLoading, toast, gbp, confirmModal } from "../app.js";
import { parseIso, fmtIso }       from "../dates.js";
import { ICON_EDIT, ICON_REFRESH, ICON_TRASH, ICON_CHECK, ICON_CLOCK } from "../icons.js";

let _videos      = [];
let _sponsorOpts = [];

// ── entry point ───────────────────────────────────────────────────────────────

export async function renderSponsorTracker(container) {
  showLoading();

  api.sponsorAutoRefresh()
    .then(() => api.sponsorList().then(v => { _videos = sorted(v); rerenderList(); updateStats(); }))
    .catch(() => {});

  try {
    [_videos, _sponsorOpts] = await Promise.all([
      api.sponsorList(),
      api.sponsorsList(),
    ]);
    _videos = sorted(_videos);
  } catch (err) {
    container.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    return;
  }

  container.innerHTML = buildPage();
  wireEvents(container);
}

// ── sorting ───────────────────────────────────────────────────────────────────
// These are cards rather than a table, so the column headers other pages sort by
// become a row of chips — same three-state cycle, same arrows.

const SORT_COLS = [
  { key: "date",    label: "Release Date", type: "date" },
  { key: "title",   label: "Title",        type: "text" },
  { key: "sponsor", label: "Sponsor",      type: "text" },
  { key: "views",   label: "Views",        type: "num"  },
  { key: "payout",  label: "Milestone",    type: "num"  },
  { key: "status",  label: "Status",       type: "num"  },
];

// null = the default order: active tracking first, then newest release date.
let _sort = null;

function sortValue(v, key) {
  switch (key) {
    case "date":    return v.release_date_iso || "";
    case "title":   return String(v.title   || "").toLowerCase();
    case "sponsor": return String(v.sponsor || "").toLowerCase();
    case "views":   return Number(v.views) || 0;
    case "payout":  return v.milestone_payout || 0;
    case "status":  return v.tracking_active ? 1 : 0;
    default:        return "";
  }
}

// Default order: active first, then newest release date.
function sorted(videos) {
  return [...videos].sort((a, b) => {
    if (a.tracking_active !== b.tracking_active) return (b.tracking_active ? 1 : 0) - (a.tracking_active ? 1 : 0);
    const da = a.release_date_iso || "0000-00-00";
    const db = b.release_date_iso || "0000-00-00";
    return db.localeCompare(da);
  });
}

function displayVideos() {
  if (!_sort) return _videos;
  const mul = _sort.dir === "asc" ? 1 : -1;
  return [..._videos]
    .map((v, i) => ({ v, i, k: sortValue(v, _sort.key) }))
    .sort((a, b) => {
      // Blanks sink to the bottom whichever way we're sorting.
      if (a.k === "" && b.k === "") return a.i - b.i;
      if (a.k === "") return 1;
      if (b.k === "") return -1;
      const c = typeof a.k === "string"
        ? a.k.localeCompare(b.k, undefined, { sensitivity: "base", numeric: true })
        : a.k - b.k;
      return (c * mul) || (a.i - b.i);
    })
    .map(x => x.v);
}

function setSort(key) {
  const type = SORT_COLS.find(c => c.key === key)?.type || "text";
  const def  = type === "text" ? "asc" : "desc";
  if (!_sort || _sort.key !== key)  _sort = { key, dir: def };
  else if (_sort.dir === def)       _sort = { key, dir: def === "asc" ? "desc" : "asc" };
  else                              _sort = null;   // third click → default order
  rerenderList();
  paintSortBar();
}

function renderSortBar() {
  const chips = SORT_COLS.map(c => {
    const on = _sort?.key === c.key;
    return `
      <button class="sort-chip${on ? " sorted" : ""}" data-sort="${c.key}">
        ${esc(c.label)}
        <span class="sort-arrow${on ? " active" : ""}">${on ? (_sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>`;
  }).join("");
  return `<div class="sort-bar" id="sponsor-sort-bar"><span class="sort-bar-label">Sort by</span>${chips}</div>`;
}

function paintSortBar() {
  const bar = document.getElementById("sponsor-sort-bar");
  if (!bar) return;
  bar.querySelectorAll(".sort-chip").forEach(chip => {
    const on    = _sort?.key === chip.dataset.sort;
    const arrow = chip.querySelector(".sort-arrow");
    chip.classList.toggle("sorted", on);
    arrow.classList.toggle("active", on);
    arrow.textContent = on ? (_sort.dir === "asc" ? "↑" : "↓") : "↕";
  });
}

// ── page skeleton ─────────────────────────────────────────────────────────────

function statsHtml() {
  const active     = _videos.filter(v => v.tracking_active).length;
  const totalBonus = _videos.reduce((s, v) => s + (v.milestone_payout || 0), 0);
  // Money still owed: earned milestone bonuses not yet marked paid, plus flat
  // rates still pending (their amounts aren't tracked, so they're counted).
  const owedBonus  = _videos
    .filter(v => v.milestones_enabled && v.milestone_payout > 0 && v.bonus_paid !== "Paid")
    .reduce((s, v) => s + v.milestone_payout, 0);
  const owedFlat   = _videos.filter(v => v.flat_rate_enabled && v.flat_rate_paid !== "Paid").length;

  return `
    <div class="stat-card">
      <div class="stat-label">Tracking now</div>
      <div class="stat-value">${active}</div>
      <div class="stat-meta">of ${_videos.length} video${_videos.length !== 1 ? "s" : ""} · 30-day window</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Milestones earned</div>
      <div class="stat-value">${gbp(totalBonus)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Awaiting payment</div>
      <div class="stat-value ${owedBonus || owedFlat ? "pending" : ""}">${gbp(owedBonus)}</div>
      <div class="stat-meta">${owedFlat
        ? `plus ${owedFlat} flat rate${owedFlat !== 1 ? "s" : ""} pending`
        : "no flat rates pending"}</div>
    </div>`;
}

function buildPage() {
  return `
    <div class="page-header">
      <div class="page-title">Sponsor Tracker</div>
    </div>

    <div class="sponsor-add-bar">
      <input type="text" id="sponsor-url-input" placeholder="Paste a YouTube video URL to start tracking…" />
      <button class="btn btn-primary" id="btn-add-sponsor">Track video</button>
    </div>

    <div class="stat-grid stat-grid-3" id="sponsor-stats">${statsHtml()}</div>

    <div class="table-card">
      ${renderSortBar()}
      <div id="sponsor-list">
        ${renderList()}
      </div>
    </div>

    ${renderModal()}
  `;
}

// ── list rendering ────────────────────────────────────────────────────────────

function renderList() {
  if (!_videos.length) {
    return `<div class="empty-state" style="padding:40px 0">No videos tracked yet. Paste a YouTube URL above to get started.</div>`;
  }
  return `<div class="sponsor-list-cards">${displayVideos().map(renderRow).join("")}</div>`;
}

// Milestone tiers — must match milestone_for() in services/sponsor_loader.py.
const TIERS = [[5000, 100], [10000, 200], [20000, 300]];

// How far the views are from the next bonus tier.
function milestoneProgress(views) {
  const i = TIERS.findIndex(([at]) => views < at);
  if (i === -1) return { pct: 100, text: "Top tier reached" };
  const from = i ? TIERS[i - 1][0] : 0;
  const [at, pay] = TIERS[i];
  return {
    pct:  Math.max(2, ((views - from) / (at - from)) * 100),
    text: `${(at - views).toLocaleString("en-GB")} views to ${gbp(pay)}`,
  };
}

function payPill(label, enabled, paid) {
  if (!enabled) return `<span class="sc-pill na"><span class="sc-pill-label">${label}</span>N/A</span>`;
  return paid
    ? `<span class="sc-pill paid"><span class="sc-pill-label">${label}</span>${ICON_CHECK}Paid</span>`
    : `<span class="sc-pill pending"><span class="sc-pill-label">${label}</span>${ICON_CLOCK}Pending</span>`;
}

function renderRow(v) {
  const views = Number(v.views) || 0;
  const thumb = v.thumbnail_url
    ? `<img src="${esc(v.thumbnail_url)}" loading="lazy" alt="" onerror="this.style.display='none'" />`
    : "";

  const left = v.milestones_enabled && v.tracking_active ? daysLeft(v.release_date_iso) : null;
  const daysTag = (left !== null && left > 0)
    ? `<span class="sc-days ${left <= 3 ? "urgent" : left <= 10 ? "soon" : ""}">${left} day${left !== 1 ? "s" : ""} left</span>`
    : "";

  // While the 30-day window is open, show how close the next bonus tier is.
  let progress = "";
  if (v.milestones_enabled && v.tracking_active) {
    const p = milestoneProgress(views);
    progress = `
      <div class="sc-progress" role="progressbar" aria-label="Progress to next milestone"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}">
        <div class="sc-progress-fill" style="width:${p.pct}%"></div>
      </div>
      <span class="sc-progress-text">${p.text}</span>`;
  }

  const milestoneLabel = v.milestones_enabled && v.milestone_payout > 0
    ? `Milestone ${gbp(v.milestone_payout).replace(".00", "")}`
    : "Milestone";

  return `
    <article class="sponsor-card${v.tracking_active ? " is-active" : ""}" data-row="${v.row_index}">
      <div class="sc-thumb">
        ${thumb}
        <span class="sc-status ${v.tracking_active ? "active" : "ended"}">${v.tracking_active ? "Tracking" : "Ended"}</span>
      </div>
      <div class="sc-main">
        <div class="sc-title" title="${esc(v.title)}">${esc(v.title)}</div>
        <div class="sc-meta">
          ${v.sponsor ? `<span class="sc-sponsor">${esc(v.sponsor)}</span>` : `<span class="sc-sponsor none">No sponsor</span>`}
          <span>${fmtIso(v.release_date_iso) || "No release date"}</span>
          ${daysTag}
        </div>
        <div class="sc-views">
          <span class="sc-views-num">${views.toLocaleString("en-GB")} views</span>
          ${progress}
        </div>
      </div>
      <div class="sc-pay">
        ${payPill("Flat rate", v.flat_rate_enabled, v.flat_rate_paid === "Paid")}
        ${v.milestones_enabled && v.milestone_payout === 0
          ? `<span class="sc-pill na"><span class="sc-pill-label">Milestone</span>Not reached</span>`
          : payPill(milestoneLabel, v.milestones_enabled, v.bonus_paid === "Paid")}
      </div>
      <div class="sc-actions">
        <button class="btn-icon btn-edit" data-row="${v.row_index}" title="Edit" aria-label="Edit">${ICON_EDIT}</button>
        <button class="btn-icon btn-refresh" data-row="${v.row_index}" title="Refresh views" aria-label="Refresh views">${ICON_REFRESH}</button>
        <button class="btn-icon btn-delete danger" data-row="${v.row_index}" title="Remove" aria-label="Remove">${ICON_TRASH}</button>
      </div>
    </article>
  `;
}

// ── edit modal ────────────────────────────────────────────────────────────────

function renderModal() {
  return `
    <div id="sponsor-modal-overlay" class="modal-overlay" style="display:none">
      <div class="modal-card" id="sponsor-modal">
        <div class="modal-header">
          <div class="modal-title" id="modal-video-title">Edit Video</div>
          <button class="modal-close" id="modal-close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label>Sponsor</label>
            <div class="modal-sponsor-row">
              <select id="modal-sponsor-select"></select>
              <input id="modal-sponsor-new" placeholder="Sponsor name…" style="display:none" />
            </div>
          </div>

          <div class="modal-field">
            <label>Release Date <span style="font-weight:400;color:var(--text-faint)">(DD/MM/YYYY)</span></label>
            <input type="text" id="modal-release-date" placeholder="e.g. 04/01/2026" maxlength="10" />
          </div>

          <div class="modal-section-divider">Milestone Bonuses</div>
          <div class="modal-field modal-toggle-row">
            <label>Enable milestone tracking</label>
            <label class="feature-toggle">
              <input type="checkbox" id="modal-milestones-toggle" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div id="modal-bonus-row" class="modal-field modal-toggle-row">
            <label>Bonus paid</label>
            <button class="toggle-pill pending" id="modal-bonus-pill">Pending</button>
          </div>

          <div class="modal-section-divider">Flat Rate</div>
          <div class="modal-field modal-toggle-row">
            <label>Enable flat rate tracking</label>
            <label class="feature-toggle">
              <input type="checkbox" id="modal-flatrate-toggle" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div id="modal-flatrate-row" class="modal-field modal-toggle-row">
            <label>Flat rate paid</label>
            <button class="toggle-pill pending" id="modal-flatrate-pill">Pending</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="modal-save-btn">Save</button>
        </div>
      </div>
    </div>
  `;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function daysLeft(iso) {
  if (!iso) return null;
  const today   = new Date(); today.setHours(0,0,0,0);
  const release = new Date(iso); release.setHours(0,0,0,0);
  const elapsed = Math.max(0, Math.floor((today - release) / 86_400_000));
  return Math.max(0, 30 - elapsed);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rerenderList() {
  const el = document.getElementById("sponsor-list");
  if (!el) return;
  el.innerHTML = renderList();
  wireListEvents(el);
}

function updateStats() {
  const el = document.getElementById("sponsor-stats");
  if (el) el.innerHTML = statsHtml();
}

function videoByRowIndex(idx) {
  return _videos.find(v => v.row_index === idx);
}

function _extractError(err) {
  const match = err.message.match(/→ \d+: ([\s\S]+)$/);
  if (match) {
    try { return JSON.parse(match[1])?.detail || match[1]; }
    catch (_) { return match[1]; }
  }
  return err.message;
}

// ── event wiring ──────────────────────────────────────────────────────────────

function wireEvents(container) {
  const addBtn   = container.querySelector("#btn-add-sponsor");
  const urlInput = container.querySelector("#sponsor-url-input");

  addBtn.addEventListener("click",    () => handleAdd(urlInput));
  urlInput.addEventListener("keydown", e => { if (e.key === "Enter") handleAdd(urlInput); });

  container.querySelectorAll("#sponsor-sort-bar .sort-chip").forEach(chip =>
    chip.addEventListener("click", () => setSort(chip.dataset.sort))
  );

  wireListEvents(container.querySelector("#sponsor-list"));
  wireModal(container);
}

function wireListEvents(list) {
  if (!list) return;

  list.querySelectorAll(".btn-edit").forEach(btn =>
    btn.addEventListener("click", e => openModal(parseInt(e.currentTarget.dataset.row, 10)))
  );
  list.querySelectorAll(".btn-refresh").forEach(btn =>
    btn.addEventListener("click", e => handleRefresh(e))
  );
  list.querySelectorAll(".btn-delete").forEach(btn =>
    btn.addEventListener("click", e => handleDelete(e))
  );
}

function wireModal(container) {
  const overlay   = container.querySelector("#sponsor-modal-overlay");
  const closeBtn  = container.querySelector("#modal-close-btn");
  const cancelBtn = container.querySelector("#modal-cancel-btn");
  const saveBtn   = container.querySelector("#modal-save-btn");

  closeBtn.addEventListener("click",  closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
  saveBtn.addEventListener("click", handleModalSave);

  // Sponsor select "Add New" logic
  container.querySelector("#modal-sponsor-select").addEventListener("change", e => {
    const newInp = container.querySelector("#modal-sponsor-new");
    if (e.target.value === "__add_new__") {
      e.target.style.display = "none";
      newInp.style.display = "";
      newInp.focus();
    }
  });

  container.querySelector("#modal-sponsor-new").addEventListener("keydown", e => {
    if (e.key === "Enter") e.target.blur();
  });
  container.querySelector("#modal-sponsor-new").addEventListener("blur", e => {
    const val = e.target.value.trim();
    const sel = container.querySelector("#modal-sponsor-select");
    if (val && !_sponsorOpts.includes(val)) {
      _sponsorOpts.push(val);
      _sponsorOpts.sort();
    }
    e.target.style.display = "none";
    sel.style.display = "";
    if (val) {
      refreshSponsorOptions(sel, val);
    }
  });

  // Paid pill toggles
  container.querySelector("#modal-bonus-pill").addEventListener("click", e => {
    togglePill(e.currentTarget);
  });
  container.querySelector("#modal-flatrate-pill").addEventListener("click", e => {
    togglePill(e.currentTarget);
  });

  // Show/hide paid rows based on toggles
  container.querySelector("#modal-milestones-toggle").addEventListener("change", e => {
    container.querySelector("#modal-bonus-row").style.display = e.target.checked ? "" : "none";
  });
  container.querySelector("#modal-flatrate-toggle").addEventListener("change", e => {
    container.querySelector("#modal-flatrate-row").style.display = e.target.checked ? "" : "none";
  });
}

function togglePill(btn) {
  const isPaid = btn.classList.contains("paid");
  btn.classList.toggle("paid",    !isPaid);
  btn.classList.toggle("pending",  isPaid);
  btn.textContent = isPaid ? "Pending" : "Paid";
}

// ── modal open / close ────────────────────────────────────────────────────────

let _editingRowIndex = null;
let _datepicker      = null;

function openModal(rowIndex) {
  const v = videoByRowIndex(rowIndex);
  if (!v) return;
  _editingRowIndex = rowIndex;

  const overlay = document.getElementById("sponsor-modal-overlay");

  document.getElementById("modal-video-title").textContent = v.title;

  // Destroy any previous flatpickr instance before re-initialising
  if (_datepicker) { _datepicker.destroy(); _datepicker = null; }
  const rdInput = document.getElementById("modal-release-date");
  // Pre-fill as a Date so the calendar opens on the right day (see parseIso)
  _datepicker = flatpickr(rdInput, {
    dateFormat: "d/m/Y",
    defaultDate: parseIso(v.release_date_iso),
    allowInput: true,
  });

  // Sponsor dropdown
  const sel = document.getElementById("modal-sponsor-select");
  refreshSponsorOptions(sel, v.sponsor);
  document.getElementById("modal-sponsor-new").style.display = "none";
  sel.style.display = "";

  // Milestones
  const mToggle = document.getElementById("modal-milestones-toggle");
  const bPill   = document.getElementById("modal-bonus-pill");
  const bRow    = document.getElementById("modal-bonus-row");
  mToggle.checked = v.milestones_enabled;
  bRow.style.display = v.milestones_enabled ? "" : "none";
  setPill(bPill, v.bonus_paid === "Paid");

  // Flat rate
  const fToggle = document.getElementById("modal-flatrate-toggle");
  const fPill   = document.getElementById("modal-flatrate-pill");
  const fRow    = document.getElementById("modal-flatrate-row");
  fToggle.checked = v.flat_rate_enabled;
  fRow.style.display = v.flat_rate_enabled ? "" : "none";
  setPill(fPill, v.flat_rate_paid === "Paid");

  overlay.style.display = "flex";
  document.getElementById("modal-save-btn").disabled = false;
  document.getElementById("modal-save-btn").textContent = "Save";
}

function closeModal() {
  const overlay = document.getElementById("sponsor-modal-overlay");
  if (overlay) overlay.style.display = "none";
  if (_datepicker) { _datepicker.destroy(); _datepicker = null; }
  _editingRowIndex = null;
}

function setPill(btn, isPaid) {
  btn.classList.toggle("paid",    isPaid);
  btn.classList.toggle("pending", !isPaid);
  btn.textContent = isPaid ? "Paid" : "Pending";
}

function refreshSponsorOptions(sel, current) {
  const opts = _sponsorOpts
    .map(s => `<option value="${esc(s)}" ${s === current ? "selected" : ""}>${esc(s)}</option>`)
    .join("");

  const hasCustom = current && !_sponsorOpts.includes(current);
  sel.innerHTML = `
    <option value="" ${!current && !hasCustom ? "selected" : ""}>— Select sponsor —</option>
    ${hasCustom ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : ""}
    ${opts}
    <option value="__add_new__">+ Add New Sponsor…</option>
  `;
}

// ── modal save ────────────────────────────────────────────────────────────────

async function handleModalSave() {
  const saveBtn = document.getElementById("modal-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  const sel        = document.getElementById("modal-sponsor-select");
  const newInp     = document.getElementById("modal-sponsor-new");
  const sponsor    = newInp.style.display !== "none"
    ? newInp.value.trim()
    : (sel.value === "__add_new__" ? "" : sel.value);

  const milestonesEnabled = document.getElementById("modal-milestones-toggle").checked;
  const flatRateEnabled   = document.getElementById("modal-flatrate-toggle").checked;
  const bonusPaid         = document.getElementById("modal-bonus-pill").classList.contains("paid") ? "Paid" : "Pending";
  const flatRatePaid      = document.getElementById("modal-flatrate-pill").classList.contains("paid") ? "Paid" : "Pending";
  const releaseDate       = document.getElementById("modal-release-date").value.trim();

  try {
    const updated = await api.sponsorUpdate(_editingRowIndex, {
      sponsor,
      milestones_enabled: milestonesEnabled,
      flat_rate_enabled:  flatRateEnabled,
      bonus_paid:         bonusPaid,
      flat_rate_paid:     flatRatePaid,
      release_date:       releaseDate || undefined,
    });

    // Update in local cache (preserve sort order)
    const idx = _videos.findIndex(v => v.row_index === _editingRowIndex);
    if (idx !== -1) _videos[idx] = updated;

    if (sponsor && !_sponsorOpts.includes(sponsor)) {
      _sponsorOpts.push(sponsor);
      _sponsorOpts.sort();
    }

    closeModal();
    rerenderList();
    updateStats();
    toast("Saved");
  } catch (err) {
    toast(_extractError(err), "error");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}

// ── action handlers ───────────────────────────────────────────────────────────

async function handleAdd(urlInput) {
  const url = urlInput.value.trim();
  if (!url) { toast("Paste a YouTube URL first", "error"); return; }

  const btn = document.getElementById("btn-add-sponsor");
  btn.disabled = true;
  btn.textContent = "Adding…";

  try {
    const video = await api.sponsorAdd({ url });
    _videos = sorted([..._videos, video]);
    if (video.sponsor && !_sponsorOpts.includes(video.sponsor)) {
      _sponsorOpts.push(video.sponsor);
      _sponsorOpts.sort();
    }
    urlInput.value = "";
    rerenderList();
    updateStats();
    toast(`Added: ${video.title}`);
  } catch (err) {
    toast(_extractError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Track video";
  }
}

async function handleRefresh(e) {
  const btn = e.currentTarget;
  const row = parseInt(btn.dataset.row, 10);
  btn.disabled = true;
  btn.classList.add("spinning");

  try {
    const updated = await api.sponsorRefresh(row);
    const idx = _videos.findIndex(v => v.row_index === row);
    if (idx !== -1) _videos[idx] = updated;
    rerenderList();
    updateStats();
    toast(`Views updated to ${Number(updated.views).toLocaleString("en-GB")}`);
  } catch (err) {
    toast(_extractError(err), "error");
    btn.disabled = false;
    btn.classList.remove("spinning");
  }
}

async function handleDelete(e) {
  const btn   = e.currentTarget;
  const row   = parseInt(btn.dataset.row, 10);
  const video = videoByRowIndex(row);
  if (!(await confirmModal(`Remove “${video?.title || "this video"}” from tracking?`,
        { title: "Remove video", okText: "Remove" }))) return;

  btn.disabled = true;
  try {
    await api.sponsorDelete(row);
    _videos = _videos.filter(v => v.row_index !== row);
    rerenderList();
    updateStats();
    toast("Video removed");
  } catch (err) {
    toast(_extractError(err), "error");
    btn.disabled = false;
  }
}
