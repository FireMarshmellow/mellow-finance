/** Inline stroke icons, sized by the surrounding font (1em) and coloured by
 *  currentColor, so they sit in buttons exactly like the glyphs they replace. */

const svg = paths =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICON_TRASH    = svg(`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>`);
export const ICON_EDIT     = svg(`<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>`);
export const ICON_REFRESH  = svg(`<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>`);
export const ICON_EYE      = svg(`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`);
export const ICON_DOWNLOAD = svg(`<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>`);
export const ICON_UPLOAD   = svg(`<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>`);
export const ICON_SEARCH   = svg(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`);
export const ICON_PLUS     = svg(`<path d="M12 5v14M5 12h14"/>`);
export const ICON_FILE     = svg(`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M14 3v5h5"/>`);
export const ICON_PRINT    = svg(`<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>`);
export const ICON_CHECK    = svg(`<path d="m5 12 5 5 9-10"/>`);
export const ICON_CLOCK    = svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`);
export const ICON_CHEVRON  = svg(`<path d="m9 6 6 6-6 6"/>`);
