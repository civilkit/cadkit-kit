import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLES } from './examples';
import { KNURLED_KNOB_SCRIPT } from './knurledknob';

describe('knurled knob example', () => {
  it('is listed in the Script tab and matches docs/examples/knurled-knob.script.ts', () => {
    expect(EXAMPLES.some((e) => e.id === 'knurled-knob' && e.code === KNURLED_KNOB_SCRIPT)).toBe(true);
    expect(KNURLED_KNOB_SCRIPT).toBe(readFileSync(resolve(__dirname, '../../../docs/examples/knurled-knob.script.ts'), 'utf8'));
  });
});
