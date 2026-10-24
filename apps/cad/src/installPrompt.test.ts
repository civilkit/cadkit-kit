import { describe, expect, it, vi } from 'vitest';
import { installDismissed, rememberInstallDismissed, watchInstall, type InstallEvent } from './installPrompt';

class FakeTarget extends EventTarget {}

describe('install prompt', () => {
  it('keeps the install event, suppresses the browser bar and reports the install', () => {
    const t = new FakeTarget();
    const onAvailable = vi.fn(); const onInstalled = vi.fn();
    const stop = watchInstall({ onAvailable, onInstalled, target: t as unknown as Window });
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    t.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onAvailable).toHaveBeenCalledWith(ev as InstallEvent);
    t.dispatchEvent(new Event('appinstalled'));
    expect(onInstalled).toHaveBeenCalledTimes(1);
    stop();
    t.dispatchEvent(new Event('beforeinstallprompt'));
    expect(onAvailable).toHaveBeenCalledTimes(1);
  });

  it('remembers "not now" and survives a storage that throws', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    expect(installDismissed(store)).toBe(false);
    rememberInstallDismissed(store);
    expect(installDismissed(store)).toBe(true);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => rememberInstallDismissed(broken)).not.toThrow();
    expect(installDismissed(broken)).toBe(false);
  });
});
