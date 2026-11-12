import * as THREE from 'three';

export const DEFAULT_SKIN = { id: 'classic', name: 'Classic', lantern: { color: '#ffc861', style: 'classic', model: null }, guideLight: null };
export const LANTERN_STYLES = ['classic', 'orb', 'crystal'];

// Fills in missing parts so every skin has an id, a name, a lantern colour and a known style.
export function readSkins(config) {
  const list = Array.isArray(config.skins) && config.skins.length ? config.skins : [DEFAULT_SKIN];
  return list.map((skin, i) => {
    const lantern = { ...DEFAULT_SKIN.lantern, ...skin.lantern };
    if (!LANTERN_STYLES.includes(lantern.style)) lantern.style = 'classic';
    const id = String(skin.id ?? i + 1);
    return { id, name: skin.name ?? id, lantern, guideLight: skin.guideLight ?? null };
  });
}

const VIEW_FOV = 60;
const DEPTH = 0.62;

// The lantern held at the lower right. It lives in its own small scene drawn after the level with a
// fixed field of view, so it never clips into walls and looks the same at every field of view setting.
export function createLantern() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(-1, 2, 1);
  scene.add(key);
  const holder = new THREE.Group();
  scene.add(holder);
  const inner = new THREE.PointLight(0xffffff, 0.6, 1, 2);
  const world = new THREE.PointLight(0xffffff, 9, 11, 1.6);
  world.position.set(0.3, -0.3, -0.5);

  const metal = new THREE.MeshStandardMaterial({ color: '#2b2a2e', metalness: 0.6, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1, transparent: true, opacity: 0.88 });
  const parts = [];
  const part = (geometry, material, x, y, z, parent) => {
    parts.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const styles = {
    classic(g) {
      part(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 16), metal, 0, -0.07, 0, g);
      part(new THREE.CylinderGeometry(0.038, 0.038, 0.11, 16), glass, 0, 0, 0, g);
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) part(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 6), metal, x * 0.036, 0, z * 0.036, g);
      part(new THREE.ConeGeometry(0.058, 0.05, 16), metal, 0, 0.08, 0, g);
      part(new THREE.TorusGeometry(0.03, 0.005, 6, 16, Math.PI), metal, 0, 0.11, 0, g);
    },
    orb(g) {
      part(new THREE.SphereGeometry(0.055, 24, 16), glass, 0, 0, 0, g);
      part(new THREE.CylinderGeometry(0.022, 0.03, 0.025, 16), metal, 0, 0.06, 0, g);
      part(new THREE.TorusGeometry(0.026, 0.005, 6, 16), metal, 0, 0.09, 0, g);
    },
    crystal(g) {
      part(new THREE.OctahedronGeometry(0.05), glass, 0, 0.01, 0, g).scale.set(0.8, 1.7, 0.8);
      part(new THREE.CylinderGeometry(0.035, 0.045, 0.03, 6), metal, 0, -0.075, 0, g);
      part(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), metal, 0, -0.13, 0, g);
    },
  };

  let body = null;
  let bobAmp = 0;
  let lastStride = 0;
  let flicker = 0;
  const place = (aspect) => {
    // Keep the lantern inside the view on narrow (phone) screens too.
    const halfWidth = DEPTH * Math.tan(THREE.MathUtils.degToRad(VIEW_FOV / 2)) * aspect;
    holder.userData.base = new THREE.Vector3(Math.min(0.26, halfWidth * 0.68), -0.2, -DEPTH);
    holder.scale.setScalar(Math.min(0.75, 0.5 + 0.25 * aspect / 1.6));
  };
  place(1);

  return {
    scene,
    camera,
    light: world,
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      place(aspect);
    },
    // model: an optional loaded glTF scene; it replaces the built-in shape.
    setSkin(skin, model = null) {
      const color = new THREE.Color(skin.lantern.color);
      glass.color.copy(color).multiplyScalar(0.6);
      glass.emissive.copy(color);
      inner.color.copy(color);
      world.color.copy(color);
      if (body) holder.remove(body);
      for (const geometry of parts) geometry.dispose();
      parts.length = 0;
      body = new THREE.Group();
      if (model) {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        model.scale.multiplyScalar(0.2 / Math.max(size.x, size.y, size.z, 1e-6));
        box.setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        body.add(model);
      } else styles[skin.lantern.style](body);
      body.add(inner);
      holder.add(body);
    },
    // Bobs with the distance walked, a little more while sprinting.
    update(dt, player, active) {
      const stepped = player.stride - lastStride;
      lastStride = player.stride;
      const target = active && stepped > 1e-4 ? (player.sprinting ? 0.022 : 0.011) : 0;
      bobAmp += (target - bobAmp) * Math.min(1, dt * 8);
      const phase = player.stride * 1.6;
      flicker += dt;
      const base = holder.userData.base;
      holder.position.set(base.x + Math.cos(phase / 2) * bobAmp * 0.6, base.y - Math.abs(Math.sin(phase / 2)) * bobAmp, base.z);
      holder.rotation.set(0.12, -0.35, Math.sin(phase / 2) * bobAmp * 2);
      if (body) body.rotation.z = Math.sin(flicker * 1.7) * 0.04 + Math.sin(phase / 2) * bobAmp * 3;
      world.intensity = 9 * (0.94 + 0.06 * Math.sin(flicker * 9.1) * Math.sin(flicker * 5.3));
    },
    render(renderer) {
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}

// Recolours the glowing parts of the exit. Model clones share materials with the cache,
// so each glowing material is cloned once per level before it is changed.
export function guideMaterials(exit, own) {
  const found = [];
  exit.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!m.emissive || m.emissive.getHex() === 0) return m;
      const copy = own(m.clone());
      found.push(copy);
      return copy;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return found;
}
