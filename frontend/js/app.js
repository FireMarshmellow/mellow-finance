/** Hash-based SPA router + global utilities. */
import { renderYearly }        from "./pages/yearly.js";
import { renderMonthly }       from "./pages/monthly.js";
import { renderSheet }         from "./pages/sheet.js";
import { renderSponsorTracker } from "./pages/sponsorTracker.js";
import { renderFreebies }      from "./pages/freebies.js";
import { renderStatements }    from "./pages/statements.js";
import { renderSettings }      from "./pages/settings.js";
import { watchTableFit }       from "./tableFit.js";

const content = document.getElementById("page-content");

// ── Toast ──────────────────────────────────────────────────────────────────
export function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Loading helper ─────────────────────────────────────────────────────────
export function showLoading() {
  content.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading…</p></div>`;
}

// ── In-app dialogs ───────────────────────────────────────────────────────────
// Custom modals replacing native confirm()/prompt(), which browsers can suppress
// ("prevent this page from creating additional dialogs") — leaving buttons dead.

function _buildModal(innerHTML) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-card" style="max-width:400px">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}

// Resolves to true (confirm) / false (cancel, Esc, backdrop).
export function confirmModal(message, { title = "Please confirm", okText = "Delete", danger = true } = {}) {
  return new Promise(resolve => {
    const overlay = _buildModal(`
      <div class="modal-header">
        <div class="modal-title"></div>
        <button class="modal-close" data-act="cancel" aria-label="Cancel">✕</button>
      </div>
      <div class="modal-body"><p class="modal-message"></p></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok"></button>
      </div>`);
    overlay.querySelector(".modal-title").textContent   = title;
    overlay.querySelector(".modal-message").textContent = message;
    overlay.querySelector('[data-act="ok"]').textContent = okText;

    const done = val => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = e => { if (e.key === "Escape") done(false); else if (e.key === "Enter") done(true); };
    overlay.addEventListener("click", e => {
      if (e.target === overlay) return done(false);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "ok") done(true);
      else if (act === "cancel") done(false);
    });
    document.addEventListener("keydown", onKey);
    overlay.querySelector('[data-act="ok"]').focus();
  });
}

// Resolves to the entered string, or null if cancelled.
export function promptModal(message, defaultValue = "", { title = "Enter a value", okText = "Save" } = {}) {
  return new Promise(resolve => {
    const overlay = _buildModal(`
      <div class="modal-header">
        <div class="modal-title"></div>
        <button class="modal-close" data-act="cancel" aria-label="Cancel">✕</button>
      </div>
      <div class="modal-body">
        <label class="modal-message" style="font-size:13px;color:var(--text)"></label>
        <input type="text" class="modal-input" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok"></button>
      </div>`);
    overlay.querySelector(".modal-title").textContent    = title;
    overlay.querySelector(".modal-message").textContent  = message;
    overlay.querySelector('[data-act="ok"]').textContent = okText;
    const input = overlay.querySelector(".modal-input");
    input.value = defaultValue;

    const done = val => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = e => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter") done(input.value);
    };
    overlay.addEventListener("click", e => {
      if (e.target === overlay) return done(null);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "ok") done(input.value);
      else if (act === "cancel") done(null);
    });
    document.addEventListener("keydown", onKey);
    input.focus(); input.select();
  });
}

// ── Currency formatter ─────────────────────────────────────────────────────
export function gbp(n) {
  if (n == null || n === "") return "—";
  return "£" + Number(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Sidebar: mobile drawer + desktop collapse ──────────────────────────────
const sidebar   = document.getElementById("sidebar");
const overlay   = document.getElementById("sidebar-overlay");
const hamburger = document.getElementById("hamburger");
const navToggle = document.getElementById("sidebar-toggle");
const navTip    = document.getElementById("nav-tip");

const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

// -- Mobile slide-over drawer --
function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("visible");
}

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("visible");
}

hamburger?.addEventListener("click", () =>
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar()
);
overlay?.addEventListener("click", closeSidebar);

// -- Desktop collapse to an icon rail --
// The initial class is set by the inline script in index.html (before first
// paint, so a collapsed rail never flashes open); this keeps the toggle, its
// labels and localStorage in sync from here on.
const isCollapsed = () => document.documentElement.classList.contains("nav-collapsed");

function syncToggle() {
  if (!navToggle) return;
  const label = isCollapsed() ? "Expand menu" : "Collapse menu";
  navToggle.setAttribute("aria-expanded", String(!isCollapsed()));
  navToggle.setAttribute("aria-label", label);
  navToggle.dataset.tip = label;
}

function setCollapsed(collapsed) {
  document.documentElement.classList.toggle("nav-collapsed", collapsed);
  try { localStorage.setItem("nav-collapsed", collapsed ? "1" : "0"); } catch {}
  syncToggle();
  hideTip();
  // Chart.js follows its own container, but nudge anything listening on window.
  window.dispatchEvent(new Event("resize"));
}

navToggle?.addEventListener("click", () => setCollapsed(!isCollapsed()));
syncToggle();

// Ctrl/Cmd+B toggles, matching the usual editor shortcut.
document.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "b") return;
  e.preventDefault();
  if (isMobile()) sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  else setCollapsed(!isCollapsed());
});

// -- Tooltip for the collapsed rail --
// Rendered at <body> level with position:fixed, so the sidebar's own overflow
// never clips it.
function showTip(el) {
  const text = el.dataset.tip;
  if (!text) return;
  const r = el.getBoundingClientRect();
  navTip.textContent = text;
  navTip.classList.add("visible");
  navTip.style.left = `${r.right + 10}px`;
  navTip.style.top  = `${r.top + r.height / 2 - navTip.offsetHeight / 2}px`;
}

function hideTip() { navTip?.classList.remove("visible"); }

sidebar?.addEventListener("mouseover", e => {
  if (isMobile() || !isCollapsed()) return;
  const el = e.target.closest("[data-tip]");
  if (el) showTip(el);
});
sidebar?.addEventListener("mouseout", e => {
  if (e.target.closest("[data-tip]")) hideTip();
});
sidebar?.addEventListener("scroll", hideTip, true);
window.addEventListener("blur", hideTip);

// ── Active nav link ────────────────────────────────────────────────────────
function setActiveNav(page) {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });
}

// ── Router ─────────────────────────────────────────────────────────────────
async function route() {
  const hash  = location.hash.replace(/^#\//, "") || "yearly";
  const parts = hash.split("/");
  const page  = parts[0];

  setActiveNav(hash);

  try {
    if (page === "yearly") {
      await renderYearly(content);
    } else if (page === "monthly") {
      await renderMonthly(content);
    } else if (page === "sheet" && parts[1]) {
      await renderSheet(content, parts[1]);
    } else if (page === "sponsor-tracker") {
      await renderSponsorTracker(content);
    } else if (page === "freebies") {
      await renderFreebies(content);
    } else if (page === "statements") {
      await renderStatements(content);
    } else if (page === "settings") {
      await renderSettings(content);
    } else {
      content.innerHTML = `<div class="empty-state">Page not found.</div>`;
    }
  } catch (err) {
    content.innerHTML = `<div class="error-banner">⚠ ${err.message}</div>`;
    console.error(err);
  }
}

watchTableFit(content);   // scroll shadows on any table too wide to fit

window.addEventListener("hashchange", () => { closeSidebar(); route(); });
route();   // initial load
