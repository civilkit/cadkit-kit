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

  it('undo then redo restores the edit', async () => {
    const store = createStore();
    const { view } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const depthOf = () =>
      (controller.document()!.features.find((x) => x.id === 'F2') as { depth: number }).depth;

    expect(depthOf()).toBe(5);
    await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 12 }]);
    expect(depthOf()).toBe(12);

    await controller.undo();
    expect(depthOf()).toBe(5);
    expect(store.busy.value).toBe(false);

    await controller.redo();
    expect(depthOf()).toBe(12);
    expect(store.busy.value).toBe(false);
  });

  it('document() exposes the current part; null before load', async () => {
    const store = createStore();
    const { view } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    expect(controller.document()).toBeNull();
    await controller.load(plateDoc());
    expect(controller.document()!.features.length).toBe(2);
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

describe('controller preview/commit', () => {
  const mk = () => {
    const store = createStore();
    const bodies: unknown[] = [];
    const view: ViewSink = {
      setBody(b) { bodies.push(b); },
      setHighlight() {},
    };
    let opened = 0;
    let lastDoc: PartDoc | null = null;
    const kernel: KernelFactory = {
      async open(doc: PartDoc) {
        lastDoc = doc;
        const tag = 't' + opened++;
        // stub: preview returns a synthetic body; edit commits nothing (we just count)
        return new Session(doc, {
          async request(msg: Record<string, unknown>) {
            const tag = String((msg as { tag?: string }).tag ?? '');
            if (tag.endsWith('-preview')) {
              const part = msg as { part?: { features?: Array<{ id?: string; depth?: number }> } };
              const bad = (part.part?.features ?? []).some((f) => typeof f.depth === 'number' && f.depth < 0);
              if (bad) return { ok: true, result: { errors: [['F2', { code: 'cut_nothing', params: {} }]] } };
            }
            if (msg.type === 'regen') return { ok: true, result: { errors: [], body: { mesh: { positions: new Float32Array([0, 0, 0]), normals: new Float32Array([0, 1, 0]), triFace: new Uint32Array([0]), faceIds: ['F1'] }, edges: [], box: { min: [0, 0, 0], max: [1, 1, 1] } } } };
            if (msg.type === 'massProps') return { ok: true, result: { volume: 0, bodies: [] } };
            if (msg.type === 'refDiff') return { ok: true, result: { warnings: [] } };
            if (msg.type === 'validate') return { ok: true, result: { ok: true, issues: [] } };
            if (msg.type === 'check') return { ok: true, result: { ok: true, passed: 0, failed: 0, results: [] } };
            throw new Error('unexpected ' + String(msg.type));
          },
        }, 'agent', tag);
      },
    };
    return { store, bodies, view, kernel, getLastDoc: () => lastDoc };
  };

  it('preview is debounced and supersedes; document/history untouched; one body shown', async () => {
    const { store, bodies, view, kernel } = mk();
    const c = new Controller({ store, view, kernel });
    await c.load(plateDoc());
    const docBefore = JSON.stringify(c.document());
    const bodiesBefore = bodies.length;

    const r1 = c.preview([{ op: 'set', id: 'F2', path: 'depth', value: 6 }], 40);
    const r2 = c.preview([{ op: 'set', id: 'F2', path: 'depth', value: 7 }], 40);
    const [a, b] = await Promise.all([r1, r2]);

    expect(a.stale).toBe(true);          // superseded by the newer preview
    expect(b.stale).toBeFalsy();
    expect(b.ok).toBe(true);
    expect(JSON.stringify(c.document())).toBe(docBefore);   // document untouched
    expect(bodies.length).toBe(bodiesBefore + 1);           // exactly one preview body shown
  }, 15000);

  it('failing preview keeps the last good body and surfaces the hint', async () => {
    const { store, bodies, view, kernel } = mk();
    const c = new Controller({ store, view, kernel });
    await c.load(plateDoc());
    const good = bodies.at(-1);

    const r = await c.preview([{ op: 'set', id: 'F2', path: 'depth', value: -1 }], 20);
    expect(r.ok).toBe(false);
    expect(r.hint).toBeTruthy();
    expect(bodies.at(-1)).toBe(good);     // last good mesh retained
  }, 20000);

  it('commit creates exactly one edit record; cancelPreview creates none', async () => {
    const { store, bodies, view, kernel } = mk();
    const c = new Controller({ store, view, kernel });
    await c.load(plateDoc());
    const s = (c as unknown as { session: Session }).session;
    const histBefore = s.history().length;
    const docBefore = JSON.stringify(c.document());
    const bodiesBefore = bodies.length;

    // preview then cancel: no record, body restored
    await c.preview([{ op: 'set', id: 'F2', path: 'depth', value: 9 }], 20);
    await c.cancelPreview();
    expect(s.history().length).toBe(histBefore);
    expect(JSON.stringify(c.document())).toBe(docBefore);
    expect(bodies.length).toBeGreaterThan(bodiesBefore);

    // commit: one record
    const r = await c.commit([{ op: 'set', id: 'F2', path: 'depth', value: 12 }]);
    expect(r.ok).toBe(true);
    expect(s.history().length).toBe(histBefore + 1);
  });
});

describe('controller preview and commit', { skip: !process.env.CK_WASM }, () => {
  const factories: Array<{ closeAll(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(factories.splice(0).map((f) => f.closeAll()));
  });

  it('preview changes neither the document nor history()', async () => {
    const store = createStore();
    const { view, bodies } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const docBefore = JSON.stringify(controller.document());
    const histBefore = (controller as unknown as { session: Session }).session.history().length;
    const bodiesBefore = bodies.length;

    const r = await controller.preview([{ op: 'set', id: 'F2', path: 'depth', value: 12 }]);

    expect(r.ok).toBe(true);
    expect(r.stale).toBeFalsy();
    expect(JSON.stringify(controller.document())).toBe(docBefore);
    expect((controller.document()!.features.find((x) => x.id === 'F2') as { depth: number }).depth).toBe(5);
    const hist = (controller as unknown as { session: Session }).session.history();
    expect(hist.length).toBe(histBefore);
    expect(bodies.length).toBe(bodiesBefore + 1); // the preview mesh was shown
    const previewBody = bodies.at(-1) as { mesh: { positions: Float32Array } } | null;
    expect(previewBody).not.toBeNull();
    expect(previewBody!.mesh.positions.length).toBeGreaterThan(0);
  }, 15000);

  it('a failing preview keeps the previous body and returns the hint', async () => {
    const store = createStore();
    const { view, bodies } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const lastBefore = bodies.at(-1);
    const bodiesBefore = bodies.length;

    const r = await controller.preview(farCutOps());

    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/cuts nothing/);
    expect(bodies.length).toBe(bodiesBefore); // no new body: the last good one stays
    expect(bodies.at(-1)).toBe(lastBefore);
  }, 15000);

  it('commit writes exactly one edit record', async () => {
    const store = createStore();
    const { view } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const s = (controller as unknown as { session: Session }).session;
    const histBefore = s.history().length;

    const r = await controller.commit([
      { op: 'set', id: 'F2', path: 'depth', value: 12 },
      { op: 'set', id: 'F2', path: 'flip', value: true },
    ]);

    expect(r.ok).toBe(true);
    expect(s.history().length).toBe(histBefore + 1); // both ops in one record
    expect((controller.document()!.features.find((x) => x.id === 'F2') as { depth: number }).depth).toBe(12);
    expect((controller.document()!.features.find((x) => x.id === 'F2') as { flip?: boolean }).flip).toBe(true);
  }, 15000);

  it('cancel after a preview creates no edit record', async () => {
    const store = createStore();
    const { view } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });

    await controller.load(plateDoc());
    const s = (controller as unknown as { session: Session }).session;
    const histBefore = s.history().length;
    const docBefore = JSON.stringify(controller.document());

    await controller.preview([{ op: 'set', id: 'F2', path: 'depth', value: 12 }]);
    await controller.cancelPreview();

    expect(s.history().length).toBe(histBefore);
    expect(JSON.stringify(controller.document())).toBe(docBefore);
  }, 15000);
});
