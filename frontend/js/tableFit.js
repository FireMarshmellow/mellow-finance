/**
 * Edge shadows on horizontally scrollable tables.
 *
 * The wide summary tables scroll sideways when they cannot fit, but nothing
 * said so — the columns past the right edge simply looked absent. This marks
 * the owning .table-card so CSS can fade in a shadow on whichever side still
 * has columns hidden.
 */

const tracked = new WeakSet();

function update(scroll) {
  const card = scroll.closest(".table-card");
  if (!card) return;

  // Keep the shadows clear of the card header, whose height varies by page.
  const head = card.querySelector(".table-card-header");
  card.style.setProperty("--thead-offset", `${head ? head.offsetHeight : 0}px`);

  const max = scroll.scrollWidth - scroll.clientWidth;
  card.classList.toggle("has-scroll-left",  scroll.scrollLeft > 1);
  card.classList.toggle("has-scroll-right", max > 1 && scroll.scrollLeft < max - 1);
}

export function initTableFit(root = document) {
  root.querySelectorAll(".table-scroll").forEach(scroll => {
    update(scroll);
    if (tracked.has(scroll)) return;
    tracked.add(scroll);
    scroll.addEventListener("scroll", () => update(scroll), { passive: true });
    new ResizeObserver(() => update(scroll)).observe(scroll);
  });
}

/** Re-scan whenever a page swaps its markup in — pages re-render on sort,
 *  filter and route change, not just on navigation. */
export function watchTableFit(container) {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; initTableFit(container); });
  }).observe(container, { childList: true, subtree: true });
  initTableFit(container);
}
