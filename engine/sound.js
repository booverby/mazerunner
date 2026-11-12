export class Sounds {
  constructor(files, gameUrl) {
    this.clips = {};
    for (const [name, file] of Object.entries(files)) {
      if (file) this.clips[name] = new Audio(gameUrl + file);
    }
    for (const name of ['music', 'step']) {
      if (this.clips[name]) this.clips[name].loop = true;
    }
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
