import '../i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { QuickMeasure } from './QuickMeasure';

afterEach(cleanup);

describe('QuickMeasure', () => {
  it('draws nothing without lines and one row per line otherwise', () => {
    expect(render(<QuickMeasure lines={[]} />).container.innerHTML).toBe('');
    const { container } = render(<QuickMeasure lines={['Length: 10 mm', 'Angle: 90°']} />);
    expect(container.querySelectorAll('.quick-measure > div')).toHaveLength(2);
  });
});
