// The kernel keeps three caches in wasm linear memory (regen states, display snapshots, tessellated faces) and wasm memory never
// shrinks. Their defaults (256 + 96 + 128 MB) suit a 50-feature part; a 500-feature part fills all of them and the tab sits near 0.5 GB
// of wasm alone. Above LARGE_PART features the app asks for a smaller cap (the kernel scales all three from `cacheCap`).
export const LARGE_PART = 150;
export const LARGE_CACHE_CAP = 96 << 20;

interface Transport { request(msg: Record<string, unknown>): Promise<unknown> }

/** `kernel` with `opts.cacheCap` added to the regen requests of a large part (unless the request already sets one). */
export function withCacheCap<K extends Transport>(kernel: K, large = LARGE_PART, cap = LARGE_CACHE_CAP): K {
  return new Proxy(kernel, {
    get(target, prop, recv) {
      if (prop !== 'request') return Reflect.get(target, prop, recv);
      return (msg: Record<string, unknown>) => {
        const feats = (msg.part as { features?: unknown[] } | undefined)?.features;
        if (msg.type === 'regen' && Array.isArray(feats) && feats.length > large) {
          const opts = (msg.opts ?? {}) as Record<string, unknown>;
          if (opts.cacheCap === undefined) return target.request({ ...msg, opts: { ...opts, cacheCap: cap } });
        }
        return target.request(msg);
      };
    },
  });
}
