import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildSmoothWalls } from './walls.js';
import { createEntities } from './entities.js';
import { createMonsters } from './monsters.js';
import { guideMaterials } from './skins.js';

const loader = new GLTFLoader();
const modelCache = new Map();

// Cached by URL so revisiting a level is instant; every caller gets its own clone.
export async function loadModel(url) {
  if (!modelCache.has(url)) {
    const loading = loader.loadAsync(url).then((gltf) => gltf.scene);
    loading.catch(() => modelCache.delete(url));
    modelCache.set(url, loading);
  }
  return (await modelCache.get(url)).clone();
}

// Scales a Blender model to fit one maze cell and rests it on the floor.
function fitToCell(model, cell, height) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(cell / size.x, height / size.y, cell / size.z);
  model.scale.multiplyScalar(scale);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  const holder = new THREE.Group();
  holder.add(model);
  return holder;
}

export function wallStyle(config) {
  const hasModel = Boolean(config.models?.wall);
  const style = config.walls?.style ?? (hasModel ? 'model' : 'blocks');
  if (style === 'model' && hasModel) return 'model';
  return style === 'smooth' ? 'smooth' : 'blocks';
}

function tint(material) {
  material.color?.multiplyScalar(0.72);
  return material;
}

// Builds a level off-screen, then adds it to the scene. dispose() removes it and frees what it created.
// guideColor tints the exit's glow; setGuideColor() changes it later.
export async function buildWorld(scene, maze, config, gameUrl, { guideColor = config.look.exit } = {}) {
  const { cell, wallHeight } = config.size;
  const { look } = config;
  const models = config.models ?? {};
  const walls = config.walls ?? {};
  const style = wallStyle(config);
  const centerOf = (c) => new THREE.Vector3((c.x + 0.5) * cell, 0, (c.z + 0.5) * cell);
  const root = new THREE.Group();
  const owned = [];
  const own = (thing) => { owned.push(thing); return thing; };

  const [wallModel, exitModel, keyModel, doorModel, monsterModel, hideModel] = await Promise.all([
    style === 'model' ? loadModel(gameUrl + models.wall) : null,
    models.exit ? loadModel(gameUrl + models.exit) : null,
    models.key && maze.keys.length ? loadModel(gameUrl + models.key) : null,
    models.door && maze.doors.length ? loadModel(gameUrl + models.door) : null,
    models.monster && maze.monsters.length ? loadModel(gameUrl + models.monster) : null,
    models.hide && maze.hides.length ? loadModel(gameUrl + models.hide) : null,
  ]);

  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(3, 10, 5);
  root.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2), sun);

  const floor = new THREE.Mesh(
    own(new THREE.PlaneGeometry(maze.width * cell, maze.height * cell)),
    own(new THREE.MeshStandardMaterial({ color: look.floor })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((maze.width * cell) / 2, 0, (maze.height * cell) / 2);
  root.add(floor);

  // Moving walls get a darker tint of the wall colour so attentive players can spot them.
  const wallColor = walls.color ?? look.wall;
  const movingColor = walls.movingColor ?? new THREE.Color(wallColor).multiplyScalar(0.72).getStyle();
  let moverTemplate = null;
  if (style === 'model') {
    const template = fitToCell(wallModel, cell, wallHeight);
    for (const w of maze.walls) {
      const copy = template.clone();
      copy.position.copy(centerOf(w));
      root.add(copy);
    }
    moverTemplate = template.clone();
    moverTemplate.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => tint(own(m.clone()))) : tint(own(o.material.clone()));
    });
  } else if (style === 'smooth') {
    if (maze.walls.length) {
      const mesh = buildSmoothWalls(maze, config.size, { ...walls, color: wallColor });
      own(mesh.geometry);
      own(mesh.material);
      root.add(mesh);
    }
    if (maze.movers.length) {
      // A 3 x 3 grid whose only wall is the centre gives one free-standing rounded block.
      const single = { width: 3, height: 3, isWall: (x, z) => x === 1 && z === 1 };
      const block = buildSmoothWalls(single, config.size, { ...walls, color: movingColor });
      own(block.geometry);
      own(block.material);
      block.position.set(-1.5 * cell, 0, -1.5 * cell);
      moverTemplate = new THREE.Group().add(block);
    }
  } else {
    const material = (color) => {
      const opacity = walls.opacity ?? 1;
      return own(new THREE.MeshStandardMaterial({
        color, roughness: walls.roughness ?? 1, metalness: walls.metalness ?? 0, opacity, transparent: opacity < 1,
      }));
    };
    const box = own(new THREE.BoxGeometry(cell, wallHeight, cell).translate(0, wallHeight / 2, 0));
    if (maze.walls.length) {
      const blocks = own(new THREE.InstancedMesh(box, material(wallColor), maze.walls.length));
      const m = new THREE.Matrix4();
      maze.walls.forEach((w, i) => {
        const p = centerOf(w);
        blocks.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z));
      });
      root.add(blocks);
    }
    moverTemplate = new THREE.Mesh(box, material(movingColor));
  }

  let exit;
  let guideMats;
  if (exitModel) {
    exit = fitToCell(exitModel, cell * 0.6, config.size.exitHeight ?? wallHeight * 0.8);
    guideMats = guideMaterials(exit, own);
  } else {
    const gemMaterial = own(new THREE.MeshStandardMaterial({ color: look.exit, emissive: look.exit, emissiveIntensity: 0.6 }));
    const gem = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.6)), gemMaterial);
    gem.position.y = 1.3;
    exit = new THREE.Group();
    exit.add(gem);
    guideMats = [gemMaterial];
  }
  exit.position.copy(centerOf(maze.exit));
  root.add(exit);
  const glow = new THREE.PointLight(look.exit, 30, cell * 3);
  glow.position.copy(centerOf(maze.exit)).setY(1.5);
  root.add(glow);
  const setGuideColor = (color) => {
    for (const m of guideMats) {
      m.color?.set(color);
      m.emissive.set(color);
    }
    glow.color.set(color);
  };
  setGuideColor(guideColor);

  const entities = createEntities(maze, config, {
    keyModel: keyModel && fitToCell(keyModel, 0.8, 0.8),
    doorModel: doorModel && fitToCell(doorModel, cell, wallHeight),
    moverTemplate,
  });
  root.add(entities.group);

  const monsters = createMonsters(maze, config, {
    solid: (x, z) => entities.blocksMonster(x, z),
    opaque: (x, z) => entities.blocks(x, z),
    monsterModel: monsterModel && fitToCell(monsterModel, cell * 0.5, 2.2),
    hideModel: hideModel && fitToCell(hideModel, cell, wallHeight),
  });
  entities.occupied = monsters.occupies;
  root.add(monsters.group);

  const background = new THREE.Color(look.sky);
  const fog = new THREE.Fog(look.sky, 1, look.fogDistance);
  scene.add(root);
  scene.background = background;
  scene.fog = fog;

  return {
    exit,
    style,
    entities,
    monsters,
    setGuideColor,
    dispose() {
      scene.remove(root);
      if (scene.background === background) scene.background = null;
      if (scene.fog === fog) scene.fog = null;
      root.traverse((o) => { if (o.isLight) o.dispose(); });
      entities.dispose();
      monsters.dispose();
      // Model clones share geometry and textures with the cache, so only what this level created is freed.
      for (const thing of owned) thing.dispose();
      owned.length = 0;
    },
  };
}
