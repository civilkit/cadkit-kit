// Pure-TypeScript standalone shareable HTML 3D viewer exporter.
// Produces a single self-contained .html file with ZERO external network dependencies:
// embedded body meshes, appearances, and an inline WebGL2/WebGL1 interactive viewer with
// orbit/pan/zoom (mouse + touch), named body visibility toggles, section-plane clipping,
// view presets (Iso/Front/Top/Right/Reset), and dark/light theme support.

import { facetNormal, parseHexColor, type MeshBody } from '@kit/io';
import { fileStem, type ExportNotice, type ExportResult } from './exportFiles';

export interface HtmlViewerResult {
  html: string;
  triangles: number;
  vertices: number;
  bodies: number;
}

export interface EmbeddedBody {
  name: string;
  color: string;
  opacity: number;
  metallic: number;
  roughness: number;
  triangles: number;
  vertices: number;
  /** Little-endian Float32Array (xyz per vertex, mm, Z-up) encoded as base64. */
  positionsB64: string;
  /** Little-endian Float32Array (nx, ny, nz per vertex) encoded as base64. */
  normalsB64: string;
  /** Little-endian Uint32Array (3 vertex indices per triangle) encoded as base64. */
  indicesB64: string;
}

export interface EmbeddedScene {
  title: string;
  units: 'mm';
  upAxis: 'Z';
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  bodies: EmbeddedBody[];
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure-JS base64 encoder for arbitrary Uint8Array buffers (no stack overflow, works in Node & browser). */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const out: string[] = [];
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const trip = (b0 << 16) | (b1 << 8) | b2;
    out.push(
      B64_CHARS[(trip >>> 18) & 63] +
      B64_CHARS[(trip >>> 12) & 63] +
      (i + 1 < len ? B64_CHARS[(trip >>> 6) & 63] : '=') +
      (i + 2 < len ? B64_CHARS[trip & 63] : '='),
    );
  }
  return out.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialize JSON safely for embedding inside a `<script type="application/json">` element. */
function safeJsonForScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function normalizeHex(color: string | undefined): string {
  const rgb = parseHexColor(color) ?? [192, 198, 206];
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Build the compact embedded scene object from CadKit mesh bodies. */
export function buildEmbeddedScene(
  bodies: readonly MeshBody[],
  opts: { name?: string } = {},
): { scene: EmbeddedScene; triangles: number; vertices: number } {
  const live = bodies.filter((b) => Math.floor(b.positions.length / 9) > 0);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const embedded: EmbeddedBody[] = [];
  let totalTriangles = 0;
  let totalVertices = 0;

  live.forEach((b, bi) => {
    const p = b.positions;
    const nT = Math.floor(p.length / 9);
    const key = new Map<string, number>();
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];

    for (let t = 0; t < nT; t++) {
      const fn = facetNormal(p, t);
      for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3;
        let n: [number, number, number] = b.normals
          ? [b.normals[o], b.normals[o + 1], b.normals[o + 2]]
          : fn;
        const l = Math.hypot(n[0], n[1], n[2]);
        n = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : fn;

        const px = Math.fround(p[o]);
        const py = Math.fround(p[o + 1]);
        const pz = Math.fround(p[o + 2]);
        const kk = `${px},${py},${pz}|${Math.round(n[0] * 1000)},${Math.round(n[1] * 1000)},${Math.round(n[2] * 1000)}`;
        let vi = key.get(kk);
        if (vi === undefined) {
          vi = pos.length / 3;
          key.set(kk, vi);
          pos.push(px, py, pz);
          nor.push(n[0], n[1], n[2]);
          if (px < lo[0]) lo[0] = px;
          if (py < lo[1]) lo[1] = py;
          if (pz < lo[2]) lo[2] = pz;
          if (px > hi[0]) hi[0] = px;
          if (py > hi[1]) hi[1] = py;
          if (pz > hi[2]) hi[2] = pz;
        }
        idx.push(vi);
      }
    }

    const fPos = Float32Array.from(pos);
    const fNor = Float32Array.from(nor);
    const uIdx = Uint32Array.from(idx);
    const vertCount = pos.length / 3;
    const triCount = idx.length / 3;
    totalTriangles += triCount;
    totalVertices += vertCount;

    embedded.push({
      name: b.name || `Body ${bi + 1}`,
      color: normalizeHex(b.color),
      opacity: clamp01(b.opacity ?? 1),
      metallic: clamp01(b.metallic ?? 0),
      roughness: clamp01(b.roughness ?? 0.55),
      triangles: triCount,
      vertices: vertCount,
      positionsB64: bytesToBase64(new Uint8Array(fPos.buffer, fPos.byteOffset, fPos.byteLength)),
      normalsB64: bytesToBase64(new Uint8Array(fNor.buffer, fNor.byteOffset, fNor.byteLength)),
      indicesB64: bytesToBase64(new Uint8Array(uIdx.buffer, uIdx.byteOffset, uIdx.byteLength)),
    });
  });

  if (!Number.isFinite(lo[0])) {
    lo[0] = lo[1] = lo[2] = 0;
    hi[0] = hi[1] = hi[2] = 0;
  }

  return {
    scene: {
      title: opts.name || 'CadKit Model',
      units: 'mm',
      upAxis: 'Z',
      bounds: { min: lo, max: hi },
      bodies: embedded,
    },
    triangles: totalTriangles,
    vertices: totalVertices,
  };
}

/** Generate a single self-contained offline HTML 3D viewer document. */
export function meshToHtmlViewer(
  bodies: readonly MeshBody[],
  opts: { name?: string } = {},
): HtmlViewerResult {
  const { scene, triangles, vertices } = buildEmbeddedScene(bodies, opts);
  const title = escapeHtml(scene.title);
  const dx = (scene.bounds.max[0] - scene.bounds.min[0]).toFixed(1);
  const dy = (scene.bounds.max[1] - scene.bounds.min[1]).toFixed(1);
  const dz = (scene.bounds.max[2] - scene.bounds.min[2]).toFixed(1);
  const jsonPayload = safeJsonForScript(scene);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${title} — CadKit 3D Viewer</title>
<style>
:root {
  --bg: #f3f5f8;
  --panel: rgba(255, 255, 255, 0.9);
  --border: rgba(15, 23, 42, 0.12);
  --text: #0f172a;
  --muted: #475569;
  --accent: #2563eb;
  --accent-fg: #ffffff;
  --btn-bg: rgba(255, 255, 255, 0.85);
  --btn-hover: #e2e8f0;
  --shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #11161f;
    --panel: rgba(23, 30, 42, 0.9);
    --border: rgba(248, 250, 252, 0.12);
    --text: #f1f5f9;
    --muted: #94a3b8;
    --accent: #3b82f6;
    --accent-fg: #ffffff;
    --btn-bg: rgba(30, 41, 59, 0.88);
    --btn-hover: #334155;
    --shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
  }
}
:root[data-theme="dark"] {
  --bg: #11161f;
  --panel: rgba(23, 30, 42, 0.9);
  --border: rgba(248, 250, 252, 0.12);
  --text: #f1f5f9;
  --muted: #94a3b8;
  --accent: #3b82f6;
  --accent-fg: #ffffff;
  --btn-bg: rgba(30, 41, 59, 0.88);
  --btn-hover: #334155;
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
#gl { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
#gl:active { cursor: grabbing; }
.hud-top-left { position: fixed; top: 12px; left: 12px; max-width: min(320px, calc(100vw - 24px)); background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; backdrop-filter: blur(10px); box-shadow: var(--shadow); z-index: 10; }
.hud-title { font-size: 15px; font-weight: 600; margin: 0 0 2px; word-break: break-word; }
.hud-meta { font-size: 11px; color: var(--muted); }
.hud-views { position: fixed; top: 12px; right: 12px; display: flex; flex-wrap: wrap; gap: 4px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 5px; backdrop-filter: blur(10px); box-shadow: var(--shadow); z-index: 10; }
.btn { appearance: none; border: 1px solid transparent; background: var(--btn-bg); color: var(--text); border-radius: 6px; padding: 5px 9px; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.12s; }
.btn:hover { background: var(--btn-hover); }
.btn.active { background: var(--accent); color: var(--accent-fg); }
.panel { position: fixed; top: 76px; left: 12px; width: 252px; max-height: calc(100vh - 120px); overflow-y: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; backdrop-filter: blur(10px); box-shadow: var(--shadow); z-index: 10; display: flex; flex-direction: column; gap: 12px; }
.panel.collapsed { width: auto; max-height: none; overflow: visible; padding: 6px 10px; }
.panel.collapsed .panel-content { display: none; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sec-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0; }
.body-actions { display: flex; gap: 4px; }
.body-actions .btn { padding: 2px 6px; font-size: 11px; }
.body-list { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; margin-top: 6px; }
.body-row { display: flex; align-items: center; gap: 7px; padding: 3px 4px; border-radius: 5px; cursor: pointer; user-select: none; }
.body-row:hover { background: var(--btn-hover); }
.swatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--border); flex: 0 0 auto; }
.body-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-box { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.axis-group { display: flex; gap: 3px; }
.axis-group .btn { padding: 3px 8px; font-size: 11px; }
input[type="range"] { width: 100%; accent-color: var(--accent); cursor: pointer; }
.clip-readout { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.hud-hint { position: fixed; bottom: 10px; left: 12px; font-size: 11px; color: var(--muted); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; backdrop-filter: blur(8px); pointer-events: none; z-index: 5; }
.fallback { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; text-align: center; font-size: 15px; }
@media (max-width: 640px) {
  .hud-views { top: auto; bottom: 10px; right: 10px; left: 10px; justify-content: center; }
  .hud-hint { display: none; }
  .panel { max-height: 44vh; }
}
</style>
</head>
<body>
<canvas id="gl" aria-label="${title} 3D viewport"></canvas>

<header class="hud-top-left">
  <h1 class="hud-title">${title}</h1>
  <div class="hud-meta">${scene.bodies.length} ${scene.bodies.length === 1 ? 'body' : 'bodies'} &middot; ${triangles.toLocaleString('en-US')} triangles &middot; ${dx} &times; ${dy} &times; ${dz} mm</div>
</header>

<nav class="hud-views" aria-label="Camera views">
  <button class="btn" data-view="iso" type="button">Iso</button>
  <button class="btn" data-view="front" type="button">Front</button>
  <button class="btn" data-view="top" type="button">Top</button>
  <button class="btn" data-view="right" type="button">Right</button>
  <button class="btn" data-view="reset" type="button">Reset</button>
  <button class="btn" id="theme-btn" type="button" title="Toggle light/dark theme">Theme</button>
</nav>

<aside class="panel" id="panel" aria-label="Model controls">
  <div class="panel-head">
    <span class="sec-title">Controls</span>
    <button class="btn" id="panel-toggle" type="button" style="padding:2px 7px;font-size:11px;">Hide</button>
  </div>
  <div class="panel-content">
    <div>
      <div class="row">
        <span class="sec-title">Bodies</span>
        <div class="body-actions">
          <button class="btn" id="show-all" type="button">All</button>
          <button class="btn" id="hide-all" type="button">None</button>
        </div>
      </div>
      <div class="body-list" id="body-list"></div>
    </div>

    <div class="section-box">
      <div class="row">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;">
          <input type="checkbox" id="clip-on">
          <span>Section plane</span>
        </label>
        <button class="btn" id="clip-flip" type="button" style="padding:2px 7px;font-size:11px;">Flip</button>
      </div>
      <div class="row">
        <div class="axis-group" id="clip-axes">
          <button class="btn" data-axis="0" type="button">X</button>
          <button class="btn" data-axis="1" type="button">Y</button>
          <button class="btn active" data-axis="2" type="button">Z</button>
        </div>
        <span class="clip-readout" id="clip-val">0.0 mm</span>
      </div>
      <input type="range" id="clip-slider" min="0" max="1" step="0.001" value="0.5" aria-label="Section plane position">
    </div>
  </div>
</aside>

<div class="hud-hint">Drag: orbit &middot; Right-drag / Shift: pan &middot; Scroll / Pinch: zoom &middot; Double-click: reset</div>

<script id="scene-data" type="application/json">${jsonPayload}</script>
<script>
(function () {
  'use strict';
  var scene = JSON.parse(document.getElementById('scene-data').textContent);
  var canvas = document.getElementById('gl');
  var gl = canvas.getContext('webgl2', { antialias: true, alpha: false }) ||
           canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) {
    var msg = document.createElement('div');
    msg.className = 'fallback';
    msg.textContent = 'WebGL is not available in this browser.';
    document.body.appendChild(msg);
    return;
  }
  var isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  var hasUint32 = isWebGL2 || !!gl.getExtension('OES_element_index_uint');

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  var vsSrc = [
    'attribute vec3 aPos;',
    'attribute vec3 aNorm;',
    'uniform mat4 uMvp;',
    'uniform mat4 uMv;',
    'varying vec3 vWorldPos;',
    'varying vec3 vViewNorm;',
    'varying vec3 vViewPos;',
    'void main() {',
    '  vWorldPos = aPos;',
    '  vec4 vp = uMv * vec4(aPos, 1.0);',
    '  vViewPos = vp.xyz;',
    '  vViewNorm = mat3(uMv) * aNorm;',
    '  gl_Position = uMvp * vec4(aPos, 1.0);',
    '}'
  ].join('\\n');

  var fsSrc = [
    'precision highp float;',
    'uniform vec3 uColor;',
    'uniform float uOpacity;',
    'uniform float uMetallic;',
    'uniform float uRoughness;',
    'uniform int uClipOn;',
    'uniform vec3 uClipNormal;',
    'uniform float uClipOffset;',
    'varying vec3 vWorldPos;',
    'varying vec3 vViewNorm;',
    'varying vec3 vViewPos;',
    'void main() {',
    '  if (uClipOn == 1 && dot(vWorldPos, uClipNormal) > uClipOffset) discard;',
    '  vec3 N = normalize(vViewNorm);',
    '  float back = 1.0;',
    '  if (!gl_FrontFacing) { N = -N; back = 0.65; }',
    '  vec3 V = normalize(-vViewPos);',
    '  vec3 L1 = normalize(vec3(0.55, 0.75, 0.85));',
    '  vec3 L2 = normalize(vec3(-0.7, -0.3, 0.45));',
    '  float d1 = max(dot(N, L1), 0.0);',
    '  float d2 = max(dot(N, L2), 0.0) * 0.35;',
    '  float hemi = 0.32 + 0.16 * N.y;',
    '  vec3 H1 = normalize(L1 + V);',
    '  float shininess = mix(96.0, 8.0, clamp(uRoughness, 0.05, 1.0));',
    '  float spec = pow(max(dot(N, H1), 0.0), shininess) * mix(0.22, 0.85, uMetallic);',
    '  vec3 base = uColor * back;',
    '  vec3 specCol = mix(vec3(1.0), base, uMetallic);',
    '  vec3 lit = base * (hemi + d1 * 0.68 + d2) + specCol * spec;',
    '  gl_FragColor = vec4(lit, uOpacity);',
    '}'
  ].join('\\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  var prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  var loc = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aNorm: gl.getAttribLocation(prog, 'aNorm'),
    uMvp: gl.getUniformLocation(prog, 'uMvp'),
    uMv: gl.getUniformLocation(prog, 'uMv'),
    uColor: gl.getUniformLocation(prog, 'uColor'),
    uOpacity: gl.getUniformLocation(prog, 'uOpacity'),
    uMetallic: gl.getUniformLocation(prog, 'uMetallic'),
    uRoughness: gl.getUniformLocation(prog, 'uRoughness'),
    uClipOn: gl.getUniformLocation(prog, 'uClipOn'),
    uClipNormal: gl.getUniformLocation(prog, 'uClipNormal'),
    uClipOffset: gl.getUniformLocation(prog, 'uClipOffset')
  };

  var gpuBodies = scene.bodies.map(function (b) {
    var posBytes = b64ToBytes(b.positionsB64);
    var norBytes = b64ToBytes(b.normalsB64);
    var idxBytes = b64ToBytes(b.indicesB64);
    var posArr = new Float32Array(posBytes.buffer, posBytes.byteOffset, posBytes.byteLength / 4);
    var norArr = new Float32Array(norBytes.buffer, norBytes.byteOffset, norBytes.byteLength / 4);
    var u32Idx = new Uint32Array(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength / 4);

    var pBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
    gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.STATIC_DRAW);

    var nBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuf);
    gl.bufferData(gl.ARRAY_BUFFER, norArr, gl.STATIC_DRAW);

    var iBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    var idxType = hasUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    var idxData = hasUint32 ? u32Idx : new Uint16Array(u32Idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

    return {
      name: b.name,
      color: hexToRgb(b.color),
      hex: b.color,
      opacity: b.opacity,
      metallic: b.metallic,
      roughness: b.roughness,
      visible: true,
      pBuf: pBuf,
      nBuf: nBuf,
      iBuf: iBuf,
      count: u32Idx.length,
      idxType: idxType
    };
  });

  var bmin = scene.bounds.min;
  var bmax = scene.bounds.max;
  var center = [(bmin[0] + bmax[0]) * 0.5, (bmin[1] + bmax[1]) * 0.5, (bmin[2] + bmax[2]) * 0.5];
  var radius = Math.max(1e-3, Math.hypot(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]) * 0.5);

  var cam = { target: center.slice(), yaw: Math.PI * 0.25, pitch: 0.55, dist: radius * 2.8 };
  var clip = { on: false, axis: 2, flip: false, frac: 0.5 };

  function setPreset(view) {
    cam.target = center.slice();
    cam.dist = radius * 2.8;
    if (view === 'front') { cam.yaw = 0; cam.pitch = 0; }
    else if (view === 'top') { cam.yaw = 0; cam.pitch = Math.PI * 0.499; }
    else if (view === 'right') { cam.yaw = Math.PI * 0.5; cam.pitch = 0; }
    else { cam.yaw = Math.PI * 0.25; cam.pitch = 0.55; }
    draw();
  }

  function mat4Mul(a, b) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function mat4Perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy * 0.5);
    var nf = 1 / (near - far);
    var m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
    return m;
  }

  function norm3(v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function mat4LookAt(eye, tgt, up) {
    var z = norm3([eye[0] - tgt[0], eye[1] - tgt[1], eye[2] - tgt[2]]);
    var x = norm3(cross3(up, z));
    var y = cross3(z, x);
    var m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot3(x, eye);
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot3(y, eye);
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2]; m[14] = -dot3(z, eye);
    m[15] = 1;
    return m;
  }

  function isDarkTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function draw() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);

    if (isDarkTheme()) gl.clearColor(0.067, 0.086, 0.122, 1);
    else gl.clearColor(0.953, 0.961, 0.973, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    // Z-up spherical orbit: yaw=0 looks from -Y toward +Y (Front view)
    var eye = [
      cam.target[0] + cam.dist * cp * sy,
      cam.target[1] - cam.dist * cp * cy,
      cam.target[2] + cam.dist * sp
    ];
    var up = Math.abs(sp) > 0.999 ? [sy, -cy, 0] : [0, 0, 1];
    var mv = mat4LookAt(eye, cam.target, up);
    var near = Math.max(radius * 0.002, cam.dist - radius * 6);
    var far = Math.max(near + 10, cam.dist + radius * 10);
    var proj = mat4Perspective(Math.PI / 4, w / h, near, far);
    var mvp = mat4Mul(proj, mv);

    gl.uniformMatrix4fv(loc.uMv, false, mv);
    gl.uniformMatrix4fv(loc.uMvp, false, mvp);

    var clipN = [0, 0, 0];
    clipN[clip.axis] = clip.flip ? -1 : 1;
    var spanMin = bmin[clip.axis], spanMax = bmax[clip.axis];
    var posVal = spanMin + (spanMax - spanMin) * clip.frac;
    var clipOff = clip.flip ? -posVal : posVal;
    gl.uniform1i(loc.uClipOn, clip.on ? 1 : 0);
    gl.uniform3f(loc.uClipNormal, clipN[0], clipN[1], clipN[2]);
    gl.uniform1f(loc.uClipOffset, clipOff);

    function renderPass(translucent) {
      if (translucent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
      for (var i = 0; i < gpuBodies.length; i++) {
        var b = gpuBodies[i];
        if (!b.visible) continue;
        if ((b.opacity < 0.999) !== translucent) continue;
        gl.uniform3f(loc.uColor, b.color[0], b.color[1], b.color[2]);
        gl.uniform1f(loc.uOpacity, b.opacity);
        gl.uniform1f(loc.uMetallic, b.metallic);
        gl.uniform1f(loc.uRoughness, b.roughness);

        gl.bindBuffer(gl.ARRAY_BUFFER, b.pBuf);
        gl.enableVertexAttribArray(loc.aPos);
        gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, b.nBuf);
        gl.enableVertexAttribArray(loc.aNorm);
        gl.vertexAttribPointer(loc.aNorm, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.iBuf);
        gl.drawElements(gl.TRIANGLES, b.count, b.idxType, 0);
      }
      gl.depthMask(true);
    }

    renderPass(false);
    renderPass(true);
  }

  function panBy(dx, dy) {
    var scale = cam.dist * 0.0018;
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    var right = [cy, sy, 0];
    var up = [-sp * sy, sp * cy, cp];
    cam.target[0] += (-dx * right[0] + dy * up[0]) * scale;
    cam.target[1] += (-dx * right[1] + dy * up[1]) * scale;
    cam.target[2] += (-dx * right[2] + dy * up[2]) * scale;
  }

  // Mouse interaction
  var drag = null;
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) {
    drag = { mode: (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.mode === 'orbit') {
      cam.yaw -= dx * 0.007;
      cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.007));
    } else {
      panBy(dx, dy);
    }
    draw();
  });
  window.addEventListener('mouseup', function () { drag = null; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var factor = Math.exp(e.deltaY * 0.0012);
    cam.dist = Math.max(radius * 0.15, Math.min(radius * 30, cam.dist * factor));
    draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', function () { setPreset('iso'); });

  // Touch interaction (1-finger orbit, 2-finger pinch + pan)
  var touchState = null;
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      touchState = { mode: 'orbit', x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length >= 2) {
      var t0 = e.touches[0], t1 = e.touches[1];
      touchState = {
        mode: 'pinch',
        x: (t0.clientX + t1.clientX) * 0.5,
        y: (t0.clientY + t1.clientY) * 0.5,
        dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
      };
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!touchState) return;
    if (touchState.mode === 'orbit' && e.touches.length === 1) {
      var dx = e.touches[0].clientX - touchState.x;
      var dy = e.touches[0].clientY - touchState.y;
      touchState.x = e.touches[0].clientX;
      touchState.y = e.touches[0].clientY;
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.008));
      draw();
    } else if (e.touches.length >= 2) {
      var t0 = e.touches[0], t1 = e.touches[1];
      var mx = (t0.clientX + t1.clientX) * 0.5;
      var my = (t0.clientY + t1.clientY) * 0.5;
      var nd = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (touchState.mode === 'pinch') {
        panBy(mx - touchState.x, my - touchState.y);
        if (nd > 0 && touchState.dist > 0) {
          cam.dist = Math.max(radius * 0.15, Math.min(radius * 30, cam.dist * (touchState.dist / nd)));
        }
      }
      touchState = { mode: 'pinch', x: mx, y: my, dist: nd };
      draw();
    }
  }, { passive: false });
  canvas.addEventListener('touchend', function () { touchState = null; });

  // View preset buttons
  var viewBtns = document.querySelectorAll('[data-view]');
  for (var i = 0; i < viewBtns.length; i++) {
    viewBtns[i].addEventListener('click', function () { setPreset(this.getAttribute('data-view')); });
  }

  // Theme toggle
  document.getElementById('theme-btn').addEventListener('click', function () {
    document.documentElement.setAttribute('data-theme', isDarkTheme() ? 'light' : 'dark');
    draw();
  });

  // Panel collapse
  var panel = document.getElementById('panel');
  var panelToggle = document.getElementById('panel-toggle');
  panelToggle.addEventListener('click', function () {
    var c = panel.classList.toggle('collapsed');
    panelToggle.textContent = c ? 'Show' : 'Hide';
  });

  // Body list toggles
  var bodyList = document.getElementById('body-list');
  var bodyChecks = [];
  gpuBodies.forEach(function (b) {
    var row = document.createElement('label');
    row.className = 'body-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', function () { b.visible = cb.checked; draw(); });
    var sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = b.hex;
    var nm = document.createElement('span');
    nm.className = 'body-name';
    nm.textContent = b.name;
    nm.title = b.name;
    row.appendChild(cb);
    row.appendChild(sw);
    row.appendChild(nm);
    bodyList.appendChild(row);
    bodyChecks.push({ cb: cb, body: b });
  });
  document.getElementById('show-all').addEventListener('click', function () {
    bodyChecks.forEach(function (x) { x.cb.checked = true; x.body.visible = true; });
    draw();
  });
  document.getElementById('hide-all').addEventListener('click', function () {
    bodyChecks.forEach(function (x) { x.cb.checked = false; x.body.visible = false; });
    draw();
  });

  // Section plane controls
  var clipOn = document.getElementById('clip-on');
  var clipSlider = document.getElementById('clip-slider');
  var clipVal = document.getElementById('clip-val');
  var clipAxes = document.querySelectorAll('#clip-axes [data-axis]');
  function updateClipReadout() {
    var v = bmin[clip.axis] + (bmax[clip.axis] - bmin[clip.axis]) * clip.frac;
    clipVal.textContent = v.toFixed(1) + ' mm';
  }
  clipOn.addEventListener('change', function () { clip.on = clipOn.checked; draw(); });
  clipSlider.addEventListener('input', function () {
    clip.frac = parseFloat(clipSlider.value);
    if (!clip.on) { clip.on = true; clipOn.checked = true; }
    updateClipReadout();
    draw();
  });
  document.getElementById('clip-flip').addEventListener('click', function () {
    clip.flip = !clip.flip;
    if (!clip.on) { clip.on = true; clipOn.checked = true; }
    draw();
  });
  for (var j = 0; j < clipAxes.length; j++) {
    clipAxes[j].addEventListener('click', function () {
      clip.axis = parseInt(this.getAttribute('data-axis'), 10);
      for (var k = 0; k < clipAxes.length; k++) clipAxes[k].classList.toggle('active', clipAxes[k] === this);
      updateClipReadout();
      draw();
    });
  }
  updateClipReadout();

  window.addEventListener('resize', draw);
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', draw);
  }
  draw();
})();
</script>
</body>
</html>
`;

  return { html, triangles, vertices, bodies: scene.bodies.length };
}

const noBody: ExportNotice = { level: 'error', key: 'io.noBody' };

function refNotices(refs: readonly MeshBody[], name: string): ExportNotice[] {
  if (!refs.length) return [];
  const triangles = refs.reduce((n, b) => n + Math.floor(b.positions.length / 9), 0);
  return [{ level: 'info', key: 'io.refMeshesIncluded', params: { name, count: refs.length, triangles } }];
}

/** Standalone interactive HTML 3D viewer: single offline .html file with WebGL orbit, body toggles and section plane. */
export function exportHtmlViewer(
  bodies: readonly MeshBody[] | null,
  partName: string | undefined,
  refs: readonly MeshBody[] = [],
): ExportResult {
  const all = [...(bodies ?? []), ...refs];
  if (!all.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToHtmlViewer(all, { name: partName || stem });
  if (!r.triangles) return { notices: [noBody] };
  const name = `${stem}.html`;
  const notices: ExportNotice[] = [
    { level: 'info', key: 'io.doneHtml', params: { name, triangles: r.triangles, bodies: r.bodies } },
    ...refNotices(refs, name),
  ];
  return { file: { name, data: r.html, mime: 'text/html;charset=utf-8' }, notices };
}
