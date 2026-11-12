const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], KeyD: [1, 0],
};

export class Player {
  constructor(camera, maze, config) {
    this.camera = camera;
    this.maze = maze;
    this.cell = config.size.cell;
    this.settings = config.player;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.moving = false;
    this.mouseSensitivity = 1;
    camera.rotation.order = 'YXZ';
    this.reset();

    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      const speed = 0.0025 * this.mouseSensitivity;
      this.yaw -= e.movementX * speed;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * speed));
    });
  }

  reset() {
    const { start } = this.maze;
    this.x = (start.x + 0.5) * this.cell;
    this.z = (start.z + 0.5) * this.cell;
    this.pitch = 0;
    this.yaw = this.openDirection();
    this.apply();
  }

  // Face the first open neighbour so the player does not start staring at a wall.
  openDirection() {
    const { start } = this.maze;
    const options = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
    const open = options.find(([dx, dz]) => !this.maze.isWall(start.x + dx, start.z + dz));
    return open ? open[2] : 0;
  }

  blocked(x, z) {
    const r = this.settings.radius;
    for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      if (this.maze.isWall(Math.floor((x + ox) / this.cell), Math.floor((z + oz) / this.cell))) return true;
    }
    return false;
  }

  update(dt) {
    let side = 0;
    let forward = 0;
    for (const code of this.keys) {
      const m = MOVE_KEYS[code];
      if (m) { side += m[0]; forward += m[1]; }
    }
    if (this.keys.has('ArrowLeft')) this.yaw += this.settings.turnSpeed * dt;
    if (this.keys.has('ArrowRight')) this.yaw -= this.settings.turnSpeed * dt;

    const length = Math.hypot(side, forward);
    this.moving = length > 0;
    if (this.moving) {
      const step = (this.settings.speed * dt) / length;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = (side * cos - forward * sin) * step;
      const dz = (-side * sin - forward * cos) * step;
      if (!this.blocked(this.x + dx, this.z)) this.x += dx;
      if (!this.blocked(this.x, this.z + dz)) this.z += dz;
    }
    this.apply();
  }

  apply() {
    this.camera.position.set(this.x, this.settings.eyeHeight, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  currentCell() {
    return { x: Math.floor(this.x / this.cell), z: Math.floor(this.z / this.cell) };
  }
}
