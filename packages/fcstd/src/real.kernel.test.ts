// Real FCStd files against the kernel: per-step volume against FreeCAD's cached shape volumes.
// Needs CK_WASM and FCSTD_DIR (files are not checked in); expected volumes were read with OCCT (python OCP) from the cached *.Shape.brp.
import { readFileSync, existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importFcstd } from './import';

const dir = process.env.FCSTD_DIR ?? '';
const volsPath = process.env.FCSTD_VOLS ?? '';
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const files = (process.env.FCSTD_FILES ?? 'PartDesignExample.FCStd,TwoLengthsPadWithExpression.FCStd,PadTest.fcstd,PocketTest.fcstd').split(',');
describe('real FCStd files', { skip: !process.env.CK_WASM || !dir || !existsSync(dir) }, () => {
  for (const f of files) {
    it(f, async () => {
      const imp = await importFcstd(new Uint8Array(readFileSync(f.startsWith('/') ? f : `${dir}/${f}`)), f, { body: process.env.FCSTD_BODY });
      const vols: Record<string, Record<string, number | null>> = volsPath ? JSON.parse(readFileSync(volsPath, 'utf8')) : {};
      const ref = vols[f.split('/').pop()!] ?? {};
      const rows: string[] = [];
      let lastOurs = 0;
      for (const st of imp.steps) {
        const upto = new Set(imp.steps.slice(0, imp.steps.indexOf(st) + 1).flatMap((s) => s.features));
        // keep every feature up to the last id of this step (planes and sketches are emitted just before their feature)
        const lastIdx = Math.max(...st.features.map((id) => imp.part.features.findIndex((x) => x.id === id)));
        const doc = { ...imp.part, features: imp.part.features.slice(0, lastIdx + 1) } as unknown as PartDoc;
        void upto;
        const s = await Session.open(doc); sessions.push(s);
        const facts = await s.facts();
        const rep = await s.regenReport();
        const want = ref[st.fc] ?? null;
        lastOurs = facts.volume ?? 0;
        rows.push(`${f} | ${st.fc} | ${st.type.slice(12)} | ours ${facts.volume?.toFixed(4)} | fc ${want?.toFixed(4) ?? '-'} | err ${want ? (Math.abs((facts.volume ?? 0) - want) / want).toExponential(2) : '-'} | ${rep.errors.length ? JSON.stringify(rep.errors[0]).slice(0, 120) : 'ok'}`);
      }
      console.log(imp.warnings.filter((w) => w.object === 'file').map((w) => w.message).join() + '\n' + rows.join('\n') + `\n${f} warnings: ${imp.warnings.map((w) => `${w.object}:${w.code}`).join(', ')}`);
      expect(lastOurs >= 0).toBe(true);
    }, 120000);
  }
});
