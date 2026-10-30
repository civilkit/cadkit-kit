import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';

// The bundled BLDC motor samples (own models, typical dimensions) open and regenerate without errors, assembled and exploded.
const DIR = resolve(process.cwd(), 'apps/cad/public/samples');
const IDS = ['motor-outrunner-2212', 'motor-inrunner-2430', 'motor-outrunner-2306', 'motor-outrunner-5010', 'motor-gimbal-2804'];
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('bundled motor samples', { skip: !process.env.CK_WASM }, () => {
  it('are listed in the samples index', () => {
    const list = JSON.parse(readFileSync(resolve(DIR, 'index.json'), 'utf8')) as Array<{ id: string; file: string }>;
    for (const id of IDS) expect(list.find((s) => s.id === id)?.file).toBe(id + '.ckpart');
  });
  for (const id of IDS) {
    it(`${id} opens and regenerates with no errors`, async () => {
      const doc = JSON.parse(readFileSync(resolve(DIR, id + '.ckpart'), 'utf8')) as PartDoc;
      const s = await Session.open(doc);
      sessions.push(s);
      const v = await s.verify();
      expect(v.regen.errors.map(([fid, e]) => `${fid}:${e.code}`)).toEqual([]);
      const body = (await s.bodyForView()) as unknown as { faces?: unknown };
      expect(body).toBeTruthy();
    }, 600_000);
  }
});
