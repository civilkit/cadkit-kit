// A fake kernel and viewer for the motion store's tests: one slot mate driving one part ("Slider") along a rail that stops it at 8.
import type { Frame, SolveReply, SweepReply } from '@kit/motion';
import type { MotionDeps } from './store';

export const frame = (ox: number, deg = 0): Frame => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return { o: [ox, 0, 0], x: [c, 0, -s], y: [0, 1, 0], z: [s, 0, c] }; };
export const FEATURES = [{ id: 'F1', type: 'insertPart', name: 'Rail' }, { id: 'F2', type: 'insertPart', name: 'Slider' }, { id: 'F3', type: 'mate', kind: 'slot', name: 'Slide' }];
const NAMES: Record<string, string> = { F1: 'Rail', F2: 'Slider', F3: 'Slide' };

export function fakeDeps(over: Partial<MotionDeps> = {}) {
  const calls = { solves: [] as Array<{ poses: Array<Record<string, number>>; opts: unknown }>, sweeps: [] as unknown[], shown: [] as string[][], saved: [] as unknown[], limits: [] as Array<[string, number, number]> };
  const deps: MotionDeps = {
    docKey: 'k1', features: FEATURES, motion: undefined,
    solve: async (poses, opts) => {
      calls.solves.push({ poses, opts });
      const reply: SolveReply = { drivers: [{ mate: 'F3', kind: 'distance', unit: 'mm', value: 0 }], poses: poses.map((p) => {
        const v = p.F3 ?? 0;
        return { ok: true, places: [{ id: 'F1', place: frame(0) }, { id: 'F2', place: frame(v) }], ...(v > 8 ? { contact: { a: 'F1', b: 'F2', kind: 'contact' as const, distance: 0, at: [0, 0, 0] } } : {}) };
      }) };
      return reply;
    },
    sweep: async (req) => {
      calls.sweeps.push(req);
      const up = req.to > 0;
      const r: SweepReply = { driver: 'F3', from: 0, to: req.to, reached: up ? 8 : -8, stop: { reason: 'contact', value: up ? 8 : -8, a: 'F1', b: 'F2', distance: 0, at: [1, 2, 3] }, startContacts: [], posesSolved: 50 };
      return r;
    },
    components: () => [{ id: 'F1', place: frame(0) }, { id: 'F2', place: frame(0) }],
    nameOf: (id) => NAMES[id] ?? id,
    show: (ids) => { calls.shown.push(ids); },
    copyToLimits: async (mate, min, max) => { calls.limits.push([mate, min, max]); return null; },
    save: (m) => { calls.saved.push(m); },
    ...over,
  };
  return { deps, calls };
}
