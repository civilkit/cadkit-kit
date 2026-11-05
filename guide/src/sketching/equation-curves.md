# Equation curves

An equation curve is a curve you describe with two formulas instead of drawing it: `x(t)` and `y(t)`. Think of `t` as a clock that moves a pen; as `t` runs from its start to its end, the pen draws the curve. Circles, ellipses, waves, spirals and gear involutes are all a line or two of formula.

The part keeps the formulas, not the points. When a variable used in a formula changes, the curve is drawn again from the formula.

## Draw one

1. Open a sketch. See [Starting a sketch](start.md).
2. Choose **Equation curve** in the **Draw** group (with the splines).
3. Click where the curve should start. A wave is placed there at once and its panel opens.
4. Type the formulas, or pick a curve in **Start from** (wave, circle, ellipse, spiral, gear involute, Lissajous figure) and change it.

| Field | Meaning |
| --- | --- |
| **x(t)**, **y(t)** | Formulas of `t`, in millimetres. |
| **t from**, **t to** | The range of `t`. A number, or a formula of your variables. |
| **Tolerance** | How far the drawn curve may be from the formulas, in millimetres (0.01 by default). |

While you type, the panel checks the formulas and says how many points the curve needs, or what is wrong. A change only goes into the sketch when it works, so a typing mistake never breaks the sketch.

5. Click **Done**. To edit the curve later, choose **Select** and click it. **Delete curve** removes it.

## Writing formulas

Formulas use the same rules as every number field: `+ - * / ^`, brackets, `sqrt`, `sin`, `cos`, `tan`, `abs`, `min`, `max`, `pow`, `atan2`, `exp`, `ln` and the others, and `pi`.

**Angles are in degrees.** `sin(90)` is 1, and a full turn is `t` from 0 to 360.

| Curve | x(t) | y(t) | t from | t to |
| --- | --- | --- | --- | --- |
| Circle, radius 20 | `20*cos(t)` | `20*sin(t)` | 0 | 360 |
| Ellipse | `30*cos(t)` | `12*sin(t)` | 0 | 360 |
| Wave, 40 long | `t/9` | `5*sin(t)` | 0 | 360 |
| Spiral, three turns | `t/36*cos(t)` | `t/36*sin(t)` | 0 | 1080 |
| Parabola | `t` | `t*t/40` | -30 | 30 |

## Using variables

Any name other than `t` must be one of the part's variables (see [Equations and variables](../modelling/equations.md)). With a variable `R`, the circle `R*cos(t)`, `R*sin(t)` follows every change of `R`, and so does anything built on it.

## From curve to part

- A curve that ends where it starts (a circle, an ellipse, a flower) is closed: extrude it straight away.
- An open curve needs lines to close it. Its end points are ordinary fixed sketch points, so draw lines that snap to them. They stay joined when the formula changes.
- An open curve can also be extruded as a thin wall.

## When something goes wrong

The panel says what to change:

- **A formula is not right**: a bracket is missing, or a name is not a variable. The message names the unknown name.
- **A formula has no value somewhere in the range**: for example a square root of a negative number, or a division by zero. Narrow the range of `t`.
- **The range of t is not right**: the start and the end are the same, or one of them cannot be read.
- **The tolerance cannot be met**: the curve would need more than 200 points. Use a larger tolerance, or split the range into two curves.
- **The curve crosses itself**: it still draws, but it does not make one region to extrude.

For scripts and agents: `s.equation({ x, y, t: [start, end], tol })` in the script API, and the kernel's `equationCurve` request.
