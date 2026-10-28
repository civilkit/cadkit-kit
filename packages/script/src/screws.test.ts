import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLES } from './examples';
import { SCREWS_SCRIPT } from './screws';

describe('screws example', () => {
  it('is listed in the Script tab and matches docs/examples/screws.script.ts', () => {
    expect(EXAMPLES.some((e) => e.id === 'screws' && e.code === SCREWS_SCRIPT)).toBe(true);
    expect(SCREWS_SCRIPT).toBe(readFileSync(resolve(__dirname, '../../../docs/examples/screws.script.ts'), 'utf8'));
  });
});
