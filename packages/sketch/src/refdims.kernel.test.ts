import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { fromFeature, toFeature } from './index';
import { rectDraft } from './tools/edit-fixtures';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('reference dimensions stored on the sketch', { skip: !process.env.CK_WASM }, () => {
  it('the kernel accepts and keeps an unknown `refDims` list on a sketch feature', async () => {
    const d = rectDraft(10, 5);
    const f = { ...toFeature(d), refDims: [{ id: 'r1', type: 'distance', refs: ['p1', 'p3'] }] };
    const s = await Session.open({ ...emptyPart('R'), features: [f], seq: 2 } as unknown as PartDoc);
    sessions.push(s);
    const r = await s.preview([], { upTo: 1, sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
    const back = s.document.features[0] as unknown as Record<string, unknown>;
    expect(back.refDims).toEqual([{ id: 'r1', type: 'distance', refs: ['p1', 'p3'] }]);
    expect(fromFeature(back).extras?.refDims).toBeTruthy();
  });
});
