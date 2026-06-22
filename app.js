/* app.js — UI + logic for the workout journal mini app */
(function () {
  "use strict";

  const tg = window.Telegram && window.Telegram.WebApp;
  const view = document.getElementById("view");
  const toastEl = document.getElementById("toast");

  // ---------- small helpers ----------
  const MON = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  const MONC = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];

  const round1 = (n) => Math.round(n * 10) / 10;
  const oneRM = (w, r) => round1(w * (1 + r / 30));        // Epley — matches the spreadsheet
  const volume = (w, r) => w * r;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parts(iso) { const [y, m, d] = (iso || "").split("-").map(Number); return { y, m: m - 1, d }; }
  function fmtDate(iso) { const p = parts(iso); return `${String(p.d).padStart(2, "0")}.${String(p.m + 1).padStart(2, "0")}.${p.y}`; }
  function fmtDay(iso) { const p = parts(iso); return `${p.d} ${MON[p.m]}`; }
  function monthKey(iso) { const p = parts(iso); return `${p.y}-${String(p.m + 1).padStart(2, "0")}`; }
  function monthLabel(key) { const [y, m] = key.split("-").map(Number); return `${MONC[m - 1]} ${y}`; }
  function fmtNum(n) { return (Math.round(n * 10) / 10).toLocaleString("ru-RU"); }

  function haptic(type) {
    try { if (tg && tg.HapticFeedback) {
      if (type === "ok") tg.HapticFeedback.notificationOccurred("success");
      else if (type === "err") tg.HapticFeedback.notificationOccurred("error");
      else tg.HapticFeedback.impactOccurred("light");
    } } catch (e) {}
  }
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  // ---------- derived data ----------
  function byDate(sets) {
    const m = new Map();
    for (const s of sets) { if (!m.has(s.date)) m.set(s.date, []); m.get(s.date).push(s); }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)); // newest first
  }
  function dayWorkout(daySets) {
    const w = daySets.find((s) => s.workout)?.workout;
    return w || "";
  }
  // best 1RM per exercise at the moment each set happened → flags PRs
  function prFlags(sets) {
    const sorted = [...sets].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.setNo - b.setNo));
    const best = new Map(); const flag = new Set();
    for (const s of sorted) {
      const orm = oneRM(s.weight, s.reps);
      const prev = best.get(s.exercise) || 0;
      if (orm > prev + 1e-9) { best.set(s.exercise, orm); flag.add(s.id); }
    }
    return flag;
  }

  // ---------- charts (hand-rolled SVG) ----------
  function lineChart(points, { unit = "" } = {}) {
    if (points.length === 0) return `<div class="chart-empty">Нет данных</div>`;
    const W = 320, H = 160, pad = { l: 34, r: 10, t: 22, b: 24 };
    const xs = points.map((_, i) => i);
    const ys = points.map((p) => p.y);
    let min = Math.min(...ys), max = Math.max(...ys);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    const px = (i) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
    const py = (v) => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
    const area = `${line} L${px(points.length - 1).toFixed(1)},${(H - pad.b).toFixed(1)} L${px(0).toFixed(1)},${(H - pad.b).toFixed(1)} Z`;
    // y gridlines (3)
    let grid = "";
    for (let g = 0; g <= 2; g++) {
      const v = min + (range * g) / 2; const y = py(v);
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="rgba(128,128,128,.18)" stroke-width="1"/>`;
      grid += `<text x="2" y="${(y + 3).toFixed(1)}" fill="var(--hint)" font-size="9">${fmtNum(v)}</text>`;
    }
    const dots = points.map((p, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3" fill="var(--link)"/>`).join("");
    // x labels: first, middle, last
    const idxs = points.length <= 4 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
    const xlabels = idxs.map((i) => `<text x="${px(i).toFixed(1)}" y="${H - 6}" fill="var(--hint)" font-size="9" text-anchor="middle">${esc(points[i].x)}</text>`).join("");
    const last = points[points.length - 1];
    const lblY = Math.min(Math.max(py(last.y) - 7, 11), H - pad.b - 4); // keep peak label inside the viewBox
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      <path d="${area}" fill="var(--link)" opacity="0.10"/>
      <path d="${line}" fill="none" stroke="var(--link)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xlabels}
      <text x="${W - pad.r}" y="${lblY.toFixed(1)}" fill="var(--text)" font-size="11" font-weight="700" text-anchor="end">${fmtNum(last.y)}${unit}</text>
    </svg>`;
  }

  function barChart(items, { unit = "" } = {}) {
    if (items.length === 0) return `<div class="chart-empty">Нет данных</div>`;
    const W = 320, H = 170, pad = { l: 8, r: 8, t: 18, b: 26 };
    const max = Math.max(...items.map((i) => i.value), 1);
    const n = items.length;
    const slot = (W - pad.l - pad.r) / n;
    const bw = Math.min(slot * 0.62, 46);
    let bars = "";
    items.forEach((it, i) => {
      const h = ((it.value / max) * (H - pad.t - pad.b));
      const x = pad.l + slot * i + (slot - bw) / 2;
      const y = H - pad.b - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="4" fill="var(--accent)"/>`;
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" fill="var(--text)" font-size="9" text-anchor="middle" font-weight="700">${fmtNum(it.value)}</text>`;
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" fill="var(--hint)" font-size="9" text-anchor="middle">${esc(it.label)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
  }

  // ---------- LOG view ----------
  const form = { date: todayISO(), workout: "", exercise: "", weight: "", reps: "", notes: "", setNo: 1 };
  let lastAddedId = null; // newly added set — highlighted + scrolled into view on next list render

  function nextSetNo() {
    const same = Store.sets().filter((s) => s.date === form.date && s.exercise === form.exercise);
    return same.length ? Math.max(...same.map((s) => s.setNo)) + 1 : 1;
  }

  function renderLog() {
    form.setNo = nextSetNo();
    const wOpts = Store.workouts().map((w) => `<option value="${esc(w)}">`).join("");
    const eOpts = Store.exercises().map((e) => `<option value="${esc(e)}">`).join("");
    const liveW = parseFloat(form.weight), liveR = parseFloat(form.reps);
    const liveOk = liveW > 0 && liveR > 0;

    const html = `
      <h1>Журнал тренировок</h1>
      <p class="subtitle">Записывай по одному рабочему подходу. Объём и 1ПМ считаются сами.</p>

      <div class="card">
        <div class="row">
          <div class="field"><label>Дата</label>
            <input type="date" id="f-date" value="${form.date}"></div>
          <div class="field"><label>Тренировка</label>
            <input id="f-workout" list="dl-workout" placeholder="напр. Ноги" value="${esc(form.workout)}">
            <datalist id="dl-workout">${wOpts}</datalist></div>
        </div>
        <div class="field"><label>Упражнение</label>
          <input id="f-exercise" list="dl-exercise" placeholder="Выбери или впиши" value="${esc(form.exercise)}">
          <datalist id="dl-exercise">${eOpts}</datalist></div>
        <div class="row">
          <div class="field"><label>Вес (кг) · подход №${form.setNo}</label>
            <div class="numwrap">
              <button class="stepbtn" data-step="weight" data-by="-2.5">−</button>
              <input type="number" inputmode="decimal" id="f-weight" step="0.5" placeholder="0" value="${esc(form.weight)}">
              <button class="stepbtn" data-step="weight" data-by="2.5">+</button>
            </div></div>
          <div class="field"><label>Повторы</label>
            <div class="numwrap">
              <button class="stepbtn" data-step="reps" data-by="-1">−</button>
              <input type="number" inputmode="numeric" id="f-reps" step="1" placeholder="0" value="${esc(form.reps)}">
              <button class="stepbtn" data-step="reps" data-by="1">+</button>
            </div></div>
        </div>
        <div class="calc">
          <span>Объём: <b>${liveOk ? fmtNum(volume(liveW, liveR)) : "—"}</b> кг</span>
          <span>Расч. 1ПМ: <b>${liveOk ? fmtNum(oneRM(liveW, liveR)) : "—"}</b> кг</span>
        </div>
        <div class="field"><label>Заметки (необязательно)</label>
          <input id="f-notes" placeholder="напр. узкий хват" value="${esc(form.notes)}"></div>
        <button class="btn" id="f-add">＋ Добавить подход</button>
      </div>

      <div id="log-list"></div>
    `;
    view.innerHTML = `<div class="fade-in">${html}</div>`;
    bindLogForm();
    renderLogList();
  }

  function bindLogForm() {
    const bind = (id, key, num) => {
      const el = document.getElementById(id);
      el.addEventListener("input", () => { form[key] = el.value; });
    };
    bind("f-date", "date");
    bind("f-workout", "workout");
    bind("f-exercise", "exercise");
    bind("f-weight", "weight");
    bind("f-reps", "reps");
    bind("f-notes", "notes");

    // date / exercise changes affect the set number + live calc
    document.getElementById("f-date").addEventListener("change", () => softRefreshLog());
    document.getElementById("f-exercise").addEventListener("change", () => softRefreshLog());
    ["f-weight", "f-reps"].forEach((id) =>
      document.getElementById(id).addEventListener("input", updateCalc));

    document.querySelectorAll(".stepbtn").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.dataset.step, by = parseFloat(b.dataset.by);
        const cur = parseFloat(form[key]) || 0;
        const val = Math.max(0, Math.round((cur + by) * 10) / 10);
        form[key] = String(val);
        document.getElementById("f-" + key).value = form[key];
        updateCalc();
        haptic("light");
      }));

    document.getElementById("f-add").addEventListener("click", addSet);
  }

  function updateCalc() {
    const w = parseFloat(document.getElementById("f-weight").value);
    const r = parseFloat(document.getElementById("f-reps").value);
    const ok = w > 0 && r > 0;
    const c = view.querySelector(".calc");
    if (c) c.innerHTML =
      `<span>Объём: <b>${ok ? fmtNum(volume(w, r)) : "—"}</b> кг</span>` +
      `<span>Расч. 1ПМ: <b>${ok ? fmtNum(oneRM(w, r)) : "—"}</b> кг</span>`;
  }

  function softRefreshLog() {
    form.setNo = nextSetNo();
    const lbl = view.querySelector('label[for], .field label');
    const wl = [...view.querySelectorAll(".field label")].find((l) => l.textContent.startsWith("Вес"));
    if (wl) wl.textContent = `Вес (кг) · подход №${form.setNo}`;
  }

  function addSet() {
    const w = parseFloat(form.weight), r = parseFloat(form.reps);
    if (!form.exercise.trim()) { toast("Укажи упражнение"); haptic("err"); return; }
    if (!(w > 0) || !(r > 0)) { toast("Вес и повторы должны быть > 0"); haptic("err"); return; }
    const set = Store.addSet({
      date: form.date, workout: form.workout.trim(), exercise: form.exercise.trim(),
      setNo: nextSetNo(), weight: w, reps: r, notes: form.notes.trim(),
    });
    lastAddedId = set.id;
    haptic("ok");
    toast("Подход добавлен");
    // keep weight/reps/exercise for the next set; clear only the note field
    form.notes = "";
    const notesEl = document.getElementById("f-notes");
    if (notesEl) notesEl.value = "";
    // bump the set-number label + refresh suggestions without rebuilding the form
    form.setNo = nextSetNo();
    const wl = [...view.querySelectorAll(".field label")].find((l) => l.textContent.startsWith("Вес"));
    if (wl) wl.textContent = `Вес (кг) · подход №${form.setNo}`;
    refreshDatalists();
    renderLogList();
  }

  function refreshDatalists() {
    const dlw = document.getElementById("dl-workout");
    const dle = document.getElementById("dl-exercise");
    if (dlw) dlw.innerHTML = Store.workouts().map((w) => `<option value="${esc(w)}">`).join("");
    if (dle) dle.innerHTML = Store.exercises().map((e) => `<option value="${esc(e)}">`).join("");
  }

  function renderLogList() {
    const box = document.getElementById("log-list");
    const sets = Store.sets();
    if (!sets.length) {
      box.innerHTML = `<div class="empty"><span class="big">🏋️</span>Пока нет записей.<br>Добавь первый подход выше.</div>`;
      return;
    }
    const flags = prFlags(sets);
    const days = byDate(sets).slice(0, 60); // show recent 60 days
    let html = "";
    for (const [date, daySets] of days) {
      const wt = dayWorkout(daySets);
      const vol = daySets.reduce((a, s) => a + volume(s.weight, s.reps), 0);
      // group by exercise within the day, preserving order
      const exOrder = []; const byEx = new Map();
      for (const s of daySets) { if (!byEx.has(s.exercise)) { byEx.set(s.exercise, []); exOrder.push(s.exercise); } byEx.get(s.exercise).push(s); }
      let inner = "";
      for (const ex of exOrder) {
        inner += `<div class="ex-name">${esc(ex)}</div>`;
        const list = byEx.get(ex).sort((a, b) => a.setNo - b.setNo);
        // collapse consecutive sets with identical weight × reps into one row
        const runs = [];
        for (const s of list) {
          const prev = runs[runs.length - 1];
          if (prev && prev.weight === s.weight && prev.reps === s.reps) prev.items.push(s);
          else runs.push({ weight: s.weight, reps: s.reps, items: [s] });
        }
        for (const run of runs) {
          const n = run.items.length;
          const isPR = run.items.some((s) => flags.has(s.id));
          const notes = [...new Set(run.items.map((s) => s.notes).filter(Boolean))].join("; ");
          const totalVol = run.weight * run.reps * n;
          const lastId = run.items[n - 1].id;                 // tapping ✕ peels the last set
          const badge = n > 1 ? `${n}×` : String(run.items[0].setNo);
          inner += `<div class="set-line" data-set="${lastId}">
            <span class="no">${badge}</span>
            <span class="wr"><b>${fmtNum(run.weight)}</b> кг × <b>${run.reps}</b>${isPR ? ' <span class="pr">🏆</span>' : ""}
              ${notes ? `<span class="note">${esc(notes)}</span>` : ""}</span>
            <span class="vol">${fmtNum(totalVol)} кг<br>1ПМ ${fmtNum(oneRM(run.weight, run.reps))}</span>
            <button class="del" data-del="${lastId}" data-count="${n}">✕</button>
          </div>`;
        }
      }
      html += `<div class="day-group">
        <div class="day-head"><span class="date">${fmtDate(date)}${wt ? `<span class="workout-tag">${esc(wt)}</span>` : ""}</span>
          <span class="meta">${daySets.length} подх. · ${fmtNum(vol)} кг</span></div>
        ${inner}
      </div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        const cnt = parseInt(b.dataset.count || "1", 10);
        if (cnt > 1) { Store.deleteSet(b.dataset.del); haptic("ok"); renderLog(); } // peel one from the group
        else confirmThen("Удалить этот подход?", () => { Store.deleteSet(b.dataset.del); haptic("ok"); renderLog(); });
      }));
    // flash + reveal the set that was just added
    if (lastAddedId) {
      const el = box.querySelector(`.set-line[data-set="${lastAddedId}"]`);
      if (el) { el.classList.add("just-added"); try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} }
      lastAddedId = null;
    }
  }

  // ---------- PROGRESS view ----------
  let progEx = null;
  function renderProgress() {
    const sets = Store.sets();
    const exWithData = [...new Set(sets.map((s) => s.exercise))].sort((a, b) => a.localeCompare(b, "ru"));
    if (!exWithData.length) { view.innerHTML = emptyState("Нет данных для прогресса"); return; }
    if (!progEx || !exWithData.includes(progEx)) {
      // default: most recently trained exercise
      const last = [...sets].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      progEx = last ? last.exercise : exWithData[0];
    }
    const opts = exWithData.map((e) => `<option value="${esc(e)}" ${e === progEx ? "selected" : ""}>${esc(e)}</option>`).join("");

    // per-session aggregation
    const exSets = sets.filter((s) => s.exercise === progEx);
    const sessions = new Map();
    for (const s of exSets) {
      if (!sessions.has(s.date)) sessions.set(s.date, []);
      sessions.get(s.date).push(s);
    }
    const rows = [...sessions.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, ss]) => {
      const maxW = Math.max(...ss.map((s) => s.weight));
      const repsAtMax = Math.max(...ss.filter((s) => s.weight === maxW).map((s) => s.reps));
      const best1rm = Math.max(...ss.map((s) => oneRM(s.weight, s.reps)));
      const vol = ss.reduce((a, s) => a + volume(s.weight, s.reps), 0);
      return { date, maxW, repsAtMax, best1rm: round1(best1rm), sets: ss.length, vol };
    });

    const chartPts = rows.map((r) => ({ x: fmtDay(r.date), y: r.best1rm }));
    const first = rows[0], last = rows[rows.length - 1];
    const delta = rows.length > 1 ? round1(last.best1rm - first.best1rm) : 0;
    const deltaPct = first.best1rm ? Math.round((delta / first.best1rm) * 100) : 0;

    let table = `<table><thead><tr><th>Дата</th><th>Макс</th><th>×</th><th>1ПМ</th><th>Объём</th></tr></thead><tbody>`;
    for (const r of [...rows].reverse()) {
      table += `<tr><td>${fmtDate(r.date)}</td><td>${fmtNum(r.maxW)}</td><td>${r.repsAtMax}</td><td>${fmtNum(r.best1rm)}</td><td>${fmtNum(r.vol)}</td></tr>`;
    }
    table += `</tbody></table>`;

    view.innerHTML = `<div class="fade-in">
      <h1>Прогресс</h1>
      <p class="subtitle">История по упражнению — расчётный 1ПМ по датам.</p>
      <div class="field"><label>Упражнение</label><select id="prog-sel">${opts}</select></div>
      <div class="card">
        <div class="calc" style="justify-content:space-around">
          <span>Лучший 1ПМ: <b>${fmtNum(last.best1rm)}</b> кг</span>
          <span>Изменение: <b style="color:${delta >= 0 ? "#4caf76" : "var(--destructive)"}">${delta >= 0 ? "+" : ""}${fmtNum(delta)} кг${rows.length > 1 ? ` (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)` : ""}</b></span>
        </div>
        ${lineChart(chartPts, { unit: "" })}
      </div>
      <h2>По тренировкам</h2>
      <div class="card tight">${table}</div>
    </div>`;
    document.getElementById("prog-sel").addEventListener("change", (e) => { progEx = e.target.value; renderProgress(); });
  }

  // ---------- VOLUME view ----------
  let volMetric = "vol"; // vol | sets | days
  function renderVolume() {
    const sets = Store.sets();
    if (!sets.length) { view.innerHTML = emptyState("Нет данных по объёму"); return; }
    const m = new Map();
    for (const s of sets) {
      const k = monthKey(s.date);
      if (!m.has(k)) m.set(k, { vol: 0, sets: 0, days: new Set() });
      const o = m.get(k); o.vol += volume(s.weight, s.reps); o.sets += 1; o.days.add(s.date);
    }
    const months = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const totalVol = months.reduce((a, [, o]) => a + o.vol, 0);
    const totalSets = months.reduce((a, [, o]) => a + o.sets, 0);
    const totalDays = months.reduce((a, [, o]) => a + o.days.size, 0);

    const metricVal = (o) => volMetric === "vol" ? o.vol : volMetric === "sets" ? o.sets : o.days.size;
    const bars = months.map(([k, o]) => ({ label: monthLabel(k).replace(" 20", " '"), value: metricVal(o) }));
    const unit = volMetric === "vol" ? " кг" : volMetric === "sets" ? " подх." : " трен.";

    let table = `<table><thead><tr><th>Месяц</th><th>Объём, кг</th><th>Подходов</th><th>Трен.</th></tr></thead><tbody>`;
    for (const [k, o] of [...months].reverse()) {
      table += `<tr><td>${monthLabel(k)}</td><td>${fmtNum(o.vol)}</td><td>${o.sets}</td><td>${o.days.size}</td></tr>`;
    }
    table += `<tr style="font-weight:700"><td>Итого</td><td>${fmtNum(totalVol)}</td><td>${totalSets}</td><td>${totalDays}</td></tr></tbody></table>`;

    view.innerHTML = `<div class="fade-in">
      <h1>Объём</h1>
      <p class="subtitle">Тоннаж = вес × повторы, суммарно за месяц.</p>
      <div class="seg">
        <button data-m="vol" class="${volMetric === "vol" ? "active" : ""}">Тоннаж</button>
        <button data-m="sets" class="${volMetric === "sets" ? "active" : ""}">Подходы</button>
        <button data-m="days" class="${volMetric === "days" ? "active" : ""}">Тренировки</button>
      </div>
      <div class="card">${barChart(bars, { unit })}</div>
      <h2>По месяцам</h2>
      <div class="card tight">${table}</div>
    </div>`;
    view.querySelectorAll(".seg button").forEach((b) =>
      b.addEventListener("click", () => { volMetric = b.dataset.m; renderVolume(); }));
  }

  // ---------- SUMMARY view ----------
  function renderSummary() {
    const sets = Store.sets();
    if (!sets.length) { view.innerHTML = emptyState("Нет данных для сводки"); return; }
    const dates = [...new Set(sets.map((s) => s.date))].sort();
    const totalVol = sets.reduce((a, s) => a + volume(s.weight, s.reps), 0);

    // PRs per exercise
    const pr = new Map();
    for (const s of sets) {
      const o = pr.get(s.exercise) || { maxW: 0, best1rm: 0, maxWDate: "", bestDate: "" };
      if (s.weight > o.maxW) { o.maxW = s.weight; o.maxWDate = s.date; }
      const orm = oneRM(s.weight, s.reps);
      if (orm > o.best1rm) { o.best1rm = orm; o.bestDate = s.date; }
      pr.set(s.exercise, o);
    }
    const prRows = [...pr.entries()].sort((a, b) => b[1].best1rm - a[1].best1rm);

    let table = `<table><thead><tr><th>Упражнение</th><th>Макс, кг</th><th>1ПМ</th></tr></thead><tbody>`;
    for (const [ex, o] of prRows) {
      table += `<tr><td>${esc(ex)}</td><td>${fmtNum(o.maxW)}</td><td>${fmtNum(round1(o.best1rm))}</td></tr>`;
    }
    table += `</tbody></table>`;

    const stat = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    view.innerHTML = `<div class="fade-in">
      <h1>Сводка</h1>
      <p class="subtitle">Общая статистика и личные рекорды.</p>
      <div class="stats">
        ${stat(sets.length, "Всего подходов")}
        ${stat(dates.length, "Тренировок")}
        ${stat(fmtNum(totalVol) + " кг", "Суммарный объём")}
        ${stat(pr.size, "Упражнений")}
      </div>
      <div class="card tight" style="margin-top:12px">
        <div class="set-line" style="background:none;padding:6px 0"><span class="wr">Первая тренировка</span><span class="vol">${fmtDate(dates[0])}</span></div>
        <div class="set-line" style="background:none;padding:6px 0"><span class="wr">Последняя тренировка</span><span class="vol">${fmtDate(dates[dates.length - 1])}</span></div>
      </div>
      <h2>Личные рекорды</h2>
      <div class="card tight">${table}</div>
    </div>`;
  }

  // ---------- SETTINGS view ----------
  function renderSettings() {
    const backend = Store.backend === "cloud"
      ? "Telegram CloudStorage — синхронизация между твоими устройствами в Telegram."
      : "Локальное хранилище браузера (данные только на этом устройстве).";
    view.innerHTML = `<div class="fade-in">
      <h1>Ещё</h1>
      <p class="subtitle">Данные, импорт/экспорт и сброс.</p>
      <div class="card">
        <h2 style="margin-top:0">Хранилище</h2>
        <p class="muted" style="font-size:13px;margin:0">${backend}</p>
        <p class="muted" style="font-size:13px;margin:8px 0 0">Подходов: <b>${Store.sets().length}</b> · Упражнений в справочнике: <b>${Store.exercises().length}</b></p>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Экспорт / Импорт</h2>
        <div class="btn-row">
          <button class="btn secondary small" id="s-export">Копировать JSON</button>
          <button class="btn secondary small" id="s-import-toggle">Импорт</button>
        </div>
        <div id="import-box" style="display:none;margin-top:10px">
          <textarea id="s-import-text" placeholder="Вставь JSON, экспортированный ранее"></textarea>
          <div class="btn-row">
            <button class="btn small" id="s-import-merge">Добавить (merge)</button>
            <button class="btn secondary small" id="s-import-replace">Заменить всё</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h2 style="margin-top:0">Сброс</h2>
        <div class="btn-row">
          <button class="btn secondary small" id="s-reseed">Перезагрузить из журнала</button>
          <button class="btn danger small" id="s-wipe">Очистить всё</button>
        </div>
        <p class="hintline">«Перезагрузить из журнала» вернёт исходные ${(window.__WT_SEED__?.sets || []).length} подходов из Excel-файла.</p>
      </div>
      <p class="center muted" style="font-size:12px;margin-top:18px">Журнал тренировок · мини-приложение</p>
    </div>`;

    document.getElementById("s-export").addEventListener("click", async () => {
      const txt = Store.exportJSON();
      try { await navigator.clipboard.writeText(txt); toast("JSON скопирован"); }
      catch (e) {
        if (tg && tg.showPopup) tg.showPopup({ title: "Экспорт", message: "Скопируй вручную из консоли", buttons: [{ type: "ok" }] });
        console.log(txt); toast("Смотри консоль (clipboard недоступен)");
      }
      haptic("ok");
    });
    document.getElementById("s-import-toggle").addEventListener("click", () => {
      const b = document.getElementById("import-box"); b.style.display = b.style.display === "none" ? "block" : "none";
    });
    const doImport = (merge) => {
      const text = document.getElementById("s-import-text").value.trim();
      if (!text) { toast("Вставь JSON"); return; }
      try { Store.importJSON(text, { merge }); toast(merge ? "Данные добавлены" : "Данные заменены"); haptic("ok"); renderSettings(); }
      catch (e) { toast("Ошибка: неверный JSON"); haptic("err"); }
    };
    document.getElementById("s-import-merge").addEventListener("click", () => doImport(true));
    document.getElementById("s-import-replace").addEventListener("click", () => confirmThen("Заменить все данные импортом?", () => doImport(false)));
    document.getElementById("s-reseed").addEventListener("click", () =>
      confirmThen("Перезагрузить исходные данные из журнала? Текущие записи будут заменены.", () => { Store.reseed(); toast("Готово"); haptic("ok"); switchTab("log"); }));
    document.getElementById("s-wipe").addEventListener("click", () =>
      confirmThen("Удалить ВСЕ записи без возможности восстановления?", () => { Store.wipe(); toast("Очищено"); haptic("ok"); switchTab("log"); }));
  }

  function confirmThen(msg, fn) {
    if (tg && tg.showConfirm) tg.showConfirm(msg, (ok) => { if (ok) fn(); });
    else if (confirm(msg)) fn();
  }

  function emptyState(msg) {
    return `<div class="fade-in"><div class="empty"><span class="big">📭</span>${esc(msg)}.<br>Добавь подходы во вкладке «Журнал».</div></div>`;
  }

  // ---------- tab routing ----------
  const renderers = { log: renderLog, progress: renderProgress, volume: renderVolume, summary: renderSummary, settings: renderSettings };
  let currentTab = "log";
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    window.scrollTo(0, 0);
    renderers[tab]();
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { haptic("light"); switchTab(t.dataset.tab); }));

  // ---------- boot ----------
  async function boot() {
    if (tg) {
      try {
        tg.ready(); tg.expand();
        const ok69 = !tg.isVersionAtLeast || tg.isVersionAtLeast("6.1");
        if (ok69 && tg.setHeaderColor) tg.setHeaderColor("secondary_bg_color");
        if (ok69 && tg.enableClosingConfirmation) tg.enableClosingConfirmation();
      } catch (e) {}
    }
    view.innerHTML = `<div class="empty"><span class="big">⏳</span>Загрузка…</div>`;
    try { await Store.init(); }
    catch (e) { console.error(e); }
    switchTab("log");
  }
  boot();
})();
