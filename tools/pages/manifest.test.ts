import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pub = join(__dirname, '../../apps/cad/public');
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as {
  id?: string; name: string; short_name: string;
  icons: { src: string; sizes: string }[];
  screenshots?: { src: string; sizes: string; type: string; form_factor?: string }[];
  file_handlers?: { action: string; accept: Record<string, string[]> }[];
};
const pngSize = (file: string): string => { const b = readFileSync(file); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };

describe('web app manifest', () => {
  it('uses the app name and has a stable id', () => {
    expect(manifest.name).toBe('CivilKit CAD');
    expect(manifest.short_name).toBe('CivilKit');
    expect(manifest.id).toBeTruthy();
  });

  it('every icon and screenshot exists and has the size it declares', () => {
    expect(manifest.screenshots?.length).toBeGreaterThan(0);
    for (const e of [...manifest.icons, ...(manifest.screenshots ?? [])]) {
      const f = join(pub, e.src);
      expect(existsSync(f), e.src).toBe(true);
      expect(pngSize(f), e.src).toBe(e.sizes);
    }
  });

  it('opens .ckpart files', () => {
    const h = manifest.file_handlers?.[0];
    expect(h?.accept && Object.values(h.accept).flat()).toContain('.ckpart');
  });

  it('is linked from the page', () => {
    expect(readFileSync(join(pub, '../index.html'), 'utf8')).toContain('manifest.webmanifest');
  });
});
