// The largest size that builds, against the real kernel: a refused edit previews with the kernel's `maxSize`, the
// refusal message says it, and the editor's one-click fix (editorFixes) puts it in the draft, which then previews clean.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { editorFixes } from './editorFixes';
import { adviceOf } from './diagnosticsText';
import './i18n';

type Wire = Record<string, unknown>;
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** A 40 x 25 x 10 box (on the top plane: F2.C1 is its top face), then `extra`. */
const boxDoc = (extra: Wire[]): PartDoc => ({
  ...emptyPart('Box'),
  features: [{ ...rect('F1', 0, 0, 40, 25), plane: { kind: 'std', id: 'top' } }, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, ...extra],
  seq: 20,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function controllerOf(doc: PartDoc) {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view, kernel });
  await c.load(doc);
  return c;
}

/** Edit `field` of feature `id` to `value` (a refused preview), apply the offered fix, and preview that. */
async function refuseThenFix(doc: PartDoc, id: string, field: string, value: unknown) {
  const c = await controllerOf(doc);
  const feature = (c.document()!.features as unknown as Wire[]).find((f) => f.id === id)!;
  const bad = await c.preview([{ op: 'set', id, path: field, value } as never], 0);
  expect(bad.ok).toBe(false);
  const root = bad.diagnosis!.roots[0];
  const draft = { [field]: value };
  const fix = editorFixes(root, feature, draft).fixes.find((f) => f.key === 'maxSize')!;
  expect(fix, JSON.stringify(root.params)).toBeTruthy();
  const good = await c.preview([{ op: 'set', id, path: fix.path, value: fix.value } as never], 0);
  return { root, fix, good };
}

describe('the largest size that builds, end to end', { skip: !process.env.CK_WASM }, () => {
  it('shell: a wall too thick for the 10 mm box offers the largest that builds, and it builds', async () => {
    const { root, fix, good } = await refuseThenFix(boxDoc([{ type: 'shell', id: 'F9', faces: ['F2.C1'], thickness: 1 }]), 'F9', 'thickness', 12);
    expect(adviceOf(root)).toMatch(/^The largest size that builds is \d+(\.\d+)? mm\./);
    expect(fix.path).toBe('thickness');
    expect(fix.value as number).toBeGreaterThan(9);
    expect(fix.value as number).toBeLessThan(10);
    expect(good.ok, good.hint).toBe(true);
  }, 120000);

  it('hole: a counterbore deeper than the hole offers the deepest that builds', async () => {
    const doc = boxDoc([
      { type: 'sketch', id: 'F3', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p0', x: 10, y: 10 }], entities: [{ type: 'point', id: 'e2', p: 'p0' }], constraints: [] },
      { type: 'hole', id: 'F4', sketch: 'F3', standard: 'iso', size: 'M8', fit: 'normal', kind: 'cbore', end: 'blind', depth: 6, cboreDiameter: 15, cboreDepth: 2 },
    ]);
    const { fix, good } = await refuseThenFix(doc, 'F4', 'cboreDepth', 8);
    expect(fix).toMatchObject({ path: 'cboreDepth', value: 5.99 });
    expect(good.ok, good.hint).toBe(true);
  }, 120000);
});
