import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { PluginManager, PluginRegistry, memoryStore } from '@kit/plugin';
import '../i18n';
import { setThirdPartyEnabled } from '../pluginStore';
import { LibraryRegistry, type KV } from '../library/registry';
import { memoryCache } from '../library/cache';
import type { FetchLike, FetchResponse } from '../library/source';
import { HubDialog } from './HubDialog';
import { BUILTIN_HUB_INDEX, HUB_FORMAT, HUB_VERSION, HubRegistryStore, type HubIndex } from './registry';

afterEach(() => {
  cleanup();
  setThirdPartyEnabled(false);
});

function memKv(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

function jsonResp(body: unknown, status = 200): FetchResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function makeStore(fetchFn?: FetchLike): HubRegistryStore {
  return new HubRegistryStore({
    fetch: fetchFn ?? (async () => jsonResp({}, 404)),
    kv: memKv(),
  });
}

function makePluginManager(): PluginManager {
  return new PluginManager({
    registry: new PluginRegistry(),
    store: memoryStore(),
    appVersion: '0.9.0',
  });
}

describe('HubDialog', () => {
  it('renders real SolidCraft released plugins with Install buttons, Download .zip links, and SPDX badges', () => {
    const store = makeStore();
    const pm = makePluginManager();
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} pluginManager={pm} onClose={vi.fn()} />,
    );

    expect(getByTestId('hub-dialog')).toBeTruthy();
    expect(queryByTestId('hub-preview-note')).toBeNull();
    expect(getByTestId('hub-card-solidcraft-gears')).toBeTruthy();
    expect(getByTestId('hub-badge-kind-solidcraft-gears').textContent).toBe('Plugin');
    expect(getByTestId('hub-badge-license-solidcraft-gears').textContent).toBe('MIT');
    expect(getByTestId('hub-action-solidcraft-gears').textContent).toBe('Install');
    expect((getByTestId('hub-action-solidcraft-gears') as HTMLButtonElement).disabled).toBe(false);
    expect(getByTestId('hub-zip-solidcraft-gears').getAttribute('href')).toContain('solidcraft-gears-0.1.1.zip');
    expect(getByTestId('hub-card-gridfinity')).toBeTruthy();
    expect(getByTestId('hub-card-woodwork')).toBeTruthy();
  });

  it('filters by search query and tag click', () => {
    const store = makeStore();
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} onClose={vi.fn()} />,
    );

    // Search
    fireEvent.input(getByTestId('hub-search'), { target: { value: 'gridfinity' } });
    expect(queryByTestId('hub-card-gridfinity')).not.toBeNull();
    expect(queryByTestId('hub-card-woodwork')).toBeNull();

    // Clear search and click tag
    fireEvent.input(getByTestId('hub-search'), { target: { value: '' } });
    fireEvent.click(getByTestId('hub-tag-woodwork-woodworking'));
    expect(queryByTestId('hub-card-woodwork')).not.toBeNull();
    expect(queryByTestId('hub-card-solidcraft-gears')).toBeNull();
    expect(getByTestId('hub-tag-clear')).toBeTruthy();
    fireEvent.click(getByTestId('hub-tag-clear'));
    expect(queryByTestId('hub-card-solidcraft-gears')).not.toBeNull();
  });

  it('respects the "Allow plugins from other people" safety gate before fetching/installing plugins', async () => {
    setThirdPartyEnabled(false);
    const pluginFetch = vi.fn();
    const store = makeStore();
    const pm = makePluginManager();
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} pluginManager={pm} fetch={pluginFetch as never} onClose={vi.fn()} />,
    );

    fireEvent.click(getByTestId('hub-action-gridfinity'));
    expect(getByTestId('hub-plugin-gate')).toBeTruthy();
    expect(pluginFetch).not.toHaveBeenCalled();

    // Toggling the gate enables third-party plugins and hides the gate prompt
    fireEvent.click(getByTestId('hub-plugin-gate-toggle'));
    await waitFor(() => expect(queryByTestId('hub-plugin-gate')).toBeNull());
  });

  it('adds a permissive library from a custom registry via LibraryRegistry and marks it Added', async () => {
    const customHub: HubIndex = {
      format: HUB_FORMAT,
      version: HUB_VERSION,
      name: 'Fasteners Hub',
      packages: [
        {
          id: 'metric-fasteners-lib',
          name: 'ISO Metric Fasteners Library',
          kind: 'library',
          summary: 'Metric fasteners.',
          author: 'example',
          version: '1.0.0',
          license: 'MIT',
          category: 'fasteners',
          tags: ['metric'],
          source: 'github:example/metric-fasteners@v1.0.0',
        },
      ],
    };
    const manifest = {
      format: 'fwlib',
      version: 1,
      name: 'ISO Metric Fasteners Library',
      licence: 'MIT',
      parts: [
        { id: 'm3-screw', title: 'M3 Screw', category: 'fasteners', tags: ['m3'], file: 'parts/m3.ckpart', sha256: 'b'.repeat(64) },
      ],
    };
    const libFetch: FetchLike = vi.fn(async () => jsonResp(manifest));
    const libReg = new LibraryRegistry({ fetch: libFetch, cache: memoryCache(), kv: memKv(), defaults: [] });
    const store = makeStore(vi.fn(async () => jsonResp(customHub)));
    await store.addRegistry('https://parts.example.org/hub.json');
    const onAdded = vi.fn();
    const { getByTestId } = render(
      <HubDialog store={store} libraryRegistry={libReg} onLibraryAdded={onAdded} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(getByTestId('hub-action-metric-fasteners-lib')).toBeTruthy());
    fireEvent.click(getByTestId('hub-action-metric-fasteners-lib'));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(getByTestId('hub-action-metric-fasteners-lib').textContent).toBe('Added');
    expect((getByTestId('hub-action-metric-fasteners-lib') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('hub-action-ok').textContent).toContain('ISO Metric Fasteners Library');
  });

  it('adds a custom registry URL and shows an offline banner on failed refresh', async () => {
    let online = true;
    const customHub: HubIndex = {
      format: HUB_FORMAT,
      version: HUB_VERSION,
      name: 'Robotics Lab Hub',
      packages: [
        {
          ...BUILTIN_HUB_INDEX.packages[0],
          id: 'custom-gripper',
          name: 'Parallel Jaw Gripper',
          kind: 'assembly',
          author: 'robotics-lab',
        },
      ],
    };
    const mockFetch: FetchLike = vi.fn(async () => {
      if (!online) throw new Error('network down');
      return jsonResp(customHub);
    });
    const store = makeStore(mockFetch);
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} onClose={vi.fn()} />,
    );

    fireEvent.click(getByTestId('hub-add-registry-toggle'));
    fireEvent.input(getByTestId('hub-registry-url'), { target: { value: 'https://robotics.example.org/hub.json' } });
    fireEvent.click(getByTestId('hub-registry-submit'));

    await waitFor(() => expect(queryByTestId('hub-card-custom-gripper')).not.toBeNull());
    expect(queryByTestId('hub-card-solidcraft-gears')).toBeNull();

    // Go offline and refresh -> cached copy stays visible with offline banner
    online = false;
    fireEvent.click(getByTestId('hub-registry-refresh'));
    await waitFor(() => expect(queryByTestId('hub-offline-banner')).not.toBeNull());
    expect(queryByTestId('hub-card-custom-gripper')).not.toBeNull();
  });

  it('honors builtinIsPreview when explicitly requested', () => {
    const { getByTestId, queryByTestId } = render(<HubDialog store={makeStore()} builtinIsPreview onClose={vi.fn()} />);
    expect(getByTestId('hub-preview-note')).toBeTruthy();
    expect(getByTestId('hub-card-solidcraft-gears')).toBeTruthy();
    expect(queryByTestId('hub-action-solidcraft-gears')).toBeNull();
    expect(getByTestId('hub-preview-solidcraft-gears')).toBeTruthy();
  });

  it('pins the status bar outside the scrollable grid and shows manual .zip download + picker when GitHub blocks direct fetch', async () => {
    setThirdPartyEnabled(true);
    const blockedFetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const store = makeStore();
    const pm = makePluginManager();
    const { getByTestId } = render(
      <HubDialog store={store} pluginManager={pm} fetch={blockedFetch as never} onClose={vi.fn()} />,
    );

    fireEvent.click(getByTestId('hub-action-gridfinity'));
    await waitFor(() => expect(getByTestId('hub-manual-zip')).toBeTruthy());
    // Status banner must sit in the pinned hub-status bar, not inside the scrollable hub-body
    expect(getByTestId('hub-status').contains(getByTestId('hub-manual-zip'))).toBe(true);
    expect(getByTestId('hub-manual-zip-download').getAttribute('href')).toContain('gridfinity-1.4.1.zip');
    expect(getByTestId('hub-manual-zip-pick')).toBeTruthy();
  });
});
