import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, FITTINGS, PROFILES, defaultHardware, frameFeature, partSpec, profileById } from './frameLib';
import { adoptFrameLibraries, clearStoredLibrary, exampleLibrary, importLibraryText, loadStoredLibrary, storedLibrary, validateLibrary } from './frameUserLib';

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => clearStoredLibrary());

const errorsOf = (raw: unknown): string[] => { const r = validateLibrary(raw); return r.ok ? [] : r.errors; };
const withProfile = (patch: Record<string, unknown>): unknown => {
  const ex = exampleLibrary() as { profiles: Array<Record<string, unknown>> };
  return { ...ex, profiles: [{ ...ex.profiles[0], ...patch }] };
};

describe('user library: checking', () => {
  it('accepts the example file', () => {
    const r = validateLibrary(exampleLibrary());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary).toEqual({ profiles: 1, fittings: 4, materials: 1 });
  });
  it('knows the I section and the channel with its own flange and web thickness', () => {
    expect(errorsOf(withProfile({ section: { kind: 'ibeam', w: 100, h: 200, tf: 8, tw: 5, r: 8 } }))).toEqual([]);
    expect(errorsOf(withProfile({ section: { kind: 'ibeam', w: 100, h: 200, tf: 8 } }))).toEqual(['profiles[0].section.tw: needs a number above 0 (mm)']);
    expect(errorsOf(withProfile({ section: { kind: 'channel', w: 75, h: 230, tf: 12, tw: 6.5, r: 12 } }))).toEqual([]);
    expect(errorsOf(withProfile({ section: { kind: 'channel', w: 75, h: 230, t: 6 } }))).toEqual([]);
    expect(errorsOf(withProfile({ section: { kind: 'channel', w: 75, h: 230, tf: 12 } }))[0]).toContain('section.t: needs a number above 0 (mm), or `tf` and `tw`');
  });
  it('names the path of each problem and imports nothing', () => {
    expect(errorsOf([])).toEqual(['the file must be a JSON object with `profiles`, `fittings` and/or `materials`']);
    expect(errorsOf({ profilez: [] })[0]).toContain('unknown top-level key `profilez`');
    expect(errorsOf(withProfile({ id: 'tslot-3030' }))[0]).toContain('profiles[0]: id `tslot-3030` is built in');
    expect(errorsOf(withProfile({ section: { kind: 'zed', w: 3 } }))[0]).toContain('profiles[0].section.kind: one of');
    expect(errorsOf(withProfile({ section: { kind: 'rectTube', w: 30 } }))).toEqual(['profiles[0].section.t: needs a number above 0 (mm)']);
    expect(errorsOf(withProfile({ material: 'unobtainium' }))[0]).toContain('profiles[0].material: `unobtainium`');
    expect(errorsOf(withProfile({ hardware: { joint: ['nope'] } }))[0]).toContain('`nope` is not a fitting id');
    expect(errorsOf(withProfile({ hardware: { cap: ['my-bracket-30'] } }))[0]).toContain('is not a cap');
    expect(errorsOf(withProfile({ hardware: { floor: [] } }))[0]).toContain('hardware.floor: one of joint, corner3, cap, foot');
    expect(errorsOf(withProfile({ fittings: [{ id: 'weld', per: 'sideways', qty: 1 }] }))[0]).toContain('needs `per`');
    const ex = exampleLibrary() as { fittings: Record<string, { part: Record<string, unknown> }> };
    ex.fittings['my-bracket-30'].part.arm = 'long';
    ex.fittings['my-bracket-30'].part.nut = 'gone';
    expect(errorsOf(ex)).toEqual(expect.arrayContaining(['fittings.my-bracket-30.part.arm: needs a number above 0 (mm)', expect.stringContaining('part.nut: `gone`')]));
    expect(importLibraryText('{ nope')[ 'ok' as never]).toBe(false);
    expect(PROFILES.some((p) => p.id === 'my-shs-30x30x2')).toBe(false);
  });
});

describe('user library: install, keep, travel with the file', () => {
  it('installs into the live lists, is kept in the browser and comes back at start-up', () => {
    const r = importLibraryText(JSON.stringify(exampleLibrary()));
    expect(r.ok).toBe(true);
    expect(profileById('my-shs-30x30x2')?.label).toBe('My SHS 30 x 30 x 2');
    expect(defaultHardware('my-shs-30x30x2')).toEqual({ joint: 'my-bracket-30', corner3: null, cap: 'my-cap-30', foot: null });
    expect(partSpec('my-bracket-30')).toMatchObject({ kind: 'lbracket', arm: 28, bolt: { id: 'my-hex-m5', d: 5 }, nut: { id: 'my-nut-m5', af: 8 } });
    expect(storedLibrary().profiles).toHaveLength(1);
    clearStoredLibrary();
    expect(profileById('my-shs-30x30x2')).toBeUndefined();
    expect(FITTINGS['my-cap-30']).toBeUndefined();
    importLibraryText(JSON.stringify(exampleLibrary()));
    // start-up: drop the live copy but not the stored one, then load
    PROFILES.splice(PROFILES.findIndex((p) => p.id === 'my-shs-30x30x2'), 1);
    delete FITTINGS['my-cap-30'];
    loadStoredLibrary();
    expect(profileById('my-shs-30x30x2')).toBeDefined();
    expect(FITTINGS['my-cap-30']).toBeDefined();
  });
  it('a frame of the user\'s stock carries the profile and its fittings, and a browser without them adopts them', () => {
    importLibraryText(JSON.stringify(exampleLibrary()));
    const f = frameFeature('F2', { ...DEFAULT_FRAME, sketch: 'F1', profile: 'my-shs-30x30x2', corner: 'mitre', hardware: defaultHardware('my-shs-30x30x2') })! as { library: { profiles: Array<{ id: string }>; fittings: Record<string, unknown>; materials: Record<string, unknown> }; hardware: Record<string, { id: string }> };
    expect(f.hardware.joint.id).toBe('my-bracket-30');
    expect(f.library.profiles.map((p) => p.id)).toEqual(['my-shs-30x30x2']);
    expect(Object.keys(f.library.fittings).sort()).toEqual(['my-bracket-30', 'my-cap-30', 'my-hex-m5', 'my-nut-m5']);
    expect(Object.keys(f.library.materials)).toEqual(['brass-cz121']);
    // a built-in profile adds nothing
    expect((frameFeature('F3', { ...DEFAULT_FRAME, sketch: 'F1' })! as Record<string, unknown>).library).toBeUndefined();
    // another browser: nothing stored, the file's feature brings the stock; no write to storage
    clearStoredLibrary();
    expect(profileById('my-shs-30x30x2')).toBeUndefined();
    expect(adoptFrameLibraries([f as unknown as Record<string, unknown>])).toBe(1);
    expect(profileById('my-shs-30x30x2')).toBeDefined();
    expect(partSpec('my-bracket-30')).not.toBeNull();
    expect(storedLibrary().profiles).toBeUndefined();
    expect(adoptFrameLibraries([f as unknown as Record<string, unknown>])).toBe(0);
  });
});
