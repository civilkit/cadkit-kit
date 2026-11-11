import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { FramePanel } from './FramePanel';
import { DEFAULT_FRAME, type FrameParams, type FrameReport } from './frameLib';
import '../i18n';

afterEach(() => cleanup());

const SK = [{ id: 'F1', label: 'F1', lines: ['e1', 'e2', 'e3', 'e4'] }];

function mount(skeletons = SK, params: FrameParams = DEFAULT_FRAME, report: FrameReport | null = null) {
  const drafts: FrameParams[] = [], applies: FrameParams[] = [];
  const r = render(<FramePanel params={params} skeletons={skeletons} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => {}} report={report} />);
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, select };
}

describe('FramePanel', () => {
  it('takes the last sketch with lines as the skeleton and previews at once', () => {
    const m = mount();
    expect(m.drafts).toHaveLength(1);
    expect(m.drafts[0]).toMatchObject({ sketch: 'F1', profile: 'tslot-2020', corner: 'butt' });
  });
  it('a profile brings its usual corner; unticking a line leaves it out; Create applies', () => {
    const m = mount();
    fireEvent.change(m.select('profile'), { target: { value: 'shs-40x40x2' } });
    expect(m.drafts.at(-1)).toMatchObject({ profile: 'shs-40x40x2', corner: 'mitre' });
    const box = m.r.container.querySelector('input[aria-label="e3"]') as HTMLInputElement;
    fireEvent.click(box);
    expect(m.drafts.at(-1)?.segments).toEqual(['e1', 'e2', 'e4']);
    fireEvent.click(m.r.getByTestId('frame-apply'));
    expect(m.applies.at(-1)?.segments).toEqual(['e1', 'e2', 'e4']);
  });
  it('without a sketch of lines it says to draw one and cannot create', () => {
    const m = mount([]);
    expect(m.r.getByTestId('frame-no-skeleton')).toBeTruthy();
    expect((m.r.getByTestId('frame-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(m.drafts).toHaveLength(0);
  });
  it('offers the connectors of the profile, defaults them, and drops them again for a profile that has none', () => {
    const m = mount();
    expect(m.drafts[0].hardware).toEqual({ joint: 'bracket-20', corner3: 'corner3-20', cap: 'cap-20', foot: 'foot-20' });
    expect(m.select('hw-joint').value).toBe('bracket-20');
    fireEvent.change(m.select('hw-cap'), { target: { value: '' } });
    expect(m.drafts.at(-1)?.hardware).toEqual({ joint: 'bracket-20', corner3: 'corner3-20', cap: null, foot: 'foot-20' });
    fireEvent.change(m.select('profile'), { target: { value: 'tslot-3030' } });
    expect(m.drafts.at(-1)?.hardware).toEqual({ joint: 'bracket-30', corner3: 'corner3-30', cap: 'cap-30', foot: 'foot-30' });
    fireEvent.change(m.select('profile'), { target: { value: 'fb-50x6' } });
    expect(m.r.queryByTestId('frame-hw')).toBeNull();   // flat bar: no connectors in the library
    expect(m.drafts.at(-1)?.hardware).toEqual({ joint: null, corner3: null, cap: null, foot: null });
  });
  it('lists the joints of the report with a choice each, and the parts list that matches the model', () => {
    const report: FrameReport = { id: 'F2', members: [], hardware: {
      parts: [{ id: 'bracket-20', label: 'Corner bracket, 20 series', kind: 'lbracket', spec: '', qty: 3, bodies: [] }, { id: 'tnut-m5-20', label: 'T-nut M5', kind: 'nut', spec: '', qty: 6, bodies: [] }],
      joints: [{ segments: ['e1', 'e2'], node: [0, 0, 0], angle: 90, corner: 'butt', connector: 'bracket-20' }, { segments: ['e2', 'e3'], node: [0, 0, 0], angle: 60, corner: 'mitre', connector: null, reason: 'an L bracket needs a 90 degree joint' }],
    } };
    const m = mount(SK, DEFAULT_FRAME, report);
    expect(m.r.container.querySelectorAll('.frame-joint')).toHaveLength(2);
    expect(m.r.getByTestId('frame-bom').textContent).toContain('3 x');
    expect(m.r.getByTestId('frame-bom').textContent).toContain('T-nut M5');
    expect(m.r.getByTestId('frame-joints').textContent).toContain('needs a 90 degree joint');
    const sel = m.r.container.querySelector('[data-joint="e1/e2"] select') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'none' } });
    expect(m.drafts.at(-1)?.joints).toEqual([{ segments: ['e1', 'e2'], connector: 'none' }]);
    fireEvent.change(sel, { target: { value: 'default' } });
    expect(m.drafts.at(-1)?.joints).toEqual([]);
  });
  it('imports pasted library JSON, lists the problems of a bad one, and offers the new stock', async () => {
    const { exampleLibrary, clearStoredLibrary } = await import('./frameUserLib');
    const m = mount();
    const area = m.r.getByTestId('frame-lib-paste') as HTMLTextAreaElement;
    fireEvent.input(area, { target: { value: '{"profiles":[{"id":"x"}]}' } });
    fireEvent.click(m.r.getByTestId('frame-lib-apply'));
    const msg = m.r.getByTestId('frame-lib-msg');
    expect(msg.getAttribute('role')).toBe('alert');
    expect(msg.textContent).toContain('nothing was imported');
    expect(msg.textContent).toContain('profiles[0]');
    expect(m.r.container.querySelector('option[value="my-shs-30x30x2"]')).toBeNull();
    fireEvent.input(area, { target: { value: JSON.stringify(exampleLibrary()) } });
    fireEvent.click(m.r.getByTestId('frame-lib-apply'));
    expect(m.r.getByTestId('frame-lib-msg').textContent).toContain('Added 1 profiles');
    expect(m.r.container.querySelector('option[value="my-shs-30x30x2"]')).not.toBeNull();
    fireEvent.click(m.r.getByTestId('frame-lib-clear'));
    expect(m.r.container.querySelector('option[value="my-shs-30x30x2"]')).toBeNull();
    clearStoredLibrary();
  });
  it('lists the generic stock first; a region is read in when it is picked, with a loading state, then grouped by standard and family and searchable', async () => {
    const m = mount();
    const labels = () => [...m.r.container.querySelectorAll('[data-path="profile"] optgroup')].map((g) => g.getAttribute('label'));
    expect(labels()[0]).toBe('Generic and T-slot / Aluminium T-slot');
    expect(labels().some((l) => l?.startsWith('Australia'))).toBe(false);   // not loaded yet
    fireEvent.change(m.select('region'), { target: { value: 'US' } });
    expect(m.r.getByTestId('frame-profile-loading').textContent).toContain('United States');
    await waitFor(() => expect(m.r.queryByTestId('frame-profile-loading')).toBeNull());
    expect(labels()).toContain('United States / ASTM A500 / Rectangular hollow section (RHS)');
    expect(labels()).toContain('United States / ASTM A992 / Wide flange beam (W)');
    expect(labels().some((l) => l?.startsWith('Europe'))).toBe(false);
    const search = m.r.getByTestId('frame-profile-search') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'a500 us-hss-4x4x0.250' } });
    const opts = () => [...m.select('profile').options].map((o) => o.value);
    expect(opts()).toEqual(['tslot-2020', 'us-hss-4x4x0.250']);   // the one in use stays
    expect(m.r.getByTestId('frame-profile-count').textContent).toContain('1 profile');
    fireEvent.change(m.select('profile'), { target: { value: 'us-hss-4x4x0.250' } });
    expect(m.drafts.at(-1)).toMatchObject({ profile: 'us-hss-4x4x0.250', corner: 'mitre' });
    expect(m.drafts.at(-1)?.hardware.joint).toBe('gusset-5');
    expect(m.r.getByTestId('frame-profile-info').textContent).toContain('ASTM A500 Gr C');
    expect(m.r.getByTestId('frame-profile-info').textContent).toContain('kg/m');
    expect(m.r.getByTestId('frame-profile-material').textContent).toContain('ASTM A500 Gr C shaped (default, confirm)');
    fireEvent.input(search, { target: { value: 'no such profile' } });
    expect(m.r.getByTestId('frame-profile-count').textContent).toContain('No profile matches');
    expect(opts()).toEqual(['us-hss-4x4x0.250']);
  });
  it('All regions reads in every region; the European stock is listed with its standards', async () => {
    const m = mount();
    fireEvent.change(m.select('region'), { target: { value: 'all' } });
    await waitFor(() => expect(m.r.queryByTestId('frame-profile-loading')).toBeNull());
    const labels = [...m.r.container.querySelectorAll('[data-path="profile"] optgroup')].map((g) => g.getAttribute('label'));
    for (const want of ['Australia / AS/NZS 1163 / Square hollow section (SHS)', 'Australia / AS/NZS 3679.1 / Universal beam (UB)', 'Europe / EN 10025-2 / IPE beam', 'Europe / EN 10210 / Square hollow section (SHS)', 'Europe / EN 10219 / Circular hollow section (CHS)', 'Europe / EN 10025-2 / UPN channel', 'United States / ASTM A53 / Steel pipe']) expect(labels, want).toContain(want);
    fireEvent.input(m.r.getByTestId('frame-profile-search'), { target: { value: 'ipe 300' } });
    expect([...m.select('profile').options].map((o) => o.value)).toEqual(expect.arrayContaining(['eu-ipe300', 'eu-ipea300', 'eu-ipeo300']));
  });
  it('a frame of a regional profile reopens with its region read in; a row or grade that is not verified wears a badge', async () => {
    const m = mount(SK, { ...DEFAULT_FRAME, sketch: 'F1', profile: 'us-pipe26std', corner: 'mitre' });
    expect((m.select('region')).value).toBe('US');
    await waitFor(() => expect(m.select('profile').value).toBe('us-pipe26std'));
    expect(m.r.getByTestId('frame-profile-material').textContent).toContain('ASTM A53 Gr B (default, confirm)');
    expect(m.r.getByTestId('frame-material-unverified').textContent).toBe('unverified');   // A53 Grade B rests on one secondary source
    expect(m.r.queryByTestId('frame-profile-unverified')).toBeNull();   // the section row itself is verified
    fireEvent.change(m.select('profile'), { target: { value: 'us-hss-2.375x0.250' } });
    expect(m.r.getByTestId('frame-profile-material').textContent).toContain('ASTM A500 Gr C round');
    expect(m.r.getByTestId('frame-material-unverified')).toBeTruthy();   // the 46 / 50 ksi edition conflict
  });
  it('an open section offers no connectors', async () => {
    const m = mount();
    fireEvent.change(m.select('region'), { target: { value: 'AU' } });
    await waitFor(() => expect(m.select('profile').querySelector('option[value="au-ub-310ub40.4"]')).toBeTruthy());
    fireEvent.change(m.select('profile'), { target: { value: 'au-ub-310ub40.4' } });
    expect(m.drafts.at(-1)).toMatchObject({ profile: 'au-ub-310ub40.4', corner: 'butt', hardware: { joint: null, corner3: null, cap: null, foot: null } });
    expect(m.r.queryByTestId('frame-hw')).toBeNull();
  });
});
