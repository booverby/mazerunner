const LAYERS = { calm: 0, tense: 0.5, danger: 1 };
const SLEEP_AFTER = 8;
const TICK_MS = 50;
const EPS = 0.001;
const GESTURES = ['pointerdown', 'keydown', 'touchend', 'click'];

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const slew = (cur, target, upTime, downTime, dt) => target > cur
  ? Math.min(target, cur + dt / Math.max(upTime, 1e-3))
  : Math.max(target, cur - dt / Math.max(downTime, 1e-3));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function createMusic(urls = {}, options = {}) {
  const opt = { attack: 1, release: 4, volume: 1, fade: 0.5, urgency: true, ...options };
  const doc = typeof document !== 'undefined' ? document : null;
  let layers = [];
  let state = 'idle';
  let userPaused = false, blocked = false, disposed = false;
  let target = 0, level = 0, fade = 0;
  let masterTarget = clamp(opt.volume), master = masterTarget;
  let timer = null, last = 0;

  for (const name of Object.keys(LAYERS)) {
    const url = urls?.[name];
    if (!url) continue;
    try {
      const el = new Audio();
      const layer = { name, pos: LAYERS[name], el, failed: false, pending: false, heard: 0, rate: 1 };
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      el.addEventListener('error', () => fail(layer, el.error));
      el.src = url;
      layers.push(layer);
    } catch (e) {
      console.warn(`Music: could not load the "${name}" track (${url}).`, e?.message ?? '');
    }
  }
  // iPhone/iPad Safari ignores element volume, so there we play only the loudest layer.
  const lockedVolume = layers.length > 0 && layers[0].el.volume !== 0;

  const hidden = () => !!doc?.hidden;

  function fail(layer, err) {
    if (layer.failed || disposed) return;
    layer.failed = true;
    console.warn(`Music: could not play the "${layer.name}" track (${layer.el.src}).`, err?.message ?? '');
    try { layer.el.pause(); } catch {}
  }

  function onPlayError(layer, err) {
    if (err?.name === 'AbortError') return;
    if (err?.name === 'NotAllowedError') return block();
    fail(layer, err);
  }

  function wake(layer) {
    if (layer.failed || layer.pending || blocked || !layer.el.paused) return;
    let p;
    try { p = layer.el.play(); } catch (e) { return onPlayError(layer, e); }
    if (p && typeof p.then === 'function') {
      layer.pending = true;
      p.then(() => { layer.pending = false; }, (e) => { layer.pending = false; onPlayError(layer, e); });
    }
  }

  function sleep(layer) {
    try { if (!layer.el.paused) layer.el.pause(); } catch {}
  }

  function onGesture() {
    unblock();
    tick();
  }

  function block() {
    if (blocked || disposed) return;
    blocked = true;
    for (const type of GESTURES) doc?.addEventListener(type, onGesture, true);
  }

  function unblock() {
    blocked = false;
    for (const type of GESTURES) doc?.removeEventListener(type, onGesture, true);
  }

  function mix(x) {
    const gains = new Map();
    const live = layers.filter((l) => !l.failed);
    if (!live.length) return gains;
    let i = 0;
    while (i < live.length - 1 && x > live[i + 1].pos) i++;
    const a = live[i], b = live[i + 1];
    if (!b || x <= a.pos) return gains.set(a, 1);
    const angle = Math.min(1, (x - a.pos) / (b.pos - a.pos)) * Math.PI / 2;
    return gains.set(a, Math.cos(angle)).set(b, Math.sin(angle));
  }

  function tick() {
    if (disposed || state === 'idle') return;
    const t = now(), dt = Math.max(0, t - last);
    last = t;
    level = slew(level, target, opt.attack, opt.release, dt);
    master = slew(master, masterTarget, 0.3, 0.3, dt);
    const fadeTarget = state === 'playing' && !userPaused ? 1 : 0;
    fade = slew(fade, fadeTarget, opt.fade, opt.fade, dt);
    if (state === 'stopping' && (fade === 0 || lockedVolume || hidden())) return reset();

    const running = !hidden() && (fadeTarget > 0 || (fade > 0 && !lockedVolume));
    let gains = mix(level);
    if (lockedVolume && gains.size) {
      const loudest = [...gains].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      gains = new Map([[loudest, 1]]);
    }
    const rate = opt.urgency ? Math.round((1 + 0.06 * clamp((level - 0.8) / 0.2)) * 200) / 200 : 1;

    for (const layer of layers) {
      if (layer.failed) continue;
      const g = gains.get(layer) || 0;
      if (g > EPS) layer.heard = t;
      const awake = lockedVolume ? g > EPS : t - layer.heard < SLEEP_AFTER;
      if (running && awake) wake(layer);
      else sleep(layer);
      if (!lockedVolume) {
        const vol = clamp(g * master * fade);
        if (Math.abs(layer.el.volume - vol) > 1e-4) layer.el.volume = vol;
      }
      if (layer.rate !== rate) {
        layer.rate = rate;
        try { layer.el.playbackRate = rate; } catch {}
      }
    }
  }

  function reset() {
    state = 'idle';
    userPaused = false;
    fade = 0;
    clearInterval(timer);
    timer = null;
    unblock();
    for (const layer of layers) {
      sleep(layer);
      try { layer.el.currentTime = 0; } catch {}
      if (!lockedVolume) layer.el.volume = 0;
    }
  }

  function onVisibility() {
    if (hidden()) layers.forEach(sleep);
    else tick();
  }
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    start() {
      if (disposed || !layers.length) return;
      unblock();
      if (state === 'idle') {
        level = target;
        fade = 0;
        const t = now();
        for (const layer of layers) layer.heard = t;
      }
      state = 'playing';
      userPaused = false;
      if (!timer) {
        last = now();
        timer = setInterval(tick, TICK_MS);
      }
      tick();
    },
    setIntensity(x) {
      target = clamp(x);
    },
    setVolume(v) {
      masterTarget = clamp(v);
    },
    pause() {
      if (state === 'playing') userPaused = true;
      tick();
    },
    resume() {
      if (state !== 'playing' || !userPaused) return;
      userPaused = false;
      tick();
    },
    stop() {
      if (state === 'idle') return;
      state = 'stopping';
      tick();
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      doc?.removeEventListener('visibilitychange', onVisibility);
      for (const layer of layers) {
        try { layer.el.removeAttribute('src'); layer.el.load(); } catch {}
      }
      layers = [];
    },
  };
}
