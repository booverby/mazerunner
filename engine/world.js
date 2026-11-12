import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function loadModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
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

export async function buildWorld(scene, maze, config, gameUrl) {
  const { cell, wallHeight } = config.size;
  const { look, models } = config;
  const centerOf = (c) => new THREE.Vector3((c.x + 0.5) * cell, 0, (c.z + 0.5) * cell);

  scene.background = new THREE.Color(look.sky);
  scene.fog = new THREE.Fog(look.sky, 1, look.fogDistance);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(3, 10, 5);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(maze.width * cell, maze.height * cell),
    new THREE.MeshStandardMaterial({ color: look.floor }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((maze.width * cell) / 2, 0, (maze.height * cell) / 2);
  scene.add(floor);

  if (models.wall) {
    const template = fitToCell(await loadModel(gameUrl + models.wall), cell, wallHeight);
    for (const w of maze.walls) {
      const copy = template.clone();
      copy.position.copy(centerOf(w));
      scene.add(copy);
    }
  } else {
    const walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(cell, wallHeight, cell),
      new THREE.MeshStandardMaterial({ color: look.wall }),
      maze.walls.length,
    );
    const m = new THREE.Matrix4();
    maze.walls.forEach((w, i) => {
      const p = centerOf(w);
      walls.setMatrixAt(i, m.makeTranslation(p.x, wallHeight / 2, p.z));
    });
    scene.add(walls);
  }

  let exit;
  if (models.exit) {
    exit = fitToCell(await loadModel(gameUrl + models.exit), cell * 0.6, wallHeight * 0.8);
  } else {
    exit = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6),
      new THREE.MeshStandardMaterial({ color: look.exit, emissive: look.exit, emissiveIntensity: 0.6 }),
    );
    exit.position.y = 1.3;
    const holder = new THREE.Group();
    holder.add(exit);
    exit = holder;
  }
  exit.position.copy(centerOf(maze.exit));
  scene.add(exit);
  const glow = new THREE.PointLight(look.exit, 30, cell * 3);
  glow.position.copy(centerOf(maze.exit)).setY(1.5);
  scene.add(glow);

  return { exit };
}
