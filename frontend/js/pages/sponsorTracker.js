import { api }                    from "../api.js";
import { showLoading, toast, gbp } from "../app.js";

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

// ── sort: active first, then newest release date ──────────────────────────────

function sorted(videos) {
  return [...videos].sort((a, b) => {
    if (a.tracking_active !== b.tracking_active) return (b.tracking_active ? 1 : 0) - (a.tracking_active ? 1 : 0);
    const da = a.release_date_iso || "0000-00-00";
    const db = b.release_date_iso || "0000-00-00";
    return db.localeCompare(da);
  });
}

// Format "2026-01-04" → "4 Jan 2026"
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1] || "";
  return `${+d} ${mon} ${y}`;
}

// ── page skeleton ─────────────────────────────────────────────────────────────

function buildPage() {
  const active     = _videos.filter(v => v.tracking_active).length;
  const totalBonus = _videos.reduce((s, v) => s + (v.milestone_payout || 0), 0);

  return `
    <div class="page-header">
      <div class="page-title">Sponsor Tracker</div>
      <div class="page-subtitle">YouTube-sponsored videos with milestone bonus tracking</div>
    </div>

    <div class="sponsor-add-bar">
      <input type="text" id="sponsor-url-input" placeholder="Paste YouTube video URL…" />
      <button class="btn btn-primary" id="btn-add-sponsor">Track Video</button>
    </div>

    <div class="stat-grid stat-grid-3" style="margin-bottom:24px;">
      <div class="stat-card">
        <div class="stat-label">Total Videos</div>
        <div class="stat-value" id="stat-total">${_videos.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Tracking</div>
        <div class="stat-value" id="stat-active">${active}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Milestones Earned</div>
        <div class="stat-value" id="stat-bonus">${gbp(totalBonus)}</div>
      </div>
    </div>

    <div class="table-card">
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
  return `<div class="sponsor-list-cards">${_videos.map(renderRow).join("")}</div>`;
}

function renderRow(v) {
  const badgeClass = v.tracking_active ? "active" : "ended";
  const badgeText  = v.tracking_active ? "Active" : "Ended";

  const thumb = v.thumbnail_url
    ? `<img src="${esc(v.thumbnail_url)}" loading="lazy" alt="" onerror="this.style.display='none'" />`
    : "";

  const left = v.milestones_enabled && v.tracking_active ? daysLeft(v.release_date_iso) : null;
  const daysTag = (left !== null && left > 0)
    ? `<span class="sc-days-left ${left <= 3 ? "days-urgent" : left <= 10 ? "days-soon" : ""}">${left}d left</span>`
    : "";

  const flatRateBox = v.flat_rate_enabled
    ? `<div class="sc-pay-box ${v.flat_rate_paid === "Paid" ? "sc-paid" : "sc-pending"}">
         <span class="sc-pay-label">Flat Rate</span>
         <span class="sc-pay-status">${v.flat_rate_paid === "Paid" ? "Paid" : "Pending"}</span>
       </div>`
    : `<div class="sc-pay-box sc-disabled"><span class="sc-pay-label">Flat Rate</span><span class="sc-pay-status">N/A</span></div>`;

  const milestoneBox = v.milestones_enabled
    ? `<div class="sc-pay-box ${v.bonus_paid === "Paid" ? "sc-paid" : "sc-pending"}">
         <span class="sc-pay-amount ${tierClass(v.milestone_payout)}">${gbp(v.milestone_payout)}</span>
         <span class="sc-pay-status">${v.bonus_paid === "Paid" ? "Paid" : "Pending"}</span>
       </div>`
    : `<div class="sc-pay-box sc-disabled"><span class="sc-pay-amount">—</span><span class="sc-pay-status">N/A</span></div>`;

  return `
    <div class="sponsor-card" data-row="${v.row_index}">
      <div class="sc-thumb-wrap">
        ${thumb}
        <span class="tracking-badge-sm ${badgeClass}">${badgeText}</span>
      </div>
      <div class="sc-meta">
        <div class="sc-title" title="${esc(v.title)}">${esc(v.title)}</div>
        <div class="sc-views">${Number(v.views).toLocaleString()} views</div>
        <div class="sc-date">${fmtDate(v.release_date_iso) || "—"}</div>
      </div>
      <div class="sc-sponsor-box">
        <div class="sc-sponsor-name">${esc(v.sponsor) || "—"}</div>
        ${daysTag}
      </div>
      <div class="sc-payments">
        ${flatRateBox}
        ${milestoneBox}
      </div>
      <div class="sc-actions">
        <button class="btn-icon btn-edit" data-row="${v.row_index}" title="Edit">✎</button>
        <button class="btn-icon btn-refresh" data-row="${v.row_index}" title="Refresh views">↻</button>
        <button class="btn-icon btn-delete danger" data-row="${v.row_index}" title="Remove">✕</button>
      </div>
    </div>
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
  const elapsed = Math.floor((today - release) / 86_400_000);
  return Math.max(0, 30 - elapsed);
}

function tierClass(p) {
  if (p >= 300) return "tier-300";
  if (p >= 200) return "tier-200";
  if (p >= 100) return "tier-100";
  return "tier-0";
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
  const active     = _videos.filter(v => v.tracking_active).length;
  const totalBonus = _videos.reduce((s, v) => s + (v.milestone_payout || 0), 0);
  const t = document.getElementById("stat-total");
  const a = document.getElementById("stat-active");
  const b = document.getElementById("stat-bonus");
  if (t) t.textContent = _videos.length;
  if (a) a.textContent = active;
  if (b) b.textContent = gbp(totalBonus);
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
  // Pre-fill from ISO date so the calendar opens on the right month
  const initialDate = v.release_date_iso || null;
  _datepicker = flatpickr(rdInput, {
    dateFormat: "d/m/Y",
    defaultDate: initialDate || undefined,
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
    btn.textContent = "Track Video";
  }
}

async function handleRefresh(e) {
  const btn = e.currentTarget;
  const row = parseInt(btn.dataset.row, 10);
  btn.disabled = true;
  btn.textContent = "…";

  try {
    const updated = await api.sponsorRefresh(row);
    const idx = _videos.findIndex(v => v.row_index === row);
    if (idx !== -1) _videos[idx] = updated;
    rerenderList();
    updateStats();
    toast(`Views updated to ${Number(updated.views).toLocaleString()}`);
  } catch (err) {
    toast(_extractError(err), "error");
    btn.disabled = false;
    btn.textContent = "↻";
  }
}

async function handleDelete(e) {
  const btn   = e.currentTarget;
  const row   = parseInt(btn.dataset.row, 10);
  const video = videoByRowIndex(row);
  if (!confirm(`Remove "${video?.title || "this video"}" from tracking?`)) return;

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
