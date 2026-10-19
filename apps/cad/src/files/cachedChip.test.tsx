import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { StatusBar } from '@kit/ui';
import { createStore } from '@kit/store';
import '../i18n';
import { registerCatalog } from '@kit/i18n';
import { filesEn } from './strings';
import { cachedChip } from './cachedChip';

registerCatalog('en', filesEn);
afterEach(cleanup);

const bar = (cached: boolean) => {
  const chip = cachedChip(cached);
  return render(<StatusBar notices={[]} hover={null} busy={false} items={chip ? [chip] : []} />);
};

describe('cached view chip', () => {
  it('is in the status bar while the view is a stored one, with the explanation as its tooltip', () => {
    const { container } = bar(true);
    const chip = container.querySelector('.st-item')!;
    expect(chip.textContent).toContain('Cached view');
    expect(chip.textContent).toContain('rebuilding');
    expect(chip.querySelector('b')!.className).toBe('warn');
    expect(cachedChip(true)!.title).toMatch(/Edits wait/);
  });
  it('is gone once the real state is there', () => {
    expect(bar(false).container.textContent).not.toContain('Cached view');
    expect(cachedChip(false)).toBeNull();
  });
  it('follows the store flag', () => {
    const store = createStore();
    expect(cachedChip(store.cached.value)).toBeNull();
    store.cached.value = true;
    expect(cachedChip(store.cached.value)?.label).toBe('Cached view');
  });
});
