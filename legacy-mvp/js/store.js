/* Persistencia en localStorage: hábitos, completados, recompensas y canjes */
const Store = (() => {
  const KEY = 'constancia-v1';
  const COLORS = ['#8b5cf6', '#22d3ee', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#fb7185', '#a3e635'];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  let s = null;

  const blank = () => ({ habits: [], rewards: [], completions: {}, redemptions: [] });

  /** Datos de ejemplo con ~8 semanas de historial para que el dashboard tenga contenido */
  function demo() {
    const st = blank();
    const t = U.today();
    const created = U.key(U.addDays(t, -70));
    const habits = [
      ['Hacer ejercicio', '🏃', COLORS[0], 15, [0, 2, 4]],
      ['Leer 20 minutos', '📚', COLORS[1], 10, ALL_DAYS],
      ['Meditar', '🧘', COLORS[2], 10, ALL_DAYS],
      ['Tomar 2 L de agua', '💧', COLORS[5], 5, ALL_DAYS],
      ['Estudiar programación', '💻', COLORS[3], 20, [0, 1, 2, 3, 4]],
    ];
    st.habits = habits.map(([name, icon, color, points, days]) => ({
      id: U.uid(), name, icon, color, points, days: [...days], createdAt: created,
    }));
    st.rewards = [
      ['Jugar 2 horas', '🎮', 150],
      ['Noche de película', '🎬', 120],
      ['Café especial', '☕', 60],
      ['Pedir mi comida favorita', '🍕', 250],
      ['Comprarme algo que me guste', '🛍️', 600],
      ['Día libre sin culpa', '🏖️', 1000],
    ].map(([name, icon, cost]) => ({ id: U.uid(), name, icon, cost }));

    // Pseudo-aleatorio determinista con tendencia de mejora
    let seed = 11;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const DAYS_BACK = 56;
    for (let i = DAYS_BACK; i >= 1; i--) {
      const d = U.addDays(t, -i);
      const k = U.key(d);
      const wd = U.weekdayIndex(d);
      const p = 0.45 + ((DAYS_BACK - i) / DAYS_BACK) * 0.4;
      st.habits.forEach((h) => {
        if (h.days.includes(wd) && rnd() < p) (st.completions[k] ||= {})[h.id] = h.points;
      });
    }

    const r = (name) => st.rewards.find((x) => x.name === name);
    [['Comprarme algo que me guste', 30], ['Noche de película', 20], ['Jugar 2 horas', 15],
      ['Pedir mi comida favorita', 10], ['Café especial', 6], ['Jugar 2 horas', 3]]
      .forEach(([name, ago]) => {
        const rw = r(name);
        const date = U.addDays(t, -ago);
        date.setHours(19, 30);
        st.redemptions.unshift({ id: U.uid(), rewardId: rw.id, name: rw.name, icon: rw.icon, cost: rw.cost, date: date.toISOString() });
      });
    return st;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(s));
  }

  function load() {
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
    if (!s || !Array.isArray(s.habits)) { s = demo(); save(); }
  }

  const habit = (id) => s.habits.find((h) => h.id === id);
  const reward = (id) => s.rewards.find((r) => r.id === id);
  const earned = () => Object.values(s.completions)
    .reduce((acc, day) => acc + Object.values(day).reduce((a, b) => a + b, 0), 0);
  const spent = () => s.redemptions.reduce((a, r) => a + r.cost, 0);

  return {
    COLORS,
    load,
    get habits() { return s.habits; },
    get rewards() { return s.rewards; },
    get redemptions() { return s.redemptions; },
    habit,
    reward,

    addHabit(data) {
      const h = { id: U.uid(), createdAt: U.key(U.today()), ...data };
      s.habits.push(h); save(); return h;
    },
    updateHabit(id, data) { Object.assign(habit(id), data); save(); },
    /** Los puntos ya ganados con el hábito se conservan en el saldo */
    deleteHabit(id) { s.habits = s.habits.filter((h) => h.id !== id); save(); },

    dayMap: (k) => s.completions[k] || {},
    isDone: (id, k) => !!(s.completions[k] && s.completions[k][id] != null),
    /** Marca/desmarca. Guarda los puntos otorgados en ese momento. */
    toggle(id, k) {
      const h = habit(id);
      const day = s.completions[k] || (s.completions[k] = {});
      if (day[id] != null) {
        const pts = day[id];
        delete day[id];
        if (!Object.keys(day).length) delete s.completions[k];
        save();
        return { done: false, points: pts };
      }
      day[id] = h.points;
      save();
      return { done: true, points: h.points };
    },

    earned,
    spent,
    balance: () => earned() - spent(),

    addReward(data) { const r = { id: U.uid(), ...data }; s.rewards.push(r); save(); return r; },
    updateReward(id, data) { Object.assign(reward(id), data); save(); },
    deleteReward(id) { s.rewards = s.rewards.filter((r) => r.id !== id); save(); },
    redeem(id) {
      const r = reward(id);
      if (!r || earned() - spent() < r.cost) return false;
      s.redemptions.unshift({ id: U.uid(), rewardId: r.id, name: r.name, icon: r.icon, cost: r.cost, date: new Date().toISOString() });
      save();
      return true;
    },

    resetDemo() { s = demo(); save(); },
    resetEmpty() { s = blank(); save(); },
  };
})();
