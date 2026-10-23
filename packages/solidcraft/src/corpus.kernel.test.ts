// Every file of the SolidCraft corpus (../corpus/solidcraft next to the kit, see its README) through the importer and the kernel.
// Nothing here pins what imports: the checks are that no file makes the importer throw, that a file is either refused with a reason
// or becomes a part (a complete import must regenerate without kernel errors), and the table printed shows what the importer covers today.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, type EdgeResolver, type ScPart } from './import';

const DIR = join(process.cwd(), '..', 'corpus', 'solidcraft');
const files = existsSync(DIR) ? [...readdirSync(DIR), ...(existsSync(join(DIR, 'from-app')) ? readdirSync(join(DIR, 'from-app')).map((f) => join('from-app', f)) : [])].filter((f) => f.endsWith('.solidcraft')).sort() : [];

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const resolver: EdgeResolver = async (part, points) => {
  const s = await open(part);
  const out: Array<Record<string, unknown> | null> = [];
  for (const p of points) {
    const m = await s.resolve([{ kind: 'edge', near: p, within: 1e-3 }]);
    out.push((m as unknown as Array<{ matches?: Array<{ ref?: Record<string, unknown> }> }>)[0]?.matches?.[0]?.ref ?? null);
  }
  return out;
};

describe('SolidCraft corpus', { skip: !process.env.CK_WASM || !files.length, timeout: 120_000 }, () => {
  const table: string[] = [];
  const bad: string[] = [];
  it('imports every file without throwing; each is refused with a reason, or imported (a complete import regenerates without kernel errors)', async () => {
    for (const f of files) {
      const r = await importSolidcraft(new Uint8Array(readFileSync(join(DIR, f))), f.replace(/.*\//, '').replace(/\.solidcraft$/, ''), { resolver });
      if (!r.part) { table.push(`${f.padEnd(44)} REFUSED  ${r.refused}`); expect(r.refused, f).toBeTruthy(); continue; }
      const s = await open(r.part);
      const rep = await s.verify();
      const facts = await s.facts().catch(() => null);
      const why = [...new Set(r.rows.filter((x) => x.status === 'unsupported').map((x) => x.reason!.replace(/ in ".*"/, '').slice(0, 60)))].join('; ');
      table.push(`${f.padEnd(44)} ${String(r.summary.converted).padStart(2)} ok ${String(r.summary.unsupported).padStart(2)} unsupported  kernel errors ${rep.regen.errors.length}  volume ${facts?.volume?.toFixed(2) ?? '-'}  ${why}`);
      // a partial import may fail downstream of a feature that was left out; only a complete one must regenerate cleanly
      if (r.geometryComplete) for (const e of rep.regen.errors) bad.push(`${f}: ${JSON.stringify(e).slice(0, 160)}`);
    }
    console.log('\n' + table.join('\n'));
    expect(bad).toEqual([]);
  });
});
