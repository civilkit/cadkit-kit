# Patterns, mirror and scale

Patterns repeat a feature in a row or around an axis. Mirror reflects a feature, or the whole body, about a plane. Scale makes the part larger or smaller. All three work on features and bodies that already exist.

## Seeds: what gets repeated

Linear pattern, Circular pattern and Mirror copy **features**, not faces. The feature that is repeated is called the **seed**. A seed is a feature that made material or removed it: an extrude, a cut, a revolve, a hole, a sweep, a loft, or an earlier pattern.

- The copies are combined with the body in the same way as the seed. Copies of a cut cut, and copies of a boss add.
- A copy that falls outside the body does nothing, and it is not an error. If a pattern seems to do nothing, check that the copies actually land on the body.
- A pattern of a pattern is allowed.

The command chooses the seed for you: the feature selected in the feature tree, or if none is selected, the last feature that is not a sketch, plane, axis or pattern. Select the feature in the tree before you run the command if you want a different one. In the Editor the seed appears under **Features to repeat**, as a list of feature ids such as `F4`, separated by commas.

When a seed is a hole with a thread, the Editor shows what is meant ("Hole F4 + Thread F5"). See [Threads in patterns](#threads-in-patterns).

## Linear pattern

A linear pattern makes copies of the seed in a row.

1. Select the feature in the tree (optional).
2. Choose **Home > Pattern > Linear pattern** (Shift+L). You can also right-click a face or the body and choose it there.
3. Adjust the Editor and confirm.

![A bar with a pocket repeated three times along its length and the Linear pattern editor open showing Count and Spacing.](../img/linear-pattern.png)

| Option | What it does | Default |
|---|---|---|
| Features to repeat | The seeds, as feature ids. | The seed chosen as above |
| Count | Number of instances **including the seed**. A count of 1 or less makes no copies. | 3 |
| Spacing | Distance between neighbouring copies, in mm. | About 20% of the body length along the pattern direction, rounded to a tidy value (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 times a power of ten), at least 1 mm |
| Reverse direction | Copies go towards the negative direction. | Off |
| Carry threads | Copy the threads of the seeds too (see below). Shown only when the part contains threads. | On |

The direction is a world axis (X, Y or Z). A new pattern uses the axis along which the body is longest. The Editor does not let you change the direction. If you need a different one, use **Reverse direction** for the opposite way, or make the pattern with the move and rotate ball (see [Moving things](transforms.md)), which can make a row along any direction you aim it.

## Circular pattern

A circular pattern turns copies of the seed around an axis.

Choose **Home > Pattern > Circular pattern** (Shift+P). It is on the same button as Linear pattern: click the small triangle to open the list.

| Option | What it does | Default |
|---|---|---|
| Features to repeat | The seeds. | The seed chosen as above |
| Axis | X axis, Y axis or Z axis. The axis passes through the model origin. | The axis along the body's shortest dimension |
| Count | Number of instances including the seed. | 3 |
| Angle | With Equal spacing: the total angle the copies are spread over. Without it: the step between neighbours. In degrees. | 360 |
| Equal spacing | On: copies are spread evenly, so 360 degrees with 4 copies puts them 90 degrees apart, and any smaller total puts the last copy exactly at the Angle. Off: the Angle is the gap between neighbours. | On |
| Reverse direction | Turns the other way. | Off |
| Carry threads | As for Linear pattern. | On |

Known limits of the circular pattern:

- The axis is always a world axis through the origin. It is not the centre of the part, and not the seed's own axis. If your seed is not centred on the axis you want, put the part's origin there, or use the move and rotate ball's radial pattern. See [Moving things](transforms.md).
- A seed that ends up outside the body after turning produces no change and no error.

## Mirror

Mirror reflects the seed about a plane. The copy is the seed's mirror image on the other side.

1. Select the feature in the tree (optional).
2. Select one flat face if you want to mirror about that face (optional).
3. Choose **Features > Modify > Mirror** (Shift+M).

With exactly one face selected, the mirror plane is that face. Otherwise it is the Right plane. The Editor has **Features to repeat**, **Plane** (Pick sets it from a selected face), and a checkbox whose label is the raw field name, `body` (there is no friendlier text for it). Tick it to reflect the whole body made so far and unite it with itself. A reflection that lies clear of the body is added as a separate body.

For the exact definitions of the three features, see the kernel book: [linear pattern](/docs/cad/kernel/format/features-patterns.html#lpattern), [circular pattern](/docs/cad/kernel/format/features-patterns.html#cpattern) and [mirror](/docs/cad/kernel/format/features-patterns.html#mirror).

## Threads in patterns

A pattern or mirror carries the threads of its seeds onto the copies, so a threaded hole patterned six times has six threads. When the part contains threads, the Editor shows a **Threads** section that lists the seeds in words and has a **Carry threads** checkbox (on by default).

- Off: the copies are plain holes and shafts. List a thread feature itself under Features to repeat to copy just that one.
- The copies are not separate tree rows. The seed and its thread show a note "patterned by F7" in the tree. Edit the source thread and every copy follows. If you try to add a thread to a face that gets its thread from a pattern, the app edits the source thread instead and says so.
- A drawing callout for a threaded hole that is patterned reads, for example, `4x M5 THRU`.

See [Holes and threads](holes.md).

## Scale

Scale makes the part bigger or smaller without changing how its features are named.

Choose **Features > Modify > Scale**. It is enabled when the part has a solid. A new Scale doubles the whole part about its centre of mass. Change it in the Editor.

| Option | What it does | Default |
|---|---|---|
| Same in every direction | One factor for all directions. Untick it for a factor per axis. | On |
| Factor | The scale factor. A plain number. Must be above 0. | 2 |
| Factor X, Factor Y, Factor Z | One factor per axis. Shown when Same in every direction is off. | The same value as Factor |
| About | The point that stays fixed: Centre of mass or Origin. | Centre of mass |
| Bodies | Which bodies are scaled. It shows "The whole part". | The whole part |

Scale is exact for flat faces, for cylinders and cones stretched along their axis, for free-form faces, and for spheres and tori under a uniform factor. It is refused, with a hint, for the cases it could not keep exact: round faces stretched across their axis, a sphere or torus with different factors per axis, and surfaces made by revolving, extruding, screw or offset operations. The part is left as it was. Negative factors are refused: use Mirror instead.

Scale acts on the bodies as they are at that point in the history. Features added after it work on the scaled part. See [scale](/docs/cad/kernel/format/features-patterns.html#scale) in the kernel book.

## Not available

These are known in the file format but cannot be built yet, so the app has no command for them:

- Patterns driven by a sketch of points, a curve, or a fill of a face.
- A second direction for a linear pattern, and spacing by total extent.
- Dome, split line and offset surface.

To copy whole bodies, use **Copy** in the Bodies panel. See [Bodies and combining](bodies.md).

## Common problems

| Symptom | Fix |
|---|---|
| The pattern shows no copies | Copies fall outside the body. Check Count, Spacing and Reverse direction. |
| The wrong feature is repeated | Select the right feature in the tree before running the command, or edit Features to repeat. |
| "a face or edge it uses no longer exists" | The seed was deleted or renamed by an earlier edit. See [The feature tree and history](history.md). |
| Circular pattern rotates about the wrong centre | The axis goes through the origin. Move the part or use the radial pattern on the move and rotate ball. |
| Scale is refused | See the cases above. Scale the sketch before extruding instead, or use uniform factors. |

## Next

- [Moving things: the move / rotate ball and handles](transforms.md)
- [Bodies and combining](bodies.md)
- [Holes and threads](holes.md)
