// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createWebPlatform } from './web';

describe('openFile accept filter', () => {
  it('limits the picker to the given extensions, in both cases', async () => {
    let seen = '';
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag === 'input') { (el as HTMLInputElement).click = () => { seen = (el as HTMLInputElement).accept; (el as HTMLInputElement).oncancel?.(new Event('cancel')); }; }
      return el;
    });
    const r = await createWebPlatform().openFile({ accept: ['.step', '.stp'] });
    expect(r).toBeNull();
    expect(seen.split(',').sort()).toEqual(['.STEP', '.STP', '.step', '.stp']);
    vi.restoreAllMocks();
  });
  it('shows every file when no filter is given', async () => {
    let seen = 'unset';
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = real(tag);
      if (tag === 'input') { (el as HTMLInputElement).click = () => { seen = (el as HTMLInputElement).accept; (el as HTMLInputElement).oncancel?.(new Event('cancel')); }; }
      return el;
    });
    await createWebPlatform().openFile();
    expect(seen).toBe('');
    vi.restoreAllMocks();
  });
});
