import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { TextPanel } from './TextPanel';
import { en as catalogue } from './locales/en';
import { parseManifest, type LocalFace } from './fonts';
import type { FontOutcome, FontsApi } from './FontPicker';
import { readFileSync } from 'node:fs';
import './i18n';

const en = (k: string): string => String((catalogue as Record<string, unknown>)[k]);
afterEach(() => cleanup());
const manifest = parseManifest(JSON.parse(readFileSync(process.cwd() + '/apps/cad/public/fonts/fonts.json', 'utf8')));
const fields = { string: 'RPM', font: 'gauge', height: 4, anchor: ['left', 'baseline'] as ['left', 'baseline'], angle: 0, spacing: 1, mirror: false, arc: null, x: 0, y: 0 };
const ok = (name: string, warnings: Array<{ code: string; detail: string }> = []): FontOutcome => ({ ok: true, name, warnings });
function api(over: Partial<FontsApi> = {}): FontsApi {
  return {
    curated: async () => manifest,
    pickCurated: vi.fn(async (id: string) => ok(id)),
    pickFile: vi.fn(async (f: File) => ok(f.name)),
    localFonts: null,
    pickLocal: vi.fn(async (f: LocalFace) => ok(f.postscriptName)),
    describe: () => null,
    ...over,
  };
}
const panel = (fonts: FontsApi, f = fields) => render(<TextPanel fields={f} notes={[]} onPatch={vi.fn()} onDone={vi.fn()} onDelete={vi.fn()} onPickCentre={vi.fn()} picking={false} fonts={fonts} />);
const face = (family: string, fullName = family): LocalFace => ({ family, fullName, postscriptName: fullName.replace(/\s/g, ''), style: 'Regular', blob: async () => new Blob([new Uint8Array([0, 1, 0, 0])]) });

describe('font picker', () => {
  it('offers the two built-ins and the ten library fonts with their role; picking a library font loads it', async () => {
    const a = api();
    const onPatch = vi.fn();
    render(<TextPanel fields={fields} notes={[]} onPatch={onPatch} onDone={vi.fn()} onDelete={vi.fn()} onPickCentre={vi.fn()} picking={false} fonts={a} />);
    const sel = screen.getByLabelText(en('app.sketch.text.font')) as HTMLSelectElement;
    await waitFor(() => expect(sel.querySelectorAll('optgroup[label="' + en('app.font.group.library') + '"] option')).toHaveLength(10));
    expect([...sel.querySelectorAll('optgroup')[0].querySelectorAll('option')].map((o) => o.value)).toEqual(['b:gauge', 'b:engrave']);
    expect(sel.textContent).toContain('Barlow (sans)');
    fireEvent.change(sel, { target: { value: 'c:bebas-neue' } });
    await waitFor(() => expect(a.pickCurated).toHaveBeenCalledWith('bebas-neue'));
    fireEvent.change(sel, { target: { value: 'b:engrave' } });
    expect(onPatch).toHaveBeenCalledWith({ font: 'engrave' });
  });

  it('shows the licence of the selected library font, and the embed note for a font of the part', async () => {
    const a = api({ describe: (n) => (n === 'plex-12345678' ? { family: 'Plex Sans', subset: false } : null) });
    const { rerender } = panel(a, { ...fields, font: 'barlow' });
    await waitFor(() => expect(document.querySelector('[data-note="curated-licence"]')).toBeTruthy());
    expect(document.querySelector('[data-note="curated-licence"]')!.textContent).toContain('SIL OFL 1.1');
    expect(document.querySelector('[data-note="user-licence"]')).toBeNull();
    rerender(<TextPanel fields={{ ...fields, font: 'plex-12345678' }} notes={[]} onPatch={vi.fn()} onDone={vi.fn()} onDelete={vi.fn()} onPickCentre={vi.fn()} picking={false} fonts={a} />);
    expect(document.querySelector('[data-note="user-licence"]')!.textContent).toBe(en('app.font.licenceNote'));
    expect((screen.getByLabelText(en('app.sketch.text.font')) as HTMLSelectElement).value).toBe('u:plex-12345678');
    expect(document.querySelector('optgroup[label="' + en('app.font.group.part') + '"] option')!.textContent).toBe('Plex Sans');
    expect(document.querySelector('[data-note="subset"]')).toBeNull();
  });

  it('says when the file holds only a subset of the font', () => {
    panel(api({ describe: () => ({ family: 'Big', subset: true }) }), { ...fields, font: 'big-12345678' });
    expect(document.querySelector('[data-note="subset"]')!.textContent).toBe(en('app.font.subsetNote'));
  });

  it('Add font file: the chosen file goes to the host; kernel warnings and errors are shown briefly', async () => {
    const a = api({ pickFile: vi.fn(async () => ok('x', [{ code: 'fontKerningIgnored', detail: '' }, { code: 'fontOverlappingContours', detail: '' }, { code: 'somethingElse', detail: '' }])) });
    panel(a);
    fireEvent.click(document.querySelector('[data-act="add-font"]')!);
    const input = screen.getByTestId('font-file') as HTMLInputElement;
    expect(input.accept).toBe('.ttf,.otf,.ttc');
    const file = new File([new Uint8Array([0, 1, 0, 0])], 'Mine.ttf');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(a.pickFile).toHaveBeenCalledWith(file));
    await waitFor(() => expect(document.querySelectorAll('[data-note="font-warn"]')).toHaveLength(2));
    expect(screen.getByText(en('app.font.warn.fontKerningIgnored'))).toBeTruthy();
    expect(screen.getByText(en('app.font.warn.fontOverlappingContours'))).toBeTruthy();
  });

  it('a refused file (WOFF) gives a short fontBadData message and changes nothing', async () => {
    const a = api({ pickFile: vi.fn(async () => ({ ok: false as const, code: 'fontBadData', detail: 'WOFF fonts are not supported' })) });
    panel(a);
    fireEvent.change(screen.getByTestId('font-file'), { target: { files: [new File([new Uint8Array([0x77, 0x4f, 0x46, 0x46])], 'x.woff')] } });
    await waitFor(() => expect(document.querySelector('[data-note="font-err"]')).toBeTruthy());
    expect(document.querySelector('[data-note="font-err"]')!.textContent).toContain('WOFF');
  });

  it('without the Local Font Access API the system button is hidden and a one-line reason shown', () => {
    panel(api({ localFonts: null }));
    expect(document.querySelector('[data-act="system-fonts"]')).toBeNull();
    expect(document.querySelector('[data-note="system-unsupported"]')!.textContent).toBe(en('app.font.system.unsupported'));
  });

  it('System fonts: asks only on click, lists with a filter, and picks one', async () => {
    const list = vi.fn(async () => [face('Verdana', 'Verdana Bold'), face('Arial'), face('Arial', 'Arial Narrow')]);
    const a = api({ localFonts: list });
    panel(a);
    expect(list).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-act="system-fonts"]')!);
    await waitFor(() => expect(screen.getByTestId('system-fonts')).toBeTruthy());
    expect(list).toHaveBeenCalledTimes(1);
    const items = () => [...document.querySelectorAll('.tp-sysitem')].map((x) => x.textContent);
    expect(items()).toEqual(['Arial', 'Arial Narrow', 'Verdana Bold']);
    fireEvent.input(screen.getByLabelText(en('app.font.system.filter')), { target: { value: 'narrow' } });
    expect(items()).toEqual(['Arial Narrow']);
    fireEvent.input(screen.getByLabelText(en('app.font.system.filter')), { target: { value: 'zzz' } });
    expect(screen.getByText(en('app.font.system.none'))).toBeTruthy();
    fireEvent.input(screen.getByLabelText(en('app.font.system.filter')), { target: { value: 'narrow' } });
    fireEvent.click(document.querySelector('.tp-sysitem')!);
    await waitFor(() => expect(a.pickLocal).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Arial Narrow' })));
    expect(screen.queryByTestId('system-fonts')).toBeNull();
  });

  it('a refused permission is reported, not thrown', async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    panel(api({ localFonts: async () => { throw denied; } }));
    fireEvent.click(document.querySelector('[data-act="system-fonts"]')!);
    await waitFor(() => expect(screen.getByText(en('app.font.system.denied'))).toBeTruthy());
    expect(screen.queryByTestId('system-fonts')).toBeNull();
  });

  it('every key it uses is in the English catalogue', () => {
    for (const k of ['group.builtin', 'group.library', 'group.part', 'role.sans', 'role.serif', 'role.mono', 'role.script', 'role.display', 'role.condensed', 'role.slab', 'addFile', 'fileLabel', 'system', 'system.unsupported', 'system.filter', 'system.none', 'system.close', 'system.denied',
      'system.failed', 'system.more', 'loading', 'licenceNote', 'curatedLicence', 'subsetNote', 'loadFailed', 'err.fontBadData', 'err.fontTooLarge', 'err.fontTooMany', 'err.fontReserved', 'err.fontBadName', 'err.fontNameConflict', 'err.fontFetch', 'err.fontChecksum', 'err.fontUnknown', 'err.noKernel', 'err.Other',
      'warn.fontKerningIgnored', 'warn.fontLigaturesIgnored', 'warn.fontVariableDefaultOnly', 'warn.fontCollectionFirstFace', 'warn.fontOverlappingContours', 'warn.fontEmbeddingRestricted', 'warn.fontNoSubsetting', 'warn.fontNoLatin', 'warn.fontCffApproximated', 'warn.fontNoCapHeight']) expect(en('app.font.' + k), k).not.toBe('undefined');
    for (const r of new Set(manifest.map((m) => m.role))) expect(en('app.font.role.' + r), r).not.toBe('undefined');
  });
});
