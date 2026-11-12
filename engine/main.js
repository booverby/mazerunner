import * as THREE from 'three';
import { parseMaze } from './maze.js';
import { Player } from './player.js';
import { buildWorld } from './world.js';
import { Sounds } from './sound.js';
import { createMenu } from './menu.js';
import { createSettings, SETTING_RANGES } from './settings.js';

const TEXT_DEFAULTS = {
  controls: 'Move: W A S D or arrow keys\nLook: mouse\nPause: Esc or P',
  play: 'Play',
  settings: 'Settings',
  back: 'Back',
  paused: 'Paused',
  resume: 'Resume',
  restart: 'Restart level',
  quit: 'Quit to menu',
  win: 'You found the exit!',
  lose: 'Time is up',
  timeTaken: 'Time: {time} s',
  playAgain: 'Play again',
  fov: 'Field of view',
  mouseSensitivity: 'Mouse sensitivity',
  resetSettings: 'Reset to defaults',
};

const hud = document.getElementById('hud');
const menu = createMenu(document.getElementById('overlay'));

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
  const camera = new THREE.PerspectiveCamera(SETTING_RANGES.fov.fallback, 1, 0.1, 500);
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
  const { rules } = config;
  const text = { ...TEXT_DEFAULTS, ...config.text };
  const canvas = renderer.domElement;
  const settings = createSettings(gameName, config.player, ({ fov, mouseSensitivity }) => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    player.mouseSensitivity = mouseSensitivity;
  });

  // state: menu -> playing <-> paused -> won | lost
  const game = { state: 'menu', time: 0, player, maze, config, settings };
  window.game = game;

  // Some embedded browsers refuse mouse capture; arrow keys still turn the view.
  const lockMouse = () => canvas.requestPointerLock?.()?.catch?.(() => {});
  const unlockMouse = () => { if (document.pointerLockElement) document.exitPointerLock(); };
  let hadLock = false;
  let pausedAt = 0;
  let settingsBack = null;

  const setState = (state) => {
    game.state = state;
    player.keys.clear();
    if (state !== 'playing') sounds.setLoop('step', false);
  };
  const screen = (options) => {
    settingsBack = null;
    menu.show(options);
  };
  const resetLevel = () => {
    player.reset();
    game.time = 0;
  };
  const startPlaying = () => {
    setState('playing');
    menu.hide();
    sounds.play('music');
    lockMouse();
  };

  const showMainMenu = () => screen({
    title: config.title,
    text: text.controls,
    buttons: [
      { label: text.play, onClick: () => game.play() },
      { label: text.settings, onClick: () => openSettings(showMainMenu) },
    ],
  });
  const showPauseMenu = () => screen({
    title: text.paused,
    buttons: [
      { label: text.resume, onClick: () => game.resume() },
      { label: text.restart, onClick: () => game.restart() },
      { label: text.settings, onClick: () => openSettings(showPauseMenu) },
      { label: text.quit, onClick: () => game.quit() },
    ],
  });
  const showResult = () => screen({
    title: game.state === 'won' ? text.win : text.lose,
    text: text.timeTaken.replace('{time}', game.time.toFixed(1)),
    buttons: [
      { label: text.playAgain, onClick: () => game.restart() },
      { label: text.quit, onClick: () => game.quit() },
    ],
  });

  function openSettings(back, focus = 0) {
    const slider = (name, format) => ({
      type: 'slider', label: text[name], ...SETTING_RANGES[name], value: settings[name], format,
      onInput: (value) => settings.set(name, value),
    });
    menu.show({
      title: text.settings,
      controls: [
        slider('fov', (v) => `${v}°`),
        slider('mouseSensitivity', (v) => `${v.toFixed(1)}x`),
      ],
      buttons: [
        { label: text.resetSettings, onClick: () => { settings.reset(); openSettings(back, 2); } },
        { label: text.back, onClick: back },
      ],
      focus,
    });
    settingsBack = back;
  }

  game.play = () => {
    resetLevel();
    startPlaying();
  };
  game.pause = () => {
    if (game.state !== 'playing') return;
    setState('paused');
    pausedAt = performance.now();
    unlockMouse();
    showPauseMenu();
  };
  game.resume = () => {
    if (game.state === 'paused') startPlaying();
  };
  game.restart = () => {
    resetLevel();
    startPlaying();
  };
  game.quit = () => {
    setState('menu');
    sounds.stop('music');
    unlockMouse();
    resetLevel();
    showMainMenu();
  };
  const finish = (state) => {
    setState(state);
    sounds.play(state === 'won' ? 'win' : 'lose');
    unlockMouse();
    showResult();
  };

  canvas.addEventListener('click', () => { if (game.state === 'playing') lockMouse(); });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      hadLock = true;
      if (game.state !== 'playing') unlockMouse();
    } else if (hadLock) {
      hadLock = false;
      game.pause();
    }
  });
  addEventListener('keydown', (e) => {
    if (e.repeat || (e.code !== 'Escape' && e.code !== 'KeyP')) return;
    if (settingsBack) {
      if (e.code === 'Escape') settingsBack();
    } else if (game.state === 'playing') {
      game.pause();
    } else if (game.state === 'paused' && performance.now() - pausedAt > 300) {
      // Some browsers also deliver the Escape that released the mouse; don't let it resume at once.
      game.resume();
    }
  });

  showMainMenu();

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
  menu.show({ title: 'Could not start the game', text: error.message });
});
