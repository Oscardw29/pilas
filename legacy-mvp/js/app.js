/* Lógica principal: vistas, interacción y modales */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');
  const modalRoot = $('#modalRoot');
  const toastRoot = $('#toastRoot');
  const { esc, fmt } = U;

  const HABIT_ICONS = ['🏃', '📚', '🧘', '💧', '💻', '🥗', '😴', '✍️', '💪', '🚶', '🎸', '🧹', '🌱', '💊', '🧠', '🎨', '📵', '☀️', '🙏', '💰'];
  const REWARD_ICONS = ['🎮', '🛍️', '🍕', '🎬', '☕', '🍦', '🎧', '📱', '🏖️', '🛋️', '🎁', '🍫', '📺', '🎟️', '✈️', '💆'];
  const QUOTES = [
    'La constancia vence lo que la dicha no alcanza.',
    'No tienes que ser extremo, solo constante.',
    'Pequeños pasos cada día construyen grandes cambios.',
    'La disciplina es elegir entre lo que quieres ahora y lo que más quieres.',
    'Lo que haces todos los días importa más que lo que haces de vez en cuando.',
    'Progreso, no perfección.',
    'Cada hábito completado es un voto por la persona que quieres ser.',
    'La motivación te pone en marcha; el hábito te mantiene en camino.',
    'Si fallas un día, no falles dos.',
    'Un 1% mejor cada día suma muchísimo al final del año.',
    'Tu yo del futuro te lo va a agradecer.',
    'Empieza donde estás, usa lo que tienes, haz lo que puedas.',
    'No rompas la cadena: un día más también es una victoria.',
    'Las recompensas llegan; disfruta también el proceso.',
  ];

  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  let quoteIdx = Math.floor((U.today() - startOfYear) / 864e5) % QUOTES.length;
  let weekStart = U.startOfWeek(U.today());

  /* ---------- Cálculos ---------- */
  const isScheduled = (h, d) => h.days.includes(U.weekdayIndex(d)) && U.key(d) >= h.createdAt;

  function weekStats(start) {
    const t = U.today();
    let scheduled = 0, doneScheduled = 0, done = 0, points = 0, target = 0, doneTarget = 0;
    const perDay = U.weekDays(start).map((d) => {
      const map = Store.dayMap(U.key(d));
      let dayPts = 0, dayDone = 0;
      Store.habits.forEach((h) => {
        const dn = map[h.id] != null;
        const sch = isScheduled(h, d);
        if (dn) { done++; dayDone++; dayPts += map[h.id]; }
        if (sch) { target++; if (dn) doneTarget++; }
        if (sch && d <= t) { scheduled++; if (dn) doneScheduled++; }
      });
      points += dayPts;
      return { date: d, points: dayPts, done: dayDone };
    });
    return {
      perDay, done, points, target, doneTarget,
      rate: scheduled ? Math.round((doneScheduled / scheduled) * 100) : 0,
    };
  }

  function streak() {
    const has = (d) => Object.keys(Store.dayMap(U.key(d))).length > 0;
    let d = U.today(), n = 0;
    if (!has(d)) d = U.addDays(d, -1);
    while (has(d)) { n++; d = U.addDays(d, -1); }
    return n;
  }

  function daysLabel(days) {
    const s = [...days].sort((a, b) => a - b);
    const k = s.join(',');
    if (s.length === 7) return 'Todos los días';
    if (k === '0,1,2,3,4') return 'Lun a Vie';
    if (k === '5,6') return 'Fines de semana';
    return s.map((i) => U.DAY_SHORT[i]).join(', ');
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  }

  /* ---------- Componentes ---------- */
  const habitIcon = (h, size = '') => `<span class="habit-icon ${size}" style="--c:${h.color}">${h.icon}</span>`;

  function stat(ic, color, label, value, sub, cls = '') {
    return `<div class="card stat">
      <div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon" style="--c:${color}">${icon(ic)}</span></div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub ${cls}">${sub}</div>
    </div>`;
  }

  function ring(done, total) {
    const r = 30, C = 2 * Math.PI * r, p = total ? done / total : 0;
    return `<svg viewBox="0 0 76 76" width="76" height="76">
      <circle cx="38" cy="38" r="${r}" class="ring-bg"/>
      <circle cx="38" cy="38" r="${r}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 38 38)"/>
    </svg><div class="ring-label"><b>${done}/${total}</b><span>hoy</span></div>`;
  }

  const emptyState = (title, text, action, label) => `<div class="empty">
      <div class="empty-icon">${icon('spark')}</div>
      <h3>${title}</h3><p>${text}</p>
      ${action ? `<button class="btn btn-primary" data-action="${action}">${icon('plus')} ${label}</button>` : ''}
    </div>`;

  /* ---------- Vista: Dashboard ---------- */
  function renderDashboard() {
    const t = U.today(), tk = U.key(t), ws = U.startOfWeek(t);
    const cur = weekStats(ws), prev = weekStats(U.addDays(ws, -7));
    const todayHabits = Store.habits.filter((h) => isScheduled(h, t) || Store.isDone(h.id, tk));
    const todayDone = todayHabits.filter((h) => Store.isDone(h.id, tk)).length;
    const bal = Store.balance();
    const st = streak();
    const diff = cur.rate - prev.rate;
    const todayPts = cur.perDay[U.weekdayIndex(t)].points;

    let title;
    if (!Store.habits.length) title = 'Crea tu primer hábito para empezar a sumar puntos';
    else if (!todayHabits.length) title = 'Hoy no tienes hábitos programados. ¡Disfruta tu día!';
    else if (todayDone === 0) title = new Date().getHours() < 12 ? 'Buen momento para arrancar el día' : 'Aún estás a tiempo de sumar puntos hoy';
    else if (todayDone < todayHabits.length) title = `Vas ${todayDone} de ${todayHabits.length} hoy. ¡Sigue así!`;
    else title = '¡Completaste todos tus hábitos de hoy!';

    const nextReward = [...Store.rewards].sort((a, b) => a.cost - b.cost).find((r) => r.cost > bal);
    const affordable = Store.rewards.filter((r) => r.cost <= bal).length;
    let goal = '';
    if (nextReward) goal = `Te faltan <b>${fmt(nextReward.cost - bal)} pts</b> para «${esc(nextReward.name)}»`;
    else if (affordable) goal = `Puedes canjear <b>${affordable}</b> recompensa${affordable > 1 ? 's' : ''}`;

    const todayList = todayHabits.length
      ? todayHabits.map((h) => {
        const dn = Store.isDone(h.id, tk);
        return `<button class="today-item ${dn ? 'done' : ''}" style="--c:${h.color}" data-action="toggle" data-habit="${h.id}" data-date="${tk}">
          ${habitIcon(h)}
          <span class="ti-text"><span class="ti-name">${esc(h.name)}</span><small>+${h.points} pts</small></span>
          <span class="ti-check">${icon('check')}</span>
        </button>`;
      }).join('')
      : `<p class="muted small">${Store.habits.length ? 'Nada programado para hoy.' : 'Aún no tienes hábitos.'}</p>`;

    return `
      <div class="page-head">
        <div><p class="eyebrow">${U.longDate(t)}</p><h1>${greeting()}</h1></div>
        <a class="btn btn-primary" href="#semana">${icon('calendar')} Registrar hábitos</a>
      </div>

      <section class="card motivation">
        <div class="ring">${ring(todayDone, todayHabits.length)}</div>
        <div class="motivation-body">
          <p class="motivation-title">${title}</p>
          <p class="quote" id="quote">“${QUOTES[quoteIdx]}”</p>
          ${goal ? `<p class="goal">${icon('gift')}<span>${goal}</span></p>` : ''}
        </div>
        <button class="icon-btn" data-action="next-quote" title="Otra frase" aria-label="Otra frase">${icon('refresh')}</button>
      </section>

      <section class="stats-grid">
        ${stat('spark', '#a78bfa', 'Puntos disponibles', fmt(bal), `+${fmt(cur.points)} esta semana`, 'up')}
        ${stat('check', '#34d399', 'Completados (semana)', `${cur.doneTarget}<small>/${cur.target}</small>`, `${Math.max(cur.target - cur.doneTarget, 0)} pendientes`)}
        ${stat('target', '#22d3ee', 'Cumplimiento', `${cur.rate}%`, `${diff >= 0 ? '+' : ''}${diff}% vs semana pasada`, diff >= 0 ? 'up' : 'down')}
        ${stat('flame', '#fbbf24', 'Racha actual', `${st}<small> día${st === 1 ? '' : 's'}</small>`, st ? '¡No rompas la cadena!' : 'Completa un hábito hoy')}
      </section>

      <section class="grid-main">
        <div class="card">
          <div class="card-head">
            <div><h3>Actividad de la semana</h3><p class="muted small">Puntos ganados por día</p></div>
            <span class="badge">+${todayPts} pts hoy</span>
          </div>
          <div class="chart" id="chartWeek"></div>
        </div>
        <div class="card">
          <div class="card-head">
            <div><h3>Hoy</h3><p class="muted small">${todayDone} de ${todayHabits.length} completados</p></div>
            <a class="link small" href="#semana">Ver semana ${icon('right')}</a>
          </div>
          <div class="today-list">${todayList}</div>
        </div>
      </section>

      <section class="grid-2">
        <div class="card">
          <div class="card-head"><div><h3>Cumplimiento semanal</h3><p class="muted small">Últimas 8 semanas</p></div></div>
          <div class="chart" id="chartBars"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Puntos por hábito</h3><p class="muted small">Últimos 30 días</p></div></div>
          <div id="chartDonut"></div>
        </div>
      </section>`;
  }

  function drawDashboardCharts() {
    const t = U.today(), ws = U.startOfWeek(t);
    const cur = weekStats(ws);
    const ti = U.weekdayIndex(t);
    const cw = $('#chartWeek');
    if (!cw) return;
    Charts.line(cw, {
      labels: U.DAY_SHORT, values: cur.perDay.map((d) => d.points),
      lastIndex: ti, activeIndex: ti, format: (v) => `${v} pts`,
    });

    const weeks = Array.from({ length: 8 }, (_, i) => U.addDays(ws, -7 * (7 - i)));
    Charts.bars($('#chartBars'), {
      labels: weeks.map((w, i) => (i === 7 ? 'Esta' : `${w.getDate()}/${w.getMonth() + 1}`)),
      details: weeks.map((w) => U.formatRange(w)),
      values: weeks.map((w) => weekStats(w).rate),
    });

    const totals = {};
    for (let i = 0; i < 30; i++) {
      const map = Store.dayMap(U.key(U.addDays(t, -i)));
      Object.entries(map).forEach(([id, p]) => { totals[id] = (totals[id] || 0) + p; });
    }
    Charts.donut($('#chartDonut'), {
      segments: Store.habits.map((h) => ({ label: h.name, value: totals[h.id] || 0, color: h.color })),
    });
  }

  /* ---------- Vista: Semana ---------- */
  function renderWeek() {
    const t = U.today();
    const days = U.weekDays(weekStart);
    const ws = weekStats(weekStart);
    const isCurrent = U.sameDay(weekStart, U.startOfWeek(t));
    const habits = Store.habits;
    const pct = ws.target ? Math.min(100, Math.round((ws.doneTarget / ws.target) * 100)) : 0;

    const head = days.map((d) => `<th class="${U.sameDay(d, t) ? 'is-today' : ''}"><span>${U.DAY_SHORT[U.weekdayIndex(d)]}</span><b>${d.getDate()}</b></th>`).join('');

    const rows = habits.map((h) => {
      let done = 0, target = 0;
      const cells = days.map((d) => {
        const k = U.key(d);
        const dn = Store.isDone(h.id, k);
        const sch = isScheduled(h, d);
        if (dn) done++;
        if (sch) target++;
        const future = d > t;
        const cls = dn ? 'done' : sch ? '' : 'off';
        const title = future ? 'Día futuro' : dn ? 'Completado · clic para desmarcar' : sch ? 'Marcar como completado' : 'No programado (puedes marcarlo como extra)';
        return `<td class="${U.sameDay(d, t) ? 'is-today' : ''}"><button class="cell ${cls}" style="--c:${h.color}" data-action="toggle" data-habit="${h.id}" data-date="${k}" title="${title}" ${future ? 'disabled' : ''}>${icon('check')}</button></td>`;
      }).join('');
      const p = target ? Math.min(100, Math.round((done / target) * 100)) : done ? 100 : 0;
      return `<tr>
        <td class="col-habit"><div class="habit-cell">${habitIcon(h)}<div><div class="habit-name">${esc(h.name)}</div><div class="habit-meta">+${h.points} pts · ${daysLabel(h.days)}</div></div></div></td>
        ${cells}
        <td class="col-progress"><div class="progress-row"><div class="mini-progress"><div style="width:${p}%;background:${h.color}"></div></div><span>${done}/${target}</span></div></td>
        <td class="col-actions">
          <button class="icon-btn sm" data-action="edit-habit" data-id="${h.id}" title="Editar">${icon('edit')}</button>
          <button class="icon-btn sm danger" data-action="delete-habit" data-id="${h.id}" title="Eliminar">${icon('trash')}</button>
        </td>
      </tr>`;
    }).join('');

    return `
      <div class="page-head">
        <div><p class="eyebrow">Seguimiento semanal</p><h1>Mi semana</h1></div>
        <button class="btn btn-primary" data-action="add-habit">${icon('plus')} Nuevo hábito</button>
      </div>

      <section class="card week-card">
        <div class="week-bar">
          <div class="week-nav">
            <button class="icon-btn" data-action="week-prev" aria-label="Semana anterior">${icon('left')}</button>
            <div class="week-range">${U.formatRange(weekStart)}${isCurrent ? '<span class="tag">Esta semana</span>' : ''}</div>
            <button class="icon-btn" data-action="week-next" aria-label="Semana siguiente">${icon('right')}</button>
            ${isCurrent ? '' : `<button class="btn btn-ghost sm" data-action="week-today">Hoy</button>`}
          </div>
          <div class="week-summary">
            <div class="ws-item"><span>Progreso</span><b>${pct}%</b></div>
            <div class="ws-item"><span>Completados</span><b>${ws.doneTarget}/${ws.target}</b></div>
            <div class="ws-item"><span>Puntos</span><b class="accent">+${fmt(ws.points)}</b></div>
          </div>
        </div>
        <div class="week-progress"><div style="width:${pct}%"></div></div>
        ${habits.length ? `<div class="table-wrap"><table class="tracker">
          <thead><tr><th class="col-habit">Hábito</th>${head}<th class="col-progress">Progreso</th><th class="col-actions"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="legend-note"><span><i class="ln done"></i>Completado</span><span><i class="ln"></i>Programado</span><span><i class="ln off"></i>No programado (cuenta como extra)</span></p>`
        : emptyState('Aún no tienes hábitos', 'Crea tu primer hábito, asígnale puntos y empieza a construir tu semana.', 'add-habit', 'Crear hábito')}
      </section>`;
  }

  /* ---------- Vista: Recompensas ---------- */
  function renderRewards() {
    const bal = Store.balance();
    const cards = [...Store.rewards].sort((a, b) => a.cost - b.cost).map((r) => {
      const ok = bal >= r.cost;
      const p = Math.max(0, Math.min(100, Math.round((bal / r.cost) * 100)));
      return `<div class="card reward-card ${ok ? '' : 'locked'}">
        <div class="reward-top">
          <span class="reward-icon">${r.icon}</span>
          <div class="reward-actions">
            <button class="icon-btn sm" data-action="edit-reward" data-id="${r.id}" title="Editar">${icon('edit')}</button>
            <button class="icon-btn sm danger" data-action="delete-reward" data-id="${r.id}" title="Eliminar">${icon('trash')}</button>
          </div>
        </div>
        <h3>${esc(r.name)}</h3>
        <div class="reward-cost">${icon('spark')} ${fmt(r.cost)} pts</div>
        <div class="mini-progress"><div style="width:${p}%"></div></div>
        <p class="reward-hint">${ok ? 'Disponible para canjear' : `Te faltan ${fmt(r.cost - bal)} pts`}</p>
        <button class="btn ${ok ? 'btn-primary' : 'btn-muted'} block" data-action="redeem" data-id="${r.id}" ${ok ? '' : 'disabled'}>${ok ? 'Canjear' : `${icon('lock')} Bloqueada`}</button>
      </div>`;
    }).join('');

    const history = Store.redemptions.slice(0, 12).map((x) => `<li>
        <span class="h-icon">${x.icon}</span>
        <div class="h-text"><b>${esc(x.name)}</b><small>${U.shortDateTime(x.date)}</small></div>
        <span class="h-cost">−${fmt(x.cost)} pts</span>
      </li>`).join('');

    return `
      <div class="page-head">
        <div><p class="eyebrow">Tu esfuerzo tiene premio</p><h1>Recompensas</h1></div>
        <button class="btn btn-primary" data-action="add-reward">${icon('plus')} Nueva recompensa</button>
      </div>

      <section class="card balance-card">
        <div>
          <span class="eyebrow">Puntos disponibles</span>
          <div class="balance">${fmt(bal)}<small> pts</small></div>
        </div>
        <div class="balance-stats">
          <div><span>Ganados</span><b>${fmt(Store.earned())}</b></div>
          <div><span>Canjeados</span><b>${fmt(Store.spent())}</b></div>
          <div><span>Canjes</span><b>${Store.redemptions.length}</b></div>
        </div>
      </section>

      ${Store.rewards.length ? `<section class="rewards-grid">${cards}</section>`
        : `<section class="card">${emptyState('Sin recompensas todavía', 'Agrega cosas que disfrutes —jugar 2 horas, comprar algo que te guste— y canjéalas con tus puntos.', 'add-reward', 'Crear recompensa')}</section>`}

      <section class="card">
        <div class="card-head"><div><h3>Historial de canjes</h3><p class="muted small">Tus últimas recompensas</p></div></div>
        ${history ? `<ul class="history">${history}</ul>` : '<p class="muted small">Todavía no has canjeado recompensas.</p>'}
      </section>`;
  }

  /* ---------- Router ---------- */
  const ROUTES = {
    dashboard: { render: renderDashboard, after: drawDashboardCharts },
    semana: { render: renderWeek },
    recompensas: { render: renderRewards },
  };
  const currentRoute = () => (ROUTES[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');

  function render() {
    const r = currentRoute();
    view.innerHTML = ROUTES[r].render();
    ROUTES[r].after?.();
    $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
    const bal = fmt(Store.balance());
    $$('.js-points').forEach((el) => { el.textContent = bal; });
  }

  /* ---------- Modales ---------- */
  function openModal(html, onMount) {
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const bd = modalRoot.firstElementChild;
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeModal(); });
    requestAnimationFrame(() => bd.classList.add('open'));
    const m = $('.modal', bd);
    onMount?.(m);
    setTimeout(() => $('input:not([type=radio]):not([type=checkbox])', m)?.focus(), 60);
  }
  function closeModal() {
    const bd = modalRoot.firstElementChild;
    if (!bd) return;
    bd.classList.remove('open');
    setTimeout(() => { if (modalRoot.firstElementChild === bd) modalRoot.innerHTML = ''; }, 180);
  }
  const modalHead = (title) => `<div class="modal-head"><h2>${title}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">${icon('x')}</button></div>`;

  function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false }) {
    return new Promise((resolve) => {
      openModal(`${modalHead(title)}<p class="modal-text">${message}</p>
        <div class="modal-foot"><button class="btn btn-ghost" data-r="0">Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${confirmText}</button></div>`,
      (m) => {
        $$('[data-r]', m).forEach((b) => b.addEventListener('click', () => { closeModal(); resolve(b.dataset.r === '1'); }));
        setTimeout(() => $('[data-r="1"]', m).focus(), 60);
      });
    });
  }

  function iconPicker(list, current, name) {
    const icons = list.includes(current) ? list : [current, ...list];
    return `<div class="emoji-grid">${icons.map((i) => `<label class="emoji-opt"><input type="radio" name="${name}" value="${i}" ${i === current ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>`;
  }

  function habitForm(h) {
    const d = h || { name: '', icon: HABIT_ICONS[0], color: Store.COLORS[Store.habits.length % Store.COLORS.length], points: 10, days: [0, 1, 2, 3, 4, 5, 6] };
    openModal(`<form class="form" novalidate>
      ${modalHead(h ? 'Editar hábito' : 'Nuevo hábito')}
      <label class="field"><span>Nombre</span><input name="name" maxlength="40" required placeholder="Ej. Leer 20 minutos" value="${esc(d.name)}"></label>
      <div class="field"><span>Icono</span>${iconPicker(HABIT_ICONS, d.icon, 'icon')}</div>
      <div class="field"><span>Color</span><div class="swatches">${Store.COLORS.map((c) => `<label class="swatch"><input type="radio" name="color" value="${c}" ${c === d.color ? 'checked' : ''}><span style="--c:${c}"></span></label>`).join('')}</div></div>
      <div class="field"><span>Puntos al completarlo</span>
        <div class="points-row"><input type="number" name="points" min="1" max="1000" value="${d.points}">
          <div class="chips">${[5, 10, 15, 20, 30].map((p) => `<button type="button" class="chip" data-action="set-points" data-v="${p}">${p}</button>`).join('')}</div>
        </div>
        ${h ? '<small class="hint">El cambio de puntos aplica a los nuevos registros; tu historial se conserva.</small>' : ''}
      </div>
      <div class="field"><span>Días de la semana</span>
        <div class="day-chips">${U.DAY_SHORT.map((l, i) => `<label class="day-chip"><input type="checkbox" name="days" value="${i}" ${d.days.includes(i) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </div>
      <p class="form-error" hidden></p>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-primary">${h ? 'Guardar cambios' : 'Crear hábito'}</button></div>
    </form>`, (m) => {
      const form = $('form', m);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        const days = fd.getAll('days').map(Number);
        const points = Math.min(1000, Math.max(1, parseInt(fd.get('points'), 10) || 0));
        const err = $('.form-error', form);
        const fail = (msg) => { err.textContent = msg; err.hidden = false; };
        if (!name) return fail('Escribe un nombre para el hábito.');
        if (!days.length) return fail('Selecciona al menos un día.');
        const data = { name, icon: fd.get('icon'), color: fd.get('color'), points, days };
        if (h) { Store.updateHabit(h.id, data); toast('Hábito actualizado'); }
        else { Store.addHabit(data); toast(`Hábito «${esc(name)}» creado`); }
        closeModal(); render();
      });
    });
  }

  function rewardForm(r) {
    const d = r || { name: '', icon: REWARD_ICONS[0], cost: 100 };
    openModal(`<form class="form" novalidate>
      ${modalHead(r ? 'Editar recompensa' : 'Nueva recompensa')}
      <label class="field"><span>¿Qué te quieres regalar?</span><input name="name" maxlength="50" required placeholder="Ej. Jugar 2 horas" value="${esc(d.name)}"></label>
      <div class="field"><span>Icono</span>${iconPicker(REWARD_ICONS, d.icon, 'icon')}</div>
      <div class="field"><span>Costo en puntos</span>
        <div class="points-row"><input type="number" name="cost" min="1" max="100000" value="${d.cost}">
          <div class="chips">${[50, 100, 250, 500, 1000].map((p) => `<button type="button" class="chip" data-action="set-cost" data-v="${p}">${p}</button>`).join('')}</div>
        </div>
      </div>
      <p class="form-error" hidden></p>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="close-modal">Cancelar</button><button type="submit" class="btn btn-primary">${r ? 'Guardar cambios' : 'Crear recompensa'}</button></div>
    </form>`, (m) => {
      const form = $('form', m);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        const cost = parseInt(fd.get('cost'), 10);
        const err = $('.form-error', form);
        if (!name) { err.textContent = 'Escribe un nombre para la recompensa.'; err.hidden = false; return; }
        if (!(cost > 0)) { err.textContent = 'El costo debe ser mayor a 0.'; err.hidden = false; return; }
        const data = { name, icon: fd.get('icon'), cost };
        if (r) { Store.updateReward(r.id, data); toast('Recompensa actualizada'); }
        else { Store.addReward(data); toast(`Recompensa «${esc(name)}» creada`); }
        closeModal(); render();
      });
    });
  }

  function settingsModal() {
    openModal(`${modalHead('Datos de la app')}
      <p class="modal-text">Tus datos se guardan localmente en este navegador.</p>
      <div class="settings-list">
        <button class="setting" data-action="reset-demo">${icon('refresh')}<div><b>Cargar datos de ejemplo</b><small>Reemplaza todo con hábitos e historial de demostración.</small></div></button>
        <button class="setting danger" data-action="reset-empty">${icon('trash')}<div><b>Empezar desde cero</b><small>Borra hábitos, puntos, recompensas e historial.</small></div></button>
      </div>`);
  }

  /* ---------- Toasts ---------- */
  function toast(html, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'success' ? 'check' : type === 'reward' ? 'gift' : 'spark')}<span>${html}</span>`;
    toastRoot.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  /* ---------- Acciones ---------- */
  function onToggle(hid, k) {
    if (U.fromKey(k) > U.today()) return;
    const h = Store.habit(hid);
    if (!h) return;
    const r = Store.toggle(hid, k);
    if (r.done) toast(`<b>+${r.points} pts</b> · ${esc(h.name)}`);
    else toast(`−${r.points} pts · ${esc(h.name)} desmarcado`, 'neutral');

    if (r.done && k === U.key(U.today())) {
      const t = U.today();
      const todays = Store.habits.filter((x) => isScheduled(x, t));
      if (todays.length && todays.every((x) => Store.isDone(x.id, k))) {
        setTimeout(() => toast('¡Día completo! Todos tus hábitos de hoy están hechos', 'reward'), 350);
      }
    }
    render();
    $(`[data-action="toggle"][data-habit="${hid}"][data-date="${k}"]`)?.classList.add('pop');
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.disabled) return;
    const id = t.dataset.id;
    switch (t.dataset.action) {
      case 'toggle': onToggle(t.dataset.habit, t.dataset.date); break;
      case 'close-modal': closeModal(); break;
      case 'week-prev': weekStart = U.addDays(weekStart, -7); render(); break;
      case 'week-next': weekStart = U.addDays(weekStart, 7); render(); break;
      case 'week-today': weekStart = U.startOfWeek(U.today()); render(); break;
      case 'next-quote': {
        quoteIdx = (quoteIdx + 1) % QUOTES.length;
        const q = $('#quote');
        if (q) { q.classList.remove('fade'); void q.offsetWidth; q.textContent = `“${QUOTES[quoteIdx]}”`; q.classList.add('fade'); }
        break;
      }
      case 'add-habit': habitForm(); break;
      case 'edit-habit': habitForm(Store.habit(id)); break;
      case 'delete-habit': {
        const h = Store.habit(id);
        const ok = await confirmDialog({ title: 'Eliminar hábito', message: `¿Seguro que quieres eliminar «${esc(h.name)}»? Los puntos que ya ganaste con él se conservan.`, confirmText: 'Eliminar', danger: true });
        if (ok) { Store.deleteHabit(id); toast('Hábito eliminado', 'neutral'); render(); }
        break;
      }
      case 'set-points': case 'set-cost': {
        const input = t.closest('form').querySelector(t.dataset.action === 'set-points' ? '[name=points]' : '[name=cost]');
        input.value = t.dataset.v;
        break;
      }
      case 'add-reward': rewardForm(); break;
      case 'edit-reward': rewardForm(Store.reward(id)); break;
      case 'delete-reward': {
        const r = Store.reward(id);
        const ok = await confirmDialog({ title: 'Eliminar recompensa', message: `¿Eliminar «${esc(r.name)}»? Tu historial de canjes no se modifica.`, confirmText: 'Eliminar', danger: true });
        if (ok) { Store.deleteReward(id); toast('Recompensa eliminada', 'neutral'); render(); }
        break;
      }
      case 'redeem': {
        const r = Store.reward(id);
        const ok = await confirmDialog({ title: 'Canjear recompensa', message: `<span class="redeem-preview"><span>${r.icon}</span><b>${esc(r.name)}</b></span>Se descontarán <b>${fmt(r.cost)} pts</b>. Te quedarán <b>${fmt(Store.balance() - r.cost)} pts</b>.`, confirmText: 'Canjear' });
        if (ok && Store.redeem(id)) { toast(`¡Disfruta! «${esc(r.name)}» canjeada`, 'reward'); render(); }
        break;
      }
      case 'open-settings': settingsModal(); break;
      case 'reset-demo': {
        closeModal();
        const ok = await confirmDialog({ title: 'Cargar datos de ejemplo', message: 'Esto reemplazará todos tus datos actuales. ¿Continuar?', confirmText: 'Cargar ejemplo', danger: true });
        if (ok) { Store.resetDemo(); weekStart = U.startOfWeek(U.today()); toast('Datos de ejemplo cargados'); render(); }
        break;
      }
      case 'reset-empty': {
        closeModal();
        const ok = await confirmDialog({ title: 'Empezar desde cero', message: 'Se borrarán todos tus hábitos, puntos, recompensas e historial. Esta acción no se puede deshacer.', confirmText: 'Borrar todo', danger: true });
        if (ok) { Store.resetEmpty(); weekStart = U.startOfWeek(U.today()); toast('Listo, empezaste desde cero', 'neutral'); render(); }
        break;
      }
      default: break;
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (currentRoute() === 'dashboard') drawDashboardCharts(); }, 150);
  });

  /* ---------- Inicio ---------- */
  $$('i[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
  Store.load();
  render();
})();
