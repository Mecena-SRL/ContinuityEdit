// Icone SVG inline coerenti (griglia 16, tratto 1.5, angoli arrotondati). Nessuna risorsa esterna.
import { icon } from './dom.js';

const S = (d) => `<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
const F = (d) => `<g fill="currentColor">${d}</g>`;

const P = {
  play: F('<path d="M5 3.2v9.6c0 .5.5.8.9.5l7.2-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/>'),
  pause: F('<rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/>'),
  back: S('<path d="M8 4 4 8l4 4M12 4 8 8l4 4"/>'),
  fwd: S('<path d="M8 4l4 4-4 4M4 4l4 4-4 4"/>'),
  stepBack: S('<path d="M10 4 6 8l4 4M4 4v8"/>'),
  stepFwd: S('<path d="M6 4l4 4-4 4M12 4v8"/>'),
  prev: S('<path d="M11 4 7 8l4 4"/>'),
  next: S('<path d="M5 4l4 4-4 4"/>'),
  markIn: S('<path d="M6 3H4v10h2M9 5l3 3-3 3M12 8H7"/>'),
  markOut: S('<path d="M10 3h2v10h-2M7 5 4 8l3 3M4 8h5"/>'),
  anchor: S('<circle cx="8" cy="4" r="1.6"/><path d="M8 5.6V13M4.5 9.5A3.5 3.5 0 0 0 8 13a3.5 3.5 0 0 0 3.5-3.5M6 7.5h4"/>'),
  scissors: S('<circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M5.8 10 12 2.5M10.2 10 4 2.5"/>'),
  trash: S('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
  undo: S('<path d="M5.5 4 3 6.5 5.5 9"/><path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7"/>'),
  redo: S('<path d="M10.5 4 13 6.5 10.5 9"/><path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9"/>'),
  search: S('<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>'),
  wave: S('<path d="M2 8h1.5M5 5v6M8 3v10M11 5.5v5M14 8h-1"/>'),
  film: S('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 3v10M11 3v10M2.5 6H5M2.5 10H5M11 6h2.5M11 10h2.5"/>'),
  doc: S('<path d="M4 2.5h5.5L12.5 5.5V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5"/>'),
  folder: S('<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>'),
  sync: S('<path d="M12.5 6A4.8 4.8 0 0 0 4 4.5L3 5.5M3.5 10A4.8 4.8 0 0 0 12 11.5l1-1"/><path d="M3 2.5v3h3M13 13.5v-3h-3"/>'),
  timeline: S('<rect x="2" y="3" width="7" height="3" rx="1"/><rect x="5" y="7.5" width="9" height="3" rx="1"/><path d="M2 13h12"/>'),
  send: S('<path d="M2.5 8h9M8.5 4.5 12 8l-3.5 3.5M13.5 3v10"/>'),
  eye: S('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  target: S('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>'),
  check: S('<path d="m3.5 8.5 3 3 6-7"/>'),
  close: S('<path d="m4 4 8 8M12 4l-8 8"/>'),
  plus: S('<path d="M8 3v10M3 8h10"/>'),
  minus: S('<path d="M3 8h10"/>'),
  more: F('<circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/>'),
  help: S('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3v.3"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/>'),
  keyboard: S('<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6"/>'),
  wand: S('<path d="m3 13 7-7M11 2.5v2M13.5 5h-2M12.5 3.5 11 5M9 2.5l.5 1.5M13.5 7.5 12 7"/>'),
  star: S('<path d="m8 2.5 1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8L2.5 6.5l3.8-.5z"/>'),
  image: S('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m13.5 11-3.5-3.5L4 13"/>'),
  board: S('<rect x="2" y="2.5" width="12" height="8.5" rx="1"/><path d="M5 14l3-3 3 3M5 5.5h3M5 8h5"/>'),
  stethoscope: S('<path d="M4 2.5v4a3 3 0 0 0 6 0v-4M7 9.5v1.5a2.5 2.5 0 0 0 5 0V9"/><circle cx="12" cy="7.8" r="1.3"/>'),
  copy: S('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1 1 0 0 0 10 2.5H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5"/>'),
  link: S('<path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>'),
  chevronDown: S('<path d="m4 6 4 4 4-4"/>'),
  chevronUp: S('<path d="m4 10 4-4 4 4"/>'),
  sidebar: S('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/>'),
  info: S('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5h.01"/>'),
  warn: S('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3h.01"/>'),
  resolve: S('<circle cx="8" cy="5" r="2.3"/><circle cx="5" cy="10.5" r="2.3"/><circle cx="11" cy="10.5" r="2.3"/>'),
  mic: S('<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 0 0 8.4 0M8 11.7V14"/>'),
};

/** ico('play') -> <svg class="ico">. Nome sconosciuto: cerchio vuoto (mai un errore). */
export function ico(name, cls = 'ico') {
  return icon(P[name] || S('<circle cx="8" cy="8" r="5"/>'), cls);
}
export const ICON_NAMES = Object.keys(P);
