// English text of the file handling features. Registered next to the app catalogue (registerCatalog merges).
import { registerCatalog } from '@kit/i18n';

export const filesEn = {
  'cmd.save-as': 'Save as', 'cmd.import-step': 'Import STEP / SolidWorks', 'cmd.import-step.tip': 'Open a STEP or SolidWorks (.sldprt) file as a new part (view only)',
  'files.restore.title': 'Restore your last session?',
  'files.restore.text': 'Part "{name}" was open {when} and was not saved to a file.',
  'files.restore.restore': 'Restore', 'files.restore.new': 'Start new',
  'files.saveAs.title': 'Save as', 'files.saveAs.label': 'File name', 'files.saveAs.hint': 'Saved as {file}', 'files.saveAs.save': 'Save',
  'files.saved': 'Saved {file}', 'files.saveFailed': 'Could not save: {message}',
  'files.autosave.tooBig': 'This part is too large for automatic backup in the browser. Save it to a file to be safe.',
  'files.autosave.quota': 'The browser has no room left for the automatic backup. Save to a file to be safe.',
  'files.autosave.unavailable': 'Automatic backup is not available in this browser.',
  'files.restored': 'Restored "{name}"',
  'files.drop.title': 'Drop a file to open it', 'files.drop.hint': '.ckpart  .json  .step  .stp  .sldprt  .dxf  .fcstd',
  'files.drop.unknown': 'Cannot open "{name}": only .ckpart, .json, .step, .stp, .sldprt, .dxf and .FCStd files are supported.',
  'files.drop.stl': 'STL files cannot be imported yet (mesh import is not available). Use a STEP file instead.',
  'files.drop.one': 'Drop one file at a time.',
  'files.dxf.target': 'DXF opens in a sketch: a new sketch on the front plane was started.',
  'files.sldprt.done': 'Imported {name} (SolidWorks): {faces} faces. Imported bodies are view only and are not saved with the part.',
  'files.step.done': 'Imported {name}: {faces} faces. Imported bodies are view only and are not saved with the part.',
  'files.step.failed': 'Could not import {name}: {message}',
  'files.fcstd.done': 'Imported {name} from FreeCAD: {features} of {total} features mapped. {warnings} warning(s): {first}',
  'files.fcstd.clean': 'Imported {name} from FreeCAD: all {total} features mapped.',
  'files.fcstd.failed': 'Could not import {name}: {message}',
  'files.step.noKernel': 'Open or create a part first, then import the STEP file.',
  'files.recent.title': 'Recent', 'files.recent.sample': 'Sample', 'files.recent.file': 'File',
  'files.recent.noHandle': '"{name}" can only be reopened with Open: the browser did not keep access to the file.',
  'files.recent.denied': 'The browser did not give access to "{name}" again. Use Open to pick it.',
  'files.recent.gone': 'Could not read "{name}" any more. Use Open to pick it.',
  'files.time.now': 'just now', 'files.time.min': '{n} min ago', 'files.time.hour': '{n} h ago', 'files.time.day': '{n} d ago',
} as const;

registerCatalog('en', filesEn);

/** "5 min ago" for a time stamp. */
export function ago(then: number, now: number, tr: (k: string, p?: Record<string, string | number>) => string): string {
  const s = Math.max(0, (now - then) / 1000);
  if (s < 60) return tr('files.time.now');
  if (s < 3600) return tr('files.time.min', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('files.time.hour', { n: Math.floor(s / 3600) });
  return tr('files.time.day', { n: Math.floor(s / 86400) });
}
