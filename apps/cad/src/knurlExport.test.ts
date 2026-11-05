import { describe, expect, it, vi } from 'vitest';
import { chooseKnurlExport } from './knurlExport';

const base = () => ({
  ask: vi.fn(async () => 'include' as 'include' | 'plain' | 'cancel'),
  run: vi.fn(async () => ({ ok: true as const, value: 'baked' })),
  failed: vi.fn(async () => 'plain' as 'plain' | 'cancel'),
});

describe('what an export does about cosmetic knurls', () => {
  it('writes as usual when there is no cosmetic knurl, whatever the setting', async () => {
    const b = base();
    expect(await chooseKnurlExport({ mode: 'on', count: 0, ...b })).toEqual({ kind: 'none' });
    expect(b.run).not.toHaveBeenCalled();
  });
  it('On cuts them without asking', async () => {
    const b = base();
    expect(await chooseKnurlExport({ mode: 'on', count: 2, ...b })).toEqual({ kind: 'baked', value: 'baked' });
    expect(b.ask).not.toHaveBeenCalled();
  });
  it('Off writes the plain solid and cuts nothing', async () => {
    const b = base();
    expect(await chooseKnurlExport({ mode: 'off', count: 1, ...b })).toEqual({ kind: 'plain' });
    expect(b.run).not.toHaveBeenCalled();
    expect(b.ask).not.toHaveBeenCalled();
  });
  it('Ask: include cuts, without writes the plain solid, cancel writes nothing', async () => {
    for (const [answer, kind, runs] of [['include', 'baked', 1], ['plain', 'plain', 0], ['cancel', 'cancel', 0]] as const) {
      const b = base();
      b.ask.mockResolvedValue(answer);
      expect((await chooseKnurlExport({ mode: 'ask', count: 1, ...b })).kind).toBe(kind);
      expect(b.run).toHaveBeenCalledTimes(runs);
    }
  });
  it('a failed or timed-out cut asks, and never writes the plain solid unasked', async () => {
    for (const reason of ['failed', 'timeout'] as const) {
      const b = base();
      b.run.mockResolvedValue({ ok: false, reason, message: 'x' } as never);
      expect(await chooseKnurlExport({ mode: 'on', count: 1, ...b })).toEqual({ kind: 'plain' });
      expect(b.failed).toHaveBeenCalledWith(reason, 'x');
      b.failed.mockResolvedValue('cancel');
      expect(await chooseKnurlExport({ mode: 'on', count: 1, ...b })).toEqual({ kind: 'cancel' });
    }
  });
  it('Cancel during the cut stops without asking anything', async () => {
    const b = base();
    b.run.mockResolvedValue({ ok: false, reason: 'cancelled', message: 'cancelled' } as never);
    expect(await chooseKnurlExport({ mode: 'on', count: 1, ...b })).toEqual({ kind: 'cancel' });
    expect(b.failed).not.toHaveBeenCalled();
  });
});
