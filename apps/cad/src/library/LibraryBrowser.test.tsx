// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import '../i18n';
import { CatalogGhost, CatalogPanel } from '../catalog/CatalogPanel';
import { boslValues, paramsOf } from '../catalog/bosl/state';
import { BOSL_ENTRIES } from '../catalog/bosl/entries';
import { catalogItem } from '../catalog/shapes';
import { catalogTab, ghost, libFetching } from '../catalog/state';
import type { LibraryActions } from './LibraryBrowser';
import { libCategory, libQuery, libSelected, libSource } from './state';
import { FIXTURE_DIR, fakeNet, makeRegistry, memoryKV } from './testkit';

const BASE = 'https://example.com/libs/';
const ID = BASE + 'library.json';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

beforeEach(() => {
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:test');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); libSelected.value = null; libQuery.value = ''; libCategory.value = 'all'; libSource.value = 'all'; catalogTab.value = 'primitives'; boslValues.value = {}; });

/** The app's bundled samples (two parts: one with an image, one whose image is missing) plus one add-on library (three parts, no images). */
async function world() {
  const net = fakeNet(['/app/samples/', BASE]);
  net.override('index.json', JSON.stringify([
    { id: 'bench-bolt', title: 'Bolt', file: 'bench-bolt.ckpart' },
    { id: 'bench-cuboid-bracket', title: 'Cuboid bracket', file: 'bench-cuboid-bracket.ckpart' },
  ]));
  net.override('thumbs/bench-bolt.webp', WEBP);
  const block = readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart');
  net.override('bench-bolt.ckpart', block);
  net.override('bench-cuboid-bracket.ckpart', block);
  const { registry } = makeRegistry(net, { kv: memoryKV(), defaults: [{ id: 'samples', name: 'Bundled samples', source: 'bundled:samples', licence: 'LicenseRef-bundled' }] });
  await registry.add(await registry.preview(ID), { confirm: true });
  const actions = { insert: vi.fn(async () => true), openNew: vi.fn(), download: vi.fn(), sources: vi.fn(() => []) } satisfies LibraryActions;
  const p = { onItemDown: vi.fn(), onItemKey: vi.fn(), notify: vi.fn() };
  const ui = (extra: { renderThumb?: (d: unknown) => Promise<Uint8Array | null> } = {}) => render(
    <CatalogPanel hasDoc={true} hasSolid={true} onItemDown={p.onItemDown} onItemKey={p.onItemKey} library={{ registry, actions, notify: p.notify, ...(extra as object) }} />);
  const open = async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Libraries' }));
    await waitFor(() => expect(document.querySelector('[data-part="block-small"]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('[data-part="bench-bolt"]')).toBeTruthy());
  };
  return { net, registry, actions, p, ui, open };
}
const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.lib-item')];
const ids = (): string[] => cards().map((c) => c.dataset.part!);

describe('Catalog tab switch', () => {
  it('Primitives is the shape list unchanged; Libraries holds everything else', async () => {
    const w = await world();
    w.ui();
    expect(screen.getByRole('tab', { name: 'Primitives' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('catalog-add')).toBeTruthy();
    expect(screen.queryByTestId('library-section')).toBeNull();
    expect(screen.queryByTestId('bosl-section')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Libraries' }));
    expect(screen.getByTestId('library-section')).toBeTruthy();
    expect(screen.queryByTestId('catalog-add')).toBeNull();
    expect(screen.getByTestId('place-row')).toBeTruthy();     // Place on / Direction applies to library parts too
    fireEvent.click(screen.getByRole('tab', { name: 'Primitives' }));
    expect(screen.getByTestId('catalog-add')).toBeTruthy();
    fireEvent.pointerDown(document.querySelector('[data-item="add-block"]')!, { button: 0 });
    expect(w.p.onItemDown.mock.calls[0][0].id).toBe('add-block');
  });
});

describe('the one list', () => {
  it('lists BOSL2, the samples and the add-on together, each marked Included or Add-on', async () => {
    const w = await world();
    w.ui(); await w.open();
    expect(cards()).toHaveLength(BOSL_ENTRIES.length + 2 + 3);
    const origin = (sel: string) => document.querySelector(sel + ' .lib-origin')!.textContent;
    expect(origin('[data-item="bosl:cuboid"]')).toBe('Included');
    expect(origin('[data-part="bench-bolt"]')).toBe('Included');
    expect(origin('[data-part="block-small"]')).toBe('Add-on');
    // every card looks the same: a picture (or its placeholder), a name, a mark
    for (const c of cards()) { expect(c.querySelector('img, [data-testid="lib-placeholder"]'), c.dataset.part).toBeTruthy(); expect(c.querySelector('.cat-name')!.textContent).toBeTruthy(); }
    // no separate BOSL2 or Libraries sections any more
    expect(document.querySelectorAll('[data-testid="library-section"]')).toHaveLength(1);
    expect(screen.queryByText('Parts library (BOSL2)')).toBeNull();
  });

  it('source chips and the category filter narrow the list', async () => {
    const w = await world();
    w.ui(); await w.open();
    fireEvent.click(screen.getByRole('tab', { name: 'Add-ons' }));
    expect(ids()).toEqual(['block-small', 'block-wide', 'plate-gpl']);
    fireEvent.click(screen.getByRole('tab', { name: 'Included' }));
    expect(cards().every((c) => c.dataset.origin === 'included')).toBe(true);
    expect(cards()).toHaveLength(BOSL_ENTRIES.length + 2);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'other' } });   // 'plates' has one part: categories under 3 parts fold into Other
    expect(ids()).toContain('plate-gpl');
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'round' } });
    expect(ids().sort()).toEqual(['spheroid', 'torus']);       // BOSL2's own categories sit in the same filter
  });

  it('one search box covers every library', async () => {
    const w = await world();
    w.ui(); await w.open();
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'cuboid' } });
    expect(ids()).toContain('cuboid');                            // BOSL2
    expect(ids()).toContain('bench-cuboid-bracket');              // a bundled sample
    expect(ids()[0]).toBe('cuboid');                              // best BOSL2 match first
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'cube' } });   // a tag of the add-on's small block
    expect(ids()).toContain('block-small');
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No parts match.')).toBeTruthy();
  });

  it('a click selects: a BOSL2 entry shows its parameter form, a library part its details', async () => {
    const w = await world();
    w.ui(); await w.open();
    fireEvent.pointerDown(document.querySelector('[data-item="bosl:cuboid"]')!, { button: 0 });
    expect(w.p.onItemDown.mock.calls[0][0].bosl.entryId).toBe('cuboid');
    expect(screen.getByTestId('bosl-form')).toBeTruthy();
    const x = document.querySelector('#bosl-cuboid-x') as HTMLInputElement;
    fireEvent.input(x, { target: { value: '55' } });
    expect(paramsOf('cuboid').x).toBe(55);
    expect(catalogItem('bosl:cuboid')!.bosl!.params.x).toBe(55);
    fireEvent.pointerDown(document.querySelector('[data-part="block-small"]')!, { button: 0 });
    expect(screen.queryByTestId('bosl-form')).toBeNull();
    expect(screen.getByTestId('lib-licence').textContent).toBe('CC0-1.0');
    expect(screen.getByTestId('lib-detail').textContent).toContain('Fixture parts');
  });
});

describe('every card has an image', () => {
  it('shows the image a part lists, and a placeholder with the category icon when there is none', async () => {
    const w = await world();
    w.ui(); await w.open();
    await waitFor(() => expect(document.querySelector('[data-part="bench-bolt"] img')).toBeTruthy());
    expect(document.querySelector('[data-item="bosl:cuboid"] img')).toBeTruthy();
    const ph = document.querySelector('[data-part="block-small"] [data-testid="lib-placeholder"]')!;
    expect(ph.querySelector('svg')).toBeTruthy();
    expect(document.querySelector('[data-part="bench-cuboid-bracket"] [data-testid="lib-placeholder"]')).toBeTruthy();   // its listed image is missing
  });

  it('an installed part without an image gets one rendered here, kept with the part', async () => {
    const w = await world();
    const render = vi.fn(async () => PNG);
    w.ui({ renderThumb: render }); await w.open();
    // an Included part without an image is on this device already: it gets its picture; the add-on part is not installed yet, so nothing is built for it
    await waitFor(() => expect(document.querySelector('[data-part="bench-cuboid-bracket"] img')).toBeTruthy());
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-part="block-small"] [data-testid="lib-placeholder"]')).toBeTruthy();
    await w.registry.install(ID, 'block-small');
    await waitFor(() => expect(document.querySelector('[data-part="block-small"] img')).toBeTruthy());
    expect(render).toHaveBeenCalledTimes(2);
    expect(await w.registry.generatedThumb(ID, 'block-small')).toEqual(PNG);
    expect(document.querySelector('[data-part="block-wide"] [data-testid="lib-placeholder"]')).toBeTruthy();
  });
});

describe('Install', () => {
  it('a remote part shows a cloud badge and an Install button; Install downloads it and the badge reads Installed', async () => {
    const w = await world();
    w.ui(); await w.open();
    const card = document.querySelector('[data-part="block-small"]')!.closest('.lib-card') as HTMLElement;
    await waitFor(() => expect(card.querySelector('.lib-state')?.getAttribute('data-state')).toBe('cloud'));
    const before = w.net.calls.filter((u) => u.endsWith('block-small.ckpart')).length;
    expect(before).toBe(0);
    fireEvent.click(within(card).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(card.querySelector('.lib-state')?.getAttribute('data-state')).toBe('installed'));
    expect(within(card).queryByRole('button', { name: 'Install' })).toBeNull();
    expect(card.querySelector('.lib-state')!.textContent).toBe('Installed');
    expect(w.net.calls.filter((u) => u.endsWith('block-small.ckpart'))).toHaveLength(1);
    expect(await w.registry.isInstalled(ID, 'block-small')).toBe(true);
    // Included parts and BOSL2 are part of the app: no badge, no button
    expect(document.querySelector('[data-part="bench-bolt"]')!.querySelector('.lib-state')).toBeNull();
    expect(document.querySelector('[data-item="bosl:cuboid"]')!.closest('.lib-card')!.querySelector('.lib-install')).toBeNull();
  });

  it('a part under a licence that was not confirmed asks first', async () => {
    const w = await world();
    w.ui(); await w.open();
    const card = document.querySelector('[data-part="plate-gpl"]')!.closest('.lib-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Install' }));
    expect(await screen.findByTestId('lib-confirm')).toBeTruthy();
    expect(await w.registry.isInstalled(ID, 'plate-gpl')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(card.querySelector('.lib-state')?.getAttribute('data-state')).toBe('installed'));
  });
});

describe('dragging', () => {
  it('pressing a library card hands its catalog item to the drag, installed or not', async () => {
    const w = await world();
    w.ui(); await w.open();
    fireEvent.pointerDown(document.querySelector('[data-part="block-small"]')!, { button: 0 });   // not installed
    fireEvent.pointerDown(document.querySelector('[data-part="bench-bolt"]')!, { button: 0 });    // bundled
    const [a, b] = w.p.onItemDown.mock.calls.map((c) => c[0]);
    expect(a).toMatchObject({ part: { libId: ID, partId: 'block-small', title: 'Small block' }, op: 'add' });
    expect(b).toMatchObject({ part: { libId: 'samples', partId: 'bench-bolt' } });
    expect(catalogItem(a.id)).toMatchObject({ id: a.id, part: a.part });                                                         // registered: the ghost and the placer find it
    fireEvent.keyDown(document.querySelector('[data-part="block-wide"]')!, { key: 'Enter' });
    expect(w.p.onItemKey).toHaveBeenCalledTimes(1);
    expect(w.net.calls.some((u) => u.endsWith('.ckpart'))).toBe(false);                           // nothing is downloaded until it is used
  });
});

describe('fetching on drop', () => {
  it('a spinner with the part\'s name shows while it is fetched, even after the pointer was released (no ghost)', () => {
    libFetching.value = null; ghost.value = null;
    const { container } = render(<CatalogGhost />);
    expect(container.querySelector('[data-testid="lib-fetching"]')).toBeNull();
    libFetching.value = 'Small block';
    const r = render(<CatalogGhost />);
    const chip = r.getAllByTestId('lib-fetching')[0];
    expect(chip.textContent).toContain('Fetching Small block');
    expect(chip.querySelector('.cat-spin')).toBeTruthy();
    libFetching.value = null;
  });
});

describe('managing libraries and adding one', () => {
  it('lists every library with its mark, and refresh / remove for add-ons only', async () => {
    const w = await world();
    w.ui(); await w.open();
    const rows = [...document.querySelectorAll<HTMLElement>('.lib-row')];
    expect(rows.map((r) => [r.dataset.lib, r.dataset.origin])).toEqual([['bosl2', 'included'], ['samples', 'included'], [ID, 'addon']]);
    expect(within(rows[0]).queryByRole('button')).toBeNull();
    expect(within(rows[2]).getByRole('button', { name: 'Refresh' })).toBeTruthy();
    fireEvent.click(within(rows[2]).getByRole('button', { name: /^Remove library/ }));
    await waitFor(() => expect(w.registry.list().map((l) => l.id)).toEqual(['samples']));
    await waitFor(() => expect(document.querySelector('[data-part="block-small"]')).toBeNull());
    expect(document.querySelector('[data-part="bench-bolt"]')).toBeTruthy();
  });

  it('shows the offline badge when the list comes from the device', async () => {
    const w = await world();
    w.ui(); await w.open();
    w.net.offline = true;
    fireEvent.click(within(document.querySelector(`.lib-row[data-lib="${ID}"]`) as HTMLElement).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('lib-offline')).toBeTruthy());
    expect(document.querySelector('[data-part="block-small"]')).toBeTruthy();
  });

  it('+ Add library: the preview says how many parts have no image; a GPL library needs the box ticked; manifest text stays text', async () => {
    const net = fakeNet([BASE]);
    const m = JSON.parse(readFileSync(FIXTURE_DIR + '/library.json', 'utf8'));
    m.licence = 'GPL-3.0'; m.name = '<img src=x onerror=alert(1)>'; for (const p of m.parts) delete p.licence;
    m.parts[0].thumb = 'thumbs/a.png';
    net.override('library.json', JSON.stringify(m));
    const { registry } = makeRegistry(net);
    const actions = { insert: vi.fn(), openNew: vi.fn(), download: vi.fn(), sources: () => [] } satisfies LibraryActions;
    render(<CatalogPanel hasDoc={true} hasSolid={true} onItemDown={vi.fn()} onItemKey={vi.fn()} library={{ registry, actions }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Libraries' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add library' }));
    fireEvent.input(screen.getByPlaceholderText('github:owner/repo'), { target: { value: ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await waitFor(() => expect(screen.getByTestId('lib-found')).toBeTruthy());
    expect(screen.getByTestId('lib-found').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(screen.getByTestId('lib-nothumbs').textContent).toContain('2 of 3 parts have no image');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('GPL-3.0');
    const add = screen.getByRole('button', { name: 'Add library' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
    fireEvent.click(add);
    await waitFor(() => expect(registry.list()).toHaveLength(1));
    expect(registry.needsConfirm(ID, 'GPL-3.0')).toBe(false);
    await waitFor(() => expect(document.querySelectorAll('.lib-item[data-origin="addon"]')).toHaveLength(3));   // shown as Add-ons straight away
  });
});

describe('part details', () => {
  it('runs Insert, Open as new document and Download on the fetched part; Insert is off without a document', async () => {
    const w = await world();
    w.ui(); await w.open();
    fireEvent.pointerDown(document.querySelector('[data-part="block-small"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(w.actions.insert).toHaveBeenCalledTimes(1));
    expect((w.actions.insert.mock.calls[0] as unknown as [{ part: { id: string } }])[0].part.id).toBe('block-small');
    fireEvent.click(screen.getByRole('button', { name: 'Open as new document' }));
    await waitFor(() => expect(w.actions.openNew).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(w.actions.download).toHaveBeenCalledTimes(1));
  });

  it('a refused checksum is shown as an error and nothing is inserted', async () => {
    const w = await world();
    w.net.override('parts/block-wide.ckpart', readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart'));
    w.ui(); await w.open();
    fireEvent.pointerDown(document.querySelector('[data-part="block-wide"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/size|checksum/));
    expect(w.actions.insert).not.toHaveBeenCalled();
  });

  it('lists the sources recorded in the document', async () => {
    const w = await world();
    w.actions.sources.mockReturnValue([{ library: 'Fixture parts', libraryId: ID, part: 'Small block', partId: 'block-small', ref: '', sha256: 'a', licence: 'CC0-1.0', features: ['F1'], variablePrefix: 'p_1_', at: 1 }] as never);
    w.ui(); await w.open();
    expect(screen.getByTestId('lib-sources').textContent).toContain('Small block from Fixture parts, licence CC0-1.0');
  });
});
