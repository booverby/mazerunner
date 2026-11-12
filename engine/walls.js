import * as THREE from 'three';

const DEFAULTS = {
  color: '#3f7a35',
  roughness: 0.9,
  metalness: 0,
  opacity: 1,
  roundness: 0.7,
  bumpiness: 0.12,
  colorVariation: 0.25,
  seed: 1,
  detail: 10,
};

function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x, y, z, seed) {
  return 0.65 * valueNoise(x, y, z, seed) + 0.35 * valueNoise(x * 2.03 + 17.1, y * 2.03 + 3.7, z * 2.03 + 9.3, seed + 101);
}

export function buildSmoothWalls(maze, { cell = 4, wallHeight = 3 } = {}, style = {}) {
  const s = { ...DEFAULTS, ...style };
  const H = wallHeight;
  const r = Math.min(Math.max(s.roundness, 0.02), cell * 0.49, H * 0.99);
  const D = Math.max(3, Math.min(32, Math.round(s.detail)));
  const seed = Math.round(s.seed) | 0;
  const bump = Math.max(0, s.bumpiness);
  const W = maze.width, Hz = maze.height;
  const isWall = (x, z) => x < 0 || z < 0 || x >= W || z >= Hz || maze.isWall(x, z);

  // Cell-edge sample offsets: dense inside the rounded band at each end, coarser in the middle.
  const band = Math.max(1, Math.round(D / 4));
  const mid = Math.max(1, D - 2 * band);
  const edge = [];
  for (let i = 0; i <= band; i++) edge.push((r * i) / band);
  for (let i = 1; i < mid; i++) edge.push(r + ((cell - 2 * r) * i) / mid);
  for (let i = 0; i <= band; i++) edge.push(cell - r + (r * i) / band);
  const E = edge.length - 1;
  const lower = Math.max(1, Math.round((D * (H - r)) / cell));
  const rowY = [];
  for (let i = 0; i <= lower; i++) rowY.push(((H - r) * i) / lower);
  for (let i = 1; i <= band; i++) rowY.push(H - r + (r * i) / band);
  const V = rowY.length - 1;
  const lat = (g) => Math.floor(g / E) * cell + edge[g % E];

  const pos = [], nrm = [], box = [], keyOf = new Map();
  const NX = W * E + 1, NZ = Hz * E + 1, SPAN = NX * NZ * (V + 1);

  const corridorRects = (cx, cz) => {
    const rects = [];
    for (let z = cz - 1; z <= cz; z++)
      for (let x = cx - 1; x <= cx; x++)
        if (!isWall(x, z)) rects.push([x * cell - r, (x + 1) * cell + r, z * cell - r, (z + 1) * cell + r]);
    return rects;
  };
  const inside = (x, z, rects) => rects.some((R) => x > R[0] + 1e-9 && x < R[1] - 1e-9 && z > R[2] + 1e-9 && z < R[3] - 1e-9);

  // Closest point of the wall core (footprint shrunk by r with square joints), restricted to the owning cell.
  function core(x, z, hx, hz) {
    const cx = Math.round(x / cell), cz = Math.round(z / cell);
    const rects = corridorRects(cx, cz);
    if (!inside(x, z, rects)) return [x, z];
    const X = [x, cx * cell - r, cx * cell + r], Z = [z, cz * cell - r, cz * cell + r];
    const e = 1e-7;
    let best = [x, z], bd = Infinity;
    for (const qx of X)
      for (const qz of Z) {
        if (qx < hx * cell - e || qx > (hx + 1) * cell + e || qz < hz * cell - e || qz > (hz + 1) * cell + e) continue;
        if (inside(qx, qz, rects)) continue;
        const d = (qx - x) ** 2 + (qz - z) ** 2;
        if (d < bd) { bd = d; best = [qx, qz]; }
      }
    return best;
  }

  function vert(gx, row, gz, hx, hz) {
    let key = (gx * NZ + gz) * (V + 1) + row;
    if (gx % E === 0 && gz % E === 0) {
      const cx = gx / E, cz = gz / E;
      const a = isWall(cx - 1, cz - 1), b = isWall(cx, cz), c = isWall(cx, cz - 1), d = isWall(cx - 1, cz);
      if (a === b && c === d && a !== c) key += SPAN * (1 + hz * W + hx);
    }
    let id = keyOf.get(key);
    if (id !== undefined) return id;
    const px = lat(gx), py = rowY[row], pz = lat(gz);
    const [qx, qz] = core(px, pz, hx, hz);
    const qy = Math.min(py, H - r);
    let dx = px - qx, dy = py - qy, dz = pz - qz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) { dx = 0; dy = 1; dz = 0; } else { dx /= len; dy /= len; dz /= len; }
    id = pos.length / 3;
    pos.push(qx + dx * r, qy + dy * r, qz + dz * r);
    nrm.push(dx, dy, dz);
    box.push(px, py, pz);
    keyOf.set(key, id);
    return id;
  }

  const index = [];
  const bx = (i) => [box[i * 3], box[i * 3 + 1], box[i * 3 + 2]];
  function quad(a, b, c, d, nx, ny, nz) {
    const A = bx(a), B = bx(b), C = bx(c);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) index.push(a, b, c, a, c, d);
    else index.push(a, c, b, a, d, c);
  }

  for (let z = 0; z < Hz; z++)
    for (let x = 0; x < W; x++) {
      if (!isWall(x, z)) continue;
      const ox = x * E, oz = z * E;
      for (let i = 0; i < E; i++)
        for (let j = 0; j < E; j++)
          quad(vert(ox + i, V, oz + j, x, z), vert(ox + i + 1, V, oz + j, x, z),
            vert(ox + i + 1, V, oz + j + 1, x, z), vert(ox + i, V, oz + j + 1, x, z), 0, 1, 0);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= Hz || isWall(nx, nz)) continue;
        for (let i = 0; i < E; i++)
          for (let k = 0; k < V; k++) {
            const at = (t, row) => dx !== 0
              ? vert(ox + (dx > 0 ? E : 0), row, oz + t, x, z)
              : vert(ox + t, row, oz + (dz > 0 ? E : 0), x, z);
            quad(at(i, k), at(i + 1, k), at(i + 1, k + 1), at(i, k + 1), dx, 0, dz);
          }
      }
    }

  const n = pos.length / 3;
  const colors = new Float32Array(n * 3);
  const cv = Math.min(Math.max(s.colorVariation, 0), 1);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const b = fbm(x / 1.1, y / 1.1, z / 1.1, seed);
    const k = bump * b;
    pos[i * 3] = x - nrm[i * 3] * k;
    pos[i * 3 + 1] = Math.max(0, y - nrm[i * 3 + 1] * k);
    pos[i * 3 + 2] = z - nrm[i * 3 + 2] * k;
    const tone = fbm(x / 2.3 + 51.3, y / 2.3, z / 2.3 - 7.7, seed + 7);
    const h = Math.min(Math.max(y / H, 0), 1);
    const c = (1 + cv * 1.6 * (tone - 0.5) - cv * 0.6 * (b - 0.5)) * (0.78 + 0.22 * h * h * (3 - 2 * h));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = Math.max(0.05, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const transparent = s.opacity < 1;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(s.color),
    roughness: s.roughness,
    metalness: s.metalness,
    vertexColors: true,
    transparent,
    opacity: s.opacity,
    // A single draw call cannot be depth-sorted; skipping depth writes keeps see-through walls from popping.
    depthWrite: !transparent,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'walls';
  return mesh;
}
