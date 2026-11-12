export class Sounds {
  // Music is played by music.js, so a "music" entry here is skipped.
  constructor(files, gameUrl, volume = 1) {
    this.clips = {};
    for (const [name, file] of Object.entries(files)) {
      if (file && name !== 'music') this.clips[name] = new Audio(gameUrl + file);
    }
    for (const name of ['step', 'sprint']) {
      if (this.clips[name]) this.clips[name].loop = true;
    }
    this.setVolume(volume);
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    for (const clip of Object.values(this.clips)) clip.volume = this.volume;
  }

  has(name) {
    return Boolean(this.clips[name]);
  }

  play(name) {
    const clip = this.clips[name];
    if (!clip) return;
    if (!clip.loop) clip.currentTime = 0;
    clip.play().catch(() => {});
  }

  stop(name) {
    this.clips[name]?.pause();
  }

  setLoop(name, on) {
    const clip = this.clips[name];
    if (!clip || clip.paused === !on) return;
    if (on) this.play(name);
    else clip.pause();
  }
}
