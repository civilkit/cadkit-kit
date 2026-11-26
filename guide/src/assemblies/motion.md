# Motion studies

A motion study moves an assembly so you can see how it works: a door swinging on its hinge, a drawer sliding out, a gear train turning. You drive a mate with a slider or by dragging a part, find out where and why it stops, and record a motion over time that plays and can be saved as a clip.

Motion only changes what is drawn. Nothing is rebuilt and the model is not changed. Measure, section, mass properties and export use the assembled positions, and a banner says so while a pose is showing.

## Before you start

You need an assembly with at least one mate that can move: a hinge (Revolute), a slider, a slot, a distance, an angle, a gear, a screw or a rack and pinion. See [Assemblies and mates](assemblies.md). With no such mate the Motion list says "No mate can be driven yet" and tells you which mates to add.

Open the **Motion** tab of the ribbon. It has four groups:

| Group | Buttons |
|---|---|
| Drive | **Sliders** (shows the Motion tab of the Outliner in the left panel), **Limits** (Find limits) |
| Study | **New study**, **Key**, **Auto key** |
| Playback | **Play** |
| Clip | **Export** |

The studies and the clip export are in a timeline along the bottom of the view while the Motion tab is open. On a phone they open in a sheet instead.

## Move the mechanism with the sliders

Each movable mate has a row in the Motion list with a slider. Drag the slider and the assembly follows. The row shows the **Value** and the **Min** and **Max** the slider can reach; type new numbers to change the range. The range is a setting of this view. It does not change the mate.

**Clearance (mm)** sets how close one part may come to another. A part stops when it comes closer than this, and the row says which two parts met. Parts that already touch where the motion starts (mated faces) only stop it if one pushes through the other.

**Reset to the assembled pose** puts every slider back.

## Drag a part

You can also move the mechanism directly. In the 3D view, press on a part and drag: the hinge or slide that moves that part follows your cursor, and the part stays under the pointer as far as the mechanism allows.

- A drag takes hold only of parts that some slider moves. A left-drag on a fixed part still orbits the view.
- With **Auto key** on and a study open, the move is recorded as a key at the time shown on the timeline (see below).
- On a mechanism that is slow to solve, such as a gear train, the first drag can take several seconds to start while the first poses are worked out. After that the part follows the cursor in steps of about a second.

## Find limits

Press **Limits** (Find limits) to sweep each slider through its range and report where and why it stops:

- stopped by a limit mate (and which one),
- stopped because one part would hit another (both are named), or would come within the clearance,
- stopped because the mechanism would flip to another position, or because the mates cannot all hold beyond that point,
- or "Reaches ... without stopping".

**Use as range** keeps the limits found as the slider's range. **Copy range to a limit** adds a Limits mate with that range, so the model itself stops there (one undo step). A limit needs two flat faces, or two axes for an angle, to measure between; if there are none the app says so and points you to **Mates > Limits**.

## Make a study

A study is a motion over time. In the timeline:

1. Press **New study**. The sliders open. Set the **Duration (s)**, what happens **When it ends** (Stop, Start over, or Go back and forth), and whether **New keys move** Smoothly or At a steady rate.
2. Move the scrubber to a time.
3. Move the mechanism there: drag a part in the view, or use a slider. With **Auto key** on, the move sets a key at that time. With Auto key off, set the sliders where you want them and press **Key**.
4. Repeat for the other times. The first key of a slider after time 0 also gets a start key at 0 with the value it had before, so the motion begins where the mechanism was.
5. Press **Play**. The **Speed** list (0.25x to 2x) changes the playback rate, and the scrubber moves through the motion by hand.

To change a key, click its mark on the track: the scrubber jumps to its time and the key is selected, then press **Delete key** to remove it. Double-click a track to key at that time. The timeline tells you, once it has worked the whole motion out, either that it runs clear or the first time a part would hit another or the mates cannot all hold.

Studies are saved in the part file, so they come back when you open it.

## Export a clip

Pick the format in the **Clip format** list at the right of the timeline: **WebM video**, **MP4 video**, **Animated GIF** or **PNG frames (ZIP)**. Then press **Export clip** (the **Export** button of the ribbon does the same). A frame counter such as 48 / 121 shows the progress and **Cancel** stops it. If the browser cannot write the chosen video format, the app says so and suggests another; MP4 needs Chrome, Edge or Safari.

## Contact sets

A contact set is a named group of bodies that Motion checks against each other for contact. The panel lists the sets under **Contact sets**: **Add contact set** makes one, you pick its members, a checkbox switches it on or off, and the remove button deletes it. A set can carry a clearance in millimetres. The check compares the actual surfaces of the members, not just their boxes. With **Stop on contact** on, driving a part stops where two members touch, so parts do not pass through each other, and the panel shows a badge such as "A <-> B" naming the two bodies that touch. Motion can also use the sets to find how far a driver can travel before contact.

## Limits

- Motion shows poses. It does not simulate forces, mass, friction or contact dynamics.
- Only gear, screw, rack and pinion, hinge, slider, slot, distance and angle mates can be driven.
- Dragging works on mechanisms where some slider moves the part you grab.

## Next

- [Assemblies and mates](assemblies.md)
- [Checks and diagnostics](../analysis/checks.md)
