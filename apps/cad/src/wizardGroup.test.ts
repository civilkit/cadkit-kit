import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import './i18n';
import { groupOps, groupPatch, wizardGroupName } from './wizardGroup';
import { bearingOps, DEFAULT_BEARING } from './bearing';
import { DEFAULT_SCREW, screwOps } from './screw';
import { DEFAULT_KNURL, knurlOps, type KnurlParams } from './knurl';
import { DEFAULT_PROP, propDocument, propPlan, readProp } from './propData';
import { DEFAULT_MARINE, marineDocument, marinePlan, readMarine } from './marineData';
import { DEFAULT_IMPELLER, impellerDocument, impellerPlan, readImpeller } from './impellerData';
import { DEFAULT_GEAR, defaultPair, gearCommitOps, gearOps, readGear } from './gearData';
import { gearCreateOps } from './featureCreators';
import { deleteOps } from './treeActions';
import { folderIds, folderRuns } from './treeFolders';

type Rec = Record<string, unknown> & { id: string; group?: string };
const added = (ops: EditOp[]): Rec[] => ops.filter((o) => o.op === 'add').map((o) => (o as unknown as { feature: Rec }).feature);
const target: NonNullable<KnurlParams['target']> = { axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12 };
const groups = (fs: Rec[]) => [...new Set(fs.map((f) => f.group))];
const rows = (fs: Rec[]) => fs.map((f) => ({ id: f.id, type: f.type as string, group: f.group }));

describe('wizardGroupName', () => {
  it('a new result is named after the wizard, numbered when that name is taken', () => {
    expect(wizardGroupName([{ id: 'F1' }], 'Bearing')).toBe('Bearing');
    expect(wizardGroupName([{ id: 'F1', group: 'Bearing' }], 'Bearing')).toBe('Bearing 2');
    expect(wizardGroupName([{ id: 'F1', group: 'Bearing' }, { id: 'F2', group: 'Bearing 2' }], 'Bearing')).toBe('Bearing 3');
  });
  it('a result being edited keeps its folder, renamed or not; one made before wizards grouped stays loose', () => {
    const fs = [{ id: 'F1', group: 'Mine' }, { id: 'F2', group: 'Mine' }, { id: 'F3' }];
    expect(wizardGroupName(fs, 'Gear', { profile: 'F1', body: 'F2' })).toBe('Mine');
    expect(wizardGroupName(fs, 'Gear', { profile: 'F3' })).toBeUndefined();
  });
});

describe('groupOps / groupPatch', () => {
  it('stamp add and replace (a replace is a whole feature) and leave other ops alone', () => {
    const ops = groupOps([{ op: 'add', feature: { id: 'F1', type: 'sketch' } }, { op: 'replace', id: 'F2', feature: { id: 'F2', type: 'extrude' } }, { op: 'remove', id: 'F3' }] as EditOp[], 'G');
    expect(ops).toEqual([{ op: 'add', feature: { id: 'F1', type: 'sketch', group: 'G' } }, { op: 'replace', id: 'F2', feature: { id: 'F2', type: 'extrude', group: 'G' } }, { op: 'remove', id: 'F3' }]);
    expect(groupOps(ops, undefined)).toBe(ops);
  });
  it('stamp the replaced and the appended features of a patch, not its variables', () => {
    const p = groupPatch({ variables: [1], features: { F1: { id: 'F1' } }, append: [{ id: 'F2' }] }, 'G');
    expect(p).toEqual({ variables: [1], features: { F1: { id: 'F1', group: 'G' } }, append: [{ id: 'F2', group: 'G' }] });
  });
});

describe('every inserting wizard puts its whole result in one folder named after it', () => {
  const doc = { features: [{ id: 'F1' }, { id: 'F2' }], seq: 3 };
  it('bearing', () => {
    const fs = added(bearingOps(doc, DEFAULT_BEARING));
    expect(fs.length).toBeGreaterThanOrEqual(4);
    expect(groups(fs)).toEqual(['Bearing']);
    const taken: Rec[] = [{ id: 'F1', group: 'Bearing' }];
    expect(groups(added(bearingOps({ features: taken }, DEFAULT_BEARING)))).toEqual(['Bearing 2']);
  });
  it('screw', () => {
    const fs = added(screwOps(doc, DEFAULT_SCREW));
    expect(fs.length).toBeGreaterThan(1);
    expect(groups(fs)).toEqual(['Screw']);
  });
  it('knurl (cut and faceted forms)', () => {
    const P = (o: Partial<KnurlParams>): KnurlParams => ({ ...DEFAULT_KNURL, count: 24, depth: 0.6, target, ...o });
    expect(groups(added(knurlOps(doc, P({}))))).toEqual(['Knurl']);
    const pyramid = added(knurlOps(doc, P({ pattern: 'pyramid', count: 12, depth: 0.5 })));
    expect(pyramid.length).toBeGreaterThan(0);
    expect(groups(pyramid)).toEqual(['Knurl']);
  });
  it('gear and gear pair, from the ribbon command and from the editor', () => {
    const ctx = { doc: { features: [{ id: 'F1' }] }, mode: 'face', selection: [], selectedId: null, edges: [] } as never;
    const single = added(gearCreateOps(ctx)!);
    expect(single.length).toBeGreaterThan(1);
    expect(groups(single)).toEqual(['Gear']);
    const pair = added(gearCreateOps(ctx, true)!);
    expect(pair.length).toBeGreaterThan(single.length);
    expect(groups(pair)).toEqual(['Gear']);   // the mating gear is in the same folder
    // the editor regenerating it keeps the folder, renamed or not, and a loose gear stays loose
    const made = added(gearCommitOps({ features: [] }, DEFAULT_GEAR)).map((f) => ({ ...f, group: 'My gears' }));
    const roles = readGear(made[0])!.roles;
    const edit = gearCommitOps({ features: made, seq: 99 }, { ...DEFAULT_GEAR, teeth: 24 }, roles);
    expect(edit.every((o) => o.op !== 'add' || (o as unknown as { feature: Rec }).feature.group === 'My gears')).toBe(true);
    expect(edit.filter((o) => o.op === 'replace').every((o) => (o as unknown as { feature: Rec }).feature.group === 'My gears')).toBe(true);
    const loose = added(gearOps({ features: [] }, DEFAULT_GEAR));
    expect(gearCommitOps({ features: loose, seq: 99 }, { ...DEFAULT_GEAR, teeth: 24 }, readGear(loose[0])!.roles).some((o) => 'feature' in o && (o as unknown as { feature: Rec }).feature.group !== undefined)).toBe(false);
  });
  it('two results in a row are two folders, not one', () => {
    const a = added(bearingOps({ features: [] }, DEFAULT_BEARING));
    const b = added(bearingOps({ features: a, seq: 50 }, DEFAULT_BEARING));
    expect(folderRuns(rows(a.concat(b)), a.concat(b)).map((r) => r.name)).toEqual(['Bearing', 'Bearing 2']);
  });

  // the three roles-based families share one shape: plan -> append, then re-open (same structure: in place; changed structure: remove and append)
  const families = [
    { name: 'Propeller', title: 'Propeller', make: () => propDocument(DEFAULT_PROP) as { features: Rec[]; seq?: number; variables?: Array<{ name: string }> }, plan: (d: never, roles?: Record<string, string>, change = false) => propPlan(d, { ...DEFAULT_PROP, ...(change ? { sections: DEFAULT_PROP.sections + 1 } : {}) }, roles), roles: (f: Rec) => readProp(f)?.roles },
    { name: 'Marine propeller', title: 'Marine', make: () => marineDocument(DEFAULT_MARINE) as { features: Rec[]; seq?: number; variables?: Array<{ name: string }> }, plan: (d: never, roles?: Record<string, string>, change = false) => marinePlan(d, { ...DEFAULT_MARINE, ...(change ? { boreDia: 0 } : {}) }, roles), roles: (f: Rec) => readMarine(f)?.roles },
    { name: 'Turbo impeller', title: 'Impeller', make: () => impellerDocument(DEFAULT_IMPELLER) as { features: Rec[]; seq?: number; variables?: Array<{ name: string }> }, plan: (d: never, roles?: Record<string, string>, change = false) => impellerPlan(d, { ...DEFAULT_IMPELLER, ...(change ? { splitterBlades: 0 } : {}) }, roles), roles: (f: Rec) => readImpeller(f)?.roles },
  ];
  for (const fam of families) {
    it(`${fam.title}: a new one is appended in one folder; editing it keeps the folder (also renamed, also when the structure changes)`, () => {
      const base = fam.make();
      const empty = { features: [{ id: 'F1' }], seq: 2, variables: [] };
      const created = fam.plan(empty as never);
      const feats = created.patch.append as Rec[];
      expect(feats.length).toBeGreaterThan(3);
      expect(groups(feats)).toEqual([fam.name]);
      // a second one next to it gets its own folder
      const second = fam.plan({ ...empty, features: [...empty.features, ...feats], seq: created.patch.seq } as never).patch.append as Rec[];
      expect(groups(second)).toEqual([`${fam.name} 2`]);

      // re-open: the hub record is on one of the made features; rename the folder first
      const live = feats.map((f) => ({ ...f, group: 'Drive' }));
      const roles = live.map(fam.roles).find((r) => r)!;
      const d = { features: live, seq: created.patch.seq, variables: [] };
      const same = fam.plan(d as never, roles);
      expect(same.before).toEqual([]);
      expect(Object.keys(same.patch.features!).length).toBe(live.length);
      expect(Object.values(same.patch.features!).every((f) => f.group === 'Drive')).toBe(true);
      const changed = fam.plan(d as never, roles, true);
      expect(changed.before.length).toBeGreaterThan(0);
      expect((changed.patch.append as Rec[]).every((f) => f.group === 'Drive')).toBe(true);
      // a result made before folders existed stays loose
      const old = base.features;
      const oldRoles = old.map(fam.roles).find((r) => r)!;
      const loose = fam.plan({ features: old, seq: base.seq, variables: [] } as never, oldRoles);
      expect(Object.values(loose.patch.features!).some((f) => f.group !== undefined)).toBe(false);
    });
  }
});

describe('deleting a wizard folder', () => {
  it('removes exactly its features and leaves the others (and their order) alone', () => {
    const before: Rec[] = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', sketch: 'F1' }];
    const ops = bearingOps({ features: before, seq: 3 }, DEFAULT_BEARING);
    const all = [...before, ...added(ops)];
    const ids = folderIds(rows(all), all, 'Bearing');
    expect(ids.length).toBe(added(ops).length);
    expect(ids.includes('F1') || ids.includes('F2')).toBe(false);
    const gone = new Set(deleteOps(all as never, ids).map((o) => (o as { id: string }).id));
    expect(gone).toEqual(new Set(ids));
    expect(all.filter((f) => !gone.has(f.id)).map((f) => f.id)).toEqual(['F1', 'F2']);
  });
  it('a feature outside the folder that uses one inside is not deleted with it: the plain remove is left for the session to refuse', () => {
    const all: Rec[] = [{ id: 'F1', type: 'sketch', group: 'G' }, { id: 'F2', type: 'extrude', sketch: 'F1', group: 'G' }, { id: 'F3', type: 'fillet', target: 'F2' } as Rec];
    const ops = deleteOps(all as never, ['F1', 'F2']);
    expect(ops).toEqual([{ op: 'remove', id: 'F1', cascade: true }, { op: 'remove', id: 'F2' }]);
  });
});
