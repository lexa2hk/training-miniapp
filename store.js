/* store.js — persistence layer.
 *
 * Backend priority:
 *   1) Telegram CloudStorage  — syncs across the user's Telegram devices, no server needed.
 *   2) localStorage           — fallback when opened in a plain browser (dev / preview).
 *
 * The whole dataset { sets, workouts, exercises } is serialised to JSON and, for
 * CloudStorage (4096 bytes/value, 1024 keys), split into chunks. */
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  // CloudStorage requires Bot API 6.9+. Check the version so older clients fall
  // back to localStorage cleanly instead of throwing on every call.
  const cloudSupported = !!(tg && tg.CloudStorage && typeof tg.CloudStorage.setItem === "function"
    && (!tg.isVersionAtLeast || tg.isVersionAtLeast("6.9")));
  const hasCloud = cloudSupported;

  const CHUNK = 1500;          // chars per CloudStorage value (safe: <4096 bytes even all-Cyrillic)
  const KEY_COUNT = "wt_n";    // how many chunks are stored
  const keyChunk = (i) => "wt_c" + i;
  const LS_KEY = "wt_data_v1"; // localStorage key

  // ---- CloudStorage promise wrappers ----
  const cloud = {
    set: (k, v) => new Promise((res, rej) =>
      tg.CloudStorage.setItem(k, v, (e, ok) => (e ? rej(e) : res(ok)))),
    get: (k) => new Promise((res, rej) =>
      tg.CloudStorage.getItem(k, (e, v) => (e ? rej(e) : res(v)))),
    getMany: (keys) => new Promise((res, rej) =>
      tg.CloudStorage.getItems(keys, (e, o) => (e ? rej(e) : res(o)))),
    remove: (keys) => new Promise((res, rej) =>
      tg.CloudStorage.removeItems(keys, (e, ok) => (e ? rej(e) : res(ok)))),
  };

  let _chunkCount = 0; // last known chunk count, to clean up stale chunks on save

  async function cloudLoad() {
    const nRaw = await cloud.get(KEY_COUNT);
    const n = parseInt(nRaw, 10);
    if (!n || isNaN(n)) return null;
    _chunkCount = n;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(keyChunk(i));
    // getItems caps at 100 keys per call — page it.
    let json = "";
    for (let i = 0; i < keys.length; i += 100) {
      const slice = keys.slice(i, i + 100);
      const obj = await cloud.getMany(slice);
      for (const k of slice) json += obj[k] || "";
    }
    try { return JSON.parse(json); } catch (e) { console.error("parse fail", e); return null; }
  }

  async function cloudSave(data) {
    const json = JSON.stringify(data);
    const chunks = [];
    for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
    await Promise.all(chunks.map((c, i) => cloud.set(keyChunk(i), c)));
    await cloud.set(KEY_COUNT, String(chunks.length));
    if (_chunkCount > chunks.length) {
      const stale = [];
      for (let i = chunks.length; i < _chunkCount; i++) stale.push(keyChunk(i));
      try { await cloud.remove(stale); } catch (e) { /* non-fatal */ }
    }
    _chunkCount = chunks.length;
  }

  // ---- localStorage backend ----
  function lsLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
  }
  function lsSave(data) { localStorage.setItem(LS_KEY, JSON.stringify(data)); }

  // ---- unified API ----
  const Store = {
    backend: hasCloud ? "cloud" : "local",
    data: { sets: [], workouts: [], exercises: [] },

    async init() {
      let loaded = null;
      try {
        loaded = hasCloud ? await cloudLoad() : lsLoad();
      } catch (e) {
        console.error("load error, falling back to local", e);
        this.backend = "local";
        loaded = lsLoad();
      }
      if (loaded && Array.isArray(loaded.sets)) {
        this.data = normalize(loaded);
      } else {
        // first run — seed from the bundled journal export
        const seed = window.__WT_SEED__ || { sets: [], workouts: [], exercises: [] };
        this.data = normalize({
          sets: (seed.sets || []).map(withId),
          workouts: seed.workouts || [],
          exercises: seed.exercises || [],
        });
        await this.save();
      }
      return this.data;
    },

    // Persistence is fire-and-forget so the UI never waits on (or breaks from) a
    // slow/failing CloudStorage write. Mutations update memory synchronously and
    // schedule a background save; only one save runs at a time, with a trailing
    // pass if more changes arrived while it was in flight.
    _saving: false,
    _dirty: false,
    _flushPromise: null,

    save() {
      this._dirty = true;
      this._drain();
      return this._flushPromise || Promise.resolve();
    },

    _drain() {
      if (this._saving || !this._dirty) return;
      this._saving = true;
      this._dirty = false;
      this._flushPromise = (async () => {
        try {
          if (this.backend === "cloud") await cloudSave(this.data);
          else lsSave(this.data);
        } catch (e) {
          console.error("save error", e);
          try { lsSave(this.data); this.backend = "local"; } catch (_) {}
        } finally {
          this._saving = false;
          if (this._dirty) this._drain();
        }
      })();
    },

    async flush() {
      while (this._dirty || this._saving) {
        this._drain();
        try { await this._flushPromise; } catch (_) {}
      }
    },

    sets() { return this.data.sets; },
    workouts() { return this.data.workouts; },
    exercises() { return this.data.exercises; },

    addSet(s) {
      const set = withId(s);
      this.data.sets.push(set);
      if (set.workout && !this.data.workouts.includes(set.workout)) this.data.workouts.push(set.workout);
      if (set.exercise && !this.data.exercises.includes(set.exercise)) this.data.exercises.push(set.exercise);
      this.save();
      return set;
    },

    updateSet(id, patch) {
      const s = this.data.sets.find((x) => x.id === id);
      if (!s) return null;
      Object.assign(s, patch);
      this.save();
      return s;
    },

    deleteSet(id) {
      this.data.sets = this.data.sets.filter((x) => x.id !== id);
      this.save();
    },

    addWorkoutType(name) {
      name = (name || "").trim();
      if (name && !this.data.workouts.includes(name)) { this.data.workouts.push(name); this.save(); }
    },
    addExercise(name) {
      name = (name || "").trim();
      if (name && !this.data.exercises.includes(name)) { this.data.exercises.push(name); this.save(); }
    },

    exportJSON() { return JSON.stringify(this.data, null, 2); },

    importJSON(text, { merge } = {}) {
      const incoming = normalize(JSON.parse(text));
      if (merge) {
        const seen = new Set(this.data.sets.map(setKey));
        for (const s of incoming.sets) {
          const k = setKey(s);
          if (!seen.has(k)) { this.data.sets.push(withId(s)); seen.add(k); }
        }
        incoming.workouts.forEach((w) => { if (!this.data.workouts.includes(w)) this.data.workouts.push(w); });
        incoming.exercises.forEach((e) => { if (!this.data.exercises.includes(e)) this.data.exercises.push(e); });
      } else {
        this.data = { ...incoming, sets: incoming.sets.map(withId) };
      }
      this.save();
    },

    reseed() {
      const seed = window.__WT_SEED__ || { sets: [], workouts: [], exercises: [] };
      this.data = normalize({
        sets: (seed.sets || []).map(withId),
        workouts: seed.workouts || [],
        exercises: seed.exercises || [],
      });
      this.save();
    },

    wipe() {
      this.data = { sets: [], workouts: window.__WT_SEED__?.workouts || [], exercises: window.__WT_SEED__?.exercises || [] };
      this.save();
    },
  };

  // ---- helpers ----
  function withId(s) {
    return { id: s.id || uid(), ...s, weight: +s.weight, reps: +s.reps, setNo: +s.setNo || 1, notes: s.notes || "" };
  }
  function setKey(s) { return [s.date, s.exercise, s.setNo, s.weight, s.reps].join("|"); }
  function uid() {
    return "s" + Math.abs(Math.floor((performance.now() * 1000)) ^ (counter++ * 2654435761)).toString(36) + counter.toString(36);
  }
  let counter = 1;

  function normalize(d) {
    const sets = (d.sets || []).filter((s) => s && s.exercise != null)
      .map((s) => ({
        id: s.id || uid(),
        date: s.date,
        workout: s.workout || "",
        exercise: s.exercise,
        setNo: +s.setNo || 1,
        weight: +s.weight || 0,
        reps: +s.reps || 0,
        notes: s.notes || "",
      }));
    sets.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.setNo - b.setNo));
    return { sets, workouts: d.workouts || [], exercises: d.exercises || [] };
  }

  window.Store = Store;
})();
