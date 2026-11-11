// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import '../i18n';
import { LibraryDialog } from '../LibraryDialog';
import { CatalogPanel } from '../catalog/CatalogPanel';
import { catalogTab } from '../catalog/state';
import { libCategory, libQuery, libSelected, libSource, libTags } from './state';
import { FIXTURE_DIR, fakeNet, makeRegistry, memoryKV } from './testkit';

const BASE = 'https://example.com/libs/';
const ID = BASE + 'library.json';

beforeEach(() => {
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:test');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  localStorage.clear();
});
afterEach(() => { cleanup(); libSelected.value = null; libQuery.value = ''; libCategory.value = 'all'; libTags.value = []; libSource.value = 'all'; catalogTab.value = 'primitives'; localStorage.clear(); });

/** Bundled samples: 4 fasteners, 3 printing, 3 pipes (the pipes' tags cover more than 12 tags in total) and one lonely mechanism. */
const SAMPLES = [
  ...['bolt', 'screw', 'nut', 'washer'].map((n) => ({ id: 's-' + n, title: n[0].toUpperCase() + n.slice(1), file: `s-${n}.ckpart`, category: 'fasteners', tags: [n, 'threaded'] })),
  ...['A', 'B', 'C'].map((n) => ({ id: 'p-' + n, title: 'Print ' + n, file: `p-${n}.ckpart`, category: 'printing', tags: ['printable', 'clip'] })),
  ...[1, 2, 3].map((n) => ({ id: 'pipe-' + n, title: 'Pipe ' + n, file: `pipe-${n}.ckpart`, category: 'pipe-fluid', tags: n === 1 ? ['pipe', 't1', 't2', 't3', 't4', 't5'] : n === 2 ? ['pipe', 't6', 't7', 't8', 't9', 't10'] : ['pipe', 't11', 't12', 't13', 't14', 't15'] })),
  { id: 'lonely', title: 'Lonely hinge', file: 'lonely.ckpart', category: 'mechanisms', tags: ['hinge'] },
];

async function world() {
  const net = fakeNet(['/app/samples/', BASE]);
  net.override('index.json', JSON.stringify(SAMPLES));
  const block = readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart');
  for (const s of SAMPLES) net.override(s.file, block);
  const { registry } = makeRegistry(net, { kv: memoryKV(), defaults: [{ id: 'samples', name: 'Bundled samples', source: 'bundled:samples', licence: 'LicenseRef-bundled' }] });
  await registry.add(await registry.preview(ID), { confirm: true });
  return registry;
}
const sel = (name: string): HTMLSelectElement => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const optionTexts = (): string[] => [...sel('Category').options].map((o) => o.textContent!);
const chips = (): string[] => [...document.querySelectorAll<HTMLElement>('.lf-chip')].map((c) => c.dataset.tag!);

describe('the filter bar in the Catalog Libraries tab', () => {
  const open = async (extra: { hasDoc?: boolean; onScrew?: () => void; onBearing?: () => void } = {}) => {
    const registry = await world();
    const actions = { insert: vi.fn(async () => true), openNew: vi.fn(), download: vi.fn(), sources: vi.fn(() => []) };
    render(<CatalogPanel hasDoc={extra.hasDoc ?? true} hasSolid={true} onItemDown={vi.fn()} onItemKey={vi.fn()} onScrew={extra.onScrew} onBearing={extra.onBearing} library={{ registry, actions, notify: vi.fn() }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Libraries' }));
    await waitFor(() => expect(document.querySelector('.lib-item[data-part="s-bolt"]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('.lib-item[data-part="block-small"]')).toBeTruthy());
  };
  const parts = (): string[] => [...document.querySelectorAll<HTMLElement>('.lib-item')].map((c) => c.dataset.part!);

  it('has the search box, source chips, the category list with counts, and the tag chips', async () => {
    await open();
    const bar = screen.getByTestId('lib-filterbar');
    expect(bar.querySelector('input[type=search]')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(expect.arrayContaining(['All', 'Included', 'Add-ons']));
    expect(optionTexts()).toEqual(expect.arrayContaining(['Fasteners (4)', '3D printing (3)', 'Pipe & fluid (3)']));
    expect(optionTexts().some((x) => x.startsWith('Mechanisms'))).toBe(false);   // one part: folded into Other
    expect(optionTexts().some((x) => x.startsWith('Other ('))).toBe(true);
    expect(chips().length).toBeGreaterThan(0);
  });
  it('a category narrows the list and the tag chips; two tags combine with AND; counts follow the other filters', async () => {
    await open();
    fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
    expect(parts().sort()).toEqual(['s-bolt', 's-nut', 's-screw', 's-washer']);
    expect(chips()).toEqual(['threaded', 'bolt', 'nut', 'screw', 'washer']);
    expect(document.querySelector('[data-tag="threaded"] .lf-n')!.textContent).toBe('4');
    fireEvent.click(document.querySelector('[data-tag="threaded"]')!);
    fireEvent.click(document.querySelector('[data-tag="nut"]')!);
    expect(parts()).toEqual(['s-nut']);
    expect(document.querySelector('[data-tag="threaded"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(optionTexts()).toContain('Fasteners (1)');   // the count reflects the tags
    expect(optionTexts()).toContain('All (1)');
    fireEvent.click(document.querySelector('[data-tag="nut"]')!);   // click again to remove
    expect(parts().sort()).toEqual(['s-bolt', 's-nut', 's-screw', 's-washer']);
  });
  it('Clear filters resets the search, category and tags', async () => {
    await open();
    expect(screen.queryByTestId('lib-clear')).toBeNull();
    fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
    fireEvent.click(document.querySelector('[data-tag="bolt"]')!);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'bol' } });
    fireEvent.click(screen.getByTestId('lib-clear'));
    expect(sel('Category').value).toBe('all');
    expect(libTags.value).toEqual([]);
    expect(libQuery.value).toBe('');
    expect(parts()).toContain('s-nut');
    expect(screen.queryByTestId('lib-clear')).toBeNull();
  });
  it('shows the top tags and collapses the rest behind a More control', async () => {
    await open();
    fireEvent.change(sel('Category'), { target: { value: 'pipe-fluid' } });
    expect(chips()).toHaveLength(12);
    fireEvent.click(screen.getByTestId('lib-tags-more'));
    expect(chips()).toHaveLength(16);   // pipe + t1..t15
    fireEvent.click(screen.getByTestId('lib-tags-more'));
    expect(chips()).toHaveLength(12);
  });
  it('search finds a part by its tag and by the core category label', async () => {
    await open();
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'printable' } });
    expect(parts().filter((p) => p.startsWith('p-')).sort()).toEqual(['p-A', 'p-B', 'p-C']);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'fasteners' } });
    expect(parts().filter((p) => p.startsWith('s-'))).toHaveLength(4);
  });
  it('remembers the category and tags on this device, and starts clean without storage', async () => {
    await open();
    fireEvent.change(sel('Category'), { target: { value: 'printing' } });
    fireEvent.click(document.querySelector('[data-tag="clip"]')!);
    expect(JSON.parse(localStorage.getItem('ck.library.filter.catalog')!)).toEqual({ category: 'printing', tags: ['clip'] });
    fireEvent.click(screen.getByTestId('lib-clear'));
    expect(localStorage.getItem('ck.library.filter.catalog')).toBeNull();
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    vi.stubGlobal('localStorage', broken);
    try {
      fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
      expect(parts().sort()).toEqual(['s-bolt', 's-nut', 's-screw', 's-washer']);   // still filters
    } finally { vi.unstubAllGlobals(); }
  });
  it('offers the Screw wizard link in Fasteners (with a document open) and nowhere else', async () => {
    const onScrew = vi.fn();
    await open({ onScrew });
    expect(document.querySelector('[data-wizard]')).toBeNull();
    fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
    const link = document.querySelector('[data-wizard="screw"]') as HTMLElement;
    expect(link.textContent).toBe('Make one with the Screw wizard');
    fireEvent.click(link);
    expect(onScrew).toHaveBeenCalledTimes(1);
    fireEvent.change(sel('Category'), { target: { value: 'printing' } });
    expect(document.querySelector('[data-wizard]')).toBeNull();
  });
  it('shows no wizard link when the app gives no opener', async () => {
    await open();
    fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
    expect(document.querySelector('[data-wizard]')).toBeNull();
  });
});

describe('the same filter bar in the top-bar Library picker', () => {
  const samples = SAMPLES.map((s) => ({ id: s.id, title: s.title, url: `/app/samples/${s.file}`, category: s.category, tags: s.tags }));
  const open = async (extra: { onWizard?: (id: string) => void; canInsert?: boolean; ready?: string } = {}) => {
    const registry = await world();
    render(<LibraryDialog samples={samples} thumbBase="/app/" registry={registry} onPick={vi.fn()} onClose={() => {}} onOpenPart={vi.fn()} canInsert={extra.canInsert ?? true} onInsertPart={vi.fn()} onWizard={extra.onWizard as never} />);
    await waitFor(() => expect(document.querySelector(extra.ready ?? '.dlg-item[data-part="block-small"]')).toBeTruthy());
  };
  const items = (): string[] => [...document.querySelectorAll<HTMLElement>('.dlg-item')].map((c) => c.textContent!);

  it('has the search, category list with counts and tag chips, and no source chips', async () => {
    await open();
    expect(screen.getByTestId('lib-filterbar')).toBeTruthy();
    expect(screen.getByPlaceholderText('Filter parts')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(optionTexts()).toEqual(expect.arrayContaining(['Fasteners (4)', '3D printing (3)', 'Pipe & fluid (3)']));
  });
  it('narrows by category and combines two tags', async () => {
    await open();
    fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
    expect(items().sort()).toEqual(['Bolt', 'Nut', 'Screw', 'Washer']);
    expect(document.querySelector('.dlg-group[data-lib="' + ID + '"]')).toBeNull();   // the add-on group has no parts left, so it is hidden
    fireEvent.click(document.querySelector('[data-tag="threaded"]')!);
    fireEvent.click(document.querySelector('[data-tag="washer"]')!);
    expect(items()).toEqual(['Washer']);
    expect(chips()).toEqual(['threaded', 'washer']);
  });
  it('remembers the last category and tags, and Clear filters forgets them', async () => {
    await open();
    fireEvent.change(sel('Category'), { target: { value: 'printing' } });
    fireEvent.click(document.querySelector('[data-tag="clip"]')!);
    expect(JSON.parse(localStorage.getItem('ck.library.filter.picker')!)).toEqual({ category: 'printing', tags: ['clip'] });
    expect(localStorage.getItem('ck.library.filter.catalog')).toBeNull();   // per surface
    cleanup();
    await open({ ready: '[data-tag="clip"]' });
    expect(sel('Category').value).toBe('printing');
    expect(items().sort()).toEqual(['Print A', 'Print B', 'Print C']);
    expect(document.querySelector('[data-tag="clip"]')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('lib-clear'));
    expect(localStorage.getItem('ck.library.filter.picker')).toBeNull();
    expect(items()).toContain('Bolt');
  });
  it('ignores a remembered category that no longer exists', async () => {
    localStorage.setItem('ck.library.filter.picker', JSON.stringify({ category: 'vanished', tags: ['gone'] }));
    await open();
    expect(sel('Category').value).toBe('all');
    expect(items()).toContain('Bolt');
  });
  it('opens the Screw wizard from the Fasteners link', async () => {
    const onWizard = vi.fn();
    await open({ onWizard });
    fireEvent.change(sel('Category'), { target: { value: 'fasteners' } });
    fireEvent.click(document.querySelector('[data-wizard="screw"]')!);
    expect(onWizard).toHaveBeenCalledWith('screw');
  });
  it('shows a hint when nothing matches', async () => {
    await open();
    fireEvent.input(screen.getByPlaceholderText('Filter parts'), { target: { value: 'zzzzqq' } });
    expect(screen.getByText('No parts match.')).toBeTruthy();
  });
});
