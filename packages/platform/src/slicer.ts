// Slicer discovery & handoff bridge: invokes allowlisted Tauri desktop commands when running
// inside the desktop app, and falls back to saving the .3mf file in the browser.

export interface SlicerInfo {
  id: string;
  name: string;
}

export type SendToSlicerResult =
  | { mode: 'launched'; slicerId: string; path: string }
  | { mode: 'downloaded'; filename: string }
  | { mode: 'error'; message: string };

interface TauriCore {
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function getTauriInvoke(): TauriCore['invoke'] | undefined {
  const g = globalThis as { __TAURI__?: { core?: TauriCore } };
  const fn = g.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : undefined;
}

/** True when running inside the Tauri desktop shell with IPC invoke available. */
export function hasDesktopSlicerBridge(): boolean {
  return getTauriInvoke() !== undefined;
}

/** Detect allowlisted slicers installed on the user's machine (desktop only; empty in browser). */
export async function detectDesktopSlicers(): Promise<SlicerInfo[]> {
  const invoke = getTauriInvoke();
  if (!invoke) return [];
  try {
    const res = await invoke<SlicerInfo[]>('detect_slicers');
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/**
 * Send a `.3mf` or `.stl` payload to an allowlisted desktop slicer, or fall back to downloading
 * via `saveFile` when running in a web browser.
 */
export async function sendToSlicerWith(
  slicerId: string,
  bytes: Uint8Array,
  filename: string,
  saveFile: (name: string, data: Uint8Array, mime?: string) => Promise<void>,
): Promise<SendToSlicerResult> {
  const invoke = getTauriInvoke();
  if (invoke && slicerId) {
    try {
      const path = await invoke<string>('open_in_slicer', {
        slicerId,
        bytes: Array.from(bytes),
        filename,
      });
      return { mode: 'launched', slicerId, path };
    } catch (e) {
      return { mode: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
  const mime = filename.toLowerCase().endsWith('.stl') ? 'model/stl' : 'model/3mf';
  await saveFile(filename, bytes, mime);
  return { mode: 'downloaded', filename };
}
