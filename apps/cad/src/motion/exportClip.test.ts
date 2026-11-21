import { describe, expect, it } from 'vitest';
import { exportClip, ClipError, pickMime, type ClipDeps, type Recorder } from './exportClip';

function deps(over: Partial<ClipDeps> = {}) {
  const log: string[] = [];
  const saved: Array<{ name: string; data: Uint8Array; mime: string }> = [];
  let shown = -1;
  const rec: Recorder = { ondata: null, onstop: null, start() { log.push('start'); }, stop() { log.push('stop'); this.ondata?.(new Blob([new Uint8Array([1, 2, 3])])); setTimeout(() => this.onstop?.(), 0); } };
  const d: ClipDeps = {
    frames: 5, duration: 2,
    show: (i) => { shown = i; log.push('show' + i); },
    capture: async () => new Blob([new Uint8Array([137, 80, 78, 71, shown])]),
    recorder: () => rec,
    supports: (m) => m.startsWith('video/webm'),
    decode: async () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) }),
    bytes: (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.readAsArrayBuffer(b); }),
    sleep: async (ms) => { log.push('sleep' + ms); },
    save: async (name, data, mime) => { saved.push({ name, data, mime }); },
    ...over,
  };
  return { d, log, saved };
}

describe('exportClip', () => {
  it('a PNG sequence is a ZIP of every frame in order, named after the study', async () => {
    const { d, saved } = deps();
    const name = await exportClip('png', 'Open door', d);
    expect(name).toBe('Open_door.zip');
    expect(saved).toHaveLength(1);
    const text = new TextDecoder('latin1').decode(saved[0].data);
    for (let i = 1; i <= 5; i++) expect(text).toContain(`Open_door_000${i}.png`);
    expect(saved[0].mime).toBe('application/zip');
  });

  it('a GIF takes about 15 frames a second of a 30 fps study and keeps the real speed', async () => {
    const { d, saved, log } = deps({ frames: 61, duration: 2 }); // 30 fps
    await exportClip('gif', 'x', d);
    expect(log.filter((l) => l.startsWith('show')).length).toBe(31); // every second frame
    expect(saved[0].name).toBe('x.gif');
    expect(String.fromCharCode(...saved[0].data.slice(0, 6))).toBe('GIF89a');
    // 15 fps -> a delay of 7 centiseconds (6.67 rounded)
    const gce = saved[0].data.findIndex((v, i, a) => v === 0x21 && a[i + 1] === 0xf9);
    expect(saved[0].data[gce + 4]).toBe(7);
  });

  it('WebM records while the frames are shown at the study speed, then saves the recording', async () => {
    const { d, saved, log } = deps();
    await exportClip('webm', 'clip', d);
    expect(log).toEqual(['show0', 'start', 'show0', 'sleep500', 'show1', 'sleep500', 'show2', 'sleep500', 'show3', 'sleep500', 'show4', 'sleep500', 'stop']);
    expect(saved[0].name).toBe('clip.webm');
    expect([...saved[0].data]).toEqual([1, 2, 3]);
    expect(saved[0].mime).toBe('video/webm');
  });

  it('MP4 says plainly when the browser cannot write it, and uses it when it can', async () => {
    const no = deps();
    await expect(exportClip('mp4', 'c', no.d)).rejects.toMatchObject({ code: 'mp4Unsupported' });
    const yes = deps({ supports: (m) => m === 'video/mp4;codecs=avc1' });
    expect(await exportClip('mp4', 'c', yes.d)).toBe('c.mp4');
    expect(yes.saved[0].mime).toBe('video/mp4');
  });

  it('stops when cancelled and refuses an empty study', async () => {
    let n = 0;
    const { d, saved } = deps({ cancelled: () => ++n > 2 });
    await expect(exportClip('png', 'c', d)).rejects.toBeInstanceOf(ClipError);
    expect(saved).toHaveLength(0);
    await expect(exportClip('png', 'c', deps({ frames: 0 }).d)).rejects.toMatchObject({ code: 'noFrames' });
  });

  it('picks the first MIME type the browser knows', () => {
    expect(pickMime('webm', (m) => m === 'video/webm')).toBe('video/webm');
    expect(pickMime('mp4', () => false)).toBeNull();
  });
});
