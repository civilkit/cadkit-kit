import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { buildPolicy, defaultSettings, settingsToInline } from './checkSettings';
import { AgentSession } from '@kit/agent-tools';
import { runProfile, withMould } from './designCheck';

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

describe('the injection undercut rule against the kernel', { skip: !hasRules() }, () => {
  /** a 40 x 20 x 10 block (x, y, z in [-20, 20] x [-10, 10] x [0, 10]) with the given extra features; pull +Z */
  async function check(tail: string, edit?: (s: Record<string, { mode: string; params: Record<string, unknown> }>) => void) {
    const a = await AgentSession.open({ wasmPath: process.env.CK_WASM });
    try {
      const r = await a.runScript(`part('P').sketch('front', (s) => s.rect(40, 20)).extrude(10)${tail};`, 'new');
      expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
      const info = withMould(await a.session.profiles()).profiles.find((p) => p.id === 'injection')!;
      const settings = defaultSettings(info);
      edit?.(settings as never);
      return await runProfile(a.session, settingsToInline(info, settings));
    } finally { await a.close(); }
  }
  const mould = (r: Awaited<ReturnType<typeof check>>) => r.issues.filter((i) => i.rule === 'mouldUndercut');

  it('a block with a hole along the pull and one with a step have no undercut', async () => {
    expect(mould(await check(`.sketch('front', (s) => s.circle(3)).cut(through(), { direction: 'both' })`))).toEqual([]);
    expect(mould(await check(`.sketch('front', (s) => s.rect(20, 20, [10, 0])).extrude(8)`))).toEqual([]);
  }, 120000);

  it('a hole across the pull is reported once, on the hole wall, as the one rule; Off silences it; pulling along the hole axis clears it', async () => {
    const cross = `.sketch('right', (s) => s.circle(2, [-5, 0])).cut(through(), { direction: 'both' })`;   // a hole along X
    const r = await check(cross);
    const m = mould(r);
    expect(m.length).toBeGreaterThan(0);
    expect(m[0].message).toMatch(/neither half can form it/);
    expect(m[0].unit).toBe('mm2');
    expect(r.issues.some((i) => i.rule === 'undercut')).toBe(false);          // the two kernel runs are folded away
    expect(r.summary.rules.map((x) => x.rule)).toEqual(['openShell', 'draft', 'uniformWall', 'minWall', 'mouldUndercut']);
    expect(r.summary.rules.at(-1)).toMatchObject({ rule: 'mouldUndercut', passed: false });
    expect(m.length).toBe(r.summary.rules.at(-1)!.issues);
    // the same part, pulled along X: the hole is along the pull
    expect(mould(await check(cross, (s) => { s.mouldUndercut.params.direction = [1, 0, 0]; }))).toEqual([]);
    expect(mould(await check(cross, (s) => { s.mouldUndercut.mode = 'off'; }))).toEqual([]);
  }, 180000);
});
