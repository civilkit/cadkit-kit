import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const dir = resolve(process.cwd(), 'apps/cad/public/samples');
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('a freshly opened sample is not modified', { skip: !process.env.CK_WASM }, () => {
  const files = readdirSync(dir).filter((f) => /^(spur-gear|bench-coil_spring|brepjs-fluted_knob|brepjs-vented_louvre_case)\.ckpart$/.test(f));   // four of the five QA saw as modified (all 82 pass too, 6 min)
  // The dirty dot came from main.tsx (a render between the controller swapping the part and markClean), not from a late document change.
  it('document() is unchanged after the controller settles, for the samples QA saw as modified', async () => {
    const bad: string[] = [];
    for (const f of files) {
      const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
      const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
      const c = new Controller({ store: createStore(), view, kernel });
      await c.load(JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as PartDoc);
      const a = JSON.stringify(c.document()), r = c.revision;
      await new Promise((res) => setTimeout(res, 1500));
      if (JSON.stringify(c.document()) !== a) bad.push(`${f} (rev ${r}->${c.revision})`);
      await sessions.pop()!.close().catch(() => {});
    }
    expect(bad).toEqual([]);
  }, 600000);
});
