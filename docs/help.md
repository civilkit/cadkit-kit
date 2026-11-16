# Contextual help

A round **?** opens a small card (name, one sentence, **Open the guide**) for the tool, editor or wizard in front of you. The card is the first step towards in-app help: the sentence is shown now, the guide link second.

## The map

`apps/cad/src/helpMap.ts` is the table `HELP`: topic id -> `{ page, anchor?, summary? }`.

| Topic id | For |
| --- | --- |
| `guide` | the guide's front page (the global `?` in the status bar) |
| `sketch`, `sketch:<tool id>` | the sketch tools (ids from `packages/sketch/src/registry.ts`, plus `select`) |
| `sketch3d` | the 3D Sketch panel |
| `feature:<type>` | one per `FEATURE_TYPES` entry (the feature editors) |
| `wizard:<id>` | the wizards (gear, propeller, marine, impeller, bearing, screw, washer, nut, standoff, insert, spring, case, fasten, knurl, cornerHoles, mesh, material) |

`page` is relative to the guide root and uses the built `.html` name; `anchor` is a heading id (mdBook: lower case, punctuation dropped, spaces to dashes) or an explicit `<a id="...">` in the guide source. The sketch pages carry one `<a id="tool-<id>">` in each tool's table row.

The name and sentence of each topic are catalogue messages in `locales/help.ts` (`help.<topic>.name`, `help.<topic>.sum`, the colon of a topic id written as a dot: `help.sketch.line.name`). An entry can later carry an inline `summary` string, which wins over the catalogue, for help text that grows beyond a sentence.

`docsBase()` gives the guide root: the site's own `/docs/cad/` on a web origin, `https://civilkit.io/docs/cad/` for a local server and the desktop app. Links are always absolute `https`, so the desktop app's link handler (it opens `http(s)` links in the default browser) takes them.

## The buttons

- `HelpButton` (apps/cad/src/HelpButton.tsx) with `topic`; in every `fedit-head` (the editors pass it to `FeatureEditor` as `headExtra`), in the Status group of the sketch ribbon and the sketch bar (`SketchControls.tool` is the active tool), and in the status bar (`StatusBar help`).
- `HelpHost` is mounted once: it draws the card (placed with `placeTip`, clamped to the window, closed by Escape or a tap outside) and owns **F1** and **?** (not in a text box), which open the card for `currentTopic(...)` from the open wizard, editor or sketch tool.
- A touch target is 44 px: a 32 px circle with an invisible ring (`@media (pointer: coarse)` in app.css).

## Tests

`helpMap.test.ts` parses the guide sources with mdBook's heading ids and fails on a dead page or anchor, on a registered sketch tool or feature type without a topic (the allowlists in the test are empty), and on a topic without a name and one-sentence summary. `HelpButton.test.tsx` covers the button, the card, Escape, outside tap and F1 / ?.

## When the guide changes

A new anchor exists on the public site only after the guide is deployed: `PAGES_DOCS=1 npm run build:pages` builds the guide (mdBook) into the site folder as `docs/cad/`, and the release flow in `docs/releasing.md` and `docs/pages-deploy.md` deploys it. Until then the card's link opens the page at its top (the browser ignores an anchor that is not there). Deploy the docs with the app.
