/* Gráficas SVG ligeras e interactivas (sin dependencias) */
const Charts = (() => {
  let gid = 0;

  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function scale(maxVal, ticks = 4) {
    if (maxVal <= 0) return { max: 20, step: 5 };
    const step = Math.max(1, niceStep(maxVal / ticks));
    return { max: step * Math.ceil(maxVal / step), step };
  }

  /** Curva suave (Catmull-Rom → Bézier) sin bajar de la línea base */
  function smooth(pts, baseY) {
    if (!pts.length) return '';
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = Math.min(baseY, p1.y + (p2.y - p0.y) / 6);
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = Math.min(baseY, p2.y - (p3.y - p1.y) / 6);
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function tip(wrap, x, y, html) {
    const t = wrap.querySelector('.chart-tip');
    t.innerHTML = html;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
    t.classList.add('show');
  }
  const hideTip = (wrap) => wrap.querySelector('.chart-tip').classList.remove('show');

  /** Gráfica de área/línea */
  function line(el, { labels, values, color = '#8b5cf6', activeIndex = -1, lastIndex = values.length - 1, format = (v) => v }) {
    const W = Math.max(el.clientWidth, 260), H = 230;
    const P = { l: 38, r: 14, t: 18, b: 32 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b, base = P.t + ih;
    const { max, step } = scale(Math.max(...values));
    const n = labels.length;
    const slot = iw / (n - 1);
    const x = (i) => P.l + i * slot;
    const y = (v) => base - (v / max) * ih;
    const id = `lg${++gid}`;
    const pts = values.slice(0, lastIndex + 1).map((v, i) => ({ x: x(i), y: y(v) }));
    const d = smooth(pts, base);
    const area = pts.length > 1 ? `${d} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z` : '';

    let grid = '';
    for (let v = 0; v <= max; v += step) {
      grid += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`
        + `<text class="axis" x="${P.l - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    const xl = labels.map((l, i) => `<text class="axis ${i === activeIndex ? 'axis-active' : ''} ${i > lastIndex ? 'axis-dim' : ''}" x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`).join('');
    const dots = pts.map((p, i) => `<circle class="dot ${i === activeIndex ? 'dot-active' : ''}" data-i="${i}" cx="${p.x}" cy="${p.y}" r="4" style="stroke:${color}"/>`).join('');
    const hits = labels.map((_, i) => `<rect data-i="${i}" x="${x(i) - slot / 2}" y="${P.t}" width="${slot}" height="${ih}" fill="transparent"/>`).join('');

    el.innerHTML = `<div class="chart-wrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".38"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <line class="hover-line" x1="0" x2="0" y1="${P.t}" y2="${base}"/>
      <path class="area-path" d="${area}" fill="url(#${id})"/>
      <path class="line-path" d="${d}" pathLength="1" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
      ${dots}${xl}${hits}
    </svg><div class="chart-tip"></div></div>`;

    const wrap = el.firstElementChild;
    const svg = wrap.querySelector('svg');
    const hl = svg.querySelector('.hover-line');
    const clear = () => {
      hideTip(wrap);
      hl.style.opacity = 0;
      svg.querySelectorAll('.dot.on').forEach((c) => c.classList.remove('on'));
    };
    svg.querySelectorAll('rect[data-i]').forEach((r) => {
      r.addEventListener('mouseenter', () => {
        const i = +r.dataset.i;
        if (i > lastIndex) return clear();
        hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i)); hl.style.opacity = 1;
        svg.querySelectorAll('.dot').forEach((c) => c.classList.toggle('on', +c.dataset.i === i));
        tip(wrap, x(i), y(values[i]), `<span>${labels[i]}</span><b>${format(values[i])}</b>`);
      });
    });
    svg.addEventListener('mouseleave', clear);
  }

  /** Gráfica de barras (porcentaje) */
  function bars(el, { labels, values, details = [], color = '#8b5cf6', highlight = values.length - 1 }) {
    const W = Math.max(el.clientWidth, 260), H = 230;
    const P = { l: 40, r: 10, t: 18, b: 32 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b, base = P.t + ih;
    const n = labels.length, slot = iw / n, bw = Math.min(34, slot * 0.56);
    const cx = (i) => P.l + slot * i + slot / 2;
    const y = (v) => base - (v / 100) * ih;

    let grid = '';
    for (let v = 0; v <= 100; v += 25) {
      grid += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`
        + `<text class="axis" x="${P.l - 10}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
    }
    const body = values.map((v, i) => {
      const h = Math.max(base - y(v), v > 0 ? 4 : 0);
      return `<rect class="bar-track" x="${cx(i) - bw / 2}" y="${P.t}" width="${bw}" height="${ih}" rx="8"/>
        <rect class="bar ${i === highlight ? 'hl' : ''}" style="--c:${color};animation-delay:${i * 45}ms" x="${cx(i) - bw / 2}" y="${base - h}" width="${bw}" height="${h}" rx="8"/>
        <text class="axis ${i === highlight ? 'axis-active' : ''}" x="${cx(i)}" y="${H - 8}" text-anchor="middle">${labels[i]}</text>
        <rect data-i="${i}" x="${cx(i) - slot / 2}" y="${P.t}" width="${slot}" height="${ih}" fill="transparent"/>`;
    }).join('');

    el.innerHTML = `<div class="chart-wrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}${body}</svg><div class="chart-tip"></div></div>`;
    const wrap = el.firstElementChild;
    const svg = wrap.querySelector('svg');
    svg.querySelectorAll('rect[data-i]').forEach((r) => {
      r.addEventListener('mouseenter', () => {
        const i = +r.dataset.i;
        svg.querySelectorAll('.bar').forEach((b, j) => b.classList.toggle('hover', j === i));
        tip(wrap, cx(i), y(values[i]), `<span>${details[i] || labels[i]}</span><b>${values[i]}%</b>`);
      });
    });
    svg.addEventListener('mouseleave', () => {
      hideTip(wrap);
      svg.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover'));
    });
  }

  /** Dona con leyenda interactiva */
  function donut(el, { segments, unit = 'pts' }) {
    const segs = segments.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
    const total = segs.reduce((a, s) => a + s.value, 0);
    if (!total) {
      el.innerHTML = '<div class="empty-chart">Aún no hay datos suficientes. Completa hábitos para ver tu distribución.</div>';
      return;
    }
    const R = 68, C = 2 * Math.PI * R, gap = segs.length > 1 ? 3 : 0;
    let off = 0;
    const arcs = segs.map((s, i) => {
      const len = (s.value / total) * C;
      const a = `<circle class="arc" data-i="${i}" cx="90" cy="90" r="${R}" fill="none" stroke="${s.color}" stroke-width="18"
        stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`;
      off += len;
      return a;
    }).join('');
    const legend = segs.map((s, i) => `<li data-i="${i}"><i style="background:${s.color}"></i><span>${U.esc(s.label)}</span><b>${Math.round((s.value / total) * 100)}%</b></li>`).join('');

    el.innerHTML = `<div class="donut">
      <div class="donut-chart">
        <svg viewBox="0 0 180 180" width="180" height="180"><circle cx="90" cy="90" r="${R}" fill="none" class="arc-bg" stroke-width="18"/>${arcs}</svg>
        <div class="donut-center"><b>${U.fmt(total)}</b><span>${unit}</span></div>
      </div>
      <ul class="legend">${legend}</ul>
    </div>`;

    const root = el.firstElementChild;
    const center = root.querySelector('.donut-center');
    const set = (i) => {
      root.querySelectorAll('.arc').forEach((a) => a.classList.toggle('dim', i != null && +a.dataset.i !== i));
      root.querySelectorAll('.legend li').forEach((l) => l.classList.toggle('dim', i != null && +l.dataset.i !== i));
      center.innerHTML = i == null
        ? `<b>${U.fmt(total)}</b><span>${unit}</span>`
        : `<b>${U.fmt(segs[i].value)}</b><span>${U.esc(segs[i].label)}</span>`;
    };
    root.querySelectorAll('.arc, .legend li').forEach((n) => {
      n.addEventListener('mouseenter', () => set(+n.dataset.i));
      n.addEventListener('mouseleave', () => set(null));
    });
  }

  return { line, bars, donut };
})();
