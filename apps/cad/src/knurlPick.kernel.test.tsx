// The whole pick-in-place flow on a real kernel: a cylinder from a sketch and an extrude, the Knurl wizard opened with nothing selected, the cylinder's face
// "clicked" (the one-face selection the app passes in), Knurl pressed: the grooves are in the feature tree.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { KnurlWizard } from './KnurlWizard';
import { DEFAULT_KNURL, knurlOps, knurlTarget, type KnurlParams } from './knurl';

const sessions: Session[] = [];
afterEach(async () => { cleanup(); await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('Knurl wizard: pick the face after opening', { skip: !process.env.CK_WASM }, () => {
  it('opened with no selection, a click on the cylinder fills it in and Knurl puts the grooves in the feature tree; the flat end is refused', async () => {
    const cyl = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 10 }], constraints: [] };
    const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await c.load({ ...emptyPart('Part2'), features: [cyl, { type: 'extrude', id: 'F2', name: 'Cylinder', op: 'add', sketch: 'F1', end: 'blind', depth: 24 }] } as never as PartDoc);
    const edges = c.bodyEdges() as Array<{ faces?: string[] }>;
    const faces = [...new Set(edges.flatMap((e) => e.faces ?? []))];
    const side = faces.find((f) => 'target' in knurlTarget(f, edges as never));
    const flat = faces.find((f) => !('target' in knurlTarget(f, edges as never)));
    expect(side && flat, 'a round and a flat face exist').toBeTruthy();

    const before = c.document()!.features.length;
    const applies: KnurlParams[] = [];
    const ui = (face: string | null) => <KnurlWizard params={{ ...DEFAULT_KNURL, cosmetic: false, target: null }} face={face} edges={edges as never} onDraft={() => {}} onApply={(p) => applies.push(p)} onCancel={() => {}} />;
    const r = render(ui(null));
    const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
    expect((q('[data-testid="knurl-apply"]') as HTMLButtonElement).disabled).toBe(true);
    r.rerender(ui(flat!));
    expect(q('[data-testid="knurl-reason"]').textContent).toMatch(/not round/);
    expect((q('[data-testid="knurl-apply"]') as HTMLButtonElement).disabled).toBe(true);
    r.rerender(ui(side!));
    expect(q('[data-testid="knurl-target"]').textContent).toMatch(/radius 10 mm, axis Z, from 0 to 24 mm/);
    const cosmetic = q('[data-path="cosmetic"] input') as HTMLInputElement;
    if (cosmetic.checked) fireEvent.click(cosmetic);
    fireEvent.click(q('[data-testid="knurl-apply"]'));
    expect(applies.length).toBe(1);

    const res = await c.commit(knurlOps(c.document() as never, applies[0]), 'knurl');
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const feats = c.document()!.features as unknown as Array<{ type: string; group?: string }>;
    expect(feats.length).toBeGreaterThan(before);
    expect(feats.slice(before).every((f) => f.group === 'Knurl')).toBe(true);
    expect(feats.slice(before).some((f) => f.type === 'extrude')).toBe(true);
  }, 300000);
});
