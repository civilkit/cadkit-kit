import { describe, expect, it } from 'vitest';
import { partOfStep, sldprtAsPart, type SldprtKernel } from './sldprtImport';

const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
const sha = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, '0')).join('');
const body = { faces: [{ id: 'a', mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }], edges: [], box: { min: [0, 0, 0], max: [1, 1, 0] } };

/** A kernel that answers from a table by message type. */
const fake = (answers: Record<string, (m: Record<string, unknown>) => unknown>): SldprtKernel & { log: string[] } => {
  const log: string[] = [];
  return { log, request: async (m) => { log.push(String(m.type)); const a = answers[String(m.type)]; return a ? (a(m) as never) : { ok: false, error: `no ${m.type}` }; } };
};

describe('partOfStep', () => {
  it('holds the text under its SHA-256 and names it in one importStep feature', async () => {
    const p = await partOfStep(STEP, 'Bracket');
    expect(p.name).toBe('Bracket');
    expect(Object.keys(p.blobs ?? {})).toEqual([await sha(STEP)]);
    expect(p.features.map((f) => f.type)).toEqual(['importStep']);
    expect((p.features[0] as unknown as { blob: string }).blob).toBe(await sha(STEP));
    expect(Object.values(p.blobs ?? {})).toEqual([STEP]);
  });
});

describe('sldprtAsPart', () => {
  const good = {
    importSldprt: () => ({ ok: true, result: { body, errors: [] } }),
    massProps: () => ({ ok: true, result: { volume: 100 } }),
    step: () => ({ ok: true, result: STEP }),
    regen: () => ({ ok: true, result: { errors: [], body: null } }),
  };
  it('builds the part when the part gives back the volume of the file\'s solid', async () => {
    const k = fake(good);
    const r = await sldprtAsPart(k, new Uint8Array([1, 2, 3]), 'P');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faces).toBe(1);
    expect(r.volume).toBe(100);
    expect(r.part.features.length).toBe(1);
    expect(k.log).toEqual(['importSldprt', 'massProps', 'step', 'regen', 'massProps']);
  });
  it('answers the code of a file the kernel cannot read, with no fallback body', async () => {
    const r = await sldprtAsPart(fake({ importSldprt: () => ({ ok: true, result: { body: null, errors: [['import', { code: 'unsupported.geometry' }]] } }) }), new Uint8Array(), 'P');
    expect(r).toMatchObject({ ok: false, code: 'unsupported.geometry' });
    expect((r as { fallback?: unknown }).fallback).toBeUndefined();
  });
  it('offers the view-only body when the STEP cannot be written', async () => {
    const r = await sldprtAsPart(fake({ ...good, step: () => ({ ok: false, error: 'noState' }) }), new Uint8Array(), 'P');
    expect(r).toMatchObject({ ok: false, code: 'stepExport' });
    expect((r as { fallback?: { faces: number } }).fallback?.faces).toBe(1);
  });
  it('offers the view-only body when the part has other errors or another volume', async () => {
    const withErrors = await sldprtAsPart(fake({ ...good, regen: () => ({ ok: true, result: { errors: [['F1', { code: 'importStepInvalid' }]] } }) }), new Uint8Array(), 'P');
    expect(withErrors).toMatchObject({ ok: false, code: 'regen' });
    let calls = 0;
    const other = await sldprtAsPart(fake({ ...good, massProps: () => ({ ok: true, result: { volume: calls++ === 0 ? 100 : 101 } }) }), new Uint8Array(), 'P');
    expect(other).toMatchObject({ ok: false, code: 'volumeDiffers' });
    expect((other as { fallback?: unknown }).fallback).toBeDefined();
  });
  it('treats a solid with no volume as unusable', async () => {
    const r = await sldprtAsPart(fake({ ...good, massProps: () => ({ ok: true, result: { volume: 0 } }) }), new Uint8Array(), 'P');
    expect(r).toMatchObject({ ok: false, code: 'noVolume' });
  });
});
