# STL import: where a mesh lives

Goal: drop an STL (a scanned head, say), see it, and start sketching on its surface in minutes.

## Decision: a kit-side reference mesh in the document, not a kernel body

Options considered:

| | (a) reference mesh in the document | (b) kernel mesh body |
|---|---|---|
| Weight | typed arrays in the browser and one base64 blob in the file; a 500k triangle scan is a few MB | the kernel's B-rep has no mesh face type; one planar face per triangle is 500k faces, which every regen, tessellation and pick would walk |
| Work | reader, BVH, a viewport layer, a tree row | a new feature, new topology, new tessellation, a new wasm build and gate |
| Sketching | rays hit the BVH in the browser | the kernel would have to pick, project and snap on its own mesh |
| Booleans, fillets | not offered | not realistic on a raw scan either |

The kernel has no mesh concept today (bodies are B-rep; an imported STEP is a B-rep body; `importStep` keeps text). Document-level
display data already has a home that the file carries and undo covers: the `docExtra` fields of `controller.ts` (`cosmeticKnurls`,
`bodyNames`, `appearance`, ...), kept by `setUndoableExtra`, merged into `document()`, ignored by the kernel, written into the
`.ckpart`. The mesh follows the same path, so (a) needs no kernel change.

## Storage

`doc.meshes` is an array of records:

```
{ id, name, visible, opacity, color, wire, unit,
  pos: [x,y,z], rot: [rx,ry,rz] degrees, scale,
  tris, verts, sig, v: base64(Float32 xyz per welded vertex), i: base64(Uint32 triangle corners) }
```

* Vertices are welded at import, so a shared vertex is stored once; the indices make the BVH and the viewer geometry cheap.
* The vertex data is in the file's own frame, scaled to millimetres at import (the unit prompt). Move / rotate / scale are the
  record's transform (`pos`, `rot` XYZ Euler, uniform `scale`), so editing them never touches the blob.
* `sig` (triangle count and a checksum) keys the decoded-geometry cache, so a transform edit does not decode again.
* A mesh is not a feature: no regen, no rebuild, one undo step per change, and it is not part of the kernel's body list, mass or
  exports. (STL export of the part does not include it; mesh to solid conversion is not done.)

## Picking and sketching

* `packages/io/src/meshBvh.ts`: a flat typed-array BVH (median split on the longest axis, 8 triangles a leaf) with `raycast` and
  `closestPoint`. 500k triangles build in about a second natively.
* Rays are taken into the mesh's local frame (the transform is rotation, translation and uniform scale, so distances scale by one
  number).
* Sketch on the mesh: click a point on the surface; the sketch plane is a `plane` feature of mode `frame` through that point with
  the surface normal (and the three base orientations stay on offer through the existing plane chips).
* 3D Sketch: the mesh is a snap target. A click that hits the mesh lands on the surface point (snap kind `mesh`); candidates
  (existing points, corners) still win, the work plane is the fallback when the ray misses. "Fit to surface" resamples a spline
  through its points and projects each sample onto the nearest surface point, giving an ordinary `sketch3d` spline whose points
  lie on the mesh.

## Storage format and SketchUp (added)

The record above is the in-memory form. In files and backups it is packed (`docs/files.md`, "Imported meshes and STEP in the file"): `fmt: 2` with one deflated block replaces `v` / `i`, about 5% of the JSON-number-array size.
A SketchUp import is the same record plus `mats` (colour and opacity per material) and `m` (material index per triangle, triangles sorted by material so each material is one run the viewport draws as one group).
Vertices are welded within a SketchUp face only, so flat shading stays crisp. The model keeps the file's Z-up axes and the record's rotation is the orientation (upright is a rotation of -90 degrees about X).

## Not done

Mesh to solid (shrink wrap, B-rep conversion), remeshing / decimation, mesh booleans, repair beyond reporting, colour or texture
import, OBJ / 3MF import (the reader layout takes them later), sketch constraints to mesh points.
