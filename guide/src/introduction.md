# Welcome to CadKit

CadKit is a parametric CAD application that runs in your web browser. You sketch on a plane, turn the sketch into a solid, add holes, fillets and patterns, and every step is kept in a history you can edit later. This page says what CadKit is, what it needs, how this guide is organised and where to look when something does not work.

## What CadKit is

A part in CadKit is a list of features: sketches, extrudes, holes, fillets, patterns and so on. The list is the model. Change a dimension in an early sketch and CadKit rebuilds every feature after it. Nothing is baked into a mesh, so you can come back to a part months later and change it.

You can:

- sketch with lines, arcs, circles, splines, text and more, and control the sketch with constraints and dimensions;
- build solids and surfaces from sketches, and shape them with fillets, chamfers, shells, drafts, patterns and mirrors;
- link dimensions to named variables and keep several configurations of one part;
- put parts together in assemblies with mates, and make drawings from them;
- measure, check and inspect a part, and run design checks against rules you choose;
- import STEP, SolidWorks, SketchUp and DXF files, and export STEP, STL, OBJ and DXF;
- drive the whole application from scripts or from an AI agent.

## What it runs in

CadKit runs entirely in a current desktop web browser that supports WebGL. Nothing has to be installed.

- **The geometry kernel runs inside your browser.** The built-in kernel is compiled to WebAssembly, so your parts are built on your own computer and stay there. If you want more speed you can instead connect to a kernel service running on the same computer. See [The local kernel service](automation/local-kernel.md).
- **Your work is stored in the browser and in files you save.** The app keeps an automatic backup while you work, and saves parts as `.ckpart` files that you keep wherever you like. See [Saving and opening](files/files.md).
- **It can be installed and used offline.** See [Install as an app and work offline](reference/pwa.md).
- **One feature needs a Chromium browser.** Listing the fonts installed on your computer (for the Text tool) only works in Chrome and Edge. Everything else is the same in any browser that runs the app.

## How this guide is organised

Read the first two parts in order the first time; after that, use the guide as a reference.

| Part | What it covers |
| --- | --- |
| [Getting started](getting-started/first-part.md) | A complete first part, a tour of the window, moving around the model, selecting, and settings. |
| [Sketching](sketching/start.md) | Starting a sketch, every sketch tool, constraints and dimensions, offsets, text, and what to do when a sketch will not solve. |
| Modelling | Solids, edges, holes, patterns, transforms, surfaces, bodies, variables and the feature tree. |
| Assemblies and appearance | Assemblies and mates, materials and colours. |
| Files | Saving, opening, importing, exporting and drawings. |
| Checking your work | Measure, inspect, checks and design checks. |
| Library and wizards | Sample parts, parametric wizards and catalog parts. |
| Automation | Scripting, the MCP server for agents, and the local kernel service. |
| Reference | Every command and shortcut, offline use, languages, troubleshooting, limits and a glossary. |

Button and menu names are in **bold**; some bold words are run-in headings. Keys are written as `Ctrl+S`; on a Mac, `Ctrl` means the Command key wherever CadKit accepts either.

All dimensions are in millimetres. Angles are in degrees.

## The kernel book

The geometry kernel and the part format have their own book, published beside this guide at [/docs/cad/kernel/](/docs/cad/kernel/introduction.html). You do not need it to use CadKit. Reach for it when you want to know exactly what is stored in a `.ckpart` file ([the part format](/docs/cad/kernel/format/overview.html)), how a program talks to the kernel ([the protocol](/docs/cad/kernel/protocol/overview.html)), or what a validation check or error code means ([validation](/docs/cad/kernel/validation/overview.html)).

## Getting help

- **Command search.** Press `F`, or click **Search commands** in the top bar, and type part of a command's name. Every command in the application is listed there with its shortcut. See [The interface](getting-started/interface.md).
- **Tooltips.** Hover a button to see its full name, its shortcut and a one-line description.
- **The Diagnostics tab.** When an edit breaks the model, open the drawer (`\`) and choose **Diagnostics**. It names the feature that failed first, says why in plain words, and offers **Undo this change**. See [Checks and diagnostics](analysis/checks.md).
- **Troubleshooting.** [Troubleshooting](reference/troubleshooting.md) lists the problems people meet most often, and [Limits and known gaps](reference/limits.md) lists what CadKit cannot do yet. If a sketch will not behave, start with [When a sketch will not solve](sketching/troubleshooting.md).
- **Samples.** Click **Samples** in the top bar to open finished parts and take them apart. See [The library and samples](library/library.md).

## Who this guide is for

It is for someone who wants to model, import, export and check parts. You do not need to know how the application is built. If you have used another parametric CAD system you will find the ideas familiar (sketch, feature, constraint, history), and the tour in [The interface](getting-started/interface.md) shows where CadKit puts them.

## Next

- [Your first part](getting-started/first-part.md)
- [The interface](getting-started/interface.md)
