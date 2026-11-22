import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { useFocusTrap } from './useFocusTrap';

afterEach(cleanup);

function Dlg() {
  const ref = useFocusTrap();
  return (
    <div ref={ref}>
      <button data-testid="a">A</button>
      <button data-testid="b">B</button>
      <button data-testid="c">C</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('Tab on the last control goes to the first, Shift+Tab on the first goes to the last', () => {
    const { getByTestId } = render(<Dlg />);
    getByTestId('c').focus();
    fireEvent.keyDown(getByTestId('c'), { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('a'));
    fireEvent.keyDown(getByTestId('a'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByTestId('c'));
  });
  it('leaves Tab between inner controls alone', () => {
    const { getByTestId } = render(<Dlg />);
    getByTestId('a').focus();
    const notCancelled = fireEvent.keyDown(getByTestId('a'), { key: 'Tab' });
    expect(notCancelled).toBe(true);
  });
  it('returns focus to the opener when the dialog unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Dlg />);
    document.body.focus();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
