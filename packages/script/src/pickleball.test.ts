import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLES } from './examples';
import { PICKLEBALL_SCRIPT } from './pickleball';

describe('pickleball example', () => {
  it('is listed in the Script tab and matches docs/examples/pickleball.script.ts', () => {
    expect(EXAMPLES.some((e) => e.id === 'pickleball' && e.code === PICKLEBALL_SCRIPT)).toBe(true);
    expect(PICKLEBALL_SCRIPT).toBe(readFileSync(resolve(__dirname, '../../../docs/examples/pickleball.script.ts'), 'utf8'));
  });
});
