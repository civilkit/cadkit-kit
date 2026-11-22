// Parser for Fusion 360 Manifest.dat (JSON or XML) and archive metadata.
// Pure string parsing with no DOMParser requirement so it works identically in browsers, workers, and Node.

import { normalizeUnit, type FusionUnit } from './units';

export interface F3dManifest {
  /** Design or assembly display name extracted from Manifest.dat. */
  name?: string;
  /** Fusion application version string if present. */
  applicationVersion?: string;
  /** Document display unit (e.g. 'mm', 'cm', 'in'). */
  documentUnit?: FusionUnit;
  /** Referenced child design filenames or asset names (for .f3z assemblies). */
  references: string[];
  /** Raw parsed JSON object if Manifest.dat was JSON (for downstream parameter/timeline extraction). */
  rawJson?: Record<string, unknown>;
}

/** Decode UTF-8 (stripping an optional UTF-8 BOM) safely. */
export function decodeText(bytes: Uint8Array): string {
  const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function xmlTagText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]+)</${tag}>`, 'i');
  const m = re.exec(xml);
  return m?.[1]?.trim() || undefined;
}

function xmlAttr(xml: string, attr: string): string | undefined {
  const re = new RegExp(`\\b${attr}\\s*=\\s*"([^"]+)"`, 'i');
  const m = re.exec(xml);
  return m?.[1]?.trim() || undefined;
}

/** Parse a Fusion 360 Manifest.dat buffer (JSON or XML). Never throws. */
export function parseManifest(bytes: Uint8Array): F3dManifest {
  const text = decodeText(bytes).trim();
  const empty: F3dManifest = { references: [] };
  if (!text) return empty;

  // JSON manifest (modern Fusion 360 .f3d / .f3z archives)
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const design = (typeof json.design === 'object' && json.design !== null ? json.design : null) as Record<string, unknown> | null;
      const meta = (typeof json.metadata === 'object' && json.metadata !== null ? json.metadata : null) as Record<string, unknown> | null;

      const name =
        pickString(json, ['name', 'designName', 'assetName', 'AssetName', 'DesignName', 'title', 'Title']) ??
        (design ? pickString(design, ['name', 'designName', 'title']) : undefined) ??
        (meta ? pickString(meta, ['name', 'designName', 'title']) : undefined);

      const applicationVersion =
        pickString(json, ['applicationVersion', 'appVersion', 'version', 'Version', 'fusionVersion']) ??
        (meta ? pickString(meta, ['applicationVersion', 'version']) : undefined);

      const rawUnit =
        pickString(json, ['unit', 'units', 'documentUnit', 'defaultLengthUnits', 'lengthUnit']) ??
        (design ? pickString(design, ['unit', 'units', 'defaultLengthUnits']) : undefined) ??
        (meta ? pickString(meta, ['unit', 'units', 'defaultLengthUnits']) : undefined);

      const references: string[] = [];
      for (const listKey of ['references', 'externalReferences', 'designs', 'components', 'assets', 'files']) {
        const arr = json[listKey];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          if (typeof item === 'string' && item.trim()) {
            references.push(item.trim());
          } else if (typeof item === 'object' && item !== null) {
            const ref = pickString(item as Record<string, unknown>, ['file', 'path', 'uri', 'name', 'assetName']);
            if (ref) references.push(ref);
          }
        }
      }

      return {
        name,
        applicationVersion,
        documentUnit: rawUnit ? normalizeUnit(rawUnit) || undefined : undefined,
        references,
        rawJson: json,
      };
    } catch {
      // Fall through to XML / heuristic parsing
    }
  }

  // XML manifest (Fusion 360 AssetManifest / Manifest.dat XML format)
  if (text.startsWith('<')) {
    const name =
      xmlTagText(text, 'AssetName') ??
      xmlTagText(text, 'DesignName') ??
      xmlTagText(text, 'Name') ??
      xmlAttr(text, 'AssetName') ??
      xmlAttr(text, 'DesignName') ??
      xmlAttr(text, 'name');

    const applicationVersion =
      xmlTagText(text, 'ApplicationVersion') ??
      xmlTagText(text, 'Version') ??
      xmlAttr(text, 'version');

    const rawUnit =
      xmlTagText(text, 'DefaultLengthUnits') ??
      xmlTagText(text, 'LengthUnit') ??
      xmlTagText(text, 'Units') ??
      xmlAttr(text, 'units');

    const references: string[] = [];
    const refRe = /<(?:Reference|ExternalReference|File|Asset)\b[^>]*?(?:path|file|uri|name)\s*=\s*"([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(text)) !== null) {
      if (m[1]?.trim()) references.push(m[1].trim());
    }

    return {
      name,
      applicationVersion,
      documentUnit: rawUnit ? normalizeUnit(rawUnit) || undefined : undefined,
      references,
    };
  }

  return empty;
}

/** Infer a clean design name from an archive filename or internal FusionAssetName[Active] directory path. */
export function inferDesignName(entryNames: readonly string[], fallbackName?: string): string {
  // Check for FusionAssetName[Active]/<Name> or DesignData/<Name>
  for (const raw of entryNames) {
    const norm = raw.replace(/\\/g, '/');
    const m = /^FusionAssetName\[Active\]\/([^/]+)\//i.exec(norm);
    if (m?.[1] && !/^(Breps|DesignData|Preview|Thumbnails)/i.test(m[1])) {
      return m[1].trim();
    }
  }
  if (fallbackName) {
    const clean = fallbackName.replace(/^.*[\\/]/, '').replace(/\.(f3d|f3z)$/i, '').trim();
    if (clean) return clean;
  }
  return 'Fusion Design';
}
