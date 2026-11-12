import * as THREE from 'three';
import { parseMaze } from './maze.js';
import { Player } from './player.js';
import { buildWorld } from './world.js';
import { Sounds } from './sound.js';
import { createMenu } from './menu.js';
import { createSettings, SETTING_RANGES } from './settings.js';
import { createProgress } from './progress.js';

const TEXT_DEFAULTS = {
  controls: 'Move: W A S D or arrow keys\nLook: mouse\nPause: Esc or P\nPick up keys to open doors of the same colour',
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
  chooseLevel: 'Choose a level',
  locked: 'Locked',
  bestTime: 'Best: {time} s',
  nextLevel: 'Next level',
  allDone: 'You escaped every maze!',
  loading: 'Loading...',
  loadError: 'Could not load the level',
  needKey: 'You need the {key} key',
  gotKey: '{key} key picked up',
};

// Sections a level may override; each is merged one level deep over the top-level section.
const LEVEL_SECTIONS = ['size', 'look', 'walls', 'rules', 'models', 'sounds', 'keys'];

const levelConfig = (config, level) => {
  const merged = { ...config };
  for (const name of LEVEL_SECTIONS) merged[name] = { ...config[name], ...level[name] };
  merged.rules.movingWalls = { ...config.rules?.movingWalls, ...level.rules?.movingWalls };
  return merged;
};

const hud = document.getElementById('hud');
const hudStatus = document.getElementById('hud-status');
const hudKeys = document.getElementById('hud-keys');
const hint = document.getElementById('hint');
const HINT_TIME = 2;
const menu = createMenu(document.getElementById('overlay'));

async function start() {
  const gameName = new URLSearchParams(location.search).get('game') || 'default';
  const gameUrl = `./games/${gameName}/`;
  const config = await (await fetch(gameUrl + 'game.json')).json();
  document.title = config.title;
  const hasLevelList = Array.isArray(config.levels) && config.levels.length > 0;
  const levels = (hasLevelList ? config.levels : [{ id: 'main', name: config.title, maze: config.maze }])
    .map((level, i) => ({ ...level, id: String(level.id ?? i + 1), name: level.name ?? String(level.id ?? i + 1) }));

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

  const player = new Player(camera, config.player);
  let sounds = new Sounds({}, gameUrl);
  const text = { ...TEXT_DEFAULTS, ...config.text };
  const fillTime = (template, seconds) => template.replace('{time}', seconds.toFixed(1));
  const progress = createProgress(gameName, levels.length);
  let world = null;
  let current = -1;
  let rules = {};
  const canvas = renderer.domElement;
  const settings = createSettings(gameName, config.player, ({ fov, mouseSensitivity }) => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    player.mouseSensitivity = mouseSensitivity;
  });

  // state: menu -> loading -> playing <-> paused -> won | lost
  const game = { state: 'menu', time: 0, player, maze: null, config, levelConfig: null, settings, progress };
  Object.defineProperties(game, {
    entities: { enumerable: true, get: () => world?.entities ?? null },
    levels: {
      enumerable: true,
      get: () => levels.map((level, i) => ({
        id: level.id, name: level.name, unlocked: progress.isUnlocked(i), best: progress.best(level.id),
      })),
    },
    level: { enumerable: true, get: () => levels[current]?.id ?? null },
  });
  window.game = game;

  // Some embedded browsers refuse mouse capture; arrow keys still turn the view.
  const lockMouse = () => canvas.requestPointerLock?.()?.catch?.(() => {});
  const unlockMouse = () => { if (document.pointerLockElement) document.exitPointerLock(); };
  let hadLock = false;
  let pausedAt = 0;
  let escapeBack = null;

  const setState = (state) => {
    game.state = state;
    player.keys.clear();
    if (state !== 'playing') sounds.setLoop('step', false);
  };
  const screen = (options) => {
    escapeBack = null;
    menu.show(options);
  };
  let hintLeft = 0;
  let shownKeys = null;
  const showHint = (template, key) => {
    hint.textContent = template.replace('{key}', key.name);
    hintLeft = HINT_TIME;
  };
  // Held keys show as a colour swatch plus the colour name, so colour is never the only clue.
  const renderKeys = () => {
    const held = world.entities.held;
    if (held.join() === shownKeys) return;
    shownKeys = held.join();
    hudKeys.replaceChildren(...held.map((id) => {
      const { name, color } = world.entities.keyInfo(id);
      const item = document.createElement('span');
      item.className = 'hud-key';
      const swatch = document.createElement('span');
      swatch.className = 'hud-swatch';
      swatch.style.background = color;
      item.append(swatch, name);
      return item;
    }));
  };
  const onEntityEvent = (type, key) => {
    if (type === 'gotKey') { showHint(text.gotKey, key); sounds.play('key'); }
    else if (type === 'needKey') showHint(text.needKey, key);
    else if (type === 'doorOpen') sounds.play('door');
    else if (type === 'wallMove') sounds.play('wallMove');
  };
  const resetLevel = () => {
    player.reset();
    world?.entities.reset();
    hintLeft = 0;
    shownKeys = null;
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
  const showLevelSelect = () => {
    screen({
      title: text.chooseLevel,
      buttons: [
        ...levels.map((level, i) => {
          const unlocked = progress.isUnlocked(i);
          const best = progress.best(level.id);
          return {
            label: level.name,
            detail: !unlocked ? text.locked : best !== null ? fillTime(text.bestTime, best) : '',
            disabled: !unlocked,
            onClick: () => game.loadLevel(i),
          };
        }),
        { label: text.back, onClick: showMainMenu },
      ],
      focus: progress.unlocked,
    });
    escapeBack = showMainMenu;
  };
  const showResult = () => {
    const won = game.state === 'won';
    const isLast = current === levels.length - 1;
    const best = progress.best(levels[current].id);
    const lines = [fillTime(text.timeTaken, game.time)];
    if (won && best !== null) lines.push(fillTime(text.bestTime, best));
    screen({
      title: won ? (isLast && hasLevelList ? text.allDone : text.win) : text.lose,
      text: lines.join('\n'),
      buttons: [
        ...(won && !isLast ? [{ label: text.nextLevel, onClick: () => game.loadLevel(current + 1) }] : []),
        { label: text.playAgain, onClick: () => game.restart() },
        { label: text.quit, onClick: () => game.quit() },
      ],
    });
  };

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
    escapeBack = back;
  }

  async function prepareLevel(index) {
    if (index === current && world) return;
    const level = levels[index];
    const levelCfg = levelConfig(config, level);
    const response = await fetch(gameUrl + level.maze);
    if (!response.ok) throw new Error(`Could not load the maze file "${level.maze}".`);
    const maze = parseMaze(await response.text());
    const next = await buildWorld(scene, maze, levelCfg, gameUrl);
    world?.dispose();
    sounds.stop('music');
    sounds.setLoop('step', false);
    world = next;
    current = index;
    rules = levelCfg.rules;
    sounds = new Sounds(levelCfg.sounds, gameUrl);
    next.entities.onEvent = onEntityEvent;
    player.setLevel(maze, levelCfg, (x, z) => maze.isWall(x, z) || next.entities.blocks(x, z));
    Object.assign(game, { maze, levelConfig: levelCfg, time: 0 });
  }
  // Loads run one after another so two quick requests can never build into the scene at the same time.
  let loadQueue = Promise.resolve();
  const queueLevel = (index) => (loadQueue = loadQueue.catch(() => {}).then(() => prepareLevel(index)));

  game.loadLevel = async (idOrIndex) => {
    const index = typeof idOrIndex === 'number' ? idOrIndex : levels.findIndex((l) => l.id === String(idOrIndex));
    if (!levels[index]) throw new Error(`There is no level "${idOrIndex}".`);
    if (index !== current) {
      setState('loading');
      unlockMouse();
      screen({ title: text.loading });
    }
    try {
      await queueLevel(index);
    } catch (error) {
      console.error(error);
      setState('menu');
      screen({ title: text.loadError, text: error.message, buttons: [{ label: text.back, onClick: showMainMenu }] });
      return false;
    }
    resetLevel();
    startPlaying();
    return true;
  };
  game.play = () => (hasLevelList ? showLevelSelect() : game.loadLevel(0));
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
    if (state === 'won') progress.complete(current, levels[current].id, game.time);
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
    if (escapeBack) {
      if (e.code === 'Escape') escapeBack();
    } else if (game.state === 'playing') {
      game.pause();
    } else if (game.state === 'paused' && performance.now() - pausedAt > 300) {
      // Some browsers also deliver the Escape that released the mouse; don't let it resume at once.
      game.resume();
    }
  });

  screen({ title: text.loading });
  // The furthest unlocked level is built behind the main menu; if it fails, Play still shows the error.
  await queueLevel(progress.unlocked).catch((error) => console.error(error));
  showMainMenu();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (world) world.exit.rotation.y += dt;
    if (game.state === 'playing') {
      game.time += dt;
      player.update(dt);
      world.entities.update(dt, player);
      hintLeft = Math.max(0, hintLeft - dt);
      sounds.setLoop('step', player.moving);
      const at = player.currentCell();
      const { exit } = game.maze;
      if (at.x === exit.x && at.z === exit.z) finish('won');
      else if (rules.timeLimit > 0 && game.time >= rules.timeLimit) finish('lost');
    }
    const shown = rules.timeLimit > 0 ? Math.max(0, rules.timeLimit - game.time) : game.time;
    const hudShown = Boolean(world) && game.state !== 'menu' && game.state !== 'loading';
    hud.classList.toggle('hidden', !hudShown);
    if (hudShown) {
      hudStatus.textContent = `${levels[current].name}  ·  ${shown.toFixed(1)} s`;
      renderKeys();
    }
    hint.classList.toggle('hidden', !(hintLeft > 0 && game.state === 'playing'));
    renderer.render(scene, camera);
  });
}

start().catch((error) => {
  console.error(error);
  menu.show({ title: 'Could not start the game', text: error.message });
});
