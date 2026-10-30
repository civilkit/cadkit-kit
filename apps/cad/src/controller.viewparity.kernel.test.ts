// The stored view the agent tools write (export with cache: true) must equal the view the app builds for the same document: a
// stored view that differed would show something the kernel then replaces. Parts: a plain solid, an assembly, a surface part.
// Needs CK_WASM.
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { decodeSnapshot, encodeSnapshot } from '@kit/viewdata';
import { AgentSession } from '../../../packages/agent-tools/src/agent-session';
import { viewCacheField } from '../../../packages/agent-tools/src/viewCache';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const WASM = process.env.CK_WASM;
const sessions: Session[] = [];
afterAll(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const sample = (name: string): PartDoc => JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/${name}.ckpart`, 'utf8')) as PartDoc;
const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
/** typed arrays as plain arrays, so two views compare by value */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) : x)));
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

describe('headless view equals the app-built view', { skip: !WASM }, () => {
  for (const name of ['bench-clevis', 'assembly-gear-train', 'surface-patch']) {
    it(name, async () => {
      const doc = sample(name);
      const c = new Controller({ store: createStore(), view, kernel });
      await c.load(structuredClone(doc));
      const appData = c.viewData();
      expect(appData).not.toBeNull();
      if (name.startsWith('assembly')) expect(appData!.components.length).toBeGreaterThan(0);   // the comparison covers real assembly data
      const app = await decodeSnapshot(await encodeSnapshot({ key: 'k', build: 'b', savedAt: 1, data: appData! }));

      const a = await AgentSession.open({ wasmPath: WASM });
      try {
        await a.setDocument(structuredClone(doc), 'open', false);
        const field = await viewCacheField(a, structuredClone(doc));
        const head = await decodeSnapshot(b64(field.data));
        expect(head).not.toBeNull();
        expect(plain(head!.data)).toEqual(plain(app!.data));
      } finally { await a.close(); }
    }, 180_000);
  }
});
