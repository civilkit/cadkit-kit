import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { RecogniseDialog, type Outcome } from './RecogniseDialog';
import '../i18n';

afterEach(cleanup);
const analysis = (over: Partial<Outcome['analysis']> = {}): Outcome['analysis'] => ({ lineIds: [], script: "const p = part('From STEP');\n", found: { holes: 4, plates: 1 }, handled: ['holes/0', 'plates/0'], skipped: [{ id: 'risers/0', why: 'family risers is not rebuilt yet' }], stock: 'box', fileVolume: 1000, version: '0.5.3', ...over });
const props = () => ({ name: 'Bracket', onOpen: vi.fn(), onCopy: vi.fn(), onClose: vi.fn() });

describe('RecogniseDialog', () => {
  it('shows what was found and offers the new part when the rebuild is the same solid', async () => {
    const p = props();
    render(<RecogniseDialog {...p} run={async () => ({ analysis: analysis(), rebuilt: { ok: true, volume: 1001, valid: true } })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict').getAttribute('data-verdict')).toBe('match'));
    expect(screen.getByTestId('recog').textContent).toContain('holes 4');
    expect(screen.getByTestId('recog-count').textContent).toContain('2 of 3');
    const open = screen.getByTestId('recog-open') as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    expect(p.onOpen).toHaveBeenCalledWith("const p = part('From STEP');\n");
  });
  it('says how much larger a bigger rebuild is, does not offer it as a new part, and still lets the script be copied', async () => {
    const p = props();
    render(<RecogniseDialog {...p} run={async () => ({ analysis: analysis(), rebuilt: { ok: true, volume: 3000, valid: true } })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict').getAttribute('data-verdict')).toBe('differs'));
    const text = screen.getByTestId('recog-verdict').textContent ?? '';
    expect(text).toContain('3.0 times the imported volume');
    expect(text).not.toContain('missing');
    expect((screen.getByTestId('recog-open') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('recog-copy') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('recog-copy'));
    expect(p.onCopy).toHaveBeenCalled();
  });
  it('says how much smaller a smaller rebuild is', async () => {
    render(<RecogniseDialog {...props()} run={async () => ({ analysis: analysis(), rebuilt: { ok: true, volume: 400, valid: true } })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict').getAttribute('data-verdict')).toBe('differs'));
    const text = screen.getByTestId('recog-verdict').textContent ?? '';
    expect(text).toContain('60.0% smaller');
    expect((screen.getByTestId('recog-open') as HTMLButtonElement).disabled).toBe(true);
  });
  it('offers a close rebuild, worded as a difference', async () => {
    render(<RecogniseDialog {...props()} run={async () => ({ analysis: analysis(), rebuilt: { ok: true, volume: 1010, valid: true } })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict').getAttribute('data-verdict')).toBe('close'));
    expect(screen.getByTestId('recog-verdict').textContent).toContain('differs by 1.0%');
    expect((screen.getByTestId('recog-open') as HTMLButtonElement).disabled).toBe(false);
  });
  it('lists what was left out in plain words, grouped with counts, never the converter\'s wording', async () => {
    const skipped = [
      { id: 'plates/0', why: "family 'plates' is not rebuilt yet", code: 'family', family: 'plates' }, { id: 'plates/1', why: "family 'plates' is not rebuilt yet", code: 'family', family: 'plates' },
      { id: 'fillets/2', why: 'the fillet is not at a corner of the stock box', code: 'fillet-corner', family: 'fillets' },
      { id: 'step_levels/0', why: "family 'step_levels' is not rebuilt yet", code: 'family', family: 'step_levels' },
    ];
    render(<RecogniseDialog {...props()} run={async () => ({ analysis: analysis({ skipped }), rebuilt: { ok: true, volume: 1000, valid: true } })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict')).toBeTruthy());
    const text = screen.getByTestId('recog').textContent ?? '';
    expect(text).toContain('Left out (4)');
    expect(text).toContain('Plates: 2 not rebuilt yet');
    expect(text).toContain('Step levels: 1 not rebuilt yet');
    expect(text).toContain('Fillets: 1 not at a corner of the block');
    expect(text).not.toContain("family 'plates'");
    expect(text).not.toContain('stock box');
  });
  it('does not offer a rebuild that is not a valid solid', async () => {
    render(<RecogniseDialog {...props()} run={async () => ({ analysis: analysis(), rebuilt: { ok: true, volume: 1000, valid: false } })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict').getAttribute('data-verdict')).toBe('invalid'));
    expect((screen.getByTestId('recog-open') as HTMLButtonElement).disabled).toBe(true);
  });
  it('has nothing to open when no script could be built', async () => {
    render(<RecogniseDialog {...props()} run={async () => ({ analysis: analysis({ script: null, handled: [], found: {} }), rebuilt: null })} />);
    await waitFor(() => expect(screen.getByTestId('recog-verdict').getAttribute('data-verdict')).toBe('none'));
    expect((screen.getByTestId('recog-open') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('recog-copy') as HTMLButtonElement).disabled).toBe(true);
  });
  it('explains a missing recogniser, and Escape closes', async () => {
    const p = props();
    render(<RecogniseDialog {...p} run={async () => { throw new Error('missing'); }} />);
    await waitFor(() => expect(screen.getByTestId('recog-error').textContent).toContain('not available in this version'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalled();
  });
  it('shows the wait text while it works', () => {
    render(<RecogniseDialog {...props()} run={() => new Promise(() => {})} />);
    expect(screen.getByTestId('recog-wait').textContent).toContain('Loading the recogniser');
  });
});
