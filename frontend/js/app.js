/** Hash-based SPA router + global utilities. */
import { renderYearly }        from "./pages/yearly.js";
import { renderMonthly }       from "./pages/monthly.js";
import { renderSheet }         from "./pages/sheet.js";
import { renderSponsorTracker } from "./pages/sponsorTracker.js";
import { renderFreebies }      from "./pages/freebies.js";
import { renderSettings }      from "./pages/settings.js";

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

// ── Currency formatter ─────────────────────────────────────────────────────
export function gbp(n) {
  if (n == null || n === "") return "—";
  return "£" + Number(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Mobile sidebar ─────────────────────────────────────────────────────────
const sidebar  = document.getElementById("sidebar");
const overlay  = document.getElementById("sidebar-overlay");
const hamburger = document.getElementById("hamburger");

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

window.addEventListener("hashchange", () => { closeSidebar(); route(); });
route();   // initial load
