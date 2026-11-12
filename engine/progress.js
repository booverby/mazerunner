// Which levels are unlocked and the best time per level, saved in localStorage; storage may be blocked.
export function createProgress(gameName, levelCount) {
  const key = `mazerunner.progress.${gameName}`;
  const last = Math.max(0, levelCount - 1);
  let data = { unlocked: 0, best: {} };

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && typeof saved === 'object') {
      const n = Number(saved.unlocked);
      if (Number.isInteger(n)) data.unlocked = Math.min(last, Math.max(0, n));
      for (const [id, time] of Object.entries(saved.best ?? {})) {
        if (Number.isFinite(time) && time >= 0) data.best[id] = time;
      }
    }
  } catch {}

  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
  };

  return {
    get unlocked() { return data.unlocked; },
    isUnlocked: (index) => index <= data.unlocked,
    best: (id) => data.best[id] ?? null,
    // Returns true when the time is a new best.
    complete(index, id, time) {
      data.unlocked = Math.min(last, Math.max(data.unlocked, index + 1));
      const newBest = !(data.best[id] <= time);
      if (newBest) data.best[id] = Number(time.toFixed(2));
      save();
      return newBest;
    },
    reset() {
      data = { unlocked: 0, best: {} };
      try { localStorage.removeItem(key); } catch {}
    },
  };
}
