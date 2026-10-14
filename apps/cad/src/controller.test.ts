import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Controller, type ViewSink, type KernelFactory, type SketchEditView } from './controller';
import { createStore } from '@kit/store';
import { Session, type EditOp } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { fromFeature, movePoint, type SketchDraft } from '@kit/sketch';

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
  const sketchEdits: Array<SketchEditView | null> = [];
  const view: ViewSink = {
    setBody(b) { bodies.push(b); },
    setHighlight(n) { highlights.push(n); },
    setSketchEdit(v) { sketchEdits.push(v); },
  };
  return { view, bodies, highlights, sketchEdits };
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
      setSketchEdit() {},
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

// ---- sketch session (S1): open, drag with the solver, confirm/cancel ----

const BOLT = '/path/to/work/rebuild/tools/cases/flangeBolt.ckpart';
const boltDoc = (): PartDoc => JSON.parse(readFileSync(BOLT, 'utf8')) as PartDoc;
const R = 7.505553499465135; // head construction-circle radius in the fixture

/** Tangential: a spot on the head circle near p1 (which sits at 90°): 85°. */
const ON_CIRCLE: [number, number] = [R * Math.cos((85 * Math.PI) / 180), R * Math.sin((85 * Math.PI) / 180)];
/** Radial: straight out from p1 along the circle's radius. */
const RADIAL: [number, number] = [0, R + 2];

describe('controller sketch session', { skip: !(process.env.CK_WASM && existsSync(BOLT)) }, () => {
  const factories: Array<{ closeAll(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(factories.splice(0).map((f) => f.closeAll()));
  });

  async function openBolt(opts?: { underDefined?: boolean }) {
    const store = createStore();
    const { view, bodies, sketchEdits } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });
    const doc = boltDoc();
    if (opts?.underDefined) {
      // Drop F3's only dimensional constraint (pldist): geometric ones stay.
      const f3 = doc.features.find((x) => x.id === 'F3') as { constraints: Array<{ type: string }> };
      f3.constraints = f3.constraints.filter((c) => c.type !== 'pldist');
    }
    await controller.load(doc);
    const draftOf = (): SketchDraft => {
      const feature = controller.document()!.features.find((x) => x.id === 'F3')!;
      return fromFeature(feature as unknown as Record<string, unknown>);
    };
    const history = () => (controller as unknown as { session: Session }).session.history();
    return { controller, bodies, sketchEdits, draftOf, history };
  }

  it('beginSketch returns the solved sketch, frame and status; upTo cuts off later sketches', async () => {
    const { controller, history } = await openBolt();
    const histBefore = history().length;
    const docBefore = JSON.stringify(controller.document());

    const view = await controller.beginSketch('F3');

    expect(view).not.toBeNull();
    expect(view!.featureId).toBe('F3');
    expect(view!.frame.z).toEqual([0, 0, 1]); // front plane
    expect(view!.sketch.points).toHaveLength(7);
    const p1 = view!.sketch.points.find((p) => p.id === 'p1')!;
    expect(p1.y).toBeCloseTo(R, 3);
    // The bolt head is fully defined: dof 0, no conflicts.
    expect(view!.status?.state).toBe('full');
    expect(view!.status?.dof).toBe(0);
    expect(view!.status?.conflicts).toEqual([]);
    // Document and history untouched by opening.
    expect(JSON.stringify(controller.document())).toBe(docBefore);
    expect(history().length).toBe(histBefore);

    // upTo stops the regen at F3: the thread sketches further down are absent.
    const s = (controller as unknown as { session: Session }).session;
    const r = await s.preview([], { upTo: 3 });
    const ids = (r.body?.sketches ?? []).map((x) => x.id);
    expect(ids).toContain('F3');
    expect(ids).not.toContain('F12');
  }, 60000);

  it('a fully defined sketch refuses a drag: app.sketch.fullyDefined, last good view kept', async () => {
    const { controller, draftOf, sketchEdits } = await openBolt();
    const good = await controller.beginSketch('F3');
    const editsBefore = sketchEdits.length;

    const r = await controller.updateSketch(movePoint(draftOf(), 'p1', RADIAL[0], RADIAL[1]), 20);

    expect(r.ok).toBe(false);
    expect(r.hint).toBe('app.sketch.fullyDefined');
    expect(r.status?.solved).toBe(false);
    expect(r.view).toBeUndefined();
    // The view keeps the last good solved sketch (no null push, no new view).
    expect(sketchEdits.length).toBe(editsBefore);
    expect(sketchEdits.at(-1)).toEqual(good);
  }, 60000);

  it('an under-defined sketch reports state under; a radial drag moves the rest of the sketch', async () => {
    const { controller, draftOf, history } = await openBolt({ underDefined: true });
    const view = await controller.beginSketch('F3');
    expect(view!.status?.state).toBe('under');
    expect(view!.status?.dof).toBe(1);
    const histBefore = history().length;
    const docBefore = JSON.stringify(controller.document());

    const r = await controller.updateSketch(movePoint(draftOf(), 'p1', RADIAL[0], RADIAL[1]), 20);

    expect(r.ok).toBe(true);
    expect(r.stale).toBeFalsy();
    const solved = r.view!.sketch;
    const p1 = solved.points.find((p) => p.id === 'p1')!;
    expect(p1.y).toBeCloseTo(RADIAL[1], 6);
    // The solver re-solved the constrained sketch around the pinned point.
    const p2 = solved.points.find((p) => p.id === 'p2')!;
    const moved = Math.hypot(p2.x - -6.5, p2.y - 3.75277674973257);
    expect(moved).toBeGreaterThan(0.05);
    // Still nothing committed.
    expect(JSON.stringify(controller.document())).toBe(docBefore);
    expect(history().length).toBe(histBefore);
  }, 60000);

  it('an under-defined sketch refuses a tangential drag: the verticals pin the orientation', async () => {
    const { controller, draftOf, sketchEdits } = await openBolt({ underDefined: true });
    const good = await controller.beginSketch('F3');
    const editsBefore = sketchEdits.length;

    const r = await controller.updateSketch(movePoint(draftOf(), 'p1', ON_CIRCLE[0], ON_CIRCLE[1]), 20);

    expect(r.ok).toBe(false);
    expect(r.hint).toBe('app.sketch.conflict');
    expect(r.status?.solved).toBe(false);
    expect(r.view).toBeUndefined();
    expect(sketchEdits.length).toBe(editsBefore);
    expect(sketchEdits.at(-1)).toEqual(good);
  }, 60000);

  it('commitSketch writes one replace edit with the solved coordinates, no draft fix', async () => {
    const { controller, draftOf, history } = await openBolt({ underDefined: true });
    await controller.beginSketch('F3');
    const histBefore = history().length;
    await controller.updateSketch(movePoint(draftOf(), 'p1', RADIAL[0], RADIAL[1]), 20);

    const r = await controller.commitSketch();

    expect(r?.ok).toBe(true);
    expect(history().length).toBe(histBefore + 1);
    const record = history().at(-1)!;
    expect(record.ops).toHaveLength(1);
    expect(record.ops[0]).toMatchObject({ op: 'replace', id: 'F3' });
    const committed = (record.ops[0] as unknown as {
      feature: { points: Array<{ id: string; x: number; y: number }>; constraints: Array<{ id: string; expr?: string }> };
    }).feature;
    const p1 = committed.points.find((p) => p.id === 'p1')!;
    expect(p1.y).toBeCloseTo(RADIAL[1], 6);
    // The fold brought the solver's rest-of-sketch result into the commit.
    const p2 = committed.points.find((p) => p.id === 'p2')!;
    expect(Math.hypot(p2.x - -6.5, p2.y - 3.75277674973257)).toBeGreaterThan(0.05);
    // No draft fix, and no interim forceSolve expr anywhere.
    expect(committed.constraints.some((c) => c.id.startsWith('draft-fix-'))).toBe(false);
    expect(committed.constraints.some((c) => c.expr !== undefined)).toBe(false);
  }, 60000);

  it('cancelSketch leaves the document and history unchanged', async () => {
    const { controller, draftOf, history, sketchEdits } = await openBolt({ underDefined: true });
    await controller.beginSketch('F3');
    const histBefore = history().length;
    const docBefore = JSON.stringify(controller.document());
    await controller.updateSketch(movePoint(draftOf(), 'p1', RADIAL[0], RADIAL[1]), 20);

    await controller.cancelSketch();

    expect(history().length).toBe(histBefore);
    expect(JSON.stringify(controller.document())).toBe(docBefore);
    expect(sketchEdits.at(-1)).toBeNull(); // the overlay was cleared
  }, 60000);

  it('a newer updateSketch supersedes an older one', async () => {
    const { controller, draftOf } = await openBolt({ underDefined: true });
    await controller.beginSketch('F3');

    const p1 = controller.updateSketch(movePoint(draftOf(), 'p1', 0, R + 1), 40);
    const p2 = controller.updateSketch(movePoint(draftOf(), 'p1', RADIAL[0], RADIAL[1]), 40);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.stale).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.view).toBeDefined();
  }, 60000);

  it('drags that arrive while a preview runs do not queue behind it: only the latest runs next', async () => {
    const { controller, draftOf } = await openBolt({ underDefined: true });
    await controller.beginSketch('F3');
    const session = (controller as unknown as { session: Session }).session;
    const real = session.preview.bind(session);
    let calls = 0;
    // a slow kernel (as in the browser), so drags overlap a running preview
    session.preview = (async (ops: Parameters<Session['preview']>[0], o?: Parameters<Session['preview']>[1]) => { calls++; await new Promise((r) => setTimeout(r, 150)); return real(ops, o); }) as Session['preview'];

    const runs: Array<ReturnType<typeof controller.updateSketch>> = [];
    for (let i = 0; i < 8; i++) {
      runs.push(controller.updateSketch(movePoint(draftOf(), 'p1', RADIAL[0], RADIAL[1] + i * 0.01), 0));
      await new Promise((r) => setTimeout(r, 12));
    }
    const results = await Promise.all(runs);
    expect(calls).toBeLessThanOrEqual(2);                 // the first, then only the newest
    expect(results[results.length - 1].ok).toBe(true);
    expect(results[results.length - 1].view).toBeDefined();
  }, 60000);

  it('beginSketch on a non-sketch feature returns null', async () => {
    const { controller } = await openBolt();
    expect(await controller.beginSketch('F4')).toBeNull();
  }, 60000);
});

describe('sketch on a face', { skip: !process.env.CK_WASM }, () => {
  const factories: Array<{ closeAll(): Promise<void> }> = [];
  afterEach(async () => { await Promise.all(factories.splice(0).map((f) => f.closeAll())); });

  it('opens a new sketch on a picked face (its frame is the face), and commit writes a face plane', async () => {
    const store = createStore();
    const { view } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });
    await controller.load(plateDoc());                       // a 10 x 10 plate, 5 thick, on the front plane
    const open = await controller.beginNewSketch({ kind: 'face', id: 'F2.C1' });   // the top cap, at z = 5
    expect(open).not.toBeNull();
    expect(open!.frame.o[2]).toBeCloseTo(5, 6);
    expect(open!.frame.z).toEqual([0, 0, 1]);                // the face's outward normal
    const res = await controller.commitSketch();
    expect(res?.ok).toBe(true);
    const added = controller.document()!.features.find((x) => x.type === 'sketch' && x.id !== 'F1') as unknown as { plane: unknown };
    expect(added.plane).toEqual({ kind: 'face', id: 'F2.C1' });
  }, 60000);

  it('exposes the open sketch plane frame and the body edges as world polylines (what the Project tool reads), then projects the top face', async () => {
    const store = createStore();
    const { view } = fakeView();
    const f = nodeFactory();
    factories.push(f);
    const controller = new Controller({ store, view, kernel: f.kernel });
    await controller.load(plateDoc());
    expect(controller.sketchFrame()).toBeNull();
    await controller.beginNewSketch({ kind: 'face', id: 'F2.C1' });
    const frame = controller.sketchFrame()!;
    expect(frame.o[2]).toBeCloseTo(5, 6);
    const edges = controller.bodyEdges();
    expect(edges.length).toBe(12);
    expect(edges.every((e) => (e.pts?.length ?? 0) >= 2 && Array.isArray(e.faces))).toBe(true);
    const { projectTool, DEFAULT_SETTINGS } = await import('@kit/sketch');
    const out = projectTool.step({}, { type: 'key', key: 'Enter' }, controller.sketchDraft()!, DEFAULT_SETTINGS, {
      body: { frame, edges: edges.map((e) => ({ key: e.key, faces: e.faces, pts: e.pts! })) }, selection: ['F2.C1'],
    });
    await controller.applySketchDraft(out.draft);
    expect(out.draft.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    expect(controller.sketchFrame()).not.toBeNull();
    await controller.cancelSketch();
    expect(controller.sketchFrame()).toBeNull();
  }, 60000);
});

describe('controller design check (fake session)', () => {
  const profiles = { profiles: [{ id: 'fdm-print', name: 'FDM 3D printing', description: '', rules: [] }], rules: [] };
  function fake(check: () => Promise<unknown>) {
    const calls = { profiles: 0, check: [] as unknown[] };
    const session = {
      document: plateDoc(),
      bodyForView: async () => null,
      verify: async () => ({ regen: { errors: [] }, hints: [] }),
      profiles: async () => { calls.profiles++; return profiles; },
      checkProfile: async (p: unknown) => { calls.check.push(p); return check(); },
    } as unknown as Session;
    const store = createStore();
    const kernel: KernelFactory = { async open() { return session; }, cancel() {} };
    return { calls, store, controller: new Controller({ store, view: fakeView().view, kernel }) };
  }

  it('lists profiles once and caches them; null without a document', async () => {
    const f = fake(async () => ({}));
    expect(await f.controller.profiles()).toBeNull();
    await f.controller.load(plateDoc());
    expect((await f.controller.profiles())!.profiles[0].id).toBe('fdm-print');
    await f.controller.profiles();
    expect(f.calls.profiles).toBe(1);
  });

  it('does not run on load or edit; runs when asked, with busy during the call and the document revision', async () => {
    let busyDuring = false;
    const f = fake(async () => { busyDuring = f.store.busy.value; return { ok: true, issues: [], summary: {} }; });
    await f.controller.load(plateDoc());
    expect(f.calls.check.length).toBe(0);
    const r = await f.controller.checkProfile('fdm-print');
    expect(r!.revision).toBe(f.controller.revision);
    expect(busyDuring).toBe(true);
    expect(f.store.busy.value).toBe(false);
    expect(f.calls.check).toEqual(['fdm-print']);
  });

  it('cancel resolves null and clears busy; a kernel error notifies and resolves null', async () => {
    const f = fake(() => new Promise(() => {}));
    await f.controller.load(plateDoc());
    const p = f.controller.checkProfile('fdm-print');
    await f.controller.cancel();
    expect(await p).toBeNull();
    expect(f.store.busy.value).toBe(false);
    const g = fake(async () => { throw new Error('unknown rule'); });
    await g.controller.load(plateDoc());
    expect(await g.controller.checkProfile('x')).toBeNull();
    expect(g.store.notices.value.some((n) => n.level === 'error' && /unknown rule/.test(n.text))).toBe(true);
  });
});

describe('controller design check: Block rules and after-edit runs (fake session)', () => {
  const wall = (faces: string[]) => ({ rule: 'minWall', severity: 'error', message: 'thin', faces, edges: [], value: 0.5, limit: 1.2, unit: 'mm' });
  const report = (issues: unknown[]) => ({ ok: !issues.length, issues, summary: { errors: issues.length, warnings: 0, infos: 0, total: issues.length } });
  function fake(afterEdit: (n: number) => unknown[], block = true) {
    const st = { edits: 0, undos: 0, checks: 0, results: [] as unknown[] };
    const session = {
      document: plateDoc(),
      bodyForView: async () => null,
      verify: async () => ({ regen: { errors: [] }, hints: [] }),
      edit: async () => { st.edits++; return { ok: true, record: { id: 'r', ops: [] }, hints: [] }; },
      undo: async () => { st.undos++; st.edits--; return { records: [] }; },
      checkProfile: async () => { st.checks++; return report(afterEdit(st.edits)); },
    } as unknown as Session;
    const store = createStore();
    const kernel: KernelFactory = { async open() { return session; }, cancel() {} };
    const controller = new Controller({ store, view: fakeView().view, kernel });
    controller.policy = () => ({ profile: { id: 'p', name: 'P', rules: [] }, name: 'P', blocking: block ? ['minWall'] : [], afterEdit: !block, titles: { minWall: 'Minimum wall' } });
    controller.onCheck = (r) => st.results.push(r);
    return { st, store, controller };
  }
  const op: EditOp[] = [{ op: 'set', id: 'F2', path: 'depth', value: 1 }];

  it('a Block rule with a pre-existing issue allows an unrelated edit', async () => {
    const f = fake(() => [wall(['A', 'B'])]);
    await f.controller.load(plateDoc());
    const r = await f.controller.edit(op);
    expect(r.ok).toBe(true);
    expect(f.st.undos).toBe(0);
    expect(f.st.results.length).toBe(1);
  });

  it('a new violation rejects the edit and rolls it back, naming rule, value, faces and limit', async () => {
    const f = fake((n) => (n === 0 ? [] : [wall(['C', 'D'])]));
    await f.controller.load(plateDoc());
    const r = await f.controller.edit(op);
    expect(r.ok).toBe(false);
    expect(f.st.undos).toBe(1);
    expect(f.st.edits).toBe(0);
    expect(r.hints![0].hint).toMatch(/Minimum wall: 0\.5 mm on C, D, limit 1\.2/);
    expect(f.store.notices.value.at(-1)!.level).toBe('error');
    expect(f.store.busy.value).toBe(false);
  });

  it('a confirmed sketch is not blocked', async () => {
    const f = fake((n) => (n === 0 ? [] : [wall(['C'])]));
    await f.controller.load(plateDoc());
    const sk = plateDoc().features[0] as never;
    (f.controller as unknown as { sketchOpen: unknown }).sketchOpen = { featureId: 'F1', upTo: 0, draft: fromFeature(sk), baselineDof: null, isNew: false, undo: [], status: null };
    const c = await f.controller.commitSketch();
    expect(c!.ok).toBe(true);
    expect(f.st.undos).toBe(0);
  });

  it('check after every edit is debounced and never overlaps', async () => {
    vi.useFakeTimers();
    try {
      let release: () => void = () => {};
      const f = fake(() => []);
      f.controller.policy = () => ({ profile: { id: 'p', name: 'P', rules: [] }, name: 'P', blocking: [], afterEdit: true, titles: {} });
      await f.controller.load(plateDoc());
      const slow = (f.st as unknown as { checks: number });
      void slow;
      await f.controller.edit(op); await f.controller.edit(op);
      expect(f.st.checks).toBe(0);
      await vi.advanceTimersByTimeAsync(500);
      expect(f.st.checks).toBe(1);
      expect(f.st.results.length).toBe(1);
      release();
    } finally { vi.useRealTimers(); }
  });
});
