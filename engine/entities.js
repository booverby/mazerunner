import * as THREE from 'three';

export const KEY_DEFAULTS = {
  a: { name: 'Red', color: '#e53935' },
  b: { name: 'Yellow', color: '#fdd835' },
  c: { name: 'Blue', color: '#1e88e5' },
};
const MOVING_DEFAULTS = { upTime: 4, downTime: 3, moveTime: 1 };
const DOOR_TIME = 0.6;
const PASSABLE = 0.15;
const HINT_GAP = 2.5;

function doorTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const base = new THREE.Color(color);
  g.fillStyle = base.clone().multiplyScalar(0.35).getStyle();
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = base.getStyle();
  g.fillRect(12, 12, 104, 104);
  g.fillStyle = base.clone().multiplyScalar(0.6).getStyle();
  for (const x of [38, 64, 90]) g.fillRect(x - 2, 12, 4, 104);
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(64, 56, 9, 0, Math.PI * 2);
  g.moveTo(58, 60);
  g.lineTo(70, 60);
  g.lineTo(74, 82);
  g.lineTo(54, 82);
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Keys, locked doors and moving walls of one level. Built once per level; reset() puts everything back.
export function createEntities(maze, config, { keyModel = null, doorModel = null, moverTemplate = null } = {}) {
  const { cell, wallHeight } = config.size;
  const timing = { ...MOVING_DEFAULTS, ...config.rules?.movingWalls };
  const group = new THREE.Group();
  const owned = [];
  const own = (thing) => { owned.push(thing); return thing; };
  const keyInfo = (id) => ({ id, ...KEY_DEFAULTS[id], ...config.keys?.[id] });
  const place = (obj, c, y = 0) => { obj.position.set((c.x + 0.5) * cell, y, (c.z + 0.5) * cell); group.add(obj); return obj; };
  const cellKey = (x, z) => `${x},${z}`;
  const blockers = new Map();

  const materials = new Map();
  const keyMaterial = (color) => {
    if (!materials.has(color)) {
      materials.set(color, own(new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.35,
      })));
    }
    return materials.get(color);
  };
  let keyParts = null;
  const builtInKey = (color) => {
    keyParts ??= [
      [own(new THREE.TorusGeometry(0.16, 0.05, 10, 24)), -0.24, 0, 0],
      [own(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10)), 0.1, 0, Math.PI / 2],
      [own(new THREE.BoxGeometry(0.05, 0.13, 0.05)), 0.3, -0.08, 0],
      [own(new THREE.BoxGeometry(0.05, 0.09, 0.05)), 0.19, -0.06, 0],
    ];
    const key = new THREE.Group();
    for (const [geometry, x, y, rz] of keyParts) {
      const part = new THREE.Mesh(geometry, keyMaterial(color));
      part.position.set(x, y, 0);
      part.rotation.z = rz;
      key.add(part);
    }
    key.scale.setScalar(1.3);
    key.rotation.x = 0.35;
    return key;
  };

  const keys = maze.keys.map((k) => {
    const info = keyInfo(k.id);
    const holder = new THREE.Group();
    holder.add(keyModel ? keyModel.clone() : builtInKey(info.color));
    const light = new THREE.PointLight(info.color, 4, cell * 1.5);
    light.position.y = 0.3;
    holder.add(light);
    return { ...k, taken: false, mesh: place(holder, k), light, spin: Math.random() * Math.PI * 2 };
  });

  let doorGeometry = null;
  const doors = maze.doors.map((d) => {
    let mesh;
    if (doorModel) {
      mesh = doorModel.clone();
    } else {
      doorGeometry ??= own(new THREE.BoxGeometry(cell - 0.04, wallHeight, cell - 0.04).translate(0, wallHeight / 2, 0));
      const map = own(doorTexture(keyInfo(d.id).color));
      mesh = new THREE.Mesh(doorGeometry, own(new THREE.MeshStandardMaterial({
        map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.6, metalness: 0.1,
      })));
    }
    const door = { ...d, kind: 'door', height: 1, opening: false, mesh: place(mesh, d) };
    blockers.set(cellKey(d.x, d.z), door);
    return door;
  });

  const movers = maze.movers.map((m) => {
    const mover = { ...m, kind: 'mover', height: 1, phase: 'up', timer: 0, mesh: moverTemplate ? place(moverTemplate.clone(), m) : null };
    blockers.set(cellKey(m.x, m.z), mover);
    return mover;
  });

  const held = [];
  let hintWait = 0;
  const sink = (thing) => {
    if (!thing.mesh) return;
    thing.mesh.position.y = -(1 - thing.height) * (wallHeight + 0.02);
    thing.mesh.visible = thing.height > 0;
  };
  const overlaps = (player, c) => {
    const r = player.settings.radius;
    return player.x + r > c.x * cell && player.x - r < (c.x + 1) * cell
      && player.z + r > c.z * cell && player.z - r < (c.z + 1) * cell;
  };
  const near = (player, c) => Math.hypot(player.x - (c.x + 0.5) * cell, player.z - (c.z + 0.5) * cell) < cell * 3;

  const entities = {
    group,
    keyInfo,
    onEvent: () => {},
    // Set by the level when something else (a monster) can stand in a lowered moving wall.
    occupied: () => false,
    get held() { return [...held]; },
    get keys() { return keys.map(({ id, x, z, taken }) => ({ id, x, z, taken })); },
    get doors() { return doors.map(({ id, x, z, height }) => ({ id, x, z, open: height === 0, height })); },
    get movers() {
      return movers.map(({ x, z, startsUp, height, phase }) => ({ x, z, startsUp, height, phase, blocking: height >= PASSABLE }));
    },

    blocks(x, z) {
      const thing = blockers.get(cellKey(x, z));
      if (!thing) return false;
      return thing.kind === 'mover' ? thing.height >= PASSABLE : thing.height > 0;
    },

    // Monsters only walk through doors that are fully open and moving walls that are fully down.
    blocksMonster(x, z) {
      const thing = blockers.get(cellKey(x, z));
      if (!thing) return false;
      return thing.kind === 'mover' ? thing.phase !== 'down' : thing.height > 0;
    },

    reset() {
      held.length = 0;
      hintWait = 0;
      for (const k of keys) {
        k.taken = false;
        k.mesh.visible = true;
        k.light.intensity = 4;
        k.mesh.position.y = 1.15;
      }
      for (const d of doors) Object.assign(d, { height: 1, opening: false });
      for (const m of movers) {
        Object.assign(m, m.startsUp
          ? { height: 1, phase: 'up', timer: timing.upTime }
          : { height: 0, phase: 'down', timer: timing.downTime });
      }
      [...doors, ...movers].forEach(sink);
    },

    // The player's bumped cells (from its last move) decide which doors were touched.
    update(dt, player) {
      hintWait = Math.max(0, hintWait - dt);
      const here = player.currentCell();
      for (const k of keys) {
        if (k.taken) continue;
        k.spin += dt;
        k.mesh.rotation.y = k.spin * 0.8;
        k.mesh.position.y = 1.15 + Math.sin(k.spin * 2) * 0.08;
        if (here.x === k.x && here.z === k.z) {
          k.taken = true;
          k.mesh.visible = false;
          k.light.intensity = 0;
          if (!held.includes(k.id)) held.push(k.id);
          entities.onEvent('gotKey', keyInfo(k.id));
        }
      }
      for (const d of doors) {
        if (d.opening) {
          d.height = Math.max(0, d.height - dt / DOOR_TIME);
          sink(d);
        } else if (player.bumped.has(cellKey(d.x, d.z))) {
          if (held.includes(d.id)) {
            d.opening = true;
            entities.onEvent('doorOpen', keyInfo(d.id));
          } else if (hintWait === 0) {
            hintWait = HINT_GAP;
            entities.onEvent('needKey', keyInfo(d.id));
          }
        }
      }
      for (const m of movers) {
        m.timer -= dt;
        if (m.phase === 'up' && m.timer <= 0) {
          m.phase = 'sinking';
          if (near(player, m)) entities.onEvent('wallMove');
        } else if (m.phase === 'sinking') {
          m.height = Math.max(0, m.height - dt / timing.moveTime);
          if (m.height === 0) Object.assign(m, { phase: 'down', timer: timing.downTime });
        } else if (m.phase === 'down' && m.timer <= 0 && !overlaps(player, m) && !entities.occupied(m.x, m.z)) {
          m.phase = 'rising';
          if (near(player, m)) entities.onEvent('wallMove');
        } else if (m.phase === 'rising') {
          // Someone stepped in while it was still low: back off instead of trapping them.
          if (overlaps(player, m) || entities.occupied(m.x, m.z)) m.phase = 'sinking';
          else {
            m.height = Math.min(1, m.height + dt / timing.moveTime);
            if (m.height === 1) Object.assign(m, { phase: 'up', timer: timing.upTime });
          }
        }
        sink(m);
      }
    },

    dispose() {
      group.removeFromParent();
      for (const thing of owned) thing.dispose();
      owned.length = 0;
    },
  };
  entities.reset();
  return entities;
}
