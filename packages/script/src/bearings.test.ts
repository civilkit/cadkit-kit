import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLES } from './examples';
import { BEARINGS_SCRIPT } from './bearings';

describe('bearings example', () => {
  it('is listed in the Script tab and matches docs/examples/bearings.script.ts', () => {
    expect(EXAMPLES.some((e) => e.id === 'bearings' && e.code === BEARINGS_SCRIPT)).toBe(true);
    expect(BEARINGS_SCRIPT).toBe(readFileSync(resolve(__dirname, '../../../docs/examples/bearings.script.ts'), 'utf8'));
  });
});
