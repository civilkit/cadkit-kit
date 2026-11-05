import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import type { FeatureRow } from '@kit/ui';
import { folderOff, folderToggleOps, HISTORY_FOLDER, isStandIn, standInOrigin } from './historyFolder';
import { folderIds, folderRuns } from './treeFolders';

type F = { id: string; type: string; group?: string; suppressed?: boolean; [k: string]: unknown };
const history = (): F[] => [
  { id: 'F1', type: 'sketch', group: HISTORY_FOLDER }, { id: 'F2', type: 'extrude', sketch: 'F1', group: HISTORY_FOLDER },
  { id: 'F3', type: 'fillet', group: HISTORY_FOLDER },
];
const standIn = (): F => ({ id: 'F4', type: 'importBody', replace: true, suppressed: true, origin: standInOrigin(HISTORY_FOLDER) });
const remainder = (): F => ({ id: 'F4', type: 'importBody', replace: true, name: 'Imported remainder' });
const rowsOf = (fs: F[]): FeatureRow[] => fs.map((f) => ({ id: f.id, type: f.type, group: f.group, uses: typeof f.sketch === 'string' ? [f.sketch] : undefined }));
const apply = (fs: F[], ops: EditOp[]): F[] => fs.map((f) => { const o = ops.find((x) => x.op === 'set' && x.id === f.id); return o && o.op === 'set' ? { ...f, [o.path]: o.value } : f; });
const state = (fs: F[]) => fs.map((f) => `${f.id}:${f.suppressed ? 'off' : 'on'}`).join(' ');

describe('the history folder', () => {
  it('is a folder of the tree: the group name on every rebuilt feature, the stand-in body after it and outside', () => {
    const fs = [...history(), standIn()];
    expect(folderRuns(rowsOf(fs), fs)).toEqual([{ name: HISTORY_FOLDER, ids: ['F2', 'F1', 'F3'].sort((a, b) => ['F1', 'F2', 'F3'].indexOf(a) - ['F1', 'F2', 'F3'].indexOf(b)) }]);
    expect(folderIds(rowsOf(fs), fs, HISTORY_FOLDER)).toEqual(['F1', 'F2', 'F3']);
    expect(isStandIn(fs[3], HISTORY_FOLDER)).toBe(true);
    expect(isStandIn(remainder())).toBe(false);
  });
  it('a folder of one row with its sketch tucked under it is a folder (a short history)', () => {
    const fs: F[] = [{ id: 'F1', type: 'sketch', group: HISTORY_FOLDER }, { id: 'F2', type: 'extrude', sketch: 'F1', group: HISTORY_FOLDER }, remainder()];
    expect(folderRuns(rowsOf(fs), fs).map((r) => r.ids)).toEqual([['F1', 'F2']]);
  });
  it('one click switches every feature off and the stand-in on, the next click the reverse', () => {
    let fs = [...history(), standIn()];
    const ids = ['F1', 'F2', 'F3'];
    expect(folderOff(fs, ids)).toBe(false);
    fs = apply(fs, folderToggleOps(fs, ids, HISTORY_FOLDER));
    expect(state(fs)).toBe('F1:off F2:off F3:off F4:on');
    expect(folderOff(fs, ids)).toBe(true);
    fs = apply(fs, folderToggleOps(fs, ids, HISTORY_FOLDER));
    expect(state(fs)).toBe('F1:on F2:on F3:on F4:off');
  });
  it('a partly suppressed folder is switched fully off first', () => {
    let fs = [...history(), standIn()]; fs[2] = { ...fs[2], suppressed: true };
    fs = apply(fs, folderToggleOps(fs, ['F1', 'F2', 'F3'], HISTORY_FOLDER));
    expect(state(fs)).toBe('F1:off F2:off F3:off F4:on');
  });
  it('the imported remainder of a partial history is never touched: it is the body when the folder is off and follows the features when on', () => {
    let fs = [...history(), remainder()];
    const ops = folderToggleOps(fs, ['F1', 'F2', 'F3'], HISTORY_FOLDER);
    expect(ops.map((o) => (o as { id: string }).id)).toEqual(['F1', 'F2', 'F3']);
    fs = apply(fs, ops);
    expect(state(fs)).toBe('F1:off F2:off F3:off F4:on');
    fs = apply(fs, folderToggleOps(fs, ['F1', 'F2', 'F3'], HISTORY_FOLDER));
    expect(state(fs)).toBe('F1:on F2:on F3:on F4:on');
  });
});
