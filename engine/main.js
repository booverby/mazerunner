import * as THREE from 'three';
import { parseMaze } from './maze.js';
import { Player } from './player.js';
import { buildWorld } from './world.js';
import { Sounds } from './sound.js';

const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.remove('hidden');
}

async function start() {
  const gameName = new URLSearchParams(location.search).get('game') || 'default';
  const gameUrl = `./games/${gameName}/`;
  const config = await (await fetch(gameUrl + 'game.json')).json();
  const maze = parseMaze(await (await fetch(gameUrl + config.maze)).text());
  document.title = config.title;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const world = await buildWorld(scene, maze, config, gameUrl);
  const player = new Player(camera, maze, config);
  const sounds = new Sounds(config.sounds, gameUrl);
  const { text, rules } = config;

  // state: ready -> playing <-> paused -> won | lost
  const game = { state: 'ready', time: 0, player, maze, config };
  window.game = game;
  showOverlay(config.title, text.start);

  // Some embedded browsers refuse mouse capture; arrow keys still turn the view.
  const lockMouse = () => renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  const play = () => {
    if (game.state === 'won' || game.state === 'lost') {
      player.reset();
      game.time = 0;
    }
    game.state = 'playing';
    overlay.classList.add('hidden');
    sounds.play('music');
    lockMouse();
  };
  const finish = (state) => {
    game.state = state;
    sounds.setLoop('step', false);
    sounds.play(state === 'won' ? 'win' : 'lose');
    document.exitPointerLock?.();
    showOverlay(state === 'won' ? text.win : text.lose, text.again);
  };
  overlay.addEventListener('click', play);
  renderer.domElement.addEventListener('click', lockMouse);
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && game.state === 'playing') {
      game.state = 'paused';
      sounds.setLoop('step', false);
      showOverlay(config.title, text.paused);
    }
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    world.exit.rotation.y += dt;
    if (game.state === 'playing') {
      game.time += dt;
      player.update(dt);
      sounds.setLoop('step', player.moving);
      const at = player.currentCell();
      if (at.x === maze.exit.x && at.z === maze.exit.z) finish('won');
      else if (rules.timeLimit > 0 && game.time >= rules.timeLimit) finish('lost');
    }
    const shown = rules.timeLimit > 0 ? Math.max(0, rules.timeLimit - game.time) : game.time;
    hud.textContent = `${shown.toFixed(1)} s`;
    renderer.render(scene, camera);
  });
}

start().catch((error) => {
  console.error(error);
  showOverlay('Could not start the game', error.message);
});
