import { describe, expect, it, vi } from 'vitest';
import './i18n';
import { STATUS_LABEL_FROM, STATUS_MENU_BELOW, statusAria, statusItems, statusMode, type StatusItemInput } from './statusGroup';

const input = (over: Partial<StatusItemInput> = {}): StatusItemInput => ({
  status: null, level: 'under', busy: false, onFullyDefine: vi.fn(), showFree: false, onShowFree: vi.fn(), showConstraints: false, onShowConstraints: vi.fn(),
  onReport: vi.fn(), reportOpen: false, onLookNormal: vi.fn(), lookChip: false, ...over,
});

describe('statusMode (width to layout)', () => {
  it('folds into the "..." menu below 900, shows icons up to the label width, then labels Fully define', () => {
    expect(statusMode(STATUS_MENU_BELOW - 1)).toBe('menu');
    expect(statusMode(STATUS_MENU_BELOW)).toBe('icons');
    expect(statusMode(STATUS_LABEL_FROM - 1)).toBe('icons');
    expect(statusMode(STATUS_LABEL_FROM)).toBe('labelled');
    expect(statusMode(1441)).toBe('labelled');
    expect(statusMode(0)).toBe('menu');
  });
});

describe('statusItems', () => {
  it('lists Fully define, Show freedom (under-defined), Show constraints, Report, Look normal, in that order', () => {
    expect(statusItems(input()).map((i) => i.id)).toEqual(['fully-define', 'show-freedom', 'show-constraints', 'sketch-report', 'look-normal']);
  });
  it('Show freedom is only there while the sketch is under-defined', () => {
    for (const level of ['full', 'over', 'none'] as const) expect(statusItems(input({ level })).map((i) => i.id)).not.toContain('show-freedom');
  });
  it('an item without its handler is left out (no report window, no freedom)', () => {
    expect(statusItems(input({ onReport: undefined, onShowFree: undefined, onShowConstraints: undefined })).map((i) => i.id)).toEqual(['fully-define', 'look-normal']);
  });
  it('every item has an icon, a name, a one-line description and an aria-label that carries both', () => {
    for (const it of statusItems(input())) {
      expect(it.icon).toBeTruthy(); expect(it.label).toBeTruthy(); expect(it.tip.length).toBeGreaterThan(10);
      const aria = statusAria(it);
      expect(aria).toContain(it.label); expect(aria).toContain(it.tip);
    }
  });
  it('keeps the tooltip text of Show constraints and the shortcut in every aria-label that has one', () => {
    const items = statusItems(input());
    const sc = items.find((i) => i.id === 'show-constraints')!;
    expect(sc.tip).toBe('Draw every constraint symbol and dimension (Shift+C)');
    expect(statusAria(sc)).toBe('Show constraints: Draw every constraint symbol and dimension (Shift+C)');
    const ln = items.find((i) => i.id === 'look-normal')!;
    expect(statusAria(ln)).toContain('(N)');
    expect(statusAria({ label: 'X', tip: 'does x', keys: 'Q' })).toBe('X: does x (Q)');
  });
  it('toggles report their state; Fully define is disabled when full or busy and shows Defining... while busy', () => {
    const sc = (o: Partial<StatusItemInput>) => statusItems(input(o)).find((i) => i.id === 'show-constraints')!;
    expect([sc({ showConstraints: false }).label, sc({ showConstraints: false }).tip]).toEqual(['Show constraints', 'Draw every constraint symbol and dimension (Shift+C)']);
    expect([sc({ showConstraints: true }).label, sc({ showConstraints: true }).tip]).toEqual(['Hide constraints', 'Draw constraint symbols and dimensions only for what is hovered or selected (Shift+C)']);
    const on = statusItems(input({ showConstraints: true, reportOpen: true, showFree: true }));
    expect(on.filter((i) => i.pressed !== undefined).map((i) => [i.id, i.pressed])).toEqual([['show-freedom', true], ['show-constraints', true], ['sketch-report', true]]);
    expect(statusItems(input({ level: 'full' }))[0]).toMatchObject({ disabled: true, cls: 'done' });
    expect(statusItems(input({ busy: true }))[0]).toMatchObject({ disabled: true, text: 'Defining...', label: 'Fully define' });
  });
  it('Look normal takes the accent class and the longer tip while the view is angled', () => {
    const ln = statusItems(input({ lookChip: true })).find((i) => i.id === 'look-normal')!;
    expect(ln.cls).toBe('look-hint');
    expect(ln.tip).toMatch(/angled/);
  });
});
