import * as THREE from 'three';

export const MONSTER_DEFAULTS = {
  patrolSpeed: 2.4,
  chaseSpeed: 5.6,
  sightRange: 5,
  attackRange: 1.5,
  windup: 0.5,
  searchTime: 6,
  safeTime: 2,
  viewAngle: 200,
  patrolRadius: 6,
  turnSpeed: 7,
  seed: 1,
  color: '#8e6bd1',
};
export const HIDE_DEFAULTS = { color: '#3f7a35' };
const STATE_COLORS = { patrol: '#5ce1e6', search: '#ffb300', chase: '#ff1744', windup: '#ff1744' };
const RADIUS = 0.7;
const RECOVER = 0.7;
const MARK_TIME = 1.6;
const SWING_TIME = 0.35;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Walks the grid cells under the straight line between two points; false if any of them is opaque.
export function clearLine(ax, az, bx, bz, cell, opaque) {
  let x = Math.floor(ax / cell);
  let z = Math.floor(az / cell);
  const tx = Math.floor(bx / cell);
  const tz = Math.floor(bz / cell);
  const dx = bx - ax;
  const dz = bz - az;
  const sx = Math.sign(dx);
  const sz = Math.sign(dz);
  const stepX = dx ? Math.abs(cell / dx) : Infinity;
  const stepZ = dz ? Math.abs(cell / dz) : Infinity;
  let nextX = dx ? (sx > 0 ? (x + 1) * cell - ax : ax - x * cell) / Math.abs(dx) : Infinity;
  let nextZ = dz ? (sz > 0 ? (z + 1) * cell - az : az - z * cell) / Math.abs(dz) : Infinity;
  for (let i = 0; i < 4096; i++) {
    if (opaque(x, z)) return false;
    if (x === tx && z === tz) return true;
    if (nextX < nextZ) { nextX += stepX; x += sx; }
    else if (nextZ < nextX) { nextZ += stepZ; z += sz; }
    else {
      // Exactly through a corner: either side cell blocks the view.
      if (opaque(x + sx, z) || opaque(x, z + sz)) return false;
      nextX += stepX; nextZ += stepZ; x += sx; z += sz;
    }
  }
  return true;
}

// The monsters' decisions only: no Three.js and no page access, so it also runs in node.
// solid(x, z): extra cells a monster may not walk into; opaque(x, z): extra cells it cannot see through.
// It also keeps the player's lives: a landed swing costs one and sends every monster home.
export function createBrain(maze, settings, { cell, lives = 3, solid = () => false, opaque = () => false }) {
  const s = { ...MONSTER_DEFAULTS, ...settings };
  const { width, height } = maze;
  const index = (x, z) => z * width + x;
  const centre = (c) => (c + 0.5) * cell;
  const cellOf = (p) => ({ x: Math.floor(p.x / cell), z: Math.floor(p.z / cell) });
  const same = (a, b) => a.x === b.x && a.z === b.z;
  const free = (x, z) => !maze.isWall(x, z) && !solid(x, z);
  const blind = (x, z) => maze.isWall(x, z) || opaque(x, z);
  const hides = new Set((maze.hides ?? []).map((h) => `${h.x},${h.z}`));
  const isHide = (x, z) => hides.has(`${x},${z}`);
  const range = s.sightRange * cell;
  const halfCone = (s.viewAngle * Math.PI) / 360;

  const field = (from, limit = Infinity) => {
    const dist = new Int16Array(width * height).fill(-1);
    dist[index(from.x, from.z)] = 0;
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const { x, z } = queue[i];
      const d = dist[index(x, z)];
      if (d >= limit) continue;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!free(nx, nz) || dist[index(nx, nz)] >= 0) continue;
        dist[index(nx, nz)] = d + 1;
        queue.push({ x: nx, z: nz });
      }
    }
    return dist;
  };
  const firstStep = (from, goal) => {
    if (!free(goal.x, goal.z)) return null;
    const dist = field(goal);
    const d = dist[index(from.x, from.z)];
    if (d <= 0) return null;
    for (const [dx, dz] of DIRS) {
      const n = { x: from.x + dx, z: from.z + dz };
      if (free(n.x, n.z) && dist[index(n.x, n.z)] === d - 1) return n;
    }
    return null;
  };
  const pick = (m, around, radius) => {
    if (!free(around.x, around.z)) return cellOf(m);
    const dist = field(around, radius);
    const here = cellOf(m);
    const options = [];
    for (let i = 0; i < dist.length; i++) {
      const c = { x: i % width, z: Math.floor(i / width) };
      if (dist[i] >= 1 && !isHide(c.x, c.z) && !same(c, here)) options.push(c);
    }
    return options.length ? options[Math.floor(m.rng() * options.length)] : around;
  };

  const sees = (m, t, reach, cone) => {
    const dx = t.x - m.x;
    const dz = t.z - m.z;
    const d = Math.hypot(dx, dz);
    if (d > reach) return false;
    if (cone && d > 0.01 && Math.abs(wrap(Math.atan2(dx, dz) - m.facing)) > cone) return false;
    return clearLine(m.x, m.z, t.x, t.z, cell, blind);
  };
  const moveTo = (m, x, z, step) => {
    const dx = x - m.x;
    const dz = z - m.z;
    const d = Math.hypot(dx, dz);
    if (d <= step) { m.x = x; m.z = z; return true; }
    m.x += (dx / d) * step;
    m.z += (dz / d) * step;
    m.heading = Math.atan2(dx, dz);
    return false;
  };
  // One cell at a time along a fresh shortest path; returns 'arrived', 'moving' or 'blocked'.
  const walk = (m, goal, speed, dt) => {
    const here = cellOf(m);
    if (m.next && !free(m.next.x, m.next.z)) m.next = null;
    if (!m.next) {
      if (same(here, goal)) return moveTo(m, centre(here.x), centre(here.z), speed * dt) ? 'arrived' : 'moving';
      m.next = firstStep(here, goal);
      if (!m.next) {
        moveTo(m, centre(here.x), centre(here.z), speed * dt);
        return 'blocked';
      }
    }
    if (moveTo(m, centre(m.next.x), centre(m.next.z), speed * dt)) m.next = null;
    return 'moving';
  };
  const lookAround = (m, dt) => {
    m.look += dt;
    m.aim = m.lookBase + Math.sin(m.look * 2.2) * 1.2;
  };
  const mark = (m, sign) => { m.mark = sign; m.markLeft = MARK_TIME; };

  const monsters = (maze.monsters ?? []).map((spawn, i) => ({ i, spawn }));
  const resetOne = (m) => {
    const rng = seeded(s.seed * 7919 + m.i * 101 + 1);
    const facing = rng() * Math.PI * 2 - Math.PI;
    Object.assign(m, {
      rng, x: centre(m.spawn.x), z: centre(m.spawn.z), facing, aim: facing, heading: facing, lookBase: facing, look: 0,
      state: 'patrol', phase: 'pause', timer: 0.5 + m.i * 0.4, goal: m.spawn, next: null, lastSeen: null,
      stall: 0, searchLeft: 0, recover: 0, mark: null, markLeft: 0, swingLeft: 0, speed: 0,
    });
  };

  const respawn = () => {
    monsters.forEach(resetOne);
    brain.threat = 0;
    brain.danger = 0;
  };

  const brain = {
    settings: s,
    monsters,
    maxLives: lives,
    lives,
    safeLeft: 0,
    threat: 0,
    danger: 0,
    isHide,
    cellOf,
    get list() {
      return monsters.map((m) => ({ x: m.x, z: m.z, cell: cellOf(m), state: m.state, facing: m.facing }));
    },
    occupies(cx, cz) {
      return monsters.some((m) => m.x + RADIUS > cx * cell && m.x - RADIUS < (cx + 1) * cell
        && m.z + RADIUS > cz * cell && m.z - RADIUS < (cz + 1) * cell);
    },
    reset() {
      respawn();
      brain.lives = lives;
      brain.safeLeft = 0;
    },

    // target: { x, z, moving, hidden }. Returns events: spot, lost, windup, swing, hit.
    // After a hit the caller sends the player back to the start; brain.lives tells if any are left.
    update(dt, t) {
      const events = [];
      const emit = (type, m) => events.push({ type, monster: m.i });
      brain.safeLeft = Math.max(0, brain.safeLeft - dt);
      const unseen = t.hidden || brain.safeLeft > 0;
      const targetCell = cellOf(t);
      const startChase = (m) => {
        Object.assign(m, { state: 'chase', lastSeen: targetCell, stall: 0, recover: 0 });
        mark(m, '!');
        emit('spot', m);
      };
      const loseTrack = (m) => {
        Object.assign(m, { state: 'search', phase: 'goto', stall: 0 });
        mark(m, '?');
        emit('lost', m);
      };
      const startLooking = (m) => {
        Object.assign(m, { phase: 'look', searchLeft: s.searchTime, timer: 0.8, lookBase: m.facing, look: 0, stall: 0 });
        m.goal = pick(m, m.lastSeen, 2);
      };

      for (const m of monsters) {
        const before = { x: m.x, z: m.z };
        m.markLeft = Math.max(0, m.markLeft - dt);
        m.swingLeft = Math.max(0, m.swingLeft - dt);
        m.recover = Math.max(0, m.recover - dt);
        m.aim = m.heading;
        const dist = Math.hypot(t.x - m.x, t.z - m.z);

        if ((m.state === 'patrol' || m.state === 'search') && !unseen && t.moving && sees(m, t, range, halfCone)) startChase(m);
        else if (m.state === 'chase' || m.state === 'windup') {
          if (unseen || !sees(m, t, range * 1.5, 0)) loseTrack(m);
          else m.lastSeen = targetCell;
        }

        if (m.state === 'windup') {
          m.aim = Math.atan2(t.x - m.x, t.z - m.z);
          m.timer -= dt;
          if (m.timer <= 0) {
            m.swingLeft = SWING_TIME;
            emit('swing', m);
            if (dist <= s.attackRange && sees(m, t, s.attackRange, 0)) {
              emit('hit', m);
              brain.lives = Math.max(0, brain.lives - 1);
              respawn();
              if (brain.lives > 0) brain.safeLeft = s.safeTime;
              return events;
            }
            Object.assign(m, { state: 'chase', recover: RECOVER });
          }
        } else if (m.state === 'chase') {
          m.aim = Math.atan2(t.x - m.x, t.z - m.z);
          if (dist <= s.attackRange && m.recover === 0) {
            Object.assign(m, { state: 'windup', timer: s.windup, next: null });
            emit('windup', m);
          } else if (dist > s.attackRange * 0.7) {
            const here = cellOf(m);
            if (same(here, targetCell)) {
              m.next = null;
              const inset = cell / 2 - RADIUS;
              const cx = Math.max(centre(here.x) - inset, Math.min(centre(here.x) + inset, t.x));
              const cz = Math.max(centre(here.z) - inset, Math.min(centre(here.z) + inset, t.z));
              moveTo(m, cx, cz, s.chaseSpeed * dt);
              m.stall = 0;
            } else if (walk(m, targetCell, s.chaseSpeed, dt) === 'blocked') {
              m.stall += dt;
              if (m.stall > 3) loseTrack(m);
            } else m.stall = 0;
          }
        } else if (m.state === 'search') {
          if (m.phase === 'goto') {
            const r = walk(m, m.lastSeen, s.chaseSpeed, dt);
            if (r === 'arrived') startLooking(m);
            else if (r === 'blocked' && (m.stall += dt) > 2) startLooking(m);
            else if (r === 'moving') m.stall = 0;
          } else {
            m.searchLeft -= dt;
            if (m.searchLeft <= 0) Object.assign(m, { state: 'patrol', phase: 'pause', timer: 0.8, lookBase: m.facing, look: 0 });
            else if (m.timer > 0) { m.timer -= dt; lookAround(m, dt); }
            else {
              const r = walk(m, m.goal, s.patrolSpeed * 1.3, dt);
              if (r === 'arrived' || (r === 'blocked' && (m.stall += dt) > 2)) {
                Object.assign(m, { timer: 0.7 + m.rng() * 0.6, lookBase: m.facing, look: 0, stall: 0 });
                m.goal = pick(m, m.lastSeen, 2);
              } else if (r === 'moving') m.stall = 0;
            }
          }
        } else if (m.phase === 'pause') {
          m.timer -= dt;
          lookAround(m, dt);
          if (m.timer <= 0) Object.assign(m, { phase: 'walk', goal: pick(m, m.spawn, s.patrolRadius), stall: 0 });
        } else {
          const r = walk(m, m.goal, s.patrolSpeed, dt);
          if (r === 'arrived') Object.assign(m, { phase: 'pause', timer: 1 + m.rng() * 1.5, lookBase: m.facing, look: 0 });
          else if (r === 'blocked' && (m.stall += dt) > 2) Object.assign(m, { phase: 'pause', timer: 0.3, lookBase: m.facing, look: 0 });
          else if (r === 'moving') m.stall = 0;
        }

        const turn = s.turnSpeed * dt;
        m.facing = wrap(m.facing + Math.max(-turn, Math.min(turn, wrap(m.aim - m.facing))));
        m.speed = Math.hypot(m.x - before.x, m.z - before.z) / Math.max(dt, 1e-6);
      }

      let threat = 0;
      let danger = 0;
      for (const m of monsters) {
        const d = Math.hypot(t.x - m.x, t.z - m.z);
        if (m.state === 'chase' || m.state === 'windup') {
          const close = clamp01(1 - d / range);
          threat = Math.max(threat, 0.7 + 0.3 * close);
          danger = Math.max(danger, 0.25 + 0.75 * close);
        } else {
          threat = Math.max(threat, 0.5 * clamp01(1 - d / (range * 1.5)));
        }
      }
      brain.threat = threat;
      brain.danger = danger;
      return events;
    },
  };
  brain.reset();
  return brain;
}

function signTexture(sign, color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#222';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(sign, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Monsters and hiding places of one level: the brain above plus what they look like.
export function createMonsters(maze, config, { solid, opaque, monsterModel = null, hideModel = null }) {
  const { cell } = config.size;
  const brain = createBrain(maze, config.monsters, { cell, solid, opaque, lives: Math.max(1, Math.round(config.rules?.lives ?? 3)) });
  const group = new THREE.Group();
  const owned = [];
  const own = (thing) => { owned.push(thing); return thing; };
  const mat = (options) => own(new THREE.MeshStandardMaterial(options));
  const mesh = (geometry, material, x, y, z, parent) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  const bodyColor = new THREE.Color(brain.settings.color);
  const body = mat({ color: bodyColor, roughness: 0.55 });
  const belly = mat({ color: bodyColor.clone().lerp(new THREE.Color('#ffffff'), 0.35), roughness: 0.6 });
  const white = mat({ color: '#ffffff', roughness: 0.25 });
  const dark = mat({ color: '#1a1420', roughness: 0.5 });
  const wood = mat({ color: '#8d5a32', roughness: 0.8 });
  const clubWood = mat({ color: '#b07a45', roughness: 0.75 });
  const eyeMats = Object.fromEntries(Object.entries(STATE_COLORS)
    .map(([state, c]) => [state, mat({ color: c, emissive: c, emissiveIntensity: 0.9 })]));
  const signs = {
    '!': own(new THREE.SpriteMaterial({ map: own(signTexture('!', '#e01030')), fog: false })),
    '?': own(new THREE.SpriteMaterial({ map: own(signTexture('?', '#d08000')), fog: false })),
  };
  const geo = {
    body: own(new THREE.SphereGeometry(0.85, 24, 18)),
    eye: own(new THREE.SphereGeometry(0.26, 16, 12)),
    iris: own(new THREE.SphereGeometry(0.13, 12, 10)),
    pupil: own(new THREE.SphereGeometry(0.06, 8, 6)),
    foot: own(new THREE.SphereGeometry(0.26, 12, 8)),
    horn: own(new THREE.ConeGeometry(0.12, 0.35, 10)),
    handle: own(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 10)),
    head: own(new THREE.CapsuleGeometry(0.3, 0.5, 6, 14)),
    band: own(new THREE.TorusGeometry(0.31, 0.04, 6, 18)),
  };

  const builtIn = () => {
    const root = new THREE.Group();
    const torso = new THREE.Group();
    torso.position.y = 0.95;
    root.add(torso);
    const blob = mesh(geo.body, body, 0, 0, 0, torso);
    blob.scale.set(1, 1.05, 0.95);
    mesh(geo.body, belly, 0, -0.2, 0.32, torso).scale.set(0.62, 0.62, 0.55);
    const irises = [];
    for (const side of [-1, 1]) {
      mesh(geo.eye, white, side * 0.3, 0.38, 0.62, torso);
      irises.push(mesh(geo.iris, eyeMats.patrol, side * 0.3, 0.38, 0.82, torso));
      mesh(geo.pupil, dark, side * 0.3, 0.38, 0.93, torso);
      const horn = mesh(geo.horn, belly, side * 0.42, 0.88, 0, torso);
      horn.rotation.z = -side * 0.35;
      const foot = mesh(geo.foot, body, side * 0.38, 0.1, 0.15, root);
      foot.scale.set(1, 0.45, 1.3);
    }
    const mouth = mesh(geo.eye, dark, 0, -0.02, 0.78, torso);
    mouth.scale.set(1.3, 0.28, 0.35);
    const club = new THREE.Group();
    club.position.set(0.88, 1.0, 0.15);
    mesh(geo.handle, wood, 0, 0.5, 0, club);
    mesh(geo.head, clubWood, 0, 1.2, 0, club);
    for (const y of [0.95, 1.45]) mesh(geo.band, wood, 0, y, 0, club).rotation.x = Math.PI / 2;
    root.add(club);
    return { root, torso, club, irises };
  };

  const views = brain.monsters.map(() => {
    const parts = monsterModel ? { root: monsterModel.clone(), torso: null, club: null, irises: [] } : builtIn();
    const holder = new THREE.Group();
    holder.add(parts.root);
    const sign = new THREE.Sprite(signs['!']);
    sign.position.y = 2.7;
    sign.visible = false;
    holder.add(sign);
    group.add(holder);
    return { ...parts, holder, sign, walk: 0, shownState: null };
  });

  const hideColor = new THREE.Color(config.hides?.color ?? HIDE_DEFAULTS.color);
  const leaves = [mat({ color: hideColor, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
    mat({ color: hideColor.clone().multiplyScalar(0.75), roughness: 0.9, flatShading: true, side: THREE.DoubleSide })];
  const leafGeo = own(new THREE.IcosahedronGeometry(1, 1));
  const ringGeo = own(new THREE.RingGeometry(cell * 0.3, cell * 0.44, 40).rotateX(-Math.PI / 2));
  const ringMat = own(new THREE.MeshBasicMaterial({ color: hideColor.clone().lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, opacity: 0.45 }));
  for (const h of maze.hides ?? []) {
    let prop;
    if (hideModel) prop = hideModel.clone();
    else {
      prop = new THREE.Group();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + h.x * 0.7 + h.z * 0.3;
        const high = k % 2 === 1;
        const clump = mesh(leafGeo, leaves[k % 2], Math.cos(a) * cell * 0.36, high ? 1.55 : 0.6, Math.sin(a) * cell * 0.36, prop);
        clump.scale.setScalar(high ? 0.62 : 0.85);
        clump.rotation.set(a, a * 2, 0);
      }
    }
    mesh(ringGeo, ringMat, 0, 0.02, 0, prop);
    prop.position.set((h.x + 0.5) * cell, 0, (h.z + 0.5) * cell);
    group.add(prop);
  }

  const draw = (dt) => {
    brain.monsters.forEach((m, i) => {
      const v = views[i];
      v.holder.position.set(m.x, 0, m.z);
      v.holder.rotation.y = m.facing;
      const moving = m.speed > 0.1;
      v.walk += dt * m.speed * 2.4;
      v.root.position.y = moving ? Math.abs(Math.sin(v.walk)) * 0.14 : 0;
      if (v.torso) {
        const squash = moving ? Math.sin(v.walk * 2) * 0.06 : Math.sin(v.walk) * 0.02;
        v.torso.scale.set(1 - squash / 2, 1 + squash, 1 - squash / 2);
        v.walk += moving ? 0 : dt * 1.5;
      }
      if (v.club) {
        const windup = m.state === 'windup' ? clamp01(1 - m.timer / brain.settings.windup) : 0;
        let swing = 0.4 - windup * 2.5;
        if (m.swingLeft > 0) {
          const k = 1 - m.swingLeft / SWING_TIME;
          swing = k < 0.35 ? -2.1 + (k / 0.35) * 3.8 : 1.7 - ((k - 0.35) / 0.65) * 1.3;
        }
        v.club.rotation.x = swing;
        v.torso.rotation.x = -0.2 * windup;
      }
      if (v.shownState !== m.state) {
        v.shownState = m.state;
        for (const iris of v.irises) iris.material = eyeMats[m.state];
      }
      v.sign.visible = m.markLeft > 0;
      if (v.sign.visible) {
        v.sign.material = signs[m.mark];
        v.sign.scale.setScalar(0.9 * Math.min(1, (MARK_TIME - m.markLeft) * 6));
      }
    });
  };
  draw(0);

  return {
    group,
    brain,
    isHide: brain.isHide,
    occupies: brain.occupies,
    get list() { return brain.list; },
    get threat() { return brain.threat; },
    get danger() { return brain.danger; },
    get lives() { return brain.lives; },
    get maxLives() { return brain.maxLives; },
    update(dt, target) {
      const events = brain.update(dt, target);
      draw(dt);
      return events;
    },
    reset() {
      brain.reset();
      draw(0);
    },
    dispose() {
      group.removeFromParent();
      for (const thing of owned) thing.dispose();
      owned.length = 0;
    },
  };
}
