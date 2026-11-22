import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectDesktopSlicers, hasDesktopSlicerBridge, sendToSlicerWith } from './slicer';

const g = globalThis as { __TAURI__?: { core?: { invoke?: (...args: unknown[]) => Promise<unknown> } } };

afterEach(() => {
  delete g.__TAURI__;
});

describe('platform slicer bridge', () => {
  it('returns empty slicer list and falls back to file download in browser', async () => {
    expect(hasDesktopSlicerBridge()).toBe(false);
    expect(await detectDesktopSlicers()).toEqual([]);

    const saveFile = vi.fn().mockResolvedValue(undefined);
    const bytes = new Uint8Array([1, 2, 3]);
    const res = await sendToSlicerWith('', bytes, 'part-plate.3mf', saveFile);
    expect(res).toEqual({ mode: 'downloaded', filename: 'part-plate.3mf' });
    expect(saveFile).toHaveBeenCalledWith('part-plate.3mf', bytes, 'model/3mf');
  });

  it('invokes Tauri detect_slicers and open_in_slicer when desktop bridge is present', async () => {
    const invoke = vi.fn(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'detect_slicers') return [{ id: 'orcaslicer', name: 'OrcaSlicer' }];
      if (cmd === 'open_in_slicer') return '/tmp/civilkit-slicer/123-part-plate.3mf';
      throw new Error('unexpected');
    });
    g.__TAURI__ = { core: { invoke } };

    expect(hasDesktopSlicerBridge()).toBe(true);
    expect(await detectDesktopSlicers()).toEqual([{ id: 'orcaslicer', name: 'OrcaSlicer' }]);

    const saveFile = vi.fn();
    const res = await sendToSlicerWith('orcaslicer', new Uint8Array([9, 8]), 'part-plate.3mf', saveFile);
    expect(res).toEqual({ mode: 'launched', slicerId: 'orcaslicer', path: '/tmp/civilkit-slicer/123-part-plate.3mf' });
    expect(saveFile).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('open_in_slicer', {
      slicerId: 'orcaslicer',
      bytes: [9, 8],
      filename: 'part-plate.3mf',
    });
  });
});
