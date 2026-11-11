import { describe, expect, it } from 'vitest';
import { alignedText, csvCell, csvText } from './tableText';
import { bomText } from './assembly/model';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it('keeps a text from being a spreadsheet formula', () => {
    for (const s of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx']) expect(csvCell(s)).toBe(`'${s}`);
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });
  it('writes numbers, even negative ones, as they are', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell('')).toBe('');
  });
});

describe('csvText', () => {
  it('ends every row with CR LF and writes null as a blank line', () => {
    expect(csvText([['a', 1], null, ['b', 2]])).toBe('a,1\r\n\r\nb,2\r\n');
  });
});

describe('alignedText', () => {
  it('pads columns and right-aligns numbers', () => {
    const t = alignedText(['Part', 'Qty'], [['Block', 12], ['Pin', 3]]);
    expect(t).toBe('Part   Qty\n-----  ---\nBlock   12\nPin      3\n');
  });
  it('left-aligns a column that holds text', () => {
    const t = alignedText(['Name', 'Note'], [['a', 'x'], ['bb', 'yy']]);
    expect(t.split('\n')[2]).toBe('a     x');
  });
});

describe('bomText', () => {
  it('lists the items and a total row', () => {
    const items = [{ no: 1, part: 'Block 40', qty: 2, components: [], massEach: 10, massTotal: 20, material: 'steel' }];
    const lines = bomText(items as never).trim().split('\n');
    expect(lines[0].startsWith('No.')).toBe(true);
    expect(lines[2]).toContain('Block 40');
    expect(lines.at(-1)).toContain('Total');
    expect(lines.at(-1)).toContain('20');
  });
});
