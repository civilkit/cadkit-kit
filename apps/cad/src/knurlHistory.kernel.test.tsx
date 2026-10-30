// The Knurl wizard's result must be in the feature tree and editable, whichever way it is made: cut into the solid (grooves, or one faceted band) it is
// ordinary features in a folder named "Knurl"; Cosmetic (display only) is a record in the document and has a row of its own. Drawn from the same rows the
// app gives FeatureTree (treeModel.ts), on a real kernel: a cylinder from a sketch and an extrude, then the wizard's ops through the Controller.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { FeatureTree } from '@kit/ui';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { DEFAULT_KNURL, knurlCosmetic, knurlOps, readCosmeticKnurls, type KnurlParams } from './knurl';
import { knurlOwner, knurlReplaceOps, paramsFromCosmetic, replaceCosmetic } from './knurlEdit';
import { featureRows, refRows, treeKnurlRows } from './treeModel';

const sessions: Session[] = [];
afterEach(async () => { cleanup(); await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function cylinder() {
  const cyl = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 10 }], constraints: [] };
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load({ ...emptyPart('Part2'), features: [cyl, { type: 'extrude', id: 'F2', name: 'Cylinder', op: 'add', sketch: 'F1', end: 'blind', depth: 24 }] } as never as PartDoc);
  return c;
}
const band = { axis: 'z' as const, center: [0, 0] as [number, number], radius: 10 };
const params = (o: Partial<KnurlParams> & { from?: number; to?: number }): KnurlParams => ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.6, ...o, target: { ...band, from: o.from ?? 0, to: o.to ?? 24 } });
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? r);
type Feat = { id: string; type: string; group?: string };
const feats = (c: Controller) => (c.document()?.features ?? []) as unknown as Feat[];

/** What the user sees: the tree the app renders for the document. */
function seen(c: Controller) {
  const doc = c.document() as never as { name: string; features: Feat[] } & Record<string, unknown>;
  const r = render(<FeatureTree rows={featureRows(doc as never)} refs={[...refRows(doc as never), ...treeKnurlRows(doc as never)]} partName={doc.name} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />);
  const q = (sel: string) => [...r.container.querySelectorAll(sel)] as HTMLElement[];
  return {
    count: r.container.querySelector('.tree-count')?.textContent ?? '',
    featureRows: q('.row[data-id]').map((e) => e.getAttribute('data-id')!),
    folders: q('.row.folder').map((e) => e.getAttribute('data-group')!),
    refs: q('.row.ref'),
  };
}
const knurlRefs = (u: ReturnType<typeof seen>) => u.refs.filter((e) => e.getAttribute('data-ref')?.startsWith('knurl:'));

describe('the Knurl wizard result is in the history', { skip: !process.env.CK_WASM }, () => {
  it('a cut knurl (straight grooves): its features carry the folder name Knurl, are listed, and the count includes them', async () => {
    const c = await cylinder();
    const before = feats(c).length;
    const r = await c.commit(knurlOps(c.document() as never, params({ pattern: 'straight' })), 'knurl');
    expect(r.ok, fail(r)).toBe(true);
    const added = feats(c).slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((f) => f.group === 'Knurl')).toBe(true);
    const ui = seen(c);
    for (const f of added.filter((x) => x.type !== 'sketch' && x.type !== 'plane')) expect(ui.featureRows).toContain(f.id);
    expect(Number(ui.count.match(/\d+/)?.[0])).toBe(feats(c).length);   // (the tree draws a folder row only for two or more consecutive rows: this knurl is one cut and its sketch)
  }, 300000);

  for (const pattern of ['diamond', 'pyramid'] as const) {
    it(`a faceted ${pattern} band is one listed feature of the part`, async () => {
      const c = await cylinder();
      const r = await c.commit(knurlOps(c.document() as never, params({ pattern, method: 'faceted', helixAngle: 30 })), 'knurl');
      expect(r.ok, fail(r)).toBe(true);
      const bands = feats(c).filter((f) => f.type === 'knurlBand');
      expect(bands.length).toBe(1);
      expect(bands[0].group).toBe('Knurl');
      const ui = seen(c);
      expect(ui.featureRows).toContain(bands[0].id);
      expect(Number(ui.count.match(/\d+/)?.[0])).toBe(3);
    }, 300000);
  }

  it('a second knurl gets its own folder name, and both cuts are listed', async () => {
    const c = await cylinder();
    for (const [from, to] of [[0, 10], [14, 24]]) {
      const r = await c.commit(knurlOps(c.document() as never, params({ pattern: 'straight', from, to })), 'knurl');
      expect(r.ok, fail(r)).toBe(true);
    }
    expect([...new Set(feats(c).map((f) => f.group).filter(Boolean))]).toEqual(['Knurl', 'Knurl 2']);
    const ui = seen(c);
    for (const f of feats(c).filter((x) => x.group && x.type === 'extrude')) expect(ui.featureRows).toContain(f.id);
  }, 300000);

  it('a cosmetic knurl is no feature, but it has a row of its own in the tree and the row opens an editor', async () => {
    const c = await cylinder();
    const rec = knurlCosmetic(params({ pattern: 'diamond', cosmetic: true, helixAngle: 45 }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    expect(readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls)).toEqual([rec]);
    expect(feats(c).length).toBe(2);   // the part holds the record, the history gains no feature
    const rows = knurlRefs(seen(c));
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toMatch(/knurl/i);
    expect(rows[0].classList.contains('editable')).toBe(true);
  }, 300000);

  it('a cut knurl and a cosmetic knurl together: both are listed', async () => {
    const c = await cylinder();
    const r = await c.commit(knurlOps(c.document() as never, params({ pattern: 'straight', from: 0, to: 10 })), 'knurl');
    expect(r.ok, fail(r)).toBe(true);
    c.setUndoableExtra('cosmeticKnurls', [knurlCosmetic(params({ pattern: 'pyramid', cosmetic: true, from: 14, to: 24 }))]);
    const ui = seen(c);
    for (const f of feats(c).filter((x) => x.group && x.type === 'extrude')) expect(ui.featureRows).toContain(f.id);
    expect(knurlRefs(ui).length).toBe(1);
  }, 300000);

  it('a cut knurl and a faceted band reopen from any of their rows and are replaced in place, keeping the Knurl folder name', async () => {
    const c = await cylinder();
    for (const p of [params({ pattern: 'straight', from: 0, to: 10 }), params({ pattern: 'diamond', method: 'faceted', helixAngle: 30, from: 14, to: 24 })]) {
      const r = await c.commit(knurlOps(c.document() as never, p), 'knurl');
      expect(r.ok, fail(r)).toBe(true);
    }
    const all = () => feats(c) as unknown as Array<Record<string, unknown>>;
    const cut = all().find((f) => f.group === 'Knurl' && f.type === 'extrude')!;
    const owner = knurlOwner(all(), String(cut.id))!;
    expect(owner.kind).toBe('group');
    expect(owner.params.pattern).toBe('straight');
    const bandId = String(all().find((f) => f.type === 'knurlBand')!.id);
    expect(knurlOwner(all(), bandId)?.kind).toBe('band');
    // edit the cut knurl: 36 grooves instead of 24, replaced where it was, in the folder it had
    const at = all().findIndex((f) => f.id === owner.ids[0]);
    const r = await c.commit(knurlReplaceOps(c.document() as never, { ...owner.params, count: 36 }, owner), 'knurl');
    expect(r.ok, fail(r)).toBe(true);
    const after = all();
    expect(after.length).toBe(feats(c).length);
    expect(after.filter((f) => f.type === 'knurlBand').length).toBe(1);
    expect(after[at].group).toBe('Knurl');
    expect([...new Set(after.map((f) => f.group).filter(Boolean))]).toEqual(['Knurl', 'Knurl 2']);   // the band stayed in Knurl 2; the new cut is back in Knurl, not in a Knurl 3
    expect(after.filter((f) => f.group === 'Knurl').map((f) => f.type)).toContain('extrude');
  }, 300000);

  it('a cosmetic knurl row reopens on its own parameters and Update replaces the record at its index', async () => {
    const c = await cylinder();
    const rec = knurlCosmetic(params({ pattern: 'diamond', cosmetic: true, helixAngle: 45, count: 30 }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const row = knurlRefs(seen(c))[0];
    expect(row.getAttribute('data-ref')).toBe('knurl:0');
    const p = paramsFromCosmetic(readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls)[0]);
    expect(p).toMatchObject({ pattern: 'diamond', count: 30, helixAngle: 45, cosmetic: true });
    const list = replaceCosmetic(readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls), 0, knurlCosmetic({ ...p, count: 48 }));
    c.setUndoableExtra('cosmeticKnurls', list);
    const now = readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls);
    expect(now.length).toBe(1);
    expect(now[0].count).toBe(48);
    expect(knurlRefs(seen(c)).length).toBe(1);
  }, 300000);
});
