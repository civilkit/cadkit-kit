import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const load = (f: string): PartDoc => JSON.parse(readFileSync(`apps/cad/public/samples/${f}`, 'utf8')) as PartDoc;

describe('surface samples regenerate cleanly', () => {
  for (const [file, minVolume] of [['loft-bottle.ckpart', 20000], ['swept-handle.ckpart', 1000]] as const) {
    it(`${file}: no errors, a solid of sensible volume`, async () => {
      const s = await Session.open(load(file));
      sessions.push(s);
      const report = await s.verify();
      expect(report.regen.errors).toEqual([]);
      const mass = (await s.massProps()) as { volume: number };
      expect(mass.volume).toBeGreaterThan(minVolume);
    });
  }
});
