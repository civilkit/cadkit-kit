import { useEffect, useRef, useState } from 'preact/hooks';
import { TEXT_FONTS } from '@kit/sketch';
import { t } from './i18n';
import { filterFaces, fontWarningKey, sortFaces, type CuratedFont, type LocalFace } from './fonts';
import { textAttrs } from '@kit/ui';

/** What a pick came to: the font is loaded and applied (with the kernel's notes), or why not. */
export type FontOutcome = { ok: true; name: string; warnings: Array<{ code: string; detail: string }> } | { ok: false; code: string; detail: string };

/** What the font picker needs from the app. The panel only shows; the host loads the font and sets the text entity's `font` / `fontHash`. */
export interface FontsApi {
  /** the curated list (fonts.json) */
  curated(): Promise<CuratedFont[]>;
  pickCurated(id: string): Promise<FontOutcome>;
  pickFile(file: File): Promise<FontOutcome>;
  /** null: the browser has no Local Font Access API */
  localFonts: null | (() => Promise<LocalFace[]>);
  pickLocal(face: LocalFace): Promise<FontOutcome>;
  /** what is known of a font that is not built in: family label, and whether the document keeps only a subset of it */
  describe(name: string): { family: string | null; subset: boolean } | null;
}

const ERR_CODES = new Set(['fontBadData', 'fontTooLarge', 'fontTooMany', 'fontReserved', 'fontBadName', 'fontNameConflict', 'fontFetch', 'fontChecksum', 'fontUnknown', 'noKernel']);
const SYSTEM_LIMIT = 80;

type Note = { kind: 'err' | 'warn' | 'info'; text: string };

export function FontPicker(p: { value: string; fonts: FontsApi; onBuiltin(name: string): void }) {
  const [curated, setCurated] = useState<CuratedFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const [sys, setSys] = useState<{ faces: LocalFace[]; filter: string } | null>(null);
  useEffect(() => { let live = true; p.fonts.curated().then((c) => { if (live) setCurated(c); }).catch(() => {}); return () => { live = false; }; }, [p.fonts]);

  const show = (o: FontOutcome): void => {
    if (!o.ok) { setNotes([{ kind: 'err', text: t('app.font.err.' + (ERR_CODES.has(o.code) ? o.code : 'Other'), { detail: o.detail }) }]); return; }
    setNotes(o.warnings.flatMap((w) => (fontWarningKey(w.code) ? [{ kind: 'warn' as const, text: t('app.font.warn.' + w.code) }] : [])));
  };
  const run = async (f: () => Promise<FontOutcome>): Promise<void> => {
    setBusy(true); setNotes([{ kind: 'info', text: t('app.font.loading') }]);
    try { show(await f()); } catch (e) { setNotes([{ kind: 'err', text: t('app.font.err.Other', { detail: (e as Error).message }) }]); } finally { setBusy(false); }
  };

  const isBuiltin = TEXT_FONTS.includes(p.value);
  const cur = curated.find((c) => c.id === p.value);
  const mine = !isBuiltin && !cur ? p.fonts.describe(p.value) : null;
  const onSelect = (v: string): void => {
    if (v.startsWith('c:')) { void run(() => p.fonts.pickCurated(v.slice(2))); return; }
    if (v.startsWith('b:')) { setNotes([]); p.onBuiltin(v.slice(2)); }
  };
  const openSystem = async (): Promise<void> => {
    if (!p.fonts.localFonts) return;
    setBusy(true); setNotes([]);
    try { setSys({ faces: sortFaces(await p.fonts.localFonts()), filter: '' }); }
    catch (e) {
      const denied = (e as Error).name === 'NotAllowedError' || (e as Error).name === 'SecurityError';
      setNotes([{ kind: 'err', text: denied ? t('app.font.system.denied') : t('app.font.system.failed', { detail: (e as Error).message }) }]);
    } finally { setBusy(false); }
  };
  const hits = sys ? filterFaces(sys.faces, sys.filter) : [];

  return (
    <div class="tp-fonts" data-testid="font-picker">
      <label class="tp-field" data-field="font"><span>{t('app.sketch.text.font')}</span>
        <select aria-label={t('app.sketch.text.font')} disabled={busy} value={isBuiltin ? 'b:' + p.value : cur ? 'c:' + cur.id : 'u:' + p.value} onChange={(e) => onSelect((e.target as HTMLSelectElement).value)}>
          <optgroup label={t('app.font.group.builtin')}>
            {TEXT_FONTS.map((x) => <option value={'b:' + x} selected={p.value === x}>{t('app.sketch.text.font.' + x)}</option>)}
          </optgroup>
          {curated.length ? (
            <optgroup label={t('app.font.group.library')}>
              {curated.map((c) => <option value={'c:' + c.id} selected={p.value === c.id}>{c.family} ({t('app.font.role.' + c.role, {}) })</option>)}
            </optgroup>
          ) : null}
          {!isBuiltin && !cur ? (
            <optgroup label={t('app.font.group.part')}><option value={'u:' + p.value} selected>{mine?.family ?? p.value}</option></optgroup>
          ) : null}
        </select></label>
      <div class="tp-row tp-fontbtns">
        <button type="button" class="tp-btn" data-act="add-font" disabled={busy} onClick={() => file.current?.click()}>{t('app.font.addFile')}</button>
        {p.fonts.localFonts ? <button type="button" class="tp-btn" data-act="system-fonts" disabled={busy} onClick={() => void openSystem()}>{t('app.font.system')}</button> : null}
        <input ref={file} type="file" accept=".ttf,.otf,.ttc" hidden aria-label={t('app.font.fileLabel')} data-testid="font-file"
          onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void run(() => p.fonts.pickFile(f)); }} />
      </div>
      {!p.fonts.localFonts ? <div class="tp-note" data-note="system-unsupported">{t('app.font.system.unsupported')}</div> : null}
      {sys ? (
        <div class="tp-sys" role="group" aria-label={t('app.font.system')} data-testid="system-fonts">
          <input {...textAttrs} type="search" enterKeyHint="search" value={sys.filter} aria-label={t('app.font.system.filter')} placeholder={t('app.font.system.filter')}
            onInput={(e) => setSys({ ...sys, filter: (e.target as HTMLInputElement).value })} onKeyDown={(e) => e.stopPropagation()} />
          <ul class="tp-syslist">
            {hits.slice(0, SYSTEM_LIMIT).map((f) => (
              <li><button type="button" class="tp-sysitem" data-face={f.postscriptName} onClick={() => { setSys(null); void run(() => p.fonts.pickLocal(f)); }}>{f.fullName || f.family}</button></li>
            ))}
          </ul>
          {hits.length === 0 ? <div class="tp-note">{t('app.font.system.none')}</div> : hits.length > SYSTEM_LIMIT ? <div class="tp-note">{t('app.font.system.more', { n: String(SYSTEM_LIMIT) })}</div> : null}
          <button type="button" class="tp-btn" data-act="close-system" onClick={() => setSys(null)}>{t('app.font.system.close')}</button>
        </div>
      ) : null}
      {cur ? <div class="tp-note" data-note="curated-licence">{t('app.font.curatedLicence', { family: cur.family, licence: cur.licence === 'OFL-1.1' ? 'SIL OFL 1.1' : cur.licence === 'Apache-2.0' ? 'Apache 2.0' : cur.licence })}</div> : null}
      {!isBuiltin && !cur ? <div class="tp-note" data-note="user-licence">{t('app.font.licenceNote')}</div> : null}
      {mine?.subset ? <div class="tp-note warn" role="status" data-note="subset">{t('app.font.subsetNote')}</div> : null}
      {notes.map((n) => <div class={'tp-note ' + (n.kind === 'err' ? 'err' : n.kind === 'warn' ? 'warn' : '')} role="status" data-note={'font-' + n.kind}>{n.text}</div>)}
    </div>
  );
}
