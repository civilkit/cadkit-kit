import { describe, expect, it } from 'vitest';
import { registerCatalog } from '@kit/i18n';
import { buildViewData, featureStatuses, diagnoseErrors, shownBody } from './build';
import { diagStrings } from './strings';

registerCatalog('en', diagStrings);
const feats = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', sketch: 'F1' }, { id: 'F3', type: 'extrude', depth: 1 }];
const body = { mesh: { triFace: new Int32Array(2) }, box: { min: [0, 0, 0], max: [1, 1, 1] } };

describe('buildViewData', () => {
  const reply = (errors: Array<[string, { code?: string; params?: Record<string, unknown> }]> = []) => ({
    body, report: { errors, hints: errors.map(([feature, e]) => ({ feature, code: e.code ?? '', hint: 'see the features field table' })), threads: [], warnings: [], surfaces: [] }, components: [],
  });
  it('is one status per feature, ok when the kernel reports no error', () => {
    const v = buildViewData(feats, reply());
    expect(v.status).toEqual([{ id: 'F1', ok: true }, { id: 'F2', ok: true }, { id: 'F3', ok: true }]);
    expect(v.body).toBe(body);
    expect(v.limits).toEqual([]);
    expect((v.diag as { roots: unknown[] }).roots).toEqual([]);
  });
  it('gives a failing feature its code and the plain advice when the kernel text only points at the field table', () => {
    const v = buildViewData(feats, reply([['F2', { code: 'nothingToCut' }]]));
    expect(v.status[1]).toMatchObject({ id: 'F2', ok: false, code: 'nothingToCut' });
    expect(v.status[1].hint).toBe(diagStrings['diag.advice.nothingToCut']);
    expect(v.errors).toEqual([['F2', { code: 'nothingToCut' }]]);
  });
  it('marks the features that follow a failed one as blocked by it', () => {
    const errs: Array<[string, { code: string }]> = [['F2', { code: 'booleanFailed' }], ['F3', { code: 'missingReference' }]];
    const d = diagnoseErrors(errs, [], feats);
    expect(featureStatuses(feats, errs, [], d)[2].blockedBy).toBe('F2');
  });
  it('adds the kernel\'s own sentence for a gone face or edge, so the reference can be repaired from the status', () => {
    const own = 'face F1.S.e9 no longer exists; the faces of F1 now are F1.S.e1, F1.C0, F1.C1';
    const errs: Array<[string, { code: string; params: Record<string, unknown> }]> = [['F2', { code: 'missingReference', params: { ref: 'F1.S.e9', candidates: ['F1.S.e1'], hint: own } }]];
    const d = diagnoseErrors(errs, [], feats);
    const h = featureStatuses(feats, errs, [], d)[1].hint ?? '';
    expect(h).toContain(own);
    expect(h).toContain(diagStrings['diag.advice.missingReference']);
    // other codes keep their text, and a missingReference without the sentence keeps the plain advice
    const plain: Array<[string, { code: string; params: Record<string, unknown> }]> = [['F2', { code: 'missingReference', params: { field: 'endRef' } }]];
    expect(featureStatuses(feats, plain, [], diagnoseErrors(plain, [], feats))[1].hint).toBe(diagStrings['diag.advice.missingReference']);
  });
  it('keeps limits only for a document that can have a tip, and drops malformed ones', () => {
    const drafted = [{ id: 'F1', type: 'extrude', draft: 5 }];
    expect(buildViewData(drafted, { ...reply(), limits: [['F1', { maxHeight: 3 }], ['F9', { maxHeight: -1 }], 'x'] }).limits).toEqual([['F1', 3]]);
    expect(buildViewData(feats, { ...reply(), limits: [['F1', { maxHeight: 3 }]] }).limits).toEqual([]);
  });
  it('shows no body when there is none, and attaches surface bodies only for a document that makes sheets', () => {
    expect(shownBody(null, feats, [])).toBeNull();
    const sheet = ['S1', { faces: [], edges: [], mesh: { positions: { data: new Float32Array(0) }, normals: { data: new Float32Array(0) }, triFace: { data: new Int32Array(0) } }, box: { min: [0, 0, 0], max: [2, 2, 2] } }];
    expect(shownBody(body, feats, [sheet])).toBe(body);
    expect((shownBody(body, [{ type: 'surfacePlanar' }], [sheet]) as { surfaces?: unknown[] }).surfaces).toHaveLength(1);
  });
});

describe('surface bodies of an import', () => {
  it('an importStep can leave surface bodies (the parts of its file that are not solids), so its surfaces are shown', async () => {
    const { hasSurfaceFeatures } = await import('./surfaces');
    expect(hasSurfaceFeatures([{ type: 'importStep' }] as never)).toBe(true);
    expect(hasSurfaceFeatures([{ type: 'extrude' }] as never)).toBe(false);
  });
});
