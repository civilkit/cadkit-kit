import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';

describe('viewport import', () => {
  it('Viewport is a function', () => {
    expect(typeof Viewport).toBe('function');
  });
});