import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { buildPolicy, defaultSettings, settingsToInline } from './checkSettings';

const rect = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -10, y: -10 }, { id: 'p2', x: 10, y: -10 }, { id: 'p3', x: 10, y: 10 }, { id: 'p4', x: -10, y: 10 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const box = (depth: number): PartDoc => ({ ...emptyPart('Box'), features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth }], seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (doc: PartDoc) => { const s = await Session.open(doc); sessions.push(s); return s; };

/** The design-rule requests came late: a kernel build without them skips these tests. */
const hasRules = (): boolean => { try { return !!process.env.CK_WASM && readFileSync(process.env.CK_WASM).includes('uniformWall'); } catch { return false; } };

describe('design check against the kernel', { skip: !hasRules() }, () => {
  it('a 0.5 mm wall gives a minWall issue under fdm-print, on faces that exist in the body', async () => {
    const s = await open(box(0.5));
    const info = (await s.profiles()).profiles.find((p) => p.id === 'fdm-print')!;
    const report = await s.checkProfile(settingsToInline(info, defaultSettings(info)));
    const wall = report.issues.filter((i) => i.rule === 'minWall');
    expect(wall.length).toBeGreaterThan(0);
    const faces = new Set((await s.bodyForView())!.mesh.faceIds);
    expect(wall[0].faces.length).toBeGreaterThan(0);
    for (const f of wall[0].faces) expect(faces.has(f)).toBe(true);
    expect(wall[0].value).toBeLessThan(wall[0].limit!);
  }, 60000);

  it('a Block rule rejects an edit that thins a wall to 0.5 mm and restores the document', async () => {
    const opened: Session[] = [];
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); opened.push(s); sessions.push(s); return s; } };
    const store = createStore();
    const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await controller.load(box(10));
    const info = (await controller.profiles())!.profiles.find((p) => p.id === 'fdm-print')!;
    const settings = defaultSettings(info);
    settings.minWall = { mode: 'block', params: { min: 1.2 } };
    controller.policy = () => buildPolicy(info, settings, false);

    const bad = await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 0.5 }]);
    expect(bad.ok).toBe(false);
    expect(bad.hints![0].hint).toMatch(/Minimum wall.*0\.5 mm on .*limit 1\.2/);
    const s = opened[0];
    expect((s.document.features.find((f) => f.id === 'F2') as { depth: number }).depth).toBe(10);
    expect(s.history().length).toBe(0);
    expect(store.busy.value).toBe(false);

    const ok = await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 8 }]);
    expect(ok.ok).toBe(true);
    expect(s.history().length).toBe(1);
  }, 120000);
});
