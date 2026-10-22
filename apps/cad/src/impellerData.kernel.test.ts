import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { DEFAULT_IMPELLER, impellerDocument, impellerSection } from './impellerData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const build = async (doc: Record<string, unknown>) => {
  const t0 = Date.now();
  const s = await Session.open(doc as unknown as PartDoc); sessions.push(s);
  const rep = await s.verify();
  const ms = Date.now() - t0;
  const mass = await s.massProps({ bodies: true });
  const facts = (await s.facts()) as { solids: number };
  const v = await s.validate(1e-3);
  return { rep, ms, mass, facts, v };
};

describe('impeller data', () => {
  it('sections are closed non-degenerate quads with real band width', () => {
    for (let i = 0; i < DEFAULT_IMPELLER.stations; i++) {
      const s = impellerSection((i + 0.5) / DEFAULT_IMPELLER.stations, DEFAULT_IMPELLER);
      const [Hf, Sf, Sb, Hb] = s.quad;
      const width = Math.hypot(Hf[0] - Hb[0], Hf[1] - Hb[1]); // front->back at the root
      expect(width).toBeGreaterThan(0.3);
      expect(Number.isFinite(width)).toBe(true);
      expect(Sf[1]).toBeGreaterThan(Hf[1]); // tip is outboard of the root
    }
  });
});

describe('impeller against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the default builds with no errors as one solid, valid at 1e-3 mm', async () => {
    const { rep, ms, mass, facts, v } = await build(impellerDocument());
    console.log('IMPELLER default errors', JSON.stringify(rep.regen.errors), 'ms', ms, 'vol', (mass.volume as number).toFixed(1), 'solids', facts.solids);
    expect(rep.regen.errors).toEqual([]);
    expect(facts.solids).toBe(1);
    expect(v.ok, JSON.stringify((v as { issues: unknown[] }).issues?.slice(0, 4))).toBe(true);
  }, 600000);

  it('splitters off still builds', async () => {
    const { rep, facts, v } = await build(impellerDocument({ ...DEFAULT_IMPELLER, splitterBlades: 0 }));
    console.log('IMPELLER no-splitter errors', JSON.stringify(rep.regen.errors), 'solids', facts.solids, 'valid', v.ok);
    expect(rep.regen.errors).toEqual([]);
    expect(facts.solids).toBe(1);
    expect(v.ok).toBe(true);
  }, 600000);
});
