# View navigation: up axis, orbit mode, pivot

Settings > Navigation (and the **Up axis** button on the ribbon View tab, command `toggle-up-axis`). Stored in the browser
under `cad.navPrefs`: `{ upAxis: 'y' | 'z', orbitMode: 'turntable' | 'trackball', orbitPivot: 'centre' | 'cursor' | 'selection' }`.
Code: `packages/viewport/src/camerarig.ts` (pure math), `orbitrig.ts` (hooks OrbitControls), `apps/cad/src/navPrefs.ts`.

These settings change the **camera only**. Part coordinates, sketches, the three reference planes (Front = XY, Top = XZ,
Right = ZY, names and geometry), exports and files are identical on either setting; a part opened on either is the same part.

## Up axis

| | Y up (default, SolidWorks style) | Z up (Onshape, Fusion, Blender style) |
|---|---|---|
| camera up vector | +Y | +Z |
| turntable axis | Y | Z |
| ground grid | XZ plane, under the part's lowest Y | XY plane, under the part's lowest Z |
| Top (key 1) | camera on +Y, looks down | camera on +Z, looks down onto the XY plane |
| Front (2) | camera on +Z | camera on -Y |
| Right (3) | camera on +X | camera on +X |
| Back (4) / Left (5) / Bottom (6) | opposite of Front / Right / Top | opposite of Front / Right / Top |
| Iso (7) | camera towards (1, 0.8, 1) | camera towards (1, -1, 0.8) |
| view cube | TOP on +Y, FRONT on +Z | TOP on +Z, FRONT on -Y, BACK on +Y |

The standard views follow the **up axis**, not the named reference planes: with Z up, Top looks at the XY plane even though
the plane called "Top" is XZ. The view cube, the 1 to 7 keys and the ribbon Views menu all use the same table, so the cube,
the orbit and the shortcuts always agree. The cube's +X/+Y/+Z arms keep pointing at the world axes.

Switching the up axis keeps the target and the distance, and keeps the camera on the same side of the model (the same face
still faces the camera); only the screen is turned so the new axis is up. A camera that sat on the new axis (for example
Front under Y up, switched to Z up) is nudged a hair off the pole. With a sketch open, the camera is left looking normal to
its plane.

The view cube's arrow ring (see the guide, Moving around the model; its buttons are four switchable groups, a phone starting with turn left/right alone) turns the view about screen axes. Left and right turn about the world up axis while the view is upright, so an iso view stays at its elevation; up and down tilt about the screen's horizontal axis and stop on the pole view instead of crossing it from an off-axis view. A rolled view, or a pole view, turns rigidly about the screen's own axes, so four quarter turns always return exactly (`packages/viewport/src/viewnav.ts`). Poles are reached with the screen's up pointing away from the front on Top and towards it on Bottom.

"Look normal" on a sketch plane points the camera along the plane normal with the sketch's own v axis up, on either setting.

## Orbit mode

* **Turntable** (default): left/right spins around the world up axis, up/down tilts, the up axis never rolls and the tilt
  stops just short of the poles.
* **Trackball**: free rotation about the screen axes through the pivot; the up vector is carried along, so the view can roll
  and go over the pole.

The mouse-button mapping is not part of these settings: OrbitControls still turns pointer movement into rotate angles and
`OrbitRig` applies them (`_rotateLeft` / `_rotateUp` are intercepted), so changes to which button orbits do not touch this.

## Orbit around

* **Model centre** (default): the camera target, as before.
* **Cursor**: the point on the model under the pointer at the start of the drag (falls back to the target on empty space).
* **Selection**: the middle of the selected faces/edges (falls back to the target with nothing selected).

The rotation is rigid about the pivot (camera and target turn together), so the pivot keeps its distance from the camera.

## Things that assume a Y-up world

Fixed: ground grid, view cube labels, standard views, hemisphere light direction (sky is the up axis), turntable pole clamp.
Left alone because they are not tied to world up: the key light and studio environment (camera-relative), reference planes,
sketch grid, triball/move handles (axis-aligned world axes, colours unchanged), dimension labels (screen-facing sprites).
The box dimension layer (`buildBoxDimensions(box, up)`) is laid out for the up axis:
but with Z up they are laid out in a frame turned a quarter turn about X (length along X, height along Z, depth along Y).
