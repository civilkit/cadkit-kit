import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import './i18n';
import { appVersion } from './appVersion';
import { shouldShowWhatsNew, WhatsNewCallout } from './WhatsNewCallout';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<div class="status"><a href="https://example.test/whats-new/">v0.8.18</a></div>'; });
afterEach(() => { cleanup(); appVersion.value = null; });

describe('shouldShowWhatsNew', () => {
  it('only for a returning user on a different version', () => {
    expect(shouldShowWhatsNew('0.8.18', '0.8.17')).toBe(true);
    expect(shouldShowWhatsNew('0.8.18', '0.8.18')).toBe(false);
    expect(shouldShowWhatsNew('0.8.18', null)).toBe(false);   // first visit
    expect(shouldShowWhatsNew(null, '0.8.17')).toBe(false);
  });
});

describe('WhatsNewCallout', () => {
  it('points at the version link after an update, and Done remembers the version', () => {
    localStorage.setItem('cad.seenVersion', '0.8.17');
    appVersion.value = '0.8.18';
    const { getByText, container } = render(<WhatsNewCallout />);
    expect(container.querySelector('[data-callout="whats-new"]')!.textContent).toContain("What's new in CadKit 0.8.18");
    fireEvent.click(getByText('Done'));
    expect(localStorage.getItem('cad.seenVersion')).toBe('0.8.18');
    expect(container.querySelector('.callout')).toBeNull();
  });
  it('a first visit shows nothing and records the version', () => {
    appVersion.value = '0.8.18';
    const { container } = render(<WhatsNewCallout />);
    expect(container.querySelector('.callout')).toBeNull();
    expect(localStorage.getItem('cad.seenVersion')).toBe('0.8.18');
  });
  it('appears when the version arrives after the first render (version.json loads late)', () => {
    localStorage.setItem('cad.seenVersion', '0.8.17');
    const { container } = render(<WhatsNewCallout />);
    expect(container.querySelector('.callout')).toBeNull();
    act(() => { appVersion.value = '0.8.18'; });
    expect(container.querySelector('[data-callout="whats-new"]')).not.toBeNull();
  });
});
