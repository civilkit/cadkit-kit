import { describe, expect, it } from 'vitest';
import { HISTORY_FOLDER } from '../historyFolder';
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
    expect(k.log).toEqual(['importSldprt', 'massProps', 'sldprtHistory', 'step', 'regen', 'massProps']);
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

describe('sldprtAsPart with the feature history of the file', () => {
  const feat = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ type, id, ...extra });
  const rebuilt = [feat('F1', 'sketch'), feat('F2', 'extrude', { sketch: 'F1' }), feat('F3', 'fillet')];
  const remainder = feat('F4', 'importBody', { name: 'Imported remainder', format: 'sldprt', blob: 'k', replace: true });
  /** The kernel: the history reply, and a regen that gives the file's volume when there is a body (any unsuppressed feature) and none when everything is suppressed. */
  const kernel = (reply: unknown, regens: Array<Array<{ id: string; suppressed?: boolean }>> = []) => {
    let live = 0;
    return fake({
      importSldprt: () => ({ ok: true, result: { body, errors: [] } }),
      sldprtHistory: () => reply,
      regen: (m) => { const fs = ((m.part as { features: Array<{ id: string; suppressed?: boolean }> }).features); regens.push(fs); live = fs.filter((f) => !f.suppressed).length; return { ok: true, result: { errors: [] } }; },
      massProps: (m) => ({ ok: true, result: { volume: m.tag === 'sldprt-part' && live === 0 ? 0 : 100 } }),
    });
  };
  const history = (complete: boolean, features: unknown[]) => ({ ok: true, result: { ok: true, complete, part: { features, blobs: complete ? {} : { k: 'FILE' }, seq: features.length + 1 } } });

  it('a complete history is one folder, with the file\'s body held suppressed after it', async () => {
    const regens: Array<Array<{ id: string; suppressed?: boolean }>> = [];
    const r = await sldprtAsPart(kernel(history(true, rebuilt), regens), new Uint8Array([1, 2, 3]), 'P');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.history).toBe(true);
    expect(r.historyInfo).toEqual({ rebuilt: 3, complete: true });
    const fs = r.part.features as unknown as Array<Record<string, unknown>>;
    expect(fs.map((f) => f.type)).toEqual(['sketch', 'extrude', 'fillet', 'importBody']);
    expect(fs.slice(0, 3).every((f) => f.group === HISTORY_FOLDER && !f.suppressed)).toBe(true);
    expect(fs[3]).toMatchObject({ id: 'F4', replace: true, suppressed: true, format: 'sldprt', origin: `standin:${HISTORY_FOLDER}` });
    expect(fs[3].group).toBeUndefined();
    const key = fs[3].blob as string;
    expect(key).toBe(await sha(Object.values((r.part as { blobs?: Record<string, string> }).blobs ?? {})[0]));
    expect(r.part.seq).toBeGreaterThan(4);
    // both states were checked: folder on (stand-in off), folder off (stand-in on)
    expect(regens.map((fs) => fs.map((f) => (f.suppressed ? 'off' : 'on')).join(' '))).toEqual(['on on on off', 'off off off on']);
  });
  it('a partial history is one folder followed by the imported remainder, which stays on', async () => {
    const r = await sldprtAsPart(kernel(history(false, [...rebuilt, remainder])), new Uint8Array([1, 2, 3]), 'P');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.historyInfo).toEqual({ rebuilt: 3, complete: false });
    const fs = r.part.features as unknown as Array<Record<string, unknown>>;
    expect(fs.map((f) => f.group)).toEqual([HISTORY_FOLDER, HISTORY_FOLDER, HISTORY_FOLDER, undefined]);
    expect(fs[3]).toMatchObject({ type: 'importBody', replace: true });
    expect(fs[3].suppressed).toBeUndefined();
    expect((r.part as { blobs?: unknown }).blobs).toEqual({ k: 'FILE' });
  });
  it('falls back to the one imported body when the folder-off state does not give the file\'s volume', async () => {
    const k = fake({
      importSldprt: () => ({ ok: true, result: { body, errors: [] } }), step: () => ({ ok: true, result: STEP }),
      sldprtHistory: () => history(false, [...rebuilt, remainder]),
      regen: () => ({ ok: true, result: { errors: [] } }),
      massProps: (() => { let n = 0; return () => ({ ok: true, result: { volume: [100, 100, 150][n++] ?? 100 } }); })(),
    });
    const r = await sldprtAsPart(k, new Uint8Array([1]), 'P');
    expect(r.ok && r.history).toBeFalsy();
    expect(r.ok && r.part.features.map((f) => f.type)).toEqual(['importStep']);
  });
  it('a history of a single feature is no folder: the plain import', async () => {
    const r = await sldprtAsPart(kernel(history(false, [feat('F1', 'sketch'), remainder])), new Uint8Array([1]), 'P');
    expect(r.ok && r.history).toBeFalsy();
  });
});
