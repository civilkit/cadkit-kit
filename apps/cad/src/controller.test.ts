import { describe, it, expect, afterEach } from 'vitest';
import { Controller, type ViewSink, type KernelFactory } from './controller';
import { createStore } from '@kit/store';
import { Session, type EditOp } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';

function plateDoc(): PartDoc {
  return {
    ...emptyPart('Plate'),
    features: [
      {
        type: 'sketch', name: 'S', id: 'F1', plane: { kind: 'std', id: 'front' },
        points: [
          { id: 'O', x: 0, y: 0, fixed: true },
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 10, y: 0 },
          { id: 'p3', x: 10, y: 10 },
          { id: 'p4', x: 0, y: 10 },
        ],
        entities: [
          { id: 'e5', type: 'line', p1: 'p1', p2: 'p2' },
          { id: 'e6', type: 'line', p1: 'p2', p2: 'p3' },
          { id: 'e7', type: 'line', p1: 'p3', p2: 'p4' },
          { id: 'e8', type: 'line', p1: 'p4', p2: 'p1' },
        ],
        constraints: [],
      },
      { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 5, id: 'F2' },
    ],
    seq: 3,
  } as PartDoc;
}

/** A sketch far from the origin, so a cut on it misses the plate. */
function farCutOps(): EditOp[] {
  return [
    {
      op: 'add',
      feature: {
        type: 'sketch', name: 'Far', id: 'F9', plane: { kind: 'std', id: 'front' },
        points: [
          { id: 'O', x: 100, y: 0, fixed: true },
          { id: 'p1', x: 100, y: 0 },
          { id: 'p2', x: 110, y: 0 },
          { id: 'p3', x: 110, y: 10 },
          { id: 'p4', x: 100, y: 10 },
        ],
        entities: [
          { id: 'e5', type: 'line', p1: 'p1', p2: 'p2' },
          { id: 'e6', type: 'line', p1: 'p2', p2: 'p3' },
          { id: 'e7', type: 'line', p1: 'p3', p2: 'p4' },
          { id: 'e8', type: 'line', p1: 'p4', p2: 'p1' },
        ],
        constraints: [],
      },
    },
    { op: 'add', feature: { type: 'extrude', op: 'cut', sketch: 'F9', end: 'blind', depth: 5 } },
  ];
}

function fakeView() {
  const bodies: unknown[] = [];
  const highlights: string[][] = [];
  const view: ViewSink = {
    setBody(b) { bodies.push(b); },
    setHighlight(n) { highlights.push(n); },
  };
  return { view, bodies, highlights };
}

/** Real wasm through the Node worker; every opened session is closed afterwards. */
function nodeFactory() {
  const opened: Session[] = [];
  const kernel: KernelFactory = {
    async open(doc: PartDoc) {
      const s = await Session.open(doc);
      opened.push(s);
      return s;
    },
  };
  return {
    kernel,
    async closeAll() {
      await Promise.all(opened.map((s) => s.close().catch(() => {})));
    },
  };
}

describe('controller with the real kernel', { skip: !process.env.CK_WASM }, () => {
  const factories: Array<{ closeAll(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(factories.splice(0).map((f) => f.closeAll()));
  });

  it('loads a plate: body on screen, statuses ok, busy cleared', async () => {
    const store = createStore();
    const { view, bodies } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());

    expect(store.busy.value).toBe(false);
    const body = bodies.at(-1) as { mesh: { positions: Float32Array; faceIds: string[] } } | null;
    expect(body).not.toBeNull();
    expect(body!.mesh.positions.length).toBeGreaterThan(0);
    expect(store.featureStatus.value.length).toBe(2);
    expect(store.featureStatus.value.every((s) => s.ok)).toBe(true);
  });

  it('a failing cut keeps the previous body and shows the hint', async () => {
    const store = createStore();
    const { view, bodies } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const before = bodies.length;
    const statusesBefore = store.featureStatus.value;

    const r = await controller.edit(farCutOps());

    expect(r.ok).toBe(false);
    expect(bodies.length).toBe(before); // the previous body stays the last one sent
    expect(store.notices.value.some((n) => n.level === 'error' && /cuts nothing/.test(n.text))).toBe(true);
    expect(store.featureStatus.value).toBe(statusesBefore); // unchanged
    expect(store.busy.value).toBe(false);
  });

  it('an empty document blanks the view without throwing', async () => {
    const store = createStore();
    const { view, bodies } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(emptyPart('Empty'));

    expect(bodies.at(-1)).toBeNull();
    expect(store.busy.value).toBe(false);
  });

  it('drops a selected face that disappears after an edit and says so', async () => {
    const store = createStore();
    const { view, bodies } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const body = bodies.at(-1) as { mesh: { faceIds: string[] } };
    expect(body.mesh.faceIds).toContain('F2.C1');
    store.select(['F2.C1']);

    const r = await controller.edit([{ op: 'remove', id: 'F2', cascade: true }]);

    expect(r.ok).toBe(true);
    expect(store.selection.value).toEqual([]);
    expect(store.notices.value.some((n) => /Selection lost/.test(n.text))).toBe(true);
  });
});

describe('controller cancel', () => {
  it('clears busy and restores the last good document', async () => {
    const store = createStore();
    const { view } = fakeView();
    let hang = false;
    let cancelled = 0;
    const openedDocs: PartDoc[] = [];
    const kernel: KernelFactory = {
      async open(doc: PartDoc) {
        openedDocs.push(JSON.parse(JSON.stringify(doc)) as PartDoc);
        return new Session(doc, {
          async request(msg: Record<string, unknown>) {
            if (hang) return new Promise<never>(() => {});
            if (msg.type === 'regen') return { ok: true, result: { errors: [], body: null } };
            if (msg.type === 'massProps') return { ok: true, result: { volume: 0, bodies: [] } };
            if (msg.type === 'refDiff') return { ok: true, result: { warnings: [] } };
            if (msg.type === 'validate') return { ok: true, result: { ok: true, issues: [] } };
            if (msg.type === 'check') return { ok: true, result: { ok: true, passed: 0, failed: 0, results: [] } };
            throw new Error('unexpected ' + String(msg.type));
          },
        }, 'test');
      },
      cancel() { cancelled += 1; hang = false; },
    };
    const controller = new Controller({ store, view, kernel });

    await controller.load(plateDoc());
    await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 12 }]);

    hang = true;
    const pending = controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 15 }]);
    await new Promise((r) => setTimeout(r, 20));
    await controller.cancel();
    await pending;

    expect(store.busy.value).toBe(false);
    expect(cancelled).toBe(1);
    const lastOpen = openedDocs.at(-1)!;
    expect((lastOpen.features.find((x) => x.id === 'F2') as { depth: number }).depth).toBe(12);
    expect(controller.features().length).toBe(2);
  });
});
