// A numeric feature field may hold an expression ('=H/2') instead of a number: labels, default names and summaries must show it, never throw.
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { FeatureTree, PanelBoundary } from '@kit/ui';
import { listText } from '../../../packages/ui/src/FeatureEditor';
import { featureLabel, planeDefaultName, refLabel } from './featureCreators';
import { featureRows } from './treeModel';
import { moveSummary } from './FeatureOptions';
import { cornerText } from './sheet/options';
import { pointText } from './sheet/flangeShape';
import { toChoices } from './patternRules';

afterEach(cleanup);

const doc = {
  features: [
    { id: 'P1', type: 'plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: '=H/2', autoName: true, name: 'Plane 0 from Front' },
    { id: 'P2', type: 'plane', mode: 'offset', base: { kind: 'feature', id: 'P1' }, offset: 'height - 15', name: 'Plane height - 15 from Plane =H/2 from Front' },
    { id: 'P3', type: 'plane', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: -60, autoName: true },
    { id: 'S1', type: 'sketch', plane: { kind: 'feature', id: 'P1' }, autoName: true },
    { id: 'E1', type: 'extrude', sketch: 'S1', depth: '=H' },
  ],
};

describe('plane names with an expression offset', () => {
  it('shows the expression, not a thrown TypeError', () => {
    expect(planeDefaultName(doc, doc.features[0] as never)).toBe('Plane H/2 from Front');
    expect(featureLabel(doc, doc.features[0] as never)).toBe('Plane H/2 from Front');
    expect(featureLabel(doc, doc.features[1] as never)).toBe('Plane height - 15 from Plane H/2 from Front');
    expect(refLabel(doc, { kind: 'feature', id: 'P1' })).toBe('Plane H/2 from Front');
  });
  it('numbers read as before', () => {
    expect(featureLabel(doc, doc.features[2] as never)).toBe('Plane -60 from Top');
    expect(planeDefaultName(doc, { offset: 12.34567, base: { kind: 'std', id: 'front' } })).toBe('Plane 12.346 from Front');
    expect(planeDefaultName(doc, { base: { kind: 'std', id: 'front' } })).toBe('Plane 0 from Front');
    expect(planeDefaultName(doc, { offset: -0, base: { kind: 'std', id: 'front' } })).toBe('Plane 0 from Front');
  });
  it('a field of a shape nobody expected falls back to the stored name', () => {
    expect(featureLabel(doc, { id: 'P9', type: 'plane', mode: 'offset', name: 'My plane', autoName: true, offset: { a: 1 }, base: 5 } as never)).toBeTypeOf('string');
    expect(featureLabel(doc, { id: 'P9', type: 'plane', name: 'x', autoName: false, offset: Symbol('s') } as never)).toBe('x');
  });
  it('the sketch on such a plane takes the plane label', () => {
    expect(featureLabel(doc, doc.features[3] as never)).toContain('Plane H/2 from Front');
  });
});

describe('the feature tree with expression fields', () => {
  it('renders every row', () => {
    const rows = featureRows(doc as never);
    const { container } = render(<FeatureTree rows={rows} status={[]} selectedId={null} onSelect={() => {}} onMove={() => {}} onRemove={() => {}} onToggleSuppress={() => {}} />);
    expect(container.querySelectorAll('.row').length).toBe(5);
    expect(container.textContent).toContain('Plane H/2 from Front');
    expect(container.textContent).toContain('Plane -60 from Top');
  });
});

describe('other summaries of a field', () => {
  it('a move shows an expression and keeps numbers rounded', () => {
    expect(moveSummary({ translate: [10.123456, '=D/2', 0] })).toContain('10.123');
    expect(moveSummary({ translate: [10, '=D/2', 0] })).toContain('D/2');
  });
  it('point lists show expressions instead of NaN', () => {
    expect(cornerText([10, '=W/2', 3.14159])).toBe('10, W/2, 3.14');
    expect(pointText([1, 'D', 2.5] as never)).toBe('1, D, 2.5');
    expect(listText('edges', [['=a', 2]] as never)).not.toContain('NaN');
    expect(pointText(null)).toBe('');
  });
  it('the pattern end-point option reads an expression', () => {
    expect(toChoices({ features: [] }, 'F1', [10, '=H', 0]).some(([, label]) => label.includes('H'))).toBe(true);
  });
});

describe('PanelBoundary', () => {
  const Boom = (p: { fail: boolean }) => { if (p.fail) throw new Error('(e.offset ?? 0).toFixed is not a function'); return <p>fine</p>; };
  it('keeps a drawing error in its panel, says what failed and Retry redraws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const Flaky = () => <Boom fail={fail} />;
    const { container, getByText } = render(<div><PanelBoundary name="tree"><Flaky /></PanelBoundary><span id="rest">still here</span></div>);
    expect(container.querySelector('[data-testid="panel-error"]')!.textContent).toContain('This panel could not be drawn: (e.offset ?? 0).toFixed is not a function');
    expect(container.querySelector('#rest')!.textContent).toBe('still here');
    fail = false;
    fireEvent.click(getByText('Retry'));
    expect(container.textContent).toContain('fine');
    expect(container.querySelector('[data-testid="panel-error"]')).toBeNull();
    spy.mockRestore();
  });
  it('clears itself when the reset key changes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, rerender } = render(<PanelBoundary resetKey="a"><Boom fail /></PanelBoundary>);
    expect(container.querySelector('[data-testid="panel-error"]')).not.toBeNull();
    rerender(<PanelBoundary resetKey="b"><Boom fail={false} /></PanelBoundary>);
    expect(container.textContent).toBe('fine');
    spy.mockRestore();
  });
});
