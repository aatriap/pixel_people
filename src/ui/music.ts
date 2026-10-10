// Background music: the game's .m4a tracks played one after another in a loop (06: use the AAC versions).
// Browsers (iOS above all) only start audio after a user gesture, so play() is retried on the first tap.
const TRACKS = ['Small_Town_Far_In_Space', 'Outer_Space_Theme_RMX_1', 'Outer_Space', 'Outer_Space_Theme_RMX_2'];

export class Music {
  private audio: HTMLAudioElement | null = null;
  private index = 0;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
    const kick = () => { if (!this.muted) this.play(); };
    document.addEventListener('pointerdown', kick, { once: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio?.pause(); else if (!this.muted) this.play();
    });
  }

  get isMuted() { return this.muted; }

  private load(): HTMLAudioElement {
    if (!this.audio) {
      const a = new Audio();
      a.preload = 'auto';
      a.volume = 0.35;
      a.addEventListener('ended', () => { this.index = (this.index + 1) % TRACKS.length; this.start(); });
      this.audio = a;
      this.audio.src = `assets/music/${TRACKS[this.index]}.m4a`;
    }
    return this.audio;
  }

  private start() {
    const a = this.load();
    a.src = `assets/music/${TRACKS[this.index]}.m4a`;
    void a.play().catch(() => undefined);
  }

  play() {
    try { void this.load().play().catch(() => undefined); } catch { /* no audio */ }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.audio?.pause(); else this.play();
  }
}
