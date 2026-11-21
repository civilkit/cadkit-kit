import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { fromFeature, toFeature } from './index';
import { setDimPlacement, placementsOf } from './dimPlacement';
import { rectDraft } from './tools/edit-fixtures';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('dimension placement stored on the sketch', { skip: !process.env.CK_WASM }, () => {
  it('the kernel accepts and keeps an unknown `dimPlacement` on a sketch feature', async () => {
    const d = setDimPlacement(rectDraft(10, 5), 'k1', { level: 3, side: -1 });
    const s = await Session.open({ ...emptyPart('R'), features: [toFeature(d)], seq: 2 } as unknown as PartDoc);
    sessions.push(s);
    const r = await s.preview([], { upTo: 1, sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
    const back = s.document.features[0] as unknown as Record<string, unknown>;
    expect(placementsOf(fromFeature(back))).toEqual({ k1: { level: 3, side: -1 } });
  });
});
