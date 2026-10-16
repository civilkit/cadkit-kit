import { describe, expect, it } from 'vitest';
import { LARGE_CACHE_CAP, withCacheCap } from './kernelCaps';

describe('withCacheCap', () => {
  const rec = () => { const seen: Array<Record<string, unknown>> = []; return { seen, request: async (m: Record<string, unknown>) => { seen.push(m); return null; }, other: 7 }; };
  const part = (n: number) => ({ features: Array.from({ length: n }, () => ({})) });
  it('caps regen of a large part only', async () => {
    const k = rec(); const w = withCacheCap(k);
    await w.request({ type: 'regen', part: part(200) });
    await w.request({ type: 'regen', part: part(20) });
    await w.request({ type: 'validate', part: part(200) });
    await w.request({ type: 'regen', part: part(200), opts: { cacheCap: 5, noView: true } });
    await w.request({ type: 'regen', part: part(200), opts: { noView: true } });
    expect(k.seen[0].opts).toEqual({ cacheCap: LARGE_CACHE_CAP });
    expect(k.seen[1].opts).toBeUndefined();
    expect(k.seen[2].opts).toBeUndefined();
    expect(k.seen[3].opts).toEqual({ cacheCap: 5, noView: true });
    expect(k.seen[4].opts).toEqual({ cacheCap: LARGE_CACHE_CAP, noView: true });
    expect(w.other).toBe(7);
  });
});
