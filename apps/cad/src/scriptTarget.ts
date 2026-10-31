// Where a Script-panel Run builds its part: in the tab being edited (rebuilt in place) or in a new tab.
// A Run on a part this panel made earlier updates THAT part. A script of another name never replaces a part it did not make,
// except the document's own script (a part opened from a file keeps its script, and Run rebuilds that part under the same name).

export interface RunTarget {
  /** the tab that is open */
  activeTabId: number;
  /** the tab the last Run of this panel built into, if it is still open */
  lastRunTabId: number | null;
  /** the open document's own script, if it has one */
  docScript?: string;
  docName?: string;
  /** the name the script gives its part (part('...')), null when it has none */
  scriptPartName: string | null;
}

export function runsInPlace(t: RunTarget): boolean {
  if (t.lastRunTabId !== null && t.lastRunTabId === t.activeTabId) return true;
  return !!t.docScript && !!t.docName && t.scriptPartName === t.docName;
}
