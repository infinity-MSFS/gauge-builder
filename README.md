# Infinity Gauge Builder

Visual editor for building MSFS 2024 WASM gauge instruments. Design NanoVG-based gauges on a vector canvas, bind properties to simulator variables, and export a ready-to-compile Rust crate targeting the [infinity-rs](https://github.com/anthropics/infinity-rs) SDK.

## Stack

- **Frontend:** React + TypeScript + Tailwind CSS + Zustand
- **Backend:** Rust (Tauri v2)
- **Output:** Rust crate (`wasm32-wasip1`) using `msfs` / `msfs_derive` from infinity-rs

## Projects

A project is a folder holding one scene per gauge plus a `project.ron` manifest
that registers them. Open one from the toolbar's **Project** menu and its gauges
appear as tabs; switching tabs writes the gauge you are leaving, so there is no
unsaved state to lose.

```text
dc-gauge-builder-projects/
  project.ron          the manifest — one entry per gauge, plus the tab order
  altimeter.ron        a gauge: elements, variables and reference metadata
  airspeed.ron
  refs/                tracing images, namespaced per gauge
  out/altimeter/       the crate codegen emits for that gauge
```

- **Tabs** — click to switch, double-click to rename, drag to reorder,
  right-click for rename / duplicate / delete, `+` for a new gauge.
- **Adoption** — any `*.ron` scene sitting in the folder is registered when the
  project opens, so pointing this at a directory of existing scenes just works,
  and a folder that has never been a project becomes one on first open.
- **Per-gauge state** — elements, sim variables and reference images all belong
  to the gauge, and travel in its scene file. Each gauge builds into its own
  crate under `out/`, so a build never overwrites a sibling.
- The last project reopens on the next launch. Without one, the editor still
  works on a single loose scene file through the same menu.

## The editor

### Tools

| Key | Tool | Notes |
|---|---|---|
| `V` | Select | Move, scale, marquee and multi-select |
| `A` | Direct Select | Drag anchors and bezier handles |
| `P` | Pen | Draw a new path, or continue an open one |
| `R` | Rectangle | Drag to size; `Shift` for a square |
| `O` | Circle | Drags outward from the centre |
| `C` | Arc | Drag a radius, then sweep the two angle handles |
| `L` | Line | `Shift` constrains to 15° steps |
| `T` | Text | Click to place, double-click to edit in place |
| `H` | Hand | Pan (or hold `Space` with any tool) |

### Paths

Paths are fully editable on canvas, not just in code:

- **Pen** — click for a corner anchor, click-drag for a smooth one with handles. Click the first anchor to close, `Enter` or double-click to finish, `Backspace` to undo the last anchor.
- **Direct Select** — drag anchors and handles; `Alt`-drag a handle to break its symmetry, `Alt`-click an anchor to toggle corner ⇄ smooth, `Alt`-click a segment to insert an anchor (the curve is split exactly, so the shape doesn't shift).
- **Convert to Path** turns a rect, circle, arc or line into an editable path with matching geometry.
- Each anchor's X and Y can be bound to a sim variable independently, so a path can deform at runtime.

### Snapping

Object, artboard and grid snapping, with magenta guides showing what caught. Element edges, centres, path anchors and circle centres are all targets, as are the artboard edges and centre. Alignment always wins over the grid, so smart guides still fire on a coarse grid. Hold `Ctrl` to bypass snapping mid-drag; the snap radius is in screen pixels, so it tightens as you zoom in.

### Layout

Align and distribute (aligning to the artboard when only one element is selected), z-ordering within the element's own parent, group/ungroup, per-layer lock and hide, drag-to-reorder and drag-into-group in the layer list, and double-click to enter a group for isolated editing.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save the active gauge into the project |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+D` | Duplicate |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / ungroup |
| `Ctrl+A` | Select all |
| `Ctrl+]` / `Ctrl+[` | Bring forward / send backward (add `Shift` for front/back) |
| Arrows | Nudge 1px — `Shift` for two grid steps, `Alt` for 0.5px |
| `Delete` | Remove the selection, or the selected anchors |
| `Esc` | Cancel the pen, leave a group, or deselect |
| `Ctrl+0` / `Ctrl+F` | Fit artboard |
| `Ctrl+1` | Zoom to 100% |
| `Ctrl++` / `Ctrl+-` | Zoom in / out |
| `'` / `;` | Toggle grid / snapping |
| `Space + drag` | Pan |
| `Scroll` | Zoom |
| `?` | Shortcut reference |

## Other features

- **Scene graph** with Rect (with corner radius), Circle, Arc, Line, Text, Path and Group elements
- **Groups** with translate, rotate, scale, opacity and a draggable **pivot** — put the pivot on a needle's hub and bind rotation to a sim variable
- **Modifiers** — rectangular clip, plus linear and radial arrays for tick marks
- **Reference images** — drop or paste images to trace over, with per-image opacity, lock and visibility
- **Variables** — define LVars and AVars, bind element properties to sim data at runtime; they are saved with the gauge
- **BoundValue system** — any numeric property can be a literal, LVar, AVar, or RPN expression
- **Text** with static labels or bound values, horizontal/vertical alignment and decimal precision, mapped to `ctx.text_align()`
- **Codegen** — generates `gauge.rs`, `draw.rs`, `vars.rs`, and `Cargo.toml` matching the infinity-rs API
- **Build** — codegen-only, `cargo check`, or full `wasm32-wasip1` release build
- **Undo/redo** with coalescing, so scrubbing a field is one step rather than dozens
- **Projects** — a folder of gauges with a manifest, switched through tabs; scenes save as RON either way

## Getting Started

```bash
bun install

bun tauri dev

bun tauri build
```

Requires [Rust](https://rustup.rs/) and the Tauri v2 CLI prerequisites.

## Tests

```bash
bun test                      # canvas geometry, path editing and snapping
cd src-tauri && cargo test    # scene round-trips, projects, refs and codegen
```

## License

MIT
