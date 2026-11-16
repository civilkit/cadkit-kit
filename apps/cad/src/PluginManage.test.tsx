import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { builtinRegistry, memoryStore, PluginManager, sha256Hex } from '@kit/plugin';
import { zipWrite } from '@kit/io';
import { PluginManage } from './PluginManage';
import './i18n';

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());
const enc = (s: string) => new TextEncoder().encode(s);
const SCRIPT = "part(uniqueName('Plate')).sketch('front', (s) => s.rect(params.width, 20)).extrude(5);\n";
async function zipBytes(): Promise<Uint8Array> {
  const manifest = { id: 'acme.plates', name: 'Plates', version: '1.0.0', license: 'MIT', files: { 'gen/plate.js': await sha256Hex(SCRIPT) }, contributes: { generators: [{ id: 'plate', title: 'Plate', script: 'gen/plate.js', params: [{ name: 'width', type: 'number', default: 40 }] }] } };
  return zipWrite([{ name: 'plugin.json', data: enc(JSON.stringify(manifest)) }, { name: 'gen/plate.js', data: enc(SCRIPT) }]);
}
const fakeFile = (b: Uint8Array, name: string) => ({ name, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
const mk = () => { const m = new PluginManager({ registry: builtinRegistry(), store: memoryStore(), appVersion: '1.0.0', denied: () => (localStorage.getItem('ck.plugins.thirdParty') === '1' ? null : 'off') }); let changes = 0; const r = render(<PluginManage manager={m} onChanged={() => { changes++; }} />); return { m, r, q: (s: string) => r.container.querySelector(s) as HTMLElement | null, changes: () => changes }; };

describe('PluginManage', () => {
  it('shows nothing but the setting until third-party plugins are switched on', () => {
    const x = mk();
    expect(x.q('[data-testid="plugin-thirdparty"]')).not.toBeNull();
    expect(x.q('[data-testid="plugin-file"]')).toBeNull();
  });
  it('install is two steps: the card shows what the package adds and its hash, Install registers it, Remove takes it away', async () => {
    const x = mk();
    fireEvent.click(x.q('[data-testid="plugin-thirdparty"]')!);
    await waitFor(() => expect(x.q('[data-testid="plugin-file"]')).not.toBeNull());
    const file = fakeFile(await zipBytes(), 'plates.zip');
    Object.defineProperty(x.q('[data-testid="plugin-file"]'), 'files', { value: [file] });
    fireEvent.change(x.q('[data-testid="plugin-file"]')!);
    await waitFor(() => expect(x.q('[data-testid="plugin-confirm"]')).not.toBeNull());
    expect(x.q('[data-testid="plugin-confirm"]')!.textContent).toContain('Plates');
    expect(x.q('[data-testid="plugin-confirm"]')!.textContent).toContain('Plate');
    expect(x.q('[data-testid="plugin-hash"]')).not.toBeNull();
    expect(x.m.registry.find('acme.plates', 'plate')).toBeUndefined();   // nothing installed before the confirmation
    fireEvent.click(x.q('[data-testid="plugin-install"]')!);
    await waitFor(() => expect(x.m.registry.find('acme.plates', 'plate')).toBeDefined());
    await waitFor(() => expect(x.q('[data-testid="plugin-row-acme.plates"]')).not.toBeNull());
    fireEvent.click(x.q('[data-testid="plugin-remove-acme.plates"]')!);
    await waitFor(() => expect(x.m.registry.find('acme.plates', 'plate')).toBeUndefined());
  });
  it('a bad package is explained and cannot be installed', async () => {
    const x = mk();
    fireEvent.click(x.q('[data-testid="plugin-thirdparty"]')!);
    await waitFor(() => expect(x.q('[data-testid="plugin-file"]')).not.toBeNull());
    Object.defineProperty(x.q('[data-testid="plugin-file"]'), 'files', { value: [fakeFile(await zipWrite([{ name: 'readme.txt', data: enc('hi') }]), 'bad.zip')] });
    fireEvent.change(x.q('[data-testid="plugin-file"]')!);
    await waitFor(() => expect(x.q('[data-testid="plugin-confirm"]')).not.toBeNull());
    expect(x.q('[data-testid="plugin-confirm"]')!.textContent).toContain('plugin.json is missing');
    expect((x.q('[data-testid="plugin-install"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
