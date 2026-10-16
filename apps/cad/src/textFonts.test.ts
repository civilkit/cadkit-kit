import { describe, expect, it, vi } from 'vitest';
import { localFontLister, makeFontsApi } from './textFonts';
import type { Controller } from './controller';
import type { FontSource, LocalFace } from './fonts';

const source: FontSource = { manifest: async () => [], fetch: async () => new Uint8Array() };
const info = (warnings: Array<{ code: string; detail: string }> = []) => ({ name: 'n', hash: 'h', family: 'Fam', bytes: 1, chars: 1, supported: [], warnings });

describe('local font access detection', () => {
  it('is null where queryLocalFonts does not exist and a lister where it does', async () => {
    expect(localFontLister({})).toBeNull();
    expect(localFontLister(undefined)).toBeNull();
    const q = vi.fn(async () => [] as LocalFace[]);
    const l = localFontLister({ queryLocalFonts: q });
    expect(l).toBeTypeOf('function');
    await l!();
    expect(q).toHaveBeenCalledTimes(1);
  });
});

describe('font picker host', () => {
  it('a pick loads the font through the controller and sets font + fontHash on the text; the kernel warnings come back', async () => {
    const addFont = vi.fn(async (s: unknown) => ({ ok: true as const, name: 'fam-12345678', hash: 'h', pin: 'abcd', info: info([{ code: 'fontKerningIgnored', detail: '' }]), s }));
    const apply = vi.fn();
    const api = makeFontsApi({ controller: { addFont, fontInfo: () => ({ loaded: false, subset: false }) } as unknown as Controller, source, apply, localFonts: null });
    const out = await api.pickFile(new File([new Uint8Array([0, 1, 0, 0])], 'My Font.ttf'));
    expect(out).toEqual({ ok: true, name: 'fam-12345678', warnings: [{ code: 'fontKerningIgnored', detail: '' }] });
    expect(apply).toHaveBeenCalledWith({ font: 'fam-12345678', fontHash: 'abcd' });
    const call = addFont.mock.calls[0][0] as { family: string; name(h: string): string };
    expect(call.family).toBe('My Font');
    expect(call.name('0123456789abcdef')).toBe('my-font-01234567');
  });
  it('a refusal changes nothing and carries the kernel code', async () => {
    const addFont = vi.fn(async () => ({ ok: false as const, problem: { name: 'x', code: 'fontBadData', message: 'WOFF' } }));
    const apply = vi.fn();
    const api = makeFontsApi({ controller: { addFont } as unknown as Controller, source, apply, localFonts: null });
    expect(await api.pickCurated('barlow')).toEqual({ ok: false, code: 'fontBadData', detail: 'WOFF' });
    expect(apply).not.toHaveBeenCalled();
  });
  it('a system font is read from its blob only when picked', async () => {
    const addFont = vi.fn(async () => ({ ok: true as const, name: 'v-1', hash: 'h', pin: undefined, info: info() }));
    const apply = vi.fn();
    const blob = vi.fn(async () => new Blob([new Uint8Array([0, 1, 0, 0, 9])]));
    const api = makeFontsApi({ controller: { addFont } as unknown as Controller, source, apply, localFonts: null });
    await api.pickLocal({ family: 'Verdana', fullName: 'Verdana', postscriptName: 'Verdana', style: 'Regular', blob });
    expect(blob).toHaveBeenCalledTimes(1);
    expect((addFont.mock.calls[0] as unknown as [{ bytes: Uint8Array }])[0].bytes).toEqual(new Uint8Array([0, 1, 0, 0, 9]));
    expect(apply).toHaveBeenCalledWith({ font: 'v-1', fontHash: null });
  });
});
