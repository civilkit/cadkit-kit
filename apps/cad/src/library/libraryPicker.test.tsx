// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import '../i18n';
import { LibraryDialog } from '../LibraryDialog';
import { CatalogPanel } from '../catalog/CatalogPanel';
import { catalogTab } from '../catalog/state';
import { docHash, bytesToBase64 } from '../files/docThumb';
import { libCategory, libQuery, libSelected, libSource } from './state';
import { FIXTURE_DIR, fakeNet, makeRegistry, memoryKV } from './testkit';

const BASE = 'https://example.com/libs/';
const ID = BASE + 'library.json';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeEach(() => {
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:test');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); libSelected.value = null; libQuery.value = ''; libCategory.value = 'all'; libSource.value = 'all'; catalogTab.value = 'primitives'; });

async function world() {
  const net = fakeNet(['/app/samples/', BASE]);
  const { registry, cache } = makeRegistry(net, { kv: memoryKV(), defaults: [{ id: 'samples', name: 'Bundled samples', source: 'bundled:samples', licence: 'LicenseRef-bundled' }] });
  await registry.add(await registry.preview(ID), { confirm: true });
  const samples = [{ id: 'bolt', title: 'Bolt', url: '/app/samples/bolt.ckpart' }];
  const onOpenPart = vi.fn(); const onPick = vi.fn();
  const ui = () => render(<LibraryDialog samples={samples} thumbBase="/app/" registry={registry} onPick={onPick} onClose={() => {}} onOpenPart={onOpenPart} />);
  return { registry, cache, ui, onOpenPart, onPick };
}

describe('Library picker', () => {
  it('is named Library and groups the bundled samples and each added library', async () => {
    const w = await world(); w.ui();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Library');
    await waitFor(() => expect(document.querySelector('[data-lib="' + ID + '"] [data-part="block-small"]')).toBeTruthy());
    const groups = [...document.querySelectorAll('.dlg-group')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Bundled samples', 'Fixture parts']);
    expect(within(document.querySelector('[data-lib="samples"]') as HTMLElement).getByText('Bolt')).toBeTruthy();
  });
  it('the filter covers every library', async () => {
    const w = await world(); w.ui();
    await waitFor(() => expect(document.querySelector('[data-part="block-small"]')).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText('Filter parts'), { target: { value: 'wide' } });
    expect([...document.querySelectorAll('.dlg-item')].map((c) => c.getAttribute('data-part'))).toEqual(['block-wide']);
    fireEvent.input(screen.getByPlaceholderText('Filter parts'), { target: { value: '' } });
  });
  it('picking a library part opens it as a new document; a sample goes through onPick', async () => {
    const w = await world(); w.ui();
    await waitFor(() => expect(document.querySelector('[data-part="block-small"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-part="block-small"]')!);
    await waitFor(() => expect(w.onOpenPart).toHaveBeenCalled());
    expect(w.onOpenPart.mock.calls[0][0].part.id).toBe('block-small');
    expect(w.onOpenPart.mock.calls[0][1].id).toBe(ID);
    fireEvent.click(screen.getByText('Bolt'));
    expect(w.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'bolt' }));
  });
  it('Insert into this part hands the entry to onInsertPart and leaves Open as the card click', async () => {
    const w = await world();
    const onInsertPart = vi.fn();
    render(<LibraryDialog samples={[{ id: 'bolt', title: 'Bolt', url: '/app/samples/bolt.ckpart' }]} thumbBase="/app/" registry={w.registry} onPick={w.onPick} onClose={() => {}} onOpenPart={w.onOpenPart} canInsert={true} onInsertPart={onInsertPart} />);
    await waitFor(() => expect(document.querySelector('[data-insert="block-small"]')).toBeTruthy());
    const btn = document.querySelector('[data-insert="block-small"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Insert into this part');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onInsertPart).toHaveBeenCalledTimes(1);
    expect(onInsertPart.mock.calls[0][0]).toMatchObject({ libId: ID, id: 'block-small', kind: 'part' });
    expect(w.onOpenPart).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-part="block-small"]')!);
    await waitFor(() => expect(w.onOpenPart).toHaveBeenCalled());
  });
  it('Insert is disabled with no document open, and absent when the app gives no insert handler', async () => {
    const w = await world();
    const onInsertPart = vi.fn();
    const r = render(<LibraryDialog samples={[]} thumbBase="/app/" registry={w.registry} onPick={w.onPick} onClose={() => {}} onInsertPart={onInsertPart} canInsert={false} />);
    await waitFor(() => expect(document.querySelector('[data-insert="block-small"]')).toBeTruthy());
    const btn = document.querySelector('[data-insert="block-small"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Open a part to insert into it');
    fireEvent.click(btn);
    expect(onInsertPart).not.toHaveBeenCalled();
    r.unmount();
    w.ui();
    await waitFor(() => expect(document.querySelector('[data-part="block-small"]')).toBeTruthy());
    expect(document.querySelector('.dlg-insert')).toBeNull();
  });
  it('Insert on a bundled sample works once its entry is in the samples list', async () => {
    const net = fakeNet(['/app/samples/']);
    net.override('index.json', JSON.stringify([{ id: 'bench-bolt', title: 'Bolt', file: 'bench-bolt.ckpart' }]));
    const { registry } = makeRegistry(net, { kv: memoryKV(), defaults: [{ id: 'samples', name: 'Bundled samples', source: 'bundled:samples', licence: 'LicenseRef-bundled' }] });
    const sid = 'bench-bolt';
    const onInsertPart = vi.fn();
    render(<LibraryDialog samples={[{ id: sid, title: 'S', url: '/x' }]} thumbBase="/app/" registry={registry} onPick={vi.fn()} onClose={() => {}} canInsert={true} onInsertPart={onInsertPart} />);
    await waitFor(() => expect(document.querySelector('[data-lib="samples"] [data-insert]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-lib="samples"] [data-insert]')!);
    expect(onInsertPart.mock.calls[0][0]).toMatchObject({ libId: 'samples', id: sid });
  });
  it('Manage libraries disables and enables a library, which hides and shows its group, and the Catalog follows', async () => {
    const w = await world(); w.ui();
    await waitFor(() => expect(document.querySelector('[data-part="block-small"]')).toBeTruthy());
    fireEvent.click(screen.getByTestId('lib-manage-toggle'));
    const view = screen.getByTestId('lib-manage-view');
    expect(within(view).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(view).getByRole('button', { name: 'Disable: Fixture parts' }));
    expect(w.registry.enabled(ID)).toBe(false);
    expect(within(view).getByTestId('lib-disabled')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lib-manage-toggle'));
    expect(document.querySelector('[data-part="block-small"]')).toBeNull();
    expect(document.querySelector('[data-lib="samples"]')).toBeTruthy();
    // the same switch in the Catalog's Libraries tab
    cleanup();
    const actions = { insert: vi.fn(async () => true), openNew: vi.fn(), download: vi.fn(), sources: vi.fn(() => []) };
    render(<CatalogPanel hasDoc={true} hasSolid={true} onItemDown={vi.fn()} onItemKey={vi.fn()} library={{ registry: w.registry, actions, notify: vi.fn() }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Libraries' }));
    await waitFor(() => expect(document.querySelector('[data-lib="bosl2"]')).toBeTruthy());
    expect(document.querySelector('.lib-item[data-part="block-small"]')).toBeNull();
    w.registry.setEnabled(ID, true);
    await waitFor(() => expect(document.querySelector('.lib-item[data-part="block-small"]')).toBeTruthy());
  });
  it('Manage libraries removes an added library', async () => {
    const w = await world(); w.ui();
    fireEvent.click(screen.getByTestId('lib-manage-toggle'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove library: Fixture parts' }));
    await waitFor(() => expect(w.registry.list().map((l) => l.id)).toEqual(['samples']));
  });
});

describe('registry enable and disable', () => {
  it('is remembered across a reload and forgotten on removal', async () => {
    const net = fakeNet([BASE]); const kv = memoryKV();
    const a = makeRegistry(net, { kv });
    await a.registry.add(await a.registry.preview(ID), { confirm: true });
    a.registry.setEnabled(ID, false);
    const b = makeRegistry(net, { kv, cache: a.cache });
    expect(b.registry.enabled(ID)).toBe(false);
    expect(b.registry.listEnabled()).toEqual([]);
    expect(b.registry.list()).toHaveLength(1);
    await b.registry.remove(ID);
    expect(b.registry.enabled(ID)).toBe(true);
  });
});

describe('the picture a saved part carries', () => {
  const store = async (mutate: (doc: Record<string, unknown>) => void, fresh = true) => {
    const net = fakeNet([BASE]); const { registry, cache } = makeRegistry(net);
    await registry.add(await registry.preview(ID), { confirm: true });
    const m = (await registry.manifest(ID)).manifest; const part = m.parts.find((x) => x.id === 'block-small')!;
    const doc = JSON.parse(readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart', 'utf8')) as Record<string, unknown>;
    const thumbnail = { format: 'png', width: 8, height: 6, hash: fresh ? docHash(doc) : 'stale', data: bytesToBase64(PNG) };
    mutate(doc);
    await cache.put({ key: `${ID}/${part.file}#${part.sha256}`, lib: ID, kind: 'part', bytes: new TextEncoder().encode(JSON.stringify({ ...doc, thumbnail })), at: 1 });
    return registry;
  };
  it('is used for a part on this device when it still matches', async () => {
    const r = await store(() => {});
    expect(Array.from((await r.embeddedThumb(ID, 'block-small'))!)).toEqual(Array.from(PNG));
  });
  it('is ignored when stale, when the part is not saved here, and when the field is damaged', async () => {
    expect(await (await store(() => {}, false)).embeddedThumb(ID, 'block-small')).toBeNull();
    expect(await (await store((d) => { d.name = 'x'; d.features = []; })).embeddedThumb(ID, 'block-small')).toBeNull();
    const net = fakeNet([BASE]); const { registry } = makeRegistry(net);
    await registry.add(await registry.preview(ID), { confirm: true });
    expect(await registry.embeddedThumb(ID, 'block-wide')).toBeNull();
  });
});
