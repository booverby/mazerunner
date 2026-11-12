export const SETTING_RANGES = {
  fov: { min: 60, max: 110, step: 1, fallback: 75 },
  mouseSensitivity: { min: 0.2, max: 3, step: 0.1, fallback: 1 },
};

const clamp = (name, value, fallback) => {
  const { min, max, step } = SETTING_RANGES[name];
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return fallback;
  const snapped = Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step + min;
  return Number(snapped.toFixed(2));
};

// Player choices for one game, saved in localStorage; storage may be blocked, so every access is guarded.
export function createSettings(gameName, playerConfig = {}, onChange = () => {}) {
  const key = `mazerunner.settings.${gameName}`;
  const defaults = {};
  for (const [name, range] of Object.entries(SETTING_RANGES)) {
    defaults[name] = clamp(name, playerConfig[name], range.fallback);
  }

  let saved = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {}

  const settings = { defaults };
  for (const name of Object.keys(SETTING_RANGES)) settings[name] = clamp(name, saved[name], defaults[name]);

  const save = () => {
    const values = {};
    for (const name of Object.keys(SETTING_RANGES)) values[name] = settings[name];
    try { localStorage.setItem(key, JSON.stringify(values)); } catch {}
  };

  settings.set = (name, value) => {
    if (!(name in SETTING_RANGES)) return;
    settings[name] = clamp(name, value, settings[name]);
    save();
    onChange(settings);
  };
  settings.reset = () => {
    Object.assign(settings, defaults);
    save();
    onChange(settings);
  };

  onChange(settings);
  return settings;
}
