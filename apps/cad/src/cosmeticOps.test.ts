import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import { cosmeticOnly } from './cosmeticOps';
import { groupPlan, renameFolderPlan, ungroupPlan } from './treeFolders';
import type { FeatureRow } from '@kit/ui';

const fs = [
  { id: 'F1', type: 'plane', offset: 5 },
  { id: 'F2', type: 'plane', offset: 9, group: 'A', name: 'Nine' },
  { id: 'F3', type: 'plane', offset: 12, group: 'A' },
  { id: 'F4', type: 'plane', offset: 20 },
];
const rows = (): FeatureRow[] => fs.map((f) => ({ id: f.id, type: f.type, group: f.group }) as FeatureRow);
const ok = (p: ReturnType<typeof groupPlan>): EditOp[] => { if (!p.ok) throw new Error(p.reason); return p.ops; };

describe('label-only edits', () => {
  it('every folder action is label-only: group, regroup, rename, ungroup', () => {
    expect(cosmeticOnly(fs, ok(groupPlan(rows(), fs, ['F3', 'F4'], 'Folder')))).toBe(true);
    expect(cosmeticOnly(fs, ok(renameFolderPlan(fs, 'A', 'B')))).toBe(true);
    expect(cosmeticOnly(fs, ok(ungroupPlan(fs, 'A')))).toBe(true);        // a replace without the key
  });
  it('anything else is not', () => {
    expect(cosmeticOnly(fs, [])).toBe(false);
    expect(cosmeticOnly(fs, [{ op: 'set', id: 'F1', path: 'offset', value: 6 }])).toBe(false);
    expect(cosmeticOnly(fs, [{ op: 'set', id: 'F1', path: 'group', value: 'X' }, { op: 'set', id: 'F1', path: 'suppressed', value: true }])).toBe(false);
    expect(cosmeticOnly(fs, [{ op: 'replace', id: 'F2', feature: { id: 'F2', type: 'plane', offset: 10 } as never }])).toBe(false);
    expect(cosmeticOnly(fs, [{ op: 'remove', id: 'F1' }])).toBe(false);
    expect(cosmeticOnly(fs, [{ op: 'replace', id: 'NOPE', feature: { id: 'NOPE' } as never }])).toBe(false);
  });
});
