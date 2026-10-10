// Tiny sound helper. iOS only plays audio after the first touch, which every sound here follows.
const cache = new Map<string, HTMLAudioElement>();
let muted = false;

export function setMuted(m: boolean) { muted = m; }

export function sfx(name: string) {
  if (muted) return;
  try {
    let a = cache.get(name);
    if (!a) {
      a = new Audio(`assets/audio/${name.includes('.') ? name : name + '.mp3'}`);
      a.volume = 0.5;
      cache.set(name, a);
    }
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  } catch { /* no audio */ }
}
