# Export a feature-tree folder as a part: spec

Status: draft, 2026-10-17. Nothing here is built. Depends on first-class bodies
(`docs/spec-bodies-materials-assemblies.md`, item C) for the geometry flavour. Folders themselves are being added to the
GUI separately (group, rename, ungroup, move).

## Why

A folder such as "Tach gauge" in the speedboat dash is a self-contained piece. The user wants to right-click it and get it
out as a part, either to reuse it or to hand over the geometry.

## Two flavours

### 1. Export the geometry
- Right-click a folder, "Export geometry...", then STEP, STL or `.ckpart` (frozen: a part whose features are the imported
  result).
- Includes the bodies the folder's features created or changed. With first-class bodies this is the set of body ids those
  features touched, taken from the regenerated document, so no dependency analysis is needed.
- Cheap once bodies exist. Before that it can only export whole connected bodies, which may include other folders' features.

### 2. Extract as an editable part
- Right-click, "Extract as part...": a new document holding the folder's features, parameters kept.
- Needs the **dependency closure**: every plane, variable and earlier feature the folder's features reference, found from the
  feature references in the document. Cases:
  - Only references the origin planes and variables: extracts cleanly (most gauge folders).
  - References a feature outside the folder: show the list and offer to include those features, or refuse.
  - References faces by name from outside (for example `F2.S.k1`): these names are not stable in a new document; refuse and
    name them.
- Variables are copied with their values; the script's own parameters travel as variables if they are variables, otherwise as
  literals.
- The extracted part is the same kind of document as any other, so it can become an assembly part later.

## Assembly link (later)

If the extract flow is clean, "Extract as part" is also the first step toward assemblies: the original folder could be
replaced by an instance of the new part. That belongs to the assembly spec (item E), not here.

## Order

1. Geometry export, after first-class bodies.
2. Extract with dependency check (refuse when outside references exist).
3. Offer "include dependencies" if people ask for it.

## Tests

- Folder referencing only origin planes: extracts, the new document regenerates with the same volume as the folder's bodies.
- Folder with an outside reference: extraction lists exactly the outside references.
- Geometry export: STEP re-imports as a valid body with matching volume.
