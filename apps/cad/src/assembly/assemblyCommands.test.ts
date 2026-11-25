import { describe, expect, it } from 'vitest';
import { assemblyCommands, EXPLODE_ON } from './assemblyCommands';
import '../i18n';

function host(spread = 0) {
  const calls: string[] = [];
  let s = spread;
  const a = { open: (x: string) => calls.push('open:' + x), hasDocument: () => true, isExploded: () => s > 0, hasComponents: () => true, explodeSpread: () => s, setExplode: (p: { spread: number }) => { s = p.spread; calls.push('spread:' + p.spread); } };
  return { a, calls, spread: () => s };
}

describe('the Explode button (audit: it used to open the panel only)', () => {
  it('turns the exploded view on, and off again, and opens its panel section each time', () => {
    const h = host();
    const cmd = assemblyCommands(h.a as never).find((c) => c.id === 'explode')!;
    expect(cmd.pressed?.()).toBe(false);
    cmd.run();
    expect(h.spread()).toBe(EXPLODE_ON);
    expect(cmd.pressed?.()).toBe(true);
    cmd.run();
    expect(h.spread()).toBe(0);
    expect(cmd.pressed?.()).toBe(false);
    expect(h.calls).toEqual(['open:explode', 'spread:' + EXPLODE_ON, 'open:explode', 'spread:0']);
  });
  it('is off without components', () => {
    const cmd = assemblyCommands({ ...host().a, hasComponents: () => false } as never).find((c) => c.id === 'explode')!;
    expect(cmd.enabled?.()).toBe(false);
  });
});
