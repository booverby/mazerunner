// Sprint stamina, the map peek timer and the music intensity: plain logic with no page access, so it runs in node.
export const STAMINA_DEFAULTS = { sprintSpeed: 8.5, stamina: 4, staminaRegen: 1, staminaRegenDelay: 1, staminaMinToStart: 0.5 };
export const MAP_DEFAULTS = { enabled: true, duration: 3, cooldown: 20, showMonsters: false };

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

// update(dt, wants, held): wants = Shift held while trying to move; held = Shift held at all.
// An empty bar locks sprinting until Shift is let go, and a new sprint needs at least staminaMinToStart.
export function createStamina(settings = {}) {
  const s = { ...STAMINA_DEFAULTS, ...settings };
  const max = Math.max(0.01, s.stamina);
  const st = {
    max,
    left: max,
    sprinting: false,
    exhausted: false,
    wait: 0,
    get fraction() { return st.left / max; },
    reset() { Object.assign(st, { left: max, sprinting: false, exhausted: false, wait: 0 }); },
    update(dt, wants, held = wants) {
      if (!held) st.exhausted = false;
      const canStart = !st.exhausted && st.left >= s.staminaMinToStart;
      st.sprinting = Boolean(wants) && (st.sprinting ? st.left > 0 : canStart);
      if (st.sprinting) {
        st.left = Math.max(0, st.left - dt);
        st.wait = s.staminaRegenDelay;
        if (st.left === 0) st.exhausted = true;
      } else if (st.wait > 0) {
        st.wait = Math.max(0, st.wait - dt);
      } else {
        st.left = Math.min(max, st.left + s.staminaRegen * dt);
      }
      return st.sprinting;
    },
  };
  return st;
}

// The map shows for `duration` seconds; the cooldown starts when it closes.
export function createMapPeek(settings = {}) {
  const s = { ...MAP_DEFAULTS, ...settings };
  let showLeft = 0;
  let wait = 0;
  const peek = {
    settings: s,
    get enabled() { return s.enabled !== false; },
    get visible() { return showLeft > 0; },
    get ready() { return peek.enabled && showLeft === 0 && wait === 0; },
    get wait() { return wait; },
    toggle() {
      if (showLeft > 0) { showLeft = 0; wait = s.cooldown; return true; }
      if (!peek.ready) return false;
      showLeft = Math.max(0.01, s.duration);
      return true;
    },
    update(dt) {
      if (showLeft > 0) {
        showLeft = Math.max(0, showLeft - dt);
        if (showLeft === 0) wait = s.cooldown;
      } else wait = Math.max(0, wait - dt);
    },
    reset() { showLeft = 0; wait = 0; },
  };
  return peek;
}

// 0 until half the time is used, then a smooth rise to 1 at time zero; 0 without a time limit.
export function timePressure(time, limit) {
  if (!(limit > 0)) return 0;
  const x = clamp01((time / limit - 0.5) / 0.5);
  return x * x * (3 - 2 * x);
}

export const musicIntensity = (time, limit, threat) => Math.max(timePressure(time, limit), clamp01(threat));

// Draws the top-down map onto a 2D canvas context. Colours always come with a letter or shape.
export function drawMap(g, width, height, view) {
  const { maze, cell, keys, doors, movers, keyInfo, player, exitColor, monsters = [], hides = [] } = view;
  const size = Math.min(width / maze.width, height / maze.height);
  const ox = (width - size * maze.width) / 2;
  const oz = (height - size * maze.height) / 2;
  const px = (x) => ox + x * size;
  const pz = (z) => oz + z * size;
  const label = (letter, x, z, color) => {
    g.fillStyle = color;
    g.font = `bold ${Math.round(size * 0.6)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, px(x + 0.5), pz(z + 0.56));
  };
  g.clearRect(0, 0, width, height);
  g.fillStyle = '#c9d3df';
  for (let z = 0; z < maze.height; z++) {
    for (let x = 0; x < maze.width; x++) if (maze.isWall(x, z)) g.fillRect(px(x), pz(z), size + 0.5, size + 0.5);
  }
  g.fillStyle = '#7d8794';
  for (const m of movers) if (m.blocking) g.fillRect(px(m.x) + 1, pz(m.z) + 1, size - 2, size - 2);
  for (const h of hides) {
    g.fillStyle = 'rgba(80,170,90,.45)';
    g.fillRect(px(h.x) + 2, pz(h.z) + 2, size - 4, size - 4);
    label('H', h.x, h.z, '#e8ffe8');
  }
  for (const d of doors) {
    if (d.open) continue;
    const info = keyInfo(d.id);
    g.fillStyle = info.color;
    g.fillRect(px(d.x) + 1, pz(d.z) + 1, size - 2, size - 2);
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.strokeRect(px(d.x) + 2, pz(d.z) + 2, size - 4, size - 4);
    label(String(info.name)[0].toUpperCase(), d.x, d.z, '#000');
  }
  for (const k of keys) {
    if (k.taken) continue;
    const info = keyInfo(k.id);
    g.fillStyle = info.color;
    g.beginPath();
    g.arc(px(k.x + 0.5), pz(k.z + 0.5), size * 0.36, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
    label(String(info.name)[0].toLowerCase(), k.x, k.z, '#000');
  }
  const { exit } = maze;
  g.fillStyle = exitColor;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 ? 0.2 : 0.46) * size;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(px(exit.x + 0.5) + Math.cos(a) * r, pz(exit.z + 0.5) + Math.sin(a) * r);
  }
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.stroke();
  for (const m of monsters) {
    g.fillStyle = '#ff3355';
    g.beginPath();
    g.arc(px(m.x / cell), pz(m.z / cell), size * 0.3, 0, Math.PI * 2);
    g.fill();
    label('!', m.x / cell - 0.5, m.z / cell - 0.5, '#fff');
  }
  // Forward is (-sin yaw, -cos yaw) in the world; the map draws x to the right and z downwards.
  const cx = px(player.x / cell);
  const cz = pz(player.z / cell);
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  const r = size * 0.45;
  g.fillStyle = '#ffeb3b';
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx + fx * r, cz + fz * r);
  g.lineTo(cx - fx * r * 0.6 - fz * r * 0.6, cz - fz * r * 0.6 + fx * r * 0.6);
  g.lineTo(cx - fx * r * 0.6 + fz * r * 0.6, cz - fz * r * 0.6 - fx * r * 0.6);
  g.closePath();
  g.fill();
  g.stroke();
}
