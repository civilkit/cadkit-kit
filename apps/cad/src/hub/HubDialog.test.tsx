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
  it('renders starter catalog cards with kind, SPDX license, and SHA-256 verified badges', () => {
    const store = makeStore();
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} onClose={vi.fn()} />,
    );

    expect(getByTestId('hub-dialog')).toBeTruthy();
    expect(getByTestId('hub-card-metric-fasteners-lib')).toBeTruthy();
    expect(getByTestId('hub-badge-kind-metric-fasteners-lib').textContent).toBe('Library');
    expect(getByTestId('hub-badge-license-metric-fasteners-lib').textContent).toBe('MIT');
    expect(getByTestId('hub-badge-sha-metric-fasteners-lib').textContent).toContain('SHA-256 verified');

    expect(getByTestId('hub-badge-kind-gridfinity-generator').textContent).toBe('Plugin');
    expect(getByTestId('hub-badge-kind-nema-stepper-mounts').textContent).toBe('Part');
    expect(getByTestId('hub-badge-kind-planetary-gearbox-asm').textContent).toBe('Assembly');
    // Unverified entry has no SHA-256 badge
    expect(queryByTestId('hub-badge-sha-pcb-enclosure-plugin')).toBeNull();
  });

  it('filters by search query, kind pill, tag click, and SHA-256 verified checkbox', () => {
    const store = makeStore();
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} onClose={vi.fn()} />,
    );

    // Search
    fireEvent.input(getByTestId('hub-search'), { target: { value: 'gridfinity' } });
    expect(queryByTestId('hub-card-gridfinity-generator')).not.toBeNull();
    expect(queryByTestId('hub-card-metric-fasteners-lib')).toBeNull();

    // Clear search and filter by kind=plugin
    fireEvent.input(getByTestId('hub-search'), { target: { value: '' } });
    fireEvent.click(getByTestId('hub-kind-plugin'));
    expect(queryByTestId('hub-card-gridfinity-generator')).not.toBeNull();
    expect(queryByTestId('hub-card-pcb-enclosure-plugin')).not.toBeNull();
    expect(queryByTestId('hub-card-metric-fasteners-lib')).toBeNull();

    // Verified only removes unverified plugin
    fireEvent.click(getByTestId('hub-verified-only'));
    expect(queryByTestId('hub-card-gridfinity-generator')).not.toBeNull();
    expect(queryByTestId('hub-card-pcb-enclosure-plugin')).toBeNull();

    // Reset kind + verified, click tag
    fireEvent.click(getByTestId('hub-verified-only'));
    fireEvent.click(getByTestId('hub-kind-all'));
    fireEvent.click(getByTestId('hub-tag-six-dof-robot-arm-urdf'));
    expect(queryByTestId('hub-card-six-dof-robot-arm')).not.toBeNull();
    expect(queryByTestId('hub-card-metric-fasteners-lib')).toBeNull();
    expect(getByTestId('hub-tag-clear')).toBeTruthy();
    fireEvent.click(getByTestId('hub-tag-clear'));
    expect(queryByTestId('hub-card-metric-fasteners-lib')).not.toBeNull();
  });

  it('respects the "Allow plugins from other people" safety gate before fetching/installing plugins', async () => {
    setThirdPartyEnabled(false);
    const pluginFetch = vi.fn();
    const store = makeStore();
    const pm = makePluginManager();
    const { getByTestId, queryByTestId } = render(
      <HubDialog store={store} pluginManager={pm} fetch={pluginFetch as never} builtinIsPreview={false} onClose={vi.fn()} />,
    );

    fireEvent.click(getByTestId('hub-action-gridfinity-generator'));
    expect(getByTestId('hub-plugin-gate')).toBeTruthy();
    expect(pluginFetch).not.toHaveBeenCalled();

    // Toggling the gate enables third-party plugins and hides the gate prompt
    fireEvent.click(getByTestId('hub-plugin-gate-toggle'));
    await waitFor(() => expect(queryByTestId('hub-plugin-gate')).toBeNull());
  });

  it('adds a permissive library directly via LibraryRegistry and marks it Added', async () => {
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
    const onAdded = vi.fn();
    const { getByTestId } = render(
      <HubDialog store={makeStore()} libraryRegistry={libReg} onLibraryAdded={onAdded} builtinIsPreview={false} onClose={vi.fn()} />,
    );

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
    expect(queryByTestId('hub-card-metric-fasteners-lib')).toBeNull();

    // Go offline and refresh -> cached copy stays visible with offline banner
    online = false;
    fireEvent.click(getByTestId('hub-registry-refresh'));
    await waitFor(() => expect(queryByTestId('hub-offline-banner')).not.toBeNull());
    expect(queryByTestId('hub-card-custom-gripper')).not.toBeNull();
  });

  it('the built-in starter catalog is a preview: a note, no install buttons', () => {
    const { getByTestId, queryByTestId } = render(<HubDialog store={makeStore()} onClose={vi.fn()} />);
    expect(getByTestId('hub-preview-note')).toBeTruthy();
    expect(getByTestId('hub-card-metric-fasteners-lib')).toBeTruthy();
    expect(queryByTestId('hub-action-metric-fasteners-lib')).toBeNull();
    expect(getByTestId('hub-preview-metric-fasteners-lib')).toBeTruthy();
  });
});
