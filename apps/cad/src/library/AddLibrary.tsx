// The "Add library" flow of the Libraries tab: a github: / https address or a folder, a preview of what it holds (name, part count,
// licence, how many parts have no image) and the licence confirmation, before anything is added.
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { LibraryError } from './source';
import type { LibraryRegistry, Preview } from './registry';
import { textAttrs } from '@kit/ui';

export function errText(e: unknown): string {
  if (e instanceof LibraryError) return t('library.err.' + e.code, { detail: e.detail ?? '' });
  return String((e as Error)?.message ?? e);
}

export function AddLibrary({ registry, onDone }: { registry: LibraryRegistry; onDone(id: string | null): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [ok, setOk] = useState(false);
  const run = async (f: () => Promise<Preview>) => {
    setBusy(true); setErr(''); setPv(null); setOk(false);
    try { setPv(await f()); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const folder = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const map = new Map<string, { arrayBuffer(): Promise<ArrayBuffer>; size: number }>();
    let name = 'library';
    for (const f of Array.from(files)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split('/');
      if (parts.length > 1) name = parts[0];
      map.set(parts.length > 1 ? parts.slice(1).join('/') : rel, f);
    }
    await run(() => registry.preview({ local: map, name }));
  };
  const add = async () => {
    if (!pv) return;
    setBusy(true); setErr('');
    try { const rec = await registry.add(pv, { confirm: ok }); onDone(rec.id); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const lic = pv?.licence;
  return (
    <div class="lib-add" data-testid="lib-add">
      <div class="cat-sub">{t('library.add.hint')}</div>
      <div class="lib-add-row">
        <input {...textAttrs} type="text" value={text} placeholder={t('library.add.placeholder')} aria-label={t('library.add.title')} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) void run(() => registry.preview(text)); }} />
        <button disabled={busy || !text.trim()} onClick={() => void run(() => registry.preview(text))}>{t('library.add.fetch')}</button>
      </div>
      <label class="lib-folder">{t('library.add.folder')}
        <input type="file" {...({ webkitdirectory: '' } as object)} onChange={(e) => void folder((e.currentTarget as HTMLInputElement).files)} />
      </label>
      {err ? <div class="lib-err" role="alert">{err}</div> : null}
      {pv ? (
        <div class="lib-found" data-testid="lib-found">
          <b>{t('library.add.found', { name: pv.record.name, count: pv.record.parts, licence: lic ?? t('library.licence.unknown') })}</b>
          {pv.record.description ? <div class="cat-sub">{pv.record.description}</div> : null}
          {pv.missingThumbs ? <div class="cat-sub" data-testid="lib-nothumbs">{t('library.add.noThumbs', { missing: pv.missingThumbs, count: pv.record.parts })}</div> : null}
          {pv.needsConfirm ? (
            <>
              <div class="lib-warn" role="note">{lic ? t('library.licence.warn', { licence: lic }) : t('library.licence.warnUnknown')}</div>
              <label class="lib-accept"><input type="checkbox" checked={ok} onChange={(e) => setOk((e.currentTarget as HTMLInputElement).checked)} />{t('library.add.accept')}</label>
            </>
          ) : null}
          <button disabled={busy || (pv.needsConfirm && !ok)} onClick={() => void add()}>{t('library.add.confirmAdd')}</button>
        </div>
      ) : null}
      <button class="lib-link" onClick={() => onDone(null)}>{t('library.add.cancel')}</button>
    </div>
  );
}
