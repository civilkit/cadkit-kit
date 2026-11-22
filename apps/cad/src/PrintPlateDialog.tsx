// Print Plate & Send to Slicer dialog: printer bed presets, 2D top-down bed preview with overflow
// highlight, per-body include/exclude + lay-flat toggles, Export Plate (.3mf) and Direct Send to Slicer.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from '@kit/ui';
import type { SlicerInfo } from '@kit/platform';
import { t } from './i18n';
import './files/files.css';
import './printPlate.css';
import {
  PRINTER_BED_PRESETS,
  findBedPreset,
  packPlate,
  type PlateBodyInput,
  type PlateLayoutResult,
} from './printPlate';

export interface PrintPlateDialogProps {
  bodies: readonly PlateBodyInput[];
  partName?: string;
  /** Detect installed desktop slicers (empty in browser). */
  detectSlicers(): Promise<SlicerInfo[]>;
  onExportPlate(layout: PlateLayoutResult): Promise<void> | void;
  onSendToSlicer(slicerId: string, slicerName: string, layout: PlateLayoutResult): Promise<void> | void;
  onClose(): void;
}

const DEFAULT_BODY_FILLS = ['#4c8bf5', '#3fb950', '#d29922', '#a371f7', '#f778ba', '#39c5cf'];

function parsePositive(raw: string, fallback: number): number {
  const v = Number(raw);
  return raw.trim() !== '' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function parseNonNegative(raw: string, fallback: number): number {
  const v = Number(raw);
  return raw.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function PrintPlateDialog(p: PrintPlateDialogProps) {
  const [presetId, setPresetId] = useState<string>('bambu-x1c');
  const [bedWidth, setBedWidth] = useState<string>('256');
  const [bedDepth, setBedDepth] = useState<string>('256');
  const [spacing, setSpacing] = useState<string>('4');
  const [allowRotate90, setAllowRotate90] = useState<boolean>(true);
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(p.bodies.map((b) => [b.id, b.included !== false])),
  );
  const [layFlat, setLayFlat] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(p.bodies.map((b) => [b.id, b.layFlat !== false])),
  );
  const [slicers, setSlicers] = useState<SlicerInfo[]>([]);
  const [selectedSlicer, setSelectedSlicer] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        p.onClose();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [p.onClose]);

  useEffect(() => {
    let alive = true;
    p.detectSlicers()
      .then((list) => {
        if (!alive) return;
        setSlicers(list);
        if (list.length > 0) setSelectedSlicer(list[0].id);
      })
      .catch(() => {
        if (alive) setSlicers([]);
      });
    return () => { alive = false; };
  }, [p.detectSlicers]);

  const widthMm = parsePositive(bedWidth, 256);
  const depthMm = parsePositive(bedDepth, 256);
  const spacingMm = parseNonNegative(spacing, 4);

  const configuredBodies = useMemo<PlateBodyInput[]>(
    () =>
      p.bodies.map((b) => ({
        ...b,
        included: included[b.id] ?? true,
        layFlat: layFlat[b.id] ?? true,
      })),
    [p.bodies, included, layFlat],
  );

  const layout = useMemo(
    () =>
      packPlate(configuredBodies, {
        bedWidthMm: widthMm,
        bedDepthMm: depthMm,
        spacingMm,
        allowRotate90,
      }),
    [configuredBodies, widthMm, depthMm, spacingMm, allowRotate90],
  );

  const placedById = useMemo(() => new Map(layout.placed.map((b) => [b.id, b])), [layout.placed]);
  const overflowById = useMemo(() => new Map(layout.overflow.map((b) => [b.id, b])), [layout.overflow]);

  const onPresetChange = (id: string) => {
    setPresetId(id);
    const preset = findBedPreset(id);
    if (preset && id !== 'custom') {
      setBedWidth(String(preset.widthMm));
      setBedDepth(String(preset.depthMm));
    }
  };

  const onWidthInput = (val: string) => {
    setBedWidth(val);
    setPresetId('custom');
  };

  const onDepthInput = (val: string) => {
    setBedDepth(val);
    setPresetId('custom');
  };

  const handleExport = async () => {
    if (busy || layout.fittedCount === 0) return;
    setBusy(true);
    try {
      await p.onExportPlate(layout);
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    if (busy || layout.fittedCount === 0) return;
    setBusy(true);
    try {
      const slicer = slicers.find((s) => s.id === selectedSlicer);
      await p.onSendToSlicer(slicer?.id ?? '', slicer?.name ?? '', layout);
    } finally {
      setBusy(false);
    }
  };

  const pad = 12;
  const vbW = widthMm + pad * 2;
  const vbH = depthMm + pad * 2;
  const gridStep = widthMm >= 280 || depthMm >= 280 ? 50 : 25;
  const gridXs: number[] = [];
  for (let gx = gridStep; gx < widthMm; gx += gridStep) gridXs.push(gx);
  const gridYs: number[] = [];
  for (let gy = gridStep; gy < depthMm; gy += gridStep) gridYs.push(gy);

  return (
    <div
      class="dlg-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="dlg print-plate-dlg"
        role="dialog"
        aria-label={t('printPlate.title')}
        data-testid="print-plate-dialog"
      >
        <div class="dlg-head print-plate-head">
          <Icon name="print-plate" size={18} />
          <b>{t('printPlate.title')}</b>
          <button
            type="button"
            class="rb-btn"
            aria-label={t('printPlate.close')}
            onClick={p.onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div class="print-plate-body">
          <div class="print-plate-preview-col">
            <div class="print-plate-svg-wrap">
              <svg
                class="print-plate-svg"
                viewBox={`0 0 ${vbW} ${vbH}`}
                role="img"
                aria-label={t('printPlate.preview')}
                data-testid="print-plate-svg"
              >
                {/* Build plate rectangle */}
                <rect
                  x={pad}
                  y={pad}
                  width={widthMm}
                  height={depthMm}
                  rx={3}
                  fill="#161b22"
                  stroke={layout.overflowCount > 0 ? '#e5534b' : '#4b5563'}
                  stroke-width={Math.max(1.2, widthMm / 180)}
                />
                {/* Bed grid lines */}
                {gridXs.map((gx) => (
                  <line
                    key={`gx-${gx}`}
                    x1={pad + gx}
                    y1={pad}
                    x2={pad + gx}
                    y2={pad + depthMm}
                    stroke="#28303d"
                    stroke-width={Math.max(0.5, widthMm / 360)}
                  />
                ))}
                {gridYs.map((gy) => (
                  <line
                    key={`gy-${gy}`}
                    x1={pad}
                    y1={pad + gy}
                    x2={pad + widthMm}
                    y2={pad + gy}
                    stroke="#28303d"
                    stroke-width={Math.max(0.5, widthMm / 360)}
                  />
                ))}
                {/* Usable margin guide */}
                {layout.marginMm > 0 && widthMm > layout.marginMm * 2 && depthMm > layout.marginMm * 2 ? (
                  <rect
                    x={pad + layout.marginMm}
                    y={pad + layout.marginMm}
                    width={widthMm - layout.marginMm * 2}
                    height={depthMm - layout.marginMm * 2}
                    fill="none"
                    stroke="#3b4454"
                    stroke-dasharray="4 3"
                    stroke-width={Math.max(0.6, widthMm / 320)}
                  />
                ) : null}
                {/* Placed bodies (flip Y so bed Y=0 is at the front/bottom of the SVG) */}
                {layout.placed.map((b, i) => {
                  const fill = b.color || DEFAULT_BODY_FILLS[i % DEFAULT_BODY_FILLS.length];
                  const rx = pad + b.x;
                  const ry = pad + (depthMm - b.y - b.depth);
                  const fontSize = Math.max(6, Math.min(11, Math.min(b.width, b.depth) * 0.24));
                  return (
                    <g key={b.id} data-testid={`plate-body-rect-${b.id}`}>
                      <rect
                        x={rx}
                        y={ry}
                        width={Math.max(1, b.width)}
                        height={Math.max(1, b.depth)}
                        fill={fill}
                        fill-opacity={0.72}
                        stroke="#e6edf3"
                        stroke-width={Math.max(0.7, widthMm / 280)}
                        rx={1.5}
                      />
                      {b.width >= 18 && b.depth >= 14 ? (
                        <text
                          x={rx + b.width / 2}
                          y={ry + b.depth / 2}
                          text-anchor="middle"
                          dominant-baseline="central"
                          fill="#ffffff"
                          font-size={fontSize}
                          font-family="system-ui, sans-serif"
                        >
                          {b.name}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </div>

            <div class="print-plate-summary" data-testid="print-plate-summary">
              <span>
                {t('printPlate.summary', {
                  fitted: layout.fittedCount,
                  total: layout.totalIncluded,
                  util: Math.round(layout.utilization * 100),
                })}
              </span>
              {layout.usedBounds ? (
                <span>
                  {t('printPlate.bounds', {
                    width: Math.round(layout.usedBounds.width * 10) / 10,
                    depth: Math.round(layout.usedBounds.depth * 10) / 10,
                  })}
                </span>
              ) : null}
            </div>

            {layout.overflowCount > 0 ? (
              <div class="print-plate-overflow" role="alert" data-testid="print-plate-overflow">
                {t('printPlate.overflowWarn', {
                  count: layout.overflowCount,
                  width: widthMm,
                  depth: depthMm,
                })}
              </div>
            ) : null}
          </div>

          <div class="print-plate-controls-col">
            <div class="print-plate-grid">
              <label class="print-plate-field full">
                <span>{t('printPlate.preset')}</span>
                <select
                  data-testid="print-plate-preset"
                  aria-label={t('printPlate.preset')}
                  value={presetId}
                  onChange={(e) => onPresetChange((e.currentTarget as HTMLSelectElement).value)}
                >
                  {PRINTER_BED_PRESETS.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.id === 'custom' ? pr.name : `${pr.name} (${pr.widthMm} × ${pr.depthMm})`}
                    </option>
                  ))}
                </select>
              </label>

              <label class="print-plate-field">
                <span>{t('printPlate.width')}</span>
                <input
                  type="number"
                  min="20"
                  step="5"
                  data-testid="print-plate-width"
                  aria-label={t('printPlate.width')}
                  value={bedWidth}
                  onInput={(e) => onWidthInput((e.currentTarget as HTMLInputElement).value)}
                />
              </label>

              <label class="print-plate-field">
                <span>{t('printPlate.depth')}</span>
                <input
                  type="number"
                  min="20"
                  step="5"
                  data-testid="print-plate-depth"
                  aria-label={t('printPlate.depth')}
                  value={bedDepth}
                  onInput={(e) => onDepthInput((e.currentTarget as HTMLInputElement).value)}
                />
              </label>

              <label class="print-plate-field">
                <span>{t('printPlate.spacing')}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  data-testid="print-plate-spacing"
                  aria-label={t('printPlate.spacing')}
                  value={spacing}
                  onInput={(e) => setSpacing((e.currentTarget as HTMLInputElement).value)}
                />
              </label>

              <label class="print-plate-check" style="align-self: end; padding-bottom: 4px;">
                <input
                  type="checkbox"
                  data-testid="print-plate-rotate90"
                  checked={allowRotate90}
                  onChange={(e) => setAllowRotate90((e.currentTarget as HTMLInputElement).checked)}
                />
                <span>{t('printPlate.rotate90')}</span>
              </label>
            </div>

            <div class="print-plate-bodies-title">{t('printPlate.bodies')}</div>
            <div class="print-plate-bodies" data-testid="print-plate-bodies">
              {p.bodies.map((b) => {
                const isInc = included[b.id] ?? true;
                const isFlat = layFlat[b.id] ?? true;
                const placed = placedById.get(b.id);
                const over = overflowById.get(b.id);
                const item = placed ?? over;
                return (
                  <div
                    key={b.id}
                    class={`print-plate-row${over ? ' is-overflow' : ''}${!isInc ? ' is-excluded' : ''}`}
                    data-testid={`plate-body-row-${b.id}`}
                  >
                    <input
                      type="checkbox"
                      aria-label={b.name}
                      data-testid={`plate-include-${b.id}`}
                      checked={isInc}
                      onChange={(e) =>
                        setIncluded((prev) => ({
                          ...prev,
                          [b.id]: (e.currentTarget as HTMLInputElement).checked,
                        }))
                      }
                    />
                    <div class="print-plate-row-info">
                      <span class="print-plate-row-name">{b.name}</span>
                      {item ? (
                        <span class="print-plate-row-dims">
                          {`${Math.round(item.width * 10) / 10} × ${Math.round(item.depth * 10) / 10} × ${Math.round(item.height * 10) / 10} mm`}
                        </span>
                      ) : null}
                    </div>
                    <label class="print-plate-check">
                      <input
                        type="checkbox"
                        data-testid={`plate-layflat-${b.id}`}
                        checked={isFlat}
                        disabled={!isInc}
                        onChange={(e) =>
                          setLayFlat((prev) => ({
                            ...prev,
                            [b.id]: (e.currentTarget as HTMLInputElement).checked,
                          }))
                        }
                      />
                      <span>{t('printPlate.layFlat')}</span>
                    </label>
                    {!isInc ? (
                      <span class="print-plate-badge excluded">{t('printPlate.excluded')}</span>
                    ) : over ? (
                      <span class="print-plate-badge overflow">
                        {over.overflowReason === 'too-large' ? t('printPlate.tooLarge') : t('printPlate.overflow')}
                      </span>
                    ) : (
                      <span class="print-plate-badge">{t('printPlate.fits')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div class="print-plate-actions">
          <div class="print-plate-slicer-group">
            {slicers.length > 0 ? (
              <select
                data-testid="print-plate-slicer-select"
                aria-label={t('printPlate.slicer')}
                value={selectedSlicer}
                onChange={(e) => setSelectedSlicer((e.currentTarget as HTMLSelectElement).value)}
              >
                {slicers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              class="rb-btn ok"
              data-testid="print-plate-send"
              disabled={busy || layout.fittedCount === 0}
              onClick={() => void handleSend()}
            >
              {t('printPlate.sendToSlicer')}
            </button>
          </div>
          <button
            type="button"
            class="rb-btn"
            data-testid="print-plate-export"
            disabled={busy || layout.fittedCount === 0}
            onClick={() => void handleExport()}
          >
            {t('printPlate.exportPlate')}
          </button>
          <button type="button" class="rb-btn" data-testid="print-plate-close" onClick={p.onClose}>
            {t('printPlate.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
