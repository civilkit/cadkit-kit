import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import type { FeatureRow } from '@kit/ui';
import { dropPlan, folderIds, folderOf, folderRuns, groupPlan, removeFromFolderPlan, renameFolderPlan, ungroupPlan, uniqueFolderName, type Plan } from './treeFolders';

type F = { id: string; type: string; group?: string; [k: string]: unknown };
// F1 -> F2 (extrude of F1), F3 -> F4 (extrude of F3), F5 fillets F4, F6 -> F7. Top-level rows: F2, F4, F5, F7 (sketches are tucked).
const base = (): F[] => [
  { id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', sketch: 'F1' },
  { id: 'F3', type: 'sketch' }, { id: 'F4', type: 'extrude', sketch: 'F3' },
  { id: 'F5', type: 'fillet', edges: ['F4.E1'] },
  { id: 'F6', type: 'sketch' }, { id: 'F7', type: 'extrude', sketch: 'F6' },
];
const rowsOf = (fs: F[]): FeatureRow[] => fs.map((f) => ({ id: f.id, type: f.type, group: f.group, uses: typeof f.sketch === 'string' ? [f.sketch] : undefined }));

/** What the session does with the ops (move / set / replace). */
function apply(fs: F[], ops: EditOp[]): F[] {
  let out = fs.map((f) => ({ ...f }));
  for (const o of ops) {
    if (o.op === 'move') { const i = out.findIndex((f) => f.id === o.id); const [f] = out.splice(i, 1); out.splice(o.to, 0, f); }
    else if (o.op === 'set') out = out.map((f) => (f.id === o.id ? { ...f, [o.path]: o.value } : f));
    else if (o.op === 'replace') out = out.map((f) => (f.id === o.id ? ({ ...o.feature, id: o.id } as F) : f));
  }
  return out;
}
const run = (fs: F[], p: Plan): F[] => { if (!p.ok) throw new Error('refused: ' + p.reason); return apply(fs, p.ops); };
const grouped = (fs: F[], name: string) => fs.filter((f) => f.group === name).map((f) => f.id);
const order = (fs: F[]) => fs.map((f) => f.id).join(' ');
/** Four independent sketch + extrude pairs. */
const indep = (): F[] => [1, 3, 5, 7].flatMap((n) => [{ id: `F${n}`, type: 'sketch' }, { id: `F${n + 1}`, type: 'extrude', sketch: `F${n}` }]);
const withFolder = (): F[] => run(base(), groupPlan(rowsOf(base()), base(), ['F2', 'F4', 'F5'], 'Folder'));

describe('folder naming', () => {
  it('numbers a name that is taken', () => {
    expect(uniqueFolderName('Folder', base())).toBe('Folder');
    expect(uniqueFolderName('Folder', [{ id: 'F1', type: 'x', group: 'Folder' }])).toBe('Folder 2');
    expect(uniqueFolderName('Folder', [{ id: 'F1', type: 'x', group: 'Folder' }, { id: 'F2', type: 'x', group: 'Folder 2' }])).toBe('Folder 3');
  });
});

describe('group into folder', () => {
  it('tags the selected rows and the sketches under them, and moves nothing', () => {
    const fs = base();
    const p = groupPlan(rowsOf(fs), fs, ['F2', 'F4'], 'Folder');
    expect(p.ok && p.name).toBe('Folder');
    expect(p.ok && p.ops.every((o) => o.op === 'set' && o.path === 'group')).toBe(true);
    const after = run(fs, p);
    expect(grouped(after, 'Folder')).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(order(after)).toBe(order(fs));
    expect(folderRuns(rowsOf(after), after)).toEqual([{ name: 'Folder', ids: ['F1', 'F2', 'F3', 'F4'] }]);
  });

  it('takes a picked sketch as the feature it is tucked under', () => {
    const fs = base();
    expect(grouped(run(fs, groupPlan(rowsOf(fs), fs, ['F1', 'F4'], 'Folder')), 'Folder')).toEqual(['F1', 'F2', 'F3', 'F4']);
  });

  it('numbers the name when a folder called Folder exists', () => {
    const fs = withFolder();
    const p = groupPlan(rowsOf(fs), fs, ['F7', 'F5'], 'Folder');
    // F5 is in a folder: the new one takes it, the old one keeps F2 F4 (two rows) and the name is numbered
    expect(p.ok && p.name).toBe('Folder 2');
  });

  it('refuses one row, and rows that are not consecutive', () => {
    const fs = base();
    expect(groupPlan(rowsOf(fs), fs, ['F2'], 'Folder')).toMatchObject({ ok: false, reason: 'needTwo' });
    expect(groupPlan(rowsOf(fs), fs, ['F1', 'F2'], 'Folder')).toMatchObject({ ok: false, reason: 'needTwo' });   // a feature and its sketch are one row
    expect(groupPlan(rowsOf(fs), fs, ['F2', 'F5'], 'Folder')).toMatchObject({ ok: false, reason: 'notContiguous' });
  });

  it('a folder taking part of another folder leaves the rest alone, and a single leftover stops being a folder', () => {
    const fs = withFolder();   // Folder: F2 F4 F5
    const after = run(fs, groupPlan(rowsOf(fs), fs, ['F4', 'F5', 'F7'], 'Folder'));
    expect(grouped(after, 'Folder 2')).toEqual(['F3', 'F4', 'F5', 'F6', 'F7']);
    expect(grouped(after, 'Folder')).toEqual([]);   // F2 alone is no folder: its tag is cleared
  });
});

describe('ungroup and remove from folder', () => {
  it('ungroup drops the tag and keeps the order', () => {
    const fs = withFolder();
    const p = ungroupPlan(fs, 'Folder');
    const after = run(fs, p);
    expect(after.some((f) => 'group' in f)).toBe(false);
    expect(order(after)).toBe(order(fs));
    expect(ungroupPlan(after, 'Folder')).toMatchObject({ ok: false });
  });

  it('removes a row from the end of a folder but not from the middle', () => {
    const fs = withFolder();   // F2 F4 F5
    const end = run(fs, removeFromFolderPlan(rowsOf(fs), fs, ['F5']));
    expect(grouped(end, 'Folder')).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(removeFromFolderPlan(rowsOf(fs), fs, ['F4'])).toMatchObject({ ok: false, reason: 'splits' });
    expect(removeFromFolderPlan(rowsOf(fs), fs, ['F7'])).toMatchObject({ ok: false, reason: 'noFolder' });
  });

  it('a folder down to one row is dissolved', () => {
    const fs = run(base(), groupPlan(rowsOf(base()), base(), ['F4', 'F5'], 'Folder'));
    expect(grouped(run(fs, removeFromFolderPlan(rowsOf(fs), fs, ['F5'])), 'Folder')).toEqual([]);
  });
});

describe('rename folder', () => {
  it('sets the tag on every member, refuses an empty name or one another folder has', () => {
    const fs = withFolder();
    expect(grouped(run(fs, renameFolderPlan(fs, 'Folder', '  Body ')), 'Body')).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(renameFolderPlan(fs, 'Folder', ' ')).toMatchObject({ ok: false, reason: 'nameEmpty' });
    const two = [...fs.slice(0, 5), ...fs.slice(5).map((f) => ({ ...f, group: 'Other' }))];
    expect(renameFolderPlan(two, 'Folder', 'Other')).toMatchObject({ ok: false, reason: 'nameTaken' });
    expect(renameFolderPlan(fs, 'Folder', 'Folder')).toMatchObject({ ok: true, ops: [] });
  });
});

describe('moves', () => {
  it('a row dropped on a folder goes to its end and joins it', () => {
    const fs = run(base(), groupPlan(rowsOf(base()), base(), ['F2', 'F4'], 'Folder'));   // F1..F4 folder; F5 F6 F7 outside
    const after = run(fs, dropPlan(rowsOf(fs), fs, { kind: 'row', id: 'F5' }, { kind: 'folder', name: 'Folder' }));
    expect(folderIds(rowsOf(after), after, 'Folder')).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(order(after)).toBe(order(fs));   // F5 was already next to it: nothing moved
  });

  it('a row from further away moves next to the folder', () => {
    const fs = run(base(), groupPlan(rowsOf(base()), base(), ['F2', 'F4'], 'Folder'));
    // F7 uses F6, which stays behind: F7 cannot go before it
    expect(dropPlan(rowsOf(fs), fs, { kind: 'row', id: 'F7' }, { kind: 'folder', name: 'Folder' })).toMatchObject({ ok: false, reason: 'order' });
    const free = [...fs, { id: 'F8', type: 'hole' } as F];
    const after = run(free, dropPlan(rowsOf(free), free, { kind: 'row', id: 'F8' }, { kind: 'folder', name: 'Folder' }));
    expect(order(after)).toBe('F1 F2 F3 F4 F8 F5 F6 F7');
    expect(after.find((f) => f.id === 'F8')!.group).toBe('Folder');
    expect(after).toBeDefined();
  });

  it('a row dropped on a folder member takes its place in the folder', () => {
    const fs = withFolder();   // F2 F4 F5 in Folder
    const solo = [...fs, { id: 'F8', type: 'hole', group: undefined } as F];
    const after = run(solo, dropPlan(rowsOf(solo), solo, { kind: 'row', id: 'F8' }, { kind: 'row', id: 'F5' }));
    expect(order(after)).toBe('F1 F2 F3 F4 F8 F5 F6 F7');
    expect(after.find((f) => f.id === 'F8')!.group).toBe('Folder');
  });

  it('a row dropped on a row outside the folder leaves the folder', () => {
    const fs = withFolder();
    const after = run(fs, dropPlan(rowsOf(fs), fs, { kind: 'row', id: 'F5' }, { kind: 'row', id: 'F7' }));
    expect(order(after)).toBe('F1 F2 F3 F4 F6 F7 F5');
    expect(after.find((f) => f.id === 'F5')!.group).toBeUndefined();
    expect(folderIds(rowsOf(after), after, 'Folder')).toEqual(['F1', 'F2', 'F3', 'F4']);
  });

  it('refuses a move that puts a feature before what it uses', () => {
    const fs = base();
    const p = dropPlan(rowsOf(fs), fs, { kind: 'row', id: 'F4' }, { kind: 'row', id: 'F1' });
    expect(p).toMatchObject({ ok: false, reason: 'order' });
    // the folder cannot be moved below the feature that uses it, either
    const g = withFolder();
    expect(dropPlan(rowsOf(g), g, { kind: 'row', id: 'F4' }, { kind: 'row', id: 'F7' })).toMatchObject({ ok: false, reason: 'order' });   // F5 fillets F4
  });

  it('a row onto itself is nothing', () => {
    const fs = withFolder();
    expect(dropPlan(rowsOf(fs), fs, { kind: 'row', id: 'F4' }, { kind: 'row', id: 'F4' })).toMatchObject({ ok: true, ops: [] });
  });

  it('moves a whole folder below another row and back, with its sketches', () => {
    const fs = run(base(), groupPlan(rowsOf(base()), base(), ['F2', 'F4'], 'Folder'));   // F1..F4 | F5 F6 F7
    // F5 fillets F4 (in the folder): the folder cannot go below F5
    expect(dropPlan(rowsOf(fs), fs, { kind: 'folder', name: 'Folder' }, { kind: 'row', id: 'F5' })).toMatchObject({ ok: false, reason: 'order' });
    // two independent parts: A = F1 F2, B = F3 F4 (plus F5 fillet on B)
    const ind = run(base(), groupPlan(rowsOf(base()), base(), ['F4', 'F5'], 'B'));   // B: F3 F4 F5 ; F1 F2 outside
    const down = run(ind, dropPlan(rowsOf(ind), ind, { kind: 'folder', name: 'B' }, { kind: 'row', id: 'F2' }));
    expect(order(down)).toBe('F3 F4 F5 F1 F2 F6 F7'.replace('F3 F4 F5 F1 F2', 'F1 F2 F3 F4 F5').replace('F1 F2 F3 F4 F5', 'F3 F4 F5 F1 F2'));
    expect(folderIds(rowsOf(down), down, 'B')).toEqual(['F3', 'F4', 'F5']);
    const back = run(down, dropPlan(rowsOf(down), down, { kind: 'folder', name: 'B' }, { kind: 'row', id: 'F7' }));
    expect(order(back)).toBe('F1 F2 F6 F7 F3 F4 F5');
  });

  it('a row inside another folder stands for that folder: folders do not nest', () => {
    const ind = indep();
    const a = run(ind, groupPlan(rowsOf(ind), ind, ['F2', 'F4'], 'A'));
    const both = run(a, groupPlan(rowsOf(a), a, ['F6', 'F8'], 'B'));
    const after = run(both, dropPlan(rowsOf(both), both, { kind: 'folder', name: 'A' }, { kind: 'row', id: 'F6' }));
    expect(order(after)).toBe('F5 F6 F7 F8 F1 F2 F3 F4');
    expect(folderOf(rowsOf(after), after, 'F6')).toBe('B');
    expect(folderOf(rowsOf(after), after, 'F2')).toBe('A');
  });
});
