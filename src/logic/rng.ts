// Random numbers. The game uses std::uniform_int_distribution(a, b), inclusive on both ends.
export type Rng = () => number; // [0, 1)

/** Small seeded generator for tests (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** U(a, b): uniform integer in [a, b]. */
export function uniform(rng: Rng, a: number, b: number): number {
  return a + Math.floor(rng() * (b - a + 1));
}

export function pick<T>(rng: Rng, list: T[]): T | undefined {
  return list.length ? list[Math.floor(rng() * list.length)] : undefined;
}
