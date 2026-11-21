import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { MotionPanel } from './MotionPanel';
import { MotionTimeline } from './MotionTimeline';
import { createMotionStore } from './store';
import { fakeDeps } from './testkit';
import '../i18n';

afterEach(() => cleanup());

function setup() {
  const store = createMotionStore();
  const f = fakeDeps();
  store.attach(f.deps);
  return { store, ...f };
}

describe('MotionPanel', () => {
  it('a slider shows the pose, a pose past the stop says what it hits, Show selects both', async () => {
    const { store, calls } = setup();
    const { container, findByLabelText } = render(<MotionPanel store={store} />);
    fireEvent.input((await findByLabelText('Slot Slide')) as HTMLInputElement, { target: { value: '12' } });
    await waitFor(() => expect(container.querySelector('[data-contact]')).not.toBeNull());
    expect(container.querySelector('[data-contact]')!.textContent).toContain('Rail would hit Slider here');
    expect(container.textContent).toContain('Showing a motion pose');
    fireEvent.click(container.querySelector('[data-contact] button') as HTMLButtonElement);
    expect(calls.shown).toEqual([['F1', 'F2']]);
  });

  it('Find limits says both stops in words and Use as range keeps them', async () => {
    const { store, calls } = setup();
    const { container, findByText } = render(<MotionPanel store={store} />);
    fireEvent.click(await findByText('Find limits'));
    await waitFor(() => expect(container.querySelector('[data-found="F3"]')).not.toBeNull());
    const text = container.querySelector('[data-found="F3"]')!.textContent!;
    expect(text).toContain('-8 mm');
    expect(text).toContain('Rail would hit Slider');
    fireEvent.click(await findByText('Use as range'));
    expect((calls.saved.at(-1) as { drivers: unknown[] }).drivers).toEqual([{ mate: 'F3', min: -8, max: 8, value: 0 }]);
  });

  it('says so when no mate can be driven', async () => {
    const store = createMotionStore();
    store.attach(fakeDeps({ solve: async () => ({ drivers: [], poses: [] }) }).deps);
    const { findByText } = render(<MotionPanel store={store} />);
    expect(await findByText(/No mate can be driven yet/)).toBeTruthy();
  });
});

describe('MotionTimeline', () => {
  it('make a study, key two moments on its tracks, scrub, and read what the study touches', async () => {
    const { store, calls } = setup();
    const { container, findByText, findByLabelText } = render(<MotionTimeline store={store} hasClip />);
    fireEvent.click(await findByText('New study'));
    const keyBtn = () => container.querySelector('[data-track="F3"] button.mtl-key') as HTMLButtonElement;
    await waitFor(() => expect(keyBtn()).not.toBeNull());
    fireEvent.click(keyBtn());
    // move the playhead to 4 s, then the slider to 12, then key: the key is what is on screen
    fireEvent.input((await findByLabelText('Time')) as HTMLInputElement, { target: { value: '4' } });
    await waitFor(() => expect(calls.solves.some((s) => s.poses.length === 121)).toBe(true));
    store.setValue('F3', 12);
    await waitFor(() => expect(store.pose.value).not.toBeNull());
    fireEvent.click(keyBtn());
    await waitFor(() => expect(container.querySelectorAll('[data-track="F3"] [data-key]').length).toBe(2));
    fireEvent.input(await findByLabelText('Time'), { target: { value: '3' } }); // editing dropped the solved frames: scrubbing solves them again
    await waitFor(() => expect(container.querySelector('[data-issue]')).not.toBeNull());
    expect(container.querySelector('[data-issue]')!.textContent).toMatch(/At [\d.]+ s Rail would hit Slider/);
    // a tapped key mark is picked, Delete key removes it
    fireEvent.click(container.querySelectorAll('[data-track="F3"] [data-key]')[1]);
    await waitFor(() => expect(store.selectedKey.value).not.toBeNull());
    fireEvent.click([...container.querySelectorAll('button')].find((x) => x.textContent === 'Delete key') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelectorAll('[data-track="F3"] [data-key]').length).toBe(1));
  });

  it('the sliders follow the playhead, so a key made after scrubbing keeps what is shown and does not overwrite another key', async () => {
    const { store } = setup();
    const { container, findByText, findByLabelText } = render(<MotionTimeline store={store} hasClip />);
    fireEvent.click(await findByText('New study'));
    await waitFor(() => expect(container.querySelector('[data-track="F3"]')).not.toBeNull());
    store.setValue('F3', 6);
    store.time.value = 2;
    store.addKey('F3'); // 6 mm at 2 s
    store.time.value = 0;
    store.setValue('F3', 0);
    store.addKey('F3'); // 0 at 0 s
    fireEvent.input((await findByLabelText('Time')) as HTMLInputElement, { target: { value: '2' } });
    await waitFor(() => expect(store.values.value.F3).toBeCloseTo(6, 6));
    fireEvent.input((await findByLabelText('Time')) as HTMLInputElement, { target: { value: '1' } });
    await waitFor(() => expect(store.values.value.F3).toBeCloseTo(3, 6)); // eased halfway between 0 and 6
    // keying at 2 s again keeps the 6
    fireEvent.input((await findByLabelText('Time')) as HTMLInputElement, { target: { value: '2' } });
    await waitFor(() => expect(store.values.value.F3).toBeCloseTo(6, 6));
    store.addKey('F3');
    expect(store.study()!.tracks[0].keys.map((k) => k.v)).toEqual([0, 6]);
  });

  it('picks a key by tapping it, moves it, nudges it and deletes it; the Delete key button says why it is off', async () => {
    const { store } = setup();
    const { container, findByText } = render(<MotionTimeline store={store} hasClip />);
    fireEvent.click(await findByText('New study'));
    await waitFor(() => expect(container.querySelector('[data-track="F3"]')).not.toBeNull());
    const del = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Delete key') as HTMLButtonElement;
    expect(del().disabled).toBe(true);
    store.time.value = 1; store.addKey('F3');
    store.time.value = 3; store.addKey('F3');
    await waitFor(() => expect(container.querySelectorAll('[data-track="F3"] [data-key]').length).toBe(2));
    fireEvent.click(container.querySelectorAll('[data-track="F3"] [data-key]')[0]);
    await waitFor(() => expect(del().disabled).toBe(false));
    expect(store.moveKey('F3', 0, 2.01)).toBe(0);
    expect(store.study()!.tracks[0].keys[0].t).toBe(2); // snapped to a frame (2.0 s)
    expect(store.moveKey('F3', 0, 3.5)).toBe(1); // past the other key: the order is kept and the pick follows
    expect(store.selectedKey.value).toEqual({ mate: 'F3', index: 1 });
    fireEvent.click(del());
    await waitFor(() => expect(container.querySelectorAll('[data-track="F3"] [data-key]').length).toBe(1));
  });

  it('offers the four clip formats when the viewer can export, and none when it cannot', async () => {
    const { store } = setup();
    const a = render(<MotionTimeline store={store} hasClip />);
    fireEvent.click(await a.findByText('New study'));
    await waitFor(() => expect(a.container.querySelector('select[aria-label="Clip format"]')).not.toBeNull());
    expect([...a.container.querySelectorAll('select[aria-label="Clip format"] option')].map((o) => o.textContent)).toEqual(['WebM video', 'MP4 video', 'Animated GIF', 'PNG frames (ZIP)']);
    cleanup();
    const b = render(<MotionTimeline store={store} hasClip={false} />);
    await b.findByText('New study');
    expect(b.container.querySelector('select[aria-label="Clip format"]')).toBeNull();
  });
});

describe('MotionTimeline on a small or short screen', () => {
  const mm = (matches: boolean) => { (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches, addEventListener() {}, removeEventListener() {} }); };
  afterEach(() => { delete (window as unknown as { matchMedia?: unknown }).matchMedia; });

  it('folds the settings into a More row and keeps the transport, the scrubber and the tracks in view', async () => {
    mm(true);
    const { store } = setup();
    const { container, findByText } = render(<MotionTimeline store={store} hasClip />);
    fireEvent.click(await findByText('New study'));
    await waitFor(() => expect(container.querySelector('[data-track="F3"]')).not.toBeNull());
    expect(container.querySelector('.motion-tl')!.classList.contains('compact')).toBe(true);
    const more = container.querySelector('details.mtl-more') as HTMLDetailsElement;
    expect(more).not.toBeNull();
    // the pinned part (transport + scrubber) is outside the folded part, the tracks outside the pinned part
    const pin = container.querySelector('.mtl-pin')!;
    expect(pin.querySelector('button.mtl-primary')).not.toBeNull();
    expect(pin.querySelector('.mtl-scrub')).not.toBeNull();
    expect(pin.querySelector('[data-track]')).toBeNull();
    expect(container.querySelector('.mtl-tracks [data-track="F3"]')).not.toBeNull();
    expect(more.querySelector('select[aria-label="Clip format"]')).not.toBeNull();
    expect(more.textContent).toContain('Delete key');
  });

  it('shows every control inline on a roomy screen', async () => {
    mm(false);
    const { store } = setup();
    const { container, findByText } = render(<MotionTimeline store={store} hasClip />);
    fireEvent.click(await findByText('New study'));
    await waitFor(() => expect(container.querySelector('[data-track="F3"]')).not.toBeNull());
    expect(container.querySelector('details.mtl-more')).toBeNull();
    expect(container.querySelector('.mtl-pin select[aria-label="Clip format"]')).not.toBeNull();
  });
});

