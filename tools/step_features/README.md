# STEP to feature history

The app's **Recognise features (beta)** (apps/cad/src/recognise/) is built from this: the converter and the slice analysis live there, the browser build of quiddity is `tools/quiddity_wasm/` (built by `tools/build_quiddity_wasm.sh`), and this folder keeps the command-line runner used to try files against the kernel.

## The spike

Turns the feature records [quiddity](https://github.com/pzfreo/quiddity) (Apache-2.0) recognises in a STEP file into a kit script, then rebuilds it in the headless kernel and checks the volume against the file. No quiddity code is linked or vendored; the converter reads its JSON.

    node tools/step_features/run.mjs part.step --quiddity /path/to/quiddity

Pipeline: quiddity JSON + our own STEP import (box, mesh volume, mesh slices) -> `apps/cad/src/recognise/convert.mjs` -> script -> kernel -> volume check (0.5 %).

## What rebuilds

| Shape | How | Result |
|---|---|---|
| Plain prism, with holes, pockets, corner fillets | stock box, then cuts | exact on the plate fixture |
| Prism with an outline (L-bracket) | outline from mesh slices at 10/50/90 % must agree; `polygon` + extrude | exact (0.0000 %) |
| Turned body on a plate | plate, then one revolved profile (shell or solid) from circular slices | 0.047 % |

## What does not

Multi-plate sheet-metal assemblies (Levellight: 151 faces) fit neither a prism nor a plate plus revolve. They need per-body decomposition and a removal order, which the STEP file does not carry. Counterbores and countersinks are cut as plain holes. The turned path assumes a Y axis, a plate starting at 0 and a part centred on the axis.

## Product recommendation

A post-import "Recognise features" action (not part of the import dialog): the import stays fast, the result is a labelled folder of features, and it is only offered as a replacement for the imported solid when the rebuilt volume matches within 0.5 % (the existing `referenceBody.ts` rule). The quiddity wasm would be built from its documented cargo recipe, pinned, shown on the Licences page, and lazy-loaded in a worker on first use. No prebuilt wasm or npm package exists today.
