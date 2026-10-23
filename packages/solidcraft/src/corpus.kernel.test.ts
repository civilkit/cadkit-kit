// Every file of the SolidCraft corpus (../corpus/solidcraft next to the kit, see its README) through the importer and the kernel.
// Nothing here pins what imports: the checks are that no file makes the importer throw, that a file is either refused with a reason
// or becomes a part (a complete import must regenerate without kernel errors), and the table printed shows what the importer covers today.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, toYUp, type ScPart, type V3 } from './import';
import { kernelResolvers } from './kernelResolvers';

const DIR = join(process.cwd(), '..', 'corpus', 'solidcraft');
const files = existsSync(DIR) ? [...readdirSync(DIR), ...(existsSync(join(DIR, 'from-app')) ? readdirSync(join(DIR, 'from-app')).map((f) => join('from-app', f)) : [])].filter((f) => f.endsWith('.solidcraft')).sort() : [];

/** Their evaluator's numbers for a file (`expected/<name>.expected.json`): total volume and area and the bounding box, in their Z-up world turned into ours. */
function expectedOf(f: string): { volume: number; area: number; min: V3; max: V3; bodies: number } | null {
  const p = join(DIR, 'expected', f.replace(/.*\//, '').replace(/\.solidcraft$/, '.expected.json'));
  if (!existsSync(p)) return null;
  const e = JSON.parse(readFileSync(p, 'utf8')) as { bodies: Array<{ volume_mm3: number; area_mm2: number; bbox: { min: V3; max: V3 } }> };
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  // all eight corners of each box, turned into our Y-up world (a rotated box's own min and max are not the rotated corners)
  for (const b of e.bodies) for (const x of [b.bbox.min[0], b.bbox.max[0]]) for (const y of [b.bbox.min[1], b.bbox.max[1]]) for (const z of [b.bbox.min[2], b.bbox.max[2]]) {
    toYUp([x, y, z]).forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
  }
  return { volume: e.bodies.reduce((a, b) => a + b.volume_mm3, 0), area: e.bodies.reduce((a, b) => a + b.area_mm2, 0), min: lo, max: hi, bodies: e.bodies.length };
}

/** Complete imports on which the KERNEL (not the importer) fails today: reported in the table, not counted as failures. */
const KNOWN_KERNEL_ISSUES: Record<string, string> = {
  'cubeish-chamfer-too-large.solidcraft': 'blendOverflow on its last chamfer: the design is named for a chamfer that is too large, and a structured refusal is the right answer',
  'crazy-geom-cuts.solidcraft': 'booleanFailed (openEdge) on one of its near-coincident cuts: a stress design for exactly that',
};

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const { resolver, faceResolver, rimResolver } = kernelResolvers(open);

describe('SolidCraft corpus', { skip: !process.env.CK_WASM || !files.length, timeout: 120_000 }, () => {
  const table: string[] = [];
  const bad: string[] = [];
  it('imports every file without throwing; each is refused with a reason, or imported (a complete import regenerates without kernel errors)', async () => {
    for (const f of files) {
      const r = await importSolidcraft(new Uint8Array(readFileSync(join(DIR, f))), f.replace(/.*\//, '').replace(/\.solidcraft$/, ''), { resolver, faceResolver, rimResolver });
      if (!r.part) { table.push(`${f.padEnd(44)} REFUSED  ${r.refused}`); expect(r.refused, f).toBeTruthy(); continue; }
      const s = await open(r.part);
      const rep = await s.verify();
      const facts = await s.facts().catch(() => null);
      const why = [...new Set(r.rows.filter((x) => x.status === 'unsupported').map((x) => x.reason!.replace(/ in ".*"/, '').slice(0, 60)))].join('; ');
      // against their evaluator's numbers: volume and area within 1e-3, bounding box within 1e-3 of its diagonal
      let vs = '';
      const ex = expectedOf(f);
      if (ex && facts?.volume != null) {
        const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
        const diag = Math.hypot(ex.max[0] - ex.min[0], ex.max[1] - ex.min[1], ex.max[2] - ex.min[2]);
        const boxOk = !!facts.box && [0, 1, 2].every((i) => Math.abs(facts.box!.min[i] - ex.min[i]) <= 1e-3 * diag && Math.abs(facts.box!.max[i] - ex.max[i]) <= 1e-3 * diag);
        const volOk = rel(facts.volume, ex.volume) < 1e-3;
        vs = ` | theirs vol ${ex.volume.toFixed(2)} (${ex.bodies} bod${ex.bodies === 1 ? 'y' : 'ies'}) ${volOk && boxOk ? 'MATCH' : volOk ? 'vol ok, box differs' : r.geometryComplete ? 'DIFFERS' : 'partial'}`;
        if (r.geometryComplete && ex.bodies === 1 && !(volOk && boxOk)) bad.push(`${f}: complete import but volume ${facts.volume} vs ${ex.volume}, box ok ${boxOk}`);
      }
      if (KNOWN_KERNEL_ISSUES[f] && rep.regen.errors.length) table.push(`  (known kernel issue: ${KNOWN_KERNEL_ISSUES[f]})`);
      table.push(`${f.padEnd(44)} ${String(r.summary.converted).padStart(2)} ok ${String(r.summary.unsupported).padStart(2)} unsupported  kernel errors ${rep.regen.errors.length}  volume ${facts?.volume?.toFixed(2) ?? '-'}${vs}  ${why}`);
      // a partial import may fail downstream of a feature that was left out; only a complete one must regenerate cleanly
      if (r.geometryComplete && !KNOWN_KERNEL_ISSUES[f]) for (const e of rep.regen.errors) bad.push(`${f}: ${JSON.stringify(e).slice(0, 160)}`);
    }
    console.log('\n' + table.join('\n'));
    expect(bad).toEqual([]);
  });
});
