import * as THREE from 'three';
import { parseMaze } from './maze.js';
import { Player } from './player.js';
import { buildWorld, loadModel } from './world.js';
import { Sounds } from './sound.js';
import { createMusic } from './music.js';
import { createMapPeek, drawMap, musicIntensity } from './abilities.js';
import { createLantern, readSkins } from './skins.js';
import { createMenu } from './menu.js';
import { createSettings, SETTING_RANGES } from './settings.js';
import { createProgress } from './progress.js';

const TEXT_DEFAULTS = {
  controls: 'W A S D to move, mouse to look\nShift to sprint, M for the map\nEsc to pause',
  howToPlay: 'How to play',
  howToPlayText: 'Move: W A S D or arrow keys\nLook: mouse (arrow keys also turn)\nSprint: hold Shift while the stamina bar lasts\nMap: M or Tab shows the maze for a few seconds\nPause: Esc or P\n\nPick up keys to open doors of the same colour\nMonsters only notice you when you move\nHide in bushes to shake them off\nReach the guide light before the time runs out',
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
  lives: 'Lives: {lives}',
  hidden: 'Hidden',
  unseen: 'Unseen',
  spotted: 'Spotted!',
  caught: 'Caught!',
  lostLife: 'Ouch! {lives} lives left',
  stamina: 'Stamina',
  staminaEmpty: 'Out of breath',
  mapReady: 'Map ready (M)',
  mapWait: 'Map {time} s',
  mapOpen: 'Map open',
  mapLabel: 'Map of the maze',
  hurry: 'Hurry!',
  skins: 'Skins',
  selected: 'Selected',
  musicVolume: 'Music volume',
  soundVolume: 'Sound effects volume',
};
const FLASH_TIME = 0.5;
const TICK = 0.05;

// Sections a level may override; each is merged one level deep over the top-level section.
const LEVEL_SECTIONS = ['size', 'look', 'walls', 'rules', 'models', 'sounds', 'keys', 'monsters', 'hides', 'abilities', 'music'];

const levelConfig = (config, level) => {
  const merged = { ...config };
  for (const name of LEVEL_SECTIONS) merged[name] = { ...config[name], ...level[name] };
  merged.rules.movingWalls = { ...config.rules?.movingWalls, ...level.rules?.movingWalls };
  for (const name of ['mapPeek', 'sprint']) merged.abilities[name] = { ...config.abilities?.[name], ...level.abilities?.[name] };
  return merged;
};

// Old games only set sounds.music; it becomes the calm layer when no music section names any file.
const musicFiles = (cfg) => {
  const files = { calm: cfg.music.calm, tense: cfg.music.tense, danger: cfg.music.danger };
  if (!files.calm && !files.tense && !files.danger) files.calm = cfg.sounds.music;
  return files;
};

const hud = document.getElementById('hud');
const hudStatus = document.getElementById('hud-status');
const hudKeys = document.getElementById('hud-keys');
const hudDanger = document.getElementById('hud-danger');
const hudHearts = document.getElementById('hud-hearts');
const hudLives = document.getElementById('hud-lives-text');
const hudStealth = document.getElementById('hud-stealth');
const vignette = document.getElementById('vignette');
const hideTint = document.getElementById('hide-tint');
const flash = document.getElementById('flash');
const hint = document.getElementById('hint');
const hudStamina = document.getElementById('hud-stamina');
const hudStaminaLabel = document.getElementById('hud-stamina-label');
const hudStaminaFill = document.getElementById('hud-stamina-fill');
const hudMap = document.getElementById('hud-map');
const mapCanvas = document.getElementById('map');
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
  const lantern = createLantern();
  // The camera joins the scene so the lantern's light, attached to it, lights the walls.
  camera.add(lantern.light);
  scene.add(camera);
  renderer.autoClear = false;
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    lantern.resize(camera.aspect);
  };
  addEventListener('resize', resize);
  resize();

  const player = new Player(camera, config.player);
  let sounds = new Sounds({}, gameUrl);
  let music = null;
  let musicKey = null;
  let mapPeek = createMapPeek();
  const skins = readSkins(config);
  let skin = skins[0];
  const text = { ...TEXT_DEFAULTS, ...config.text };
  const fillTime = (template, seconds) => template.replace('{time}', seconds.toFixed(1));
  const progress = createProgress(gameName, levels.length);
  let world = null;
  let current = -1;
  let rules = {};
  const canvas = renderer.domElement;
  const settings = createSettings(gameName, config.player, ({ fov, mouseSensitivity, musicVolume, soundVolume }) => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    player.mouseSensitivity = mouseSensitivity;
    music?.setVolume(musicVolume / 100);
    sounds.setVolume(soundVolume / 100);
  });
  skin = skins.find((s) => s.id === settings.skin) ?? skins[0];

  // state: menu -> loading -> playing <-> paused -> won | lost
  const game = {
    state: 'menu', time: 0, player, maze: null, config, levelConfig: null, settings, progress,
    hidden: false, threat: 0, intensity: 0, skins: skins.map(({ id, name }) => ({ id, name })),
  };
  Object.defineProperties(game, {
    entities: { enumerable: true, get: () => world?.entities ?? null },
    monsters: { enumerable: true, get: () => world?.monsters.list ?? [] },
    lives: { enumerable: true, get: () => world?.monsters.lives ?? 0 },
    levels: {
      enumerable: true,
      get: () => levels.map((level, i) => ({
        id: level.id, name: level.name, unlocked: progress.isUnlocked(i), best: progress.best(level.id),
      })),
    },
    level: { enumerable: true, get: () => levels[current]?.id ?? null },
    stamina: { enumerable: true, get: () => player.stamina.fraction },
    sprinting: { enumerable: true, get: () => player.sprinting },
    mapVisible: { enumerable: true, get: () => mapPeek.visible },
    mapReady: { enumerable: true, get: () => mapPeek.ready },
    skin: { enumerable: true, get: () => skin.id },
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
    if (state !== 'playing') {
      sounds.setLoop('step', false);
      sounds.setLoop('sprint', false);
    }
  };
  const screen = (options) => {
    escapeBack = null;
    menu.show(options);
  };
  let hintLeft = 0;
  let shownKeys = null;
  let flashLeft = 0;
  let caught = false;
  const say = (message) => {
    hint.textContent = message;
    hintLeft = HINT_TIME;
  };
  const showHint = (template, key) => say(template.replace('{key}', key.name));
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
    world?.monsters.reset();
    hintLeft = 0;
    shownKeys = null;
    flashLeft = 0;
    caught = false;
    mapPeek.reset();
    Object.assign(game, { time: 0, hidden: false, threat: 0, intensity: 0 });
    music?.setIntensity(0);
  };
  const startPlaying = () => {
    setState('playing');
    menu.hide();
    music?.start();
    lockMouse();
  };

  const guideColor = () => skin.guideLight ?? game.levelConfig?.look?.exit ?? '#3aa0ff';
  let skinRequest = 0;
  game.setSkin = (id) => {
    const next = skins.find((s) => s.id === String(id));
    if (!next) return false;
    skin = next;
    settings.setSkin(next.id);
    world?.setGuideColor(guideColor());
    lantern.setSkin(next);
    const request = ++skinRequest;
    if (next.lantern.model) {
      loadModel(gameUrl + next.lantern.model)
        .then((model) => { if (request === skinRequest) lantern.setSkin(next, model); })
        .catch((error) => console.warn(`Could not load the lantern model "${next.lantern.model}".`, error));
    }
    return true;
  };
  game.setSkin(skin.id);

  const showMainMenu = () => screen({
    title: config.title,
    text: text.controls,
    buttons: [
      { label: text.play, onClick: () => game.play() },
      { label: text.howToPlay, onClick: showHowToPlay },
      { label: text.skins, onClick: () => showSkins(0) },
      { label: text.settings, onClick: () => openSettings(showMainMenu) },
    ],
  });
  const showHowToPlay = () => {
    screen({ title: text.howToPlay, text: text.howToPlayText, buttons: [{ label: text.back, onClick: showMainMenu }] });
    escapeBack = showMainMenu;
  };
  // Choosing a skin applies it at once; the lantern and exit light behind the menu change with it.
  const showSkins = (focus) => {
    screen({
      title: text.skins,
      buttons: [
        ...skins.map((s, i) => ({
          label: s.name,
          detail: s.id === skin.id ? text.selected : '',
          pressed: s.id === skin.id,
          onClick: () => { game.setSkin(s.id); showSkins(i); },
        })),
        { label: text.back, onClick: showMainMenu },
      ],
      focus,
    });
    escapeBack = showMainMenu;
  };
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
      title: won ? (isLast && hasLevelList ? text.allDone : text.win) : caught ? text.caught : text.lose,
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
        slider('musicVolume', (v) => `${v}%`),
        slider('soundVolume', (v) => `${v}%`),
      ],
      buttons: [
        { label: text.resetSettings, onClick: () => { settings.reset(); openSettings(back, 4); } },
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
    const next = await buildWorld(scene, maze, levelCfg, gameUrl, { guideColor: skin.guideLight ?? levelCfg.look.exit });
    world?.dispose();
    sounds.setLoop('step', false);
    sounds.setLoop('sprint', false);
    world = next;
    current = index;
    rules = levelCfg.rules;
    sounds = new Sounds(levelCfg.sounds, gameUrl, settings.soundVolume / 100);
    const files = musicFiles(levelCfg);
    if (JSON.stringify(files) !== musicKey) {
      music?.dispose();
      musicKey = JSON.stringify(files);
      const urls = Object.fromEntries(Object.entries(files).map(([layer, file]) => [layer, file ? gameUrl + file : null]));
      music = createMusic(urls, { volume: settings.musicVolume / 100 });
    }
    mapPeek = createMapPeek(levelCfg.abilities.mapPeek);
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
  game.toggleMap = () => game.state === 'playing' && mapPeek.toggle();
  game.play = () => (hasLevelList ? showLevelSelect() : game.loadLevel(0));
  game.pause = () => {
    if (game.state !== 'playing') return;
    setState('paused');
    music?.pause();
    pausedAt = performance.now();
    unlockMouse();
    showPauseMenu();
  };
  game.resume = () => {
    if (game.state !== 'paused') return;
    music?.resume();
    startPlaying();
  };
  game.restart = () => {
    resetLevel();
    startPlaying();
  };
  game.quit = () => {
    setState('menu');
    music?.stop();
    unlockMouse();
    resetLevel();
    showMainMenu();
  };
  // The monsters already went home and took the life; keys and doors stay as they are.
  const loseLife = () => {
    flashLeft = FLASH_TIME;
    sounds.play('hit');
    if (game.lives <= 0) {
      caught = true;
      finish('lost');
      return;
    }
    player.reset();
    game.hidden = false;
    say(text.lostLife.replace('{lives}', game.lives));
  };
  const finish = (state) => {
    setState(state);
    if (state === 'won') progress.complete(current, levels[current].id, game.time);
    music?.stop();
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
    if (game.state !== 'playing' || (e.code !== 'KeyM' && e.code !== 'Tab')) return;
    // Tab would move focus out of the game.
    e.preventDefault();
    if (!e.repeat) mapPeek.toggle();
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

  // One simulation tick, shared by the animation frame and game.step.
  const simulate = (dt) => {
    game.time += dt;
    player.update(dt);
    world.entities.update(dt, player);
    const at = player.currentCell();
    const hidden = world.monsters.isHide(at.x, at.z);
    if (hidden && !game.hidden) sounds.play('hide');
    game.hidden = hidden;
    const target = { x: player.x, z: player.z, moving: player.moved, hidden };
    for (const event of world.monsters.update(dt, target)) {
      if (event.type === 'spot') sounds.play('monsterSpot');
      else if (event.type === 'swing') sounds.play('monsterSwing');
      else if (event.type === 'hit') { loseLife(); break; }
    }
    game.threat = world.monsters.threat;
    mapPeek.update(dt);
    game.intensity = musicIntensity(game.time, rules.timeLimit, game.threat);
    music?.setIntensity(game.intensity);
    if (game.state !== 'playing') return;
    hintLeft = Math.max(0, hintLeft - dt);
    const sprintLoop = player.sprinting && sounds.has('sprint');
    sounds.setLoop('sprint', sprintLoop);
    sounds.setLoop('step', player.moving && !sprintLoop);
    const { exit } = game.maze;
    if (at.x === exit.x && at.z === exit.z) finish('won');
    else if (rules.timeLimit > 0 && game.time >= rules.timeLimit) finish('lost');
  };
  const stealthWord = () => {
    if (game.hidden) return ['hidden', text.hidden];
    if (world.monsters.list.some((m) => m.state === 'chase' || m.state === 'windup')) return ['spotted', text.spotted];
    if (!player.moved) return ['unseen', text.unseen];
    return ['', ''];
  };
  let shownLives = null;
  const drawHud = (dt) => {
    flashLeft = Math.max(0, flashLeft - dt);
    const shown = rules.timeLimit > 0 ? Math.max(0, rules.timeLimit - game.time) : game.time;
    const hudShown = Boolean(world) && game.state !== 'menu' && game.state !== 'loading';
    const inLevel = hudShown && (game.state === 'playing' || game.state === 'paused');
    hud.classList.toggle('hidden', !hudShown);
    if (hudShown) {
      // The last 20 percent of the time: bigger, pulsing and with a word, so colour is not the only sign.
      const urgent = rules.timeLimit > 0 && shown <= rules.timeLimit * 0.2;
      hudStatus.textContent = `${levels[current].name}  ·  ${shown.toFixed(1)} s${urgent ? `  ·  ${text.hurry}` : ''}`;
      hudStatus.classList.toggle('urgent', urgent && inLevel);
      const stamina = player.stamina;
      const showStamina = player.sprintEnabled && (stamina.fraction < 1 || player.sprinting);
      hudStamina.classList.toggle('hidden', !showStamina);
      if (showStamina) {
        hudStaminaLabel.textContent = stamina.exhausted ? text.staminaEmpty : text.stamina;
        hudStaminaFill.style.width = `${(stamina.fraction * 100).toFixed(1)}%`;
        hudStamina.classList.toggle('empty', stamina.exhausted);
      }
      hudMap.classList.toggle('hidden', !mapPeek.enabled);
      hudMap.textContent = mapPeek.visible ? text.mapOpen : mapPeek.ready ? text.mapReady
        : text.mapWait.replace('{time}', Math.ceil(mapPeek.wait));
      hudMap.dataset.ready = String(mapPeek.ready);
      renderKeys();
      const hasMonsters = game.maze.monsters.length > 0;
      hudDanger.classList.toggle('hidden', !hasMonsters);
      if (hasMonsters) {
        const { lives, maxLives } = world.monsters;
        if (`${lives}/${maxLives}` !== shownLives) {
          shownLives = `${lives}/${maxLives}`;
          hudHearts.textContent = '♥'.repeat(lives);
          hudHearts.dataset.lost = '♥'.repeat(maxLives - lives);
          hudLives.textContent = text.lives.replace('{lives}', game.lives);
        }
        const [state, word] = stealthWord();
        hudStealth.dataset.state = state;
        hudStealth.textContent = word;
      }
    }
    vignette.style.opacity = inLevel ? world.monsters.danger.toFixed(3) : '0';
    hideTint.style.opacity = inLevel && game.hidden ? '1' : '0';
    flash.style.opacity = (flashLeft / FLASH_TIME).toFixed(3);
    hint.classList.toggle('hidden', !(hintLeft > 0 && game.state === 'playing'));
    const mapShown = inLevel && game.state === 'playing' && mapPeek.visible;
    mapCanvas.classList.toggle('hidden', !mapShown);
    if (mapShown) drawMapOverlay();
  };
  const drawMapOverlay = () => {
    const { maze } = game;
    const scale = Math.min(Math.min(innerWidth * 0.92, 560) / maze.width, (innerHeight * 0.75) / maze.height);
    const width = Math.round(maze.width * scale);
    const height = Math.round(maze.height * scale);
    const ratio = Math.min(devicePixelRatio, 2);
    if (mapCanvas.width !== Math.round(width * ratio) || mapCanvas.height !== Math.round(height * ratio)) {
      Object.assign(mapCanvas, { width: Math.round(width * ratio), height: Math.round(height * ratio) });
      Object.assign(mapCanvas.style, { width: `${width}px`, height: `${height}px` });
    }
    const g = mapCanvas.getContext('2d');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { entities, monsters } = world;
    drawMap(g, width, height, {
      maze, cell: game.levelConfig.size.cell, keys: entities.keys, doors: entities.doors, movers: entities.movers,
      keyInfo: entities.keyInfo, hides: maze.hides, exitColor: guideColor(),
      player: { x: player.x, z: player.z, yaw: player.yaw },
      monsters: mapPeek.settings.showMonsters ? monsters.list : [],
    });
  };
  mapCanvas.setAttribute('aria-label', text.mapLabel);
  const tick = (dt) => {
    if (world) world.exit.rotation.y += dt;
    if (game.state === 'playing') simulate(dt);
    lantern.update(dt, player, game.state === 'playing');
    drawHud(dt);
  };
  // For tests: advances the game like frames would, in steps no longer than a frame can be.
  game.step = (dt = 1 / 60) => {
    for (let left = dt; left > 1e-9 && game.state === 'playing'; left -= TICK) tick(Math.min(left, TICK));
    return game.state;
  };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    tick(Math.min(clock.getDelta(), TICK));
    renderer.clear();
    renderer.render(scene, camera);
    if (world) lantern.render(renderer);
  });
}

start().catch((error) => {
  console.error(error);
  menu.show({ title: 'Could not start the game', text: error.message });
});
