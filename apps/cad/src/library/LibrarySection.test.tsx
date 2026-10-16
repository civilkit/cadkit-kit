// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import '../i18n';
import { LibrarySection, type LibraryActions } from './LibrarySection';
import { libCategory, libPart, libQuery, libSelected } from './state';
import { fakeNet, makeRegistry, memoryKV } from './testkit';
import { readFileSync } from 'node:fs';
import { FIXTURE_DIR } from './testkit';

const BASE = 'https://example.com/libs/';
const ID = BASE + 'library.json';

afterEach(() => { cleanup(); libSelected.value = null; libQuery.value = ''; libCategory.value = 'all'; libPart.value = null; });

async function ready(opts: { licence?: string } = {}) {
  const net = fakeNet([BASE]);
  if (opts.licence) { const m = JSON.parse(readFileSync(FIXTURE_DIR + '/library.json', 'utf8')); m.licence = opts.licence; for (const p of m.parts) delete p.licence; net.override('library.json', JSON.stringify(m)); }
  const { registry } = makeRegistry(net, { kv: memoryKV() });
  await registry.add(await registry.preview(ID), { confirm: true });
  const actions = { insert: vi.fn(async () => true), openNew: vi.fn(), download: vi.fn(), sources: vi.fn(() => []) } satisfies LibraryActions;
  return { registry, actions, net };
}

describe('Libraries section', () => {
  it('lists the cards, filters by category and searches title and tags', async () => {
    const { registry, actions } = await ready();
    render(<LibrarySection registry={registry} hasDoc={true} actions={actions} />);
    await waitFor(() => expect(screen.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('lib-item'))).toHaveLength(3));
    fireEvent.click(screen.getByRole('tab', { name: 'plates' }));
    expect(document.querySelectorAll('.lib-item')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'cube' } });   // a tag of the small block only
    expect([...document.querySelectorAll('.lib-item')].map((e) => (e as HTMLElement).dataset.part)).toEqual(['block-small']);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No parts match.')).toBeTruthy();
  });

  it('shows the licence and runs the three actions on the downloaded part', async () => {
    const { registry, actions } = await ready();
    render(<LibrarySection registry={registry} hasDoc={true} actions={actions} />);
    await waitFor(() => expect(document.querySelectorAll('.lib-item')).toHaveLength(3));
    fireEvent.click(document.querySelector('[data-part="block-small"]')!);
    expect(screen.getByTestId('lib-licence').textContent).toBe('CC0-1.0');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(actions.insert).toHaveBeenCalledTimes(1));
    expect((actions.insert.mock.calls[0] as unknown as [{ part: { id: string } }])[0].part.id).toBe('block-small');
    fireEvent.click(screen.getByRole('button', { name: 'Open as new document' }));
    await waitFor(() => expect(actions.openNew).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(actions.download).toHaveBeenCalledTimes(1));
  });

  it('Insert is off without a document', async () => {
    const { registry, actions } = await ready();
    render(<LibrarySection registry={registry} hasDoc={false} actions={actions} />);
    await waitFor(() => expect(document.querySelectorAll('.lib-item')).toHaveLength(3));
    fireEvent.click(document.querySelector('[data-part="block-small"]')!);
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a part under another licence asks first, once; a refused checksum is shown as an error', async () => {
    const { registry, actions, net } = await ready();
    render(<LibrarySection registry={registry} hasDoc={true} actions={actions} />);
    await waitFor(() => expect(document.querySelectorAll('.lib-item')).toHaveLength(3));
    fireEvent.click(document.querySelector('[data-part="plate-gpl"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByTestId('lib-confirm').textContent).toContain('GPL-3.0-or-later');
    expect(actions.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(actions.download).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));   // no second question
    await waitFor(() => expect(actions.download).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('lib-confirm')).toBeNull();

    net.override('parts/block-wide.ckpart', readFileSync(FIXTURE_DIR + '/parts/block-small.ckpart'));
    fireEvent.click(document.querySelector('[data-part="block-wide"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/size|checksum/));
    expect(actions.insert).not.toHaveBeenCalled();
  });

  it('adding a GPL library needs the box ticked; names from a manifest are shown as text, not markup', async () => {
    const net = fakeNet([BASE]);
    const m = JSON.parse(readFileSync(FIXTURE_DIR + '/library.json', 'utf8'));
    m.licence = 'GPL-3.0'; m.name = '<img src=x onerror=alert(1)>'; for (const p of m.parts) delete p.licence;
    net.override('library.json', JSON.stringify(m));
    const { registry } = makeRegistry(net);
    const actions = { insert: vi.fn(), openNew: vi.fn(), download: vi.fn(), sources: () => [] } satisfies LibraryActions;
    render(<LibrarySection registry={registry} hasDoc={true} actions={actions} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Library' }), { target: { value: '__add' } });
    fireEvent.input(screen.getByPlaceholderText('github:owner/repo'), { target: { value: ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await waitFor(() => expect(screen.getByTestId('lib-found')).toBeTruthy());
    expect(screen.getByTestId('lib-found').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('GPL-3.0');
    const add = screen.getByRole('button', { name: 'Add library' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(registry.list()).toHaveLength(1));
    expect(registry.needsConfirm(ID, 'GPL-3.0')).toBe(false);
  });

  it('shows the offline badge when the manifest comes from the device', async () => {
    const { registry, actions, net } = await ready();
    render(<LibrarySection registry={registry} hasDoc={true} actions={actions} />);
    await waitFor(() => expect(document.querySelectorAll('.lib-item')).toHaveLength(3));
    net.offline = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('lib-offline')).toBeTruthy());
    expect(document.querySelectorAll('.lib-item')).toHaveLength(3);
  });

  it('lists the sources recorded in the document', async () => {
    const { registry } = await ready();
    const actions = { insert: vi.fn(), openNew: vi.fn(), download: vi.fn(), sources: () => [{ library: 'Fixture parts', libraryId: ID, part: 'Small block', partId: 'block-small', ref: '', sha256: 'a', licence: 'CC0-1.0', features: ['F1'], variablePrefix: 'p_1_', at: 1 }] } satisfies LibraryActions;
    render(<LibrarySection registry={registry} hasDoc={true} actions={actions} />);
    expect(screen.getByTestId('lib-sources').textContent).toContain('Small block from Fixture parts, licence CC0-1.0');
  });
});
