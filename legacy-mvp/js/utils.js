/* Utilidades de fechas, formato e iconos */
const U = {
  DAY_SHORT: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
  DAY_LETTER: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  MONTHS: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],

  pad: (n) => String(n).padStart(2, '0'),
  key(d) {
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  },
  fromKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },
  addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  },
  /** Índice de día con lunes = 0 ... domingo = 6 */
  weekdayIndex(d) {
    return (d.getDay() + 6) % 7;
  },
  startOfWeek(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - U.weekdayIndex(r));
    return r;
  },
  weekDays(start) {
    return Array.from({ length: 7 }, (_, i) => U.addDays(start, i));
  },
  sameDay(a, b) {
    return U.key(a) === U.key(b);
  },
  formatRange(start) {
    const end = U.addDays(start, 6);
    const M = U.MONTHS;
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()} – ${end.getDate()} ${M[end.getMonth()]} ${end.getFullYear()}`;
    }
    return `${start.getDate()} ${M[start.getMonth()]} – ${end.getDate()} ${M[end.getMonth()]} ${end.getFullYear()}`;
  },
  longDate(d) {
    const s = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  shortDateTime(iso) {
    const d = new Date(iso);
    return `${d.getDate()} ${U.MONTHS[d.getMonth()]} · ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`;
  },
  fmt: (n) => Number(n).toLocaleString('es-MX'),
  esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  },
};

/* Iconos SVG (trazo, estilo lineal) */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  spark: '<path d="M12 3c.5 4.5 3.5 8 9 9-5.5 1-8.5 4.5-9 9-.5-4.5-3.5-8-9-9 5.5-1 8.5-4.5 9-9z"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  trending: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};

function icon(name, cls = 'i') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
