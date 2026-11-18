import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { PluginRegistry, type ReadResult } from '@kit/plugin';
import { PluginPanel, parseCsv } from './PluginPanel';
import './i18n';

afterEach(() => cleanup());
const reg = new PluginRegistry();
reg.add({ id: 'test.cuts', name: 'Cuts', version: '1.0.0', contributes: { generators: [{ id: 'cutlist', title: 'Cut list', effect: 'read', params: [{ name: 'file', type: 'string', title: 'Save as', default: '' }] }] } }, { cutlist: async () => '' });
const csv = 'Qty,Length (mm),Parts\n2,720,"Side L, Side R"\n1,564,"Shelf ""A"""\n';
function mount(readResult: ReadResult | null, o: { busy?: boolean } = {}) {
  const log = { runs: 0, applies: 0 };
  const r = render(<PluginPanel registry={reg} sel={{ pluginId: 'test.cuts', generatorId: 'cutlist', values: { file: '' } }} onPick={() => {}} onChange={() => {}} onApply={() => { log.applies++; }} onRun={() => { log.runs++; }} readResult={readResult} readBusy={o.busy} onBack={() => {}} onCancel={() => {}} />);
  return { r, log, q: (x: string) => r.container.querySelector(x) as HTMLElement | null };
}

describe('a read entry in the Plugins form', () => {
  it('has Run, not Add, and no result until it has run', () => {
    const m = mount(null);
    expect(m.q('[data-testid="plugin-apply"]')).toBeNull();
    expect(m.q('[data-testid="plugin-result"]')).toBeNull();
    fireEvent.click(m.q('[data-testid="plugin-run"]')!);
    expect(m.log).toEqual({ runs: 1, applies: 0 });
  });
  it('shows the csv as a table, the plain numbers as one line, and each saved file as a download', () => {
    const m = mount({ result: { csv, area_m2: 0.708, boards: 3, units: 'mm', hardware: [], parts: [{ qty: 2 }] }, files: [{ grant: 'cutlists', name: 'kitchen.csv', data: new Uint8Array([49]) }] });
    const rows = [...m.r.container.querySelectorAll('[data-testid="plugin-result-table"] tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => c.textContent));
    expect(rows).toEqual([['Qty', 'Length (mm)', 'Parts'], ['2', '720', 'Side L, Side R'], ['1', '564', 'Shelf "A"']]);
    expect(m.q('[data-testid="plugin-result-facts"]')!.textContent).toBe('area m2 0.708 · boards 3 · units mm');
    expect(m.q('[data-testid="plugin-result-file-0"]')!.textContent).toBe('Download kitchen.csv');
    expect(m.q('[data-testid="plugin-result-csv"]')).not.toBeNull();
  });
  it('a result with no csv shows what it has as JSON; Run is off while it works', () => {
    const m = mount({ result: { rows: [{ a: 1 }] }, files: [] }, { busy: true });
    expect(m.q('.plugin-result-json')!.textContent).toContain('"a": 1');
    expect((m.q('[data-testid="plugin-run"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, commas and newlines inside quotes, CRLF, and no final newline', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
    expect(parseCsv('')).toEqual([]);
  });
});
