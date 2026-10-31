import { describe, expect, it } from 'vitest';
import { noPrompt, shouldWarnOnUnload } from './urlFlags';

describe('?noprompt=1', () => {
  it('only the value 1 turns the prompt off', () => {
    expect(noPrompt('?noprompt=1')).toBe(true);
    expect(noPrompt('?a=b&noprompt=1')).toBe(true);
    for (const s of ['', '?noprompt', '?noprompt=0', '?noprompt=true', '?other=1']) expect(noPrompt(s)).toBe(false);
  });
  it('the prompt stays for unsaved content without the flag, and is off with it', () => {
    expect(shouldWarnOnUnload(true, '')).toBe(true);
    expect(shouldWarnOnUnload(false, '')).toBe(false);
    expect(shouldWarnOnUnload(true, '?noprompt=1')).toBe(false);
  });
});
